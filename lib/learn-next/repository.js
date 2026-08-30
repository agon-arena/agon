"use strict";

// Accès Supabase du moteur "À apprendre ensuite" — toutes les requêtes
// vivent ici, jamais dans engine.js (orchestration pure) ni scoring.js
// (calcul pur). Chaque fonction est bornée par construction :
//   - soit par le graphe propre à l'UTILISATEUR (ses acquisitions, ses
//     voisins directs dans culture_generale_notion_links) — jamais un scan
//     de toute la base ;
//   - soit par knowledge_nodes, indexée sur solar_system_id/importance_score,
//     limitée explicitement (jamais de select() sans limit()).
// Aucun appel IA dans ce fichier.
//
// knowledge_nodes EST UNE MATÉRIALISATION, PAS UNE SOURCE DE VÉRITÉ (revue
// du 27/08/2026, section 2) : l'identité canonique d'une connaissance reste
// exclusivement (subject_type, subject_source_id), jamais un id propre à
// cette table. display_name/solar_system_id/star_id y sont dupliqués pour
// accélérer les requêtes (impossible de lister efficacement "les
// connaissances les plus importantes hors du catalogue déjà connu" sans un
// index dédié), mais restent reconstructibles à tout moment depuis les
// catalogues canoniques (user_article_acquisitions, culture_generale_notion_links
// — cf. le backfill de data/migration-learn-next-engine.sql, ré-exécutable
// sans risque). Si cette table est vidée ou corrompue, aucune information
// métier n'est perdue : seul le moteur de recommandation redevient
// temporairement moins précis, jamais en échec (cf. upsertKnowledgeNode plus
// bas et son usage best-effort dans server.js).

const { cultureGeneraleNotionKey } = require("../culture-generale-links");

const ECLAIRAGE_ACQUISITION_SELECT = "eclairage_type, eclairage_source_id, eclairage_name, solar_system_id, star_id, acquired_at";
const KNOWLEDGE_NODE_SELECT = "subject_type,subject_source_id,display_name,solar_system_id,star_id,link_degree,acquisition_count,importance_score,importance_tier";

// Corpus réellement acquis par l'utilisateur (même table que "Mes acquis"),
// déduplique par identité (type, source_id) — une même connaissance ne peut
// être acquise qu'une fois par utilisateur (contrainte UNIQUE existante),
// la déduplication ici est une défense supplémentaire bon marché.
async function fetchUserAcquiredEclairages(supabase, userId) {
  const { data, error } = await supabase
    .from("user_article_acquisitions")
    .select(ECLAIRAGE_ACQUISITION_SELECT)
    .eq("user_id", userId)
    .not("eclairage_type", "is", null)
    .not("eclairage_source_id", "is", null)
    .limit(2000);
  if (error) throw new Error(error.message);
  const seen = new Set();
  const rows = [];
  for (const row of data || []) {
    if (!row.eclairage_type || !row.eclairage_source_id) continue;
    const key = cultureGeneraleNotionKey(row.eclairage_type, row.eclairage_source_id);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      type: row.eclairage_type,
      sourceId: String(row.eclairage_source_id),
      name: row.eclairage_name,
      solarSystemId: row.solar_system_id,
      starId: row.star_id,
      acquiredAt: row.acquired_at
    });
  }
  return rows;
}

// Solars explicitement actifs pour cet utilisateur (cf. user_solar_activations,
// "univers actif" — même table que le moteur de classification existant).
async function fetchUserActiveSolarIds(supabase, userId) {
  const { data, error } = await supabase
    .from("user_solar_activations")
    .select("solar_system_id")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((row) => row.solar_system_id).filter((id) => Number.isFinite(id)))];
}

// Liens globaux (culture_generale_notion_links) touchant au moins une des
// connaissances acquises par l'utilisateur — même requête à deux lectures
// indexées que /api/users/intellectual-universe (server.js), jamais un
// .or() interpolé. La table est PARTAGÉE entre tous les utilisateurs : pour
// CET utilisateur, l'extrémité non acquise d'un tel lien est un candidat
// naturel (cf. buildConnectedCandidates).
async function fetchNeighborLinks(supabase, fetchAllSupabaseRowsIn, acquiredSourceIds) {
  if (!acquiredSourceIds.length) return [];
  const columns = "id,type_a,source_id_a,name_a,type_b,source_id_b,name_b,label";
  const [fromA, fromB] = await Promise.all([
    fetchAllSupabaseRowsIn(acquiredSourceIds, (chunk) =>
      supabase.from("culture_generale_notion_links").select(columns).in("source_id_a", chunk).order("id", { ascending: true })
    ),
    fetchAllSupabaseRowsIn(acquiredSourceIds, (chunk) =>
      supabase.from("culture_generale_notion_links").select(columns).in("source_id_b", chunk).order("id", { ascending: true })
    )
  ]);
  if (fromA.error || fromB.error) throw new Error((fromA.error || fromB.error).message);
  const seen = new Set();
  const rows = [];
  for (const row of [...(fromA.data || []), ...(fromB.data || [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

// Regroupe les liens bruts en candidats "connectés" : l'extrémité NON
// acquise de chaque lien touchant exactement une extrémité acquise (les
// deux acquises = association déjà connue, aucune acquise = faux positif
// d'un filtrage par seul source_id, cf. commentaire de la requête ci-dessus
// — les deux cas sont ignorés). Une même connaissance candidate peut être
// pointée par plusieurs voisins acquis : regroupée en une seule entrée.
//
// shareableTypes (Set) : filtre de confidentialité (cf. config.js
// SHAREABLE_KNOWLEDGE_TYPES) — un candidat d'un type non partageable (import
// personnel, "comprendre") n'est JAMAIS ajouté au pool, quel que soit son
// score potentiel. Le côté ACQUIS du lien n'est jamais filtré : un import
// personnel de CET utilisateur continue de compter normalement comme voisin
// pour son propre calcul de readiness, seul le fait de le proposer comme
// candidat à recommander est exclu.
function buildConnectedCandidates(linkRows, acquiredKeySet, shareableTypes) {
  const candidates = new Map();
  for (const link of linkRows) {
    const keyA = cultureGeneraleNotionKey(link.type_a, link.source_id_a);
    const keyB = cultureGeneraleNotionKey(link.type_b, link.source_id_b);
    const aAcquired = acquiredKeySet.has(keyA);
    const bAcquired = acquiredKeySet.has(keyB);
    if (aAcquired === bAcquired) continue;
    const acquiredKey = aAcquired ? keyA : keyB;
    const candidateType = aAcquired ? link.type_b : link.type_a;
    if (shareableTypes && !shareableTypes.has(candidateType)) continue;
    const candidateSourceId = String(aAcquired ? link.source_id_b : link.source_id_a);
    const candidateName = aAcquired ? link.name_b : link.name_a;
    const candidateKey = cultureGeneraleNotionKey(candidateType, candidateSourceId);
    if (!candidates.has(candidateKey)) {
      candidates.set(candidateKey, {
        key: candidateKey,
        type: candidateType,
        sourceId: candidateSourceId,
        name: candidateName,
        neighborKeys: new Set()
      });
    }
    candidates.get(candidateKey).neighborKeys.add(acquiredKey);
  }
  return candidates;
}

// Mastery FSRS agrégée par Subject (type::sourceId) pour cet utilisateur —
// même requête et même agrégation (moyenne de computeRetrievability sur les
// MemoryItems du Subject) que GET /api/users/notion-quizzes (server.js),
// réutilisée telle quelle plutôt que réinventée. Bornée par le nombre total
// de MemoryItems déjà répondus par CET utilisateur, jamais par la base
// entière.
async function fetchUserSubjectMasteryByKey(supabase, userId, computeRetrievability, now = new Date()) {
  const { data, error } = await supabase
    .from("memory_item_fsrs_states")
    .select("state, stability, last_review_at, memory_items(subject_type, subject_source_id)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const sums = new Map();
  for (const row of data || []) {
    const mi = row.memory_items;
    if (!mi) continue;
    const key = cultureGeneraleNotionKey(mi.subject_type, mi.subject_source_id);
    const retrievability = computeRetrievability(
      { state: row.state, stability: row.stability, lastReviewAt: row.last_review_at },
      now
    );
    const entry = sums.get(key) || { sum: 0, count: 0 };
    entry.sum += retrievability;
    entry.count += 1;
    sums.set(key, entry);
  }
  const masteryByKey = new Map();
  for (const [key, { sum, count }] of sums) masteryByKey.set(key, count > 0 ? sum / count : 0);
  return masteryByKey;
}

// knowledge_nodes pour un ensemble de clés (type::sourceId) — regroupées par
// type pour permettre un .in() sur subject_source_id par lot (clé composite,
// pas de .in() direct sur une paire). Le nombre de types Éclairages distincts
// reste toujours petit (une quinzaine), jamais un facteur d'explosion. Les
// lots par type sont indépendants les uns des autres : lancés en parallèle
// (Promise.all) plutôt qu'en séquence — mesuré en conditions réelles le
// 27/08/2026, c'était le principal contributeur de latence (jusqu'à 3
// allers-retours Supabase enchaînés pour un profil à 3 types de candidats).
async function fetchKnowledgeNodesByKeys(supabase, fetchAllSupabaseRowsIn, keys) {
  const map = new Map();
  if (!keys.length) return map;
  const idsByType = new Map();
  for (const key of keys) {
    const sep = key.indexOf("::");
    if (sep < 0) continue;
    const type = key.slice(0, sep);
    const id = key.slice(sep + 2);
    if (!idsByType.has(type)) idsByType.set(type, []);
    idsByType.get(type).push(id);
  }
  const results = await Promise.all([...idsByType.entries()].map(([type, ids]) =>
    fetchAllSupabaseRowsIn(ids, (chunk) =>
      supabase.from("knowledge_nodes").select(KNOWLEDGE_NODE_SELECT).eq("subject_type", type).in("subject_source_id", chunk)
    )
  ));
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      map.set(cultureGeneraleNotionKey(row.subject_type, row.subject_source_id), row);
    }
  }
  return map;
}

// Pool de découverte : les connaissances les plus "importantes" du catalogue
// global — une seule requête indexée (importance_score DESC), jamais un scan
// complet. Ne filtre PLUS par Solar actif/inactif (revue du 27/08/2026,
// section 5) : exclure purement et simplement les Solars déjà fréquentés
// interdirait toute vraie découverte à un utilisateur déjà actif dans
// beaucoup de branches. La nouveauté est désormais un score CONTINU
// (cf. scoring.js computeNoveltyScore), calculé par l'appelant (engine.js)
// à partir de solarAcquisitionCounts — jamais un filtre SQL binaire. Seules
// les connaissances déjà acquises ou déjà couvertes par le graphe
// (excludeKeys) sont retirées, en JS après un fetch volontairement borné
// (poolSize + marge) plutôt qu'un NOT IN composite (type, id) côté SQL —
// la marge reste petite, ce n'est jamais un téléchargement massif.
//
// shareableTypes (array) : filtre de confidentialité (cf. config.js
// SHAREABLE_KNOWLEDGE_TYPES), appliqué ici directement en SQL (.in()) — un
// import personnel ou un quiz "comprendre" ne doit JAMAIS apparaître comme
// candidat de découverte pour un autre utilisateur.
//
// orderBy (revue du 30/08/2026, cold-start) : par défaut "importance_score"
// (comportement historique, inchangé pour un utilisateur avec acquis — le
// classement final y reste de toute façon piloté par computeFinalScore en
// aval). L'appelant (engine.js) passe "acquisition_count" pour un utilisateur
// cold-start : l'importance_score mélange connectivité ET popularité à parts
// égales (cf. scoring.js computeImportanceScore), donc un sujet réellement
// très adopté mais peu connecté au graphe pourrait ne pas figurer dans les
// `poolSize` premiers résultats si on ne trie QUE par importance_score —
// vérifié en base de production le 30/08/2026 (un sujet à 3 acquisitions
// absent du top 30 par importance_score). importance_score reste un ordre
// secondaire (départage) dans les deux cas.
async function fetchDiscoveryCandidates(supabase, { excludeKeys, poolSize, shareableTypes, orderBy = "importance_score" }) {
  let query = supabase
    .from("knowledge_nodes")
    .select(KNOWLEDGE_NODE_SELECT)
    .in("subject_type", shareableTypes)
    .order(orderBy, { ascending: false });
  if (orderBy !== "importance_score") query = query.order("importance_score", { ascending: false });
  const { data, error } = await query.limit(poolSize + excludeKeys.size);
  if (error) throw new Error(error.message);
  return (data || [])
    .filter((row) => !excludeKeys.has(cultureGeneraleNotionKey(row.subject_type, row.subject_source_id)))
    .slice(0, poolSize);
}

// Derniers événements "shown" de cet utilisateur (fenêtre courte, requête
// indexée sur user_id+created_at) — sert uniquement à la pénalité de
// saturation thématique (lib/learn-next/scoring.js computeSaturationPenalty),
// jamais à autre chose.
async function fetchRecentShownSolarCounts(supabase, userId, { lookbackEvents, lookbackDays }) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("recommendation_events")
    .select("solar_system_id")
    .eq("user_id", userId)
    .eq("event_type", "shown")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(lookbackEvents);
  if (error) throw new Error(error.message);
  const counts = new Map();
  for (const row of data || []) {
    if (!row.solar_system_id) continue;
    counts.set(row.solar_system_id, (counts.get(row.solar_system_id) || 0) + 1);
  }
  return counts;
}

// Upsert best-effort d'un knowledge_node (section 12 : enrichissement
// mutualisé, jamais recalculé par utilisateur). Lit d'abord la ligne
// existante pour incrémenter les compteurs en JS (Supabase upsert ne sait
// pas exprimer "colonne = colonne + 1") — écriture peu fréquente (une fois
// par acquisition/lien nouvellement créé), une course concurrente rare y
// est tolérée (mêmes garanties "best-effort" que le reste des écritures
// dérivées de ce chemin, cf. server.js recordDailyQuizEclairageAcquisition).
// N'écrase JAMAIS silencieusement un display_name/solar/star déjà connu par
// une valeur vide.
//
// Confidentialité (cf. config.js SHAREABLE_KNOWLEDGE_TYPES) : un type non
// partageable (import personnel, "comprendre") n'est jamais matérialisé ici
// — no-op silencieux, jamais une erreur (l'acquisition/le lien qui a
// déclenché cet appel reste écrit normalement, seul le cache de
// recommandation ne l'apprend jamais comme candidat).
async function upsertKnowledgeNode(supabase, computeImportanceScore, computeImportanceTier, importanceConfig, {
  type,
  sourceId,
  name,
  solarSystemId,
  starId,
  incrementAcquisition = false,
  incrementLinkDegreeBy = 0
}) {
  if (importanceConfig.SHAREABLE_KNOWLEDGE_TYPES && !importanceConfig.SHAREABLE_KNOWLEDGE_TYPES.includes(type)) return;

  const { data: existing, error: readError } = await supabase
    .from("knowledge_nodes")
    .select("link_degree, acquisition_count, display_name, solar_system_id, star_id")
    .eq("subject_type", type)
    .eq("subject_source_id", sourceId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const linkDegree = (existing?.link_degree || 0) + incrementLinkDegreeBy;
  const acquisitionCount = (existing?.acquisition_count || 0) + (incrementAcquisition ? 1 : 0);
  const importanceScore = computeImportanceScore({ linkDegree, acquisitionCount }, importanceConfig);
  const importanceTier = computeImportanceTier(importanceScore, importanceConfig.IMPORTANCE_TIER_THRESHOLDS);

  const { error } = await supabase.from("knowledge_nodes").upsert({
    subject_type: type,
    subject_source_id: sourceId,
    display_name: name || existing?.display_name || null,
    solar_system_id: solarSystemId || existing?.solar_system_id || null,
    star_id: starId || existing?.star_id || null,
    link_degree: linkDegree,
    acquisition_count: acquisitionCount,
    importance_score: importanceScore,
    importance_tier: importanceTier,
    updated_at: new Date().toISOString()
  }, { onConflict: "subject_type,subject_source_id" });
  if (error) throw new Error(error.message);
}

// Noms de Solar Systems pour un ensemble d'ids (reason_data "Crée un pont
// entre X et Y") — une seule requête .in(), jamais une par candidat.
async function fetchSolarSystemNames(supabase, ids) {
  const uniqueIds = [...new Set((ids || []).filter((id) => Number.isInteger(id)))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase.from("solar_systems").select("id, name").in("id", uniqueIds);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [row.id, row.name]));
}

// ── V2 : fallback IA (mission du 27/08/2026) ────────────────────────────────
// ai_learning_proposals mutualise les PROPOSITIONS entre utilisateurs, jamais
// les connaissances elles-mêmes (cf. data/migration-learn-next-ai-fallback.sql
// pour l'avertissement complet). Toutes les fonctions ci-dessous restent de
// simples lectures/écritures bornées par clé primaire — jamais un scan.

const AI_LEARNING_PROPOSALS_TABLE = "ai_learning_proposals";

// Verrou anti-concurrence (section 14) : tente de "réserver" cette signature
// avant tout appel IA. Retourne true si cette requête a gagné le droit
// d'appeler l'IA (insertion réussie, ou reprise d'une ligne "pending" restée
// bloquée trop longtemps — cf. AI_FALLBACK_PENDING_STALE_MS), false sinon
// (une autre requête est déjà en train de calculer cette signature, ou une
// réponse fraîche existe déjà — l'appelant doit alors relire via
// fetchCachedGapProposals plutôt que réessayer d'appeler l'IA).
async function claimGapProposalSlot(supabase, gapSignature, config) {
  const { error: insertError } = await supabase
    .from(AI_LEARNING_PROPOSALS_TABLE)
    .insert({ gap_signature: gapSignature, status: "pending" });
  if (!insertError) return true;
  // 23505 = violation de contrainte unique (clé déjà prise) — le seul cas où
  // une reprise a du sens ; toute autre erreur remonte telle quelle.
  if (insertError.code !== "23505") throw new Error(insertError.message);

  const { data: existing, error: readError } = await supabase
    .from(AI_LEARNING_PROPOSALS_TABLE)
    .select("status, updated_at")
    .eq("gap_signature", gapSignature)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!existing) return false;

  // Une ligne "failed" (échec IA précédent — quota, config, erreur réseau…)
  // ne correspond à AUCUN appel en cours : aucun risque de concurrence à la
  // reprendre immédiatement, contrairement à "pending" ci-dessous (bug
  // constaté le 30/08/2026 : sans ce cas, une signature en échec restait
  // bloquée indéfiniment, plus jamais retentée par personne).
  if (existing.status === "failed") {
    const { error: reclaimFailedError, count: reclaimedFailedCount } = await supabase
      .from(AI_LEARNING_PROPOSALS_TABLE)
      .update({ status: "pending", updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("gap_signature", gapSignature)
      .eq("status", "failed");
    if (reclaimFailedError) throw new Error(reclaimFailedError.message);
    return (reclaimedFailedCount || 0) > 0;
  }

  if (existing.status !== "pending") return false;
  const ageMs = Date.now() - new Date(existing.updated_at).getTime();
  if (ageMs < config.AI_FALLBACK_PENDING_STALE_MS) return false;

  // Reprise optimiste d'une ligne bloquée — condition sur l'ancien statut
  // pour ne jamais écraser une réponse qui vient d'arriver entre-temps
  // (course résiduelle tolérée, même principe "best-effort" que le reste du
  // moteur, cf. upsertKnowledgeNode).
  const { error: reclaimError, count } = await supabase
    .from(AI_LEARNING_PROPOSALS_TABLE)
    .update({ status: "pending", updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("gap_signature", gapSignature)
    .eq("status", "pending");
  if (reclaimError) throw new Error(reclaimError.message);
  return (count || 0) > 0;
}

// Propositions déjà prêtes et encore fraîches pour cette signature — null si
// absentes, encore en cours de calcul, expirées (cooldown dépassé) ou déjà
// adoptées (le vrai sujet existe alors dans le catalogue normal, cf. section
// 9 : une signature adoptée n'est plus jamais re-proposée par la V2).
async function fetchCachedGapProposals(supabase, gapSignature, config) {
  const { data, error } = await supabase
    .from(AI_LEARNING_PROPOSALS_TABLE)
    .select("status, proposals, updated_at, adopted_at")
    .eq("gap_signature", gapSignature)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "ready" || data.adopted_at) return null;
  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  if (ageMs > config.AI_FALLBACK_COOLDOWN_MS) return null;
  return Array.isArray(data.proposals) ? data.proposals : null;
}

async function saveGapProposalsReady(supabase, gapSignature, { proposals, model, seedTopicCount }) {
  const { error } = await supabase.from(AI_LEARNING_PROPOSALS_TABLE).update({
    status: "ready",
    proposals,
    model,
    seed_topic_count: seedTopicCount,
    updated_at: new Date().toISOString()
  }).eq("gap_signature", gapSignature);
  if (error) throw new Error(error.message);
}

async function markGapProposalFailed(supabase, gapSignature) {
  const { error } = await supabase.from(AI_LEARNING_PROPOSALS_TABLE)
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("gap_signature", gapSignature);
  if (error) throw new Error(error.message);
}

// Marque cette signature comme adoptée (section 9) : plus jamais reproposée,
// le sujet existe désormais réellement dans le catalogue (daily_quiz), qui le
// rendra visible à la V1 via le chemin normal (acquisition/lien) au fil de
// son usage.
async function markGapProposalAdopted(supabase, gapSignature, adoptedTitle) {
  const { error } = await supabase.from(AI_LEARNING_PROPOSALS_TABLE)
    .update({ adopted_title: adoptedTitle, adopted_at: new Date().toISOString() })
    .eq("gap_signature", gapSignature);
  if (error) throw new Error(error.message);
}

// Sujets libres déjà générés ("notion:custom:*") — même requête que
// findEquivalentGeneratedCustomTopic (server.js), réutilisée ici pour ne
// jamais dupliquer cette lecture : sert à dédupliquer une proposition IA
// contre le catalogue existant AVANT de l'afficher comme "nouvelle" (section
// 6). Une seule lecture pour l'ensemble des propositions d'un fallback,
// jamais une requête par proposition.
async function fetchGeneratedCustomTopics(supabase) {
  const { data, error } = await supabase
    .from("daily_quiz")
    .select("slot, quiz_date, questions")
    .like("slot", "notion:custom:%");
  if (error) throw new Error(error.message);
  const latestBySlot = new Map();
  for (const row of data || []) {
    const existing = latestBySlot.get(row.slot);
    if (!existing || row.quiz_date > existing.quiz_date) latestBySlot.set(row.slot, row);
  }
  const topics = [];
  for (const row of latestBySlot.values()) {
    const name = row.questions?.[0]?.searchTopic || row.questions?.[0]?.sourceName || null;
    if (!name) continue;
    topics.push({ name, slot: row.slot, quizDate: row.quiz_date });
  }
  return topics;
}

module.exports = {
  fetchUserAcquiredEclairages,
  fetchUserActiveSolarIds,
  fetchNeighborLinks,
  buildConnectedCandidates,
  fetchUserSubjectMasteryByKey,
  fetchKnowledgeNodesByKeys,
  fetchDiscoveryCandidates,
  fetchRecentShownSolarCounts,
  fetchSolarSystemNames,
  upsertKnowledgeNode,
  claimGapProposalSlot,
  fetchCachedGapProposals,
  saveGapProposalsReady,
  markGapProposalFailed,
  markGapProposalAdopted,
  fetchGeneratedCustomTopics
};
