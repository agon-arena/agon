"use strict";

// Vérifie le comportement cible de la revue du 30/08/2026 : le catalogue (V1)
// a la priorité, et le nombre de places qu'il reste à combler par l'IA (V2)
// se déduit directement de `recommendations.length` une fois le seuil de
// pertinence appliqué (engine.js) — jamais un compteur séparé. Ce fichier ne
// mocke aucun appel réseau/IA (cf. test/learn-next-no-ai-calls.test.js pour
// la garantie statique correspondante) : il vérifie uniquement la partie
// déterministe (engine.js + ai-fallback.shouldTriggerFallback).

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeLearnNextRecommendations } = require("../lib/learn-next/engine");
const { computeRetrievability } = require("../lib/spaced-repetition/fsrs-scheduler");
const learnNextConfig = require("../lib/learn-next/config");
const learnNextAiFallback = require("../lib/learn-next/ai-fallback");

// Même mock minimal que test/learn-next-engine.test.js (select/eq/in/not/gte/
// order/limit/or/maybeSingle/upsert, toujours "thenable").
function createSupabaseMock(seedTables) {
  const tables = {};
  for (const [name, rows] of Object.entries(seedTables)) tables[name] = rows.map((r) => ({ ...r }));
  function matchFilters(row, filters) {
    return filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "in") return (f.vals || []).includes(row[f.col]);
      if (f.type === "not-is-null") return row[f.col] !== null && row[f.col] !== undefined;
      if (f.type === "gte") return row[f.col] >= f.val;
      return true;
    });
  }
  function builder(tableName) {
    const filters = [];
    let limitN = null;
    let orderState = null;
    const self = {
      select() { return self; },
      eq(col, val) { filters.push({ type: "eq", col, val }); return self; },
      in(col, vals) { filters.push({ type: "in", col, vals }); return self; },
      not(col, op, val) { if (op === "is" && val === null) filters.push({ type: "not-is-null", col }); return self; },
      gte(col, val) { filters.push({ type: "gte", col, val }); return self; },
      order(col, opts) { orderState = { col, ascending: opts?.ascending !== false }; return self; },
      limit(n) { limitN = n; return self; },
      async maybeSingle() {
        const rows = (tables[tableName] || []).filter((r) => matchFilters(r, filters));
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) {
        try {
          let rows = (tables[tableName] || []).filter((r) => matchFilters(r, filters));
          if (orderState) {
            rows = [...rows].sort((a, b) => {
              const av = a[orderState.col];
              const bv = b[orderState.col];
              if (av === bv) return 0;
              return orderState.ascending ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
            });
          }
          if (limitN != null) rows = rows.slice(0, limitN);
          resolve({ data: rows, error: null });
        } catch (error) {
          reject(error);
        }
      }
    };
    return self;
  }
  return { from: (tableName) => builder(tableName) };
}
async function fakeFetchAllSupabaseRowsIn(ids, buildChunkQuery) { return buildChunkQuery(ids); }
const BASE_DEPS = { fetchAllSupabaseRowsIn: fakeFetchAllSupabaseRowsIn, computeRetrievability };

// Construit `goodCount` clusters de candidats INDÉPENDANTS (chacun sa propre
// paire d'acquis + son propre candidat "citation"), chacun taillé pour
// franchir confortablement le seuil de pertinence (même construction que
// test/learn-next-engine.test.js, "confidentialité" : deux voisins mastery
// neutre/haute dans le même Solar, candidat dans un Solar dédié) — jamais de
// dépendance entre clusters (Solars et ids tous distincts), pour isoler
// strictement l'effet du NOMBRE de bons candidats disponibles.
function buildGoodCandidatesFixture(goodCount) {
  const acquisitions = [];
  const fsrsStates = [];
  const links = [];
  const nodes = [];
  const solars = [];
  const now = new Date().toISOString();

  // goodCount=0 doit rester un profil NON vide (coldStart=false) — l'IA reste
  // désactivée à 0 acquisition par construction (cf. shouldTriggerFallback),
  // ce qui est un cas déjà couvert séparément (cold start = découverte
  // uniquement, jamais l'IA) et distinct de "0 bon candidat CATALOGUE avec un
  // profil réel", le scénario réellement visé ici. Un acquis isolé, sans
  // aucun lien, ne produit aucun candidat connecté ni de découverte (le pool
  // de découverte reste vide tant qu'aucun knowledge_nodes partageable
  // n'existe dans cette fixture).
  if (goodCount === 0) {
    acquisitions.push({ user_id: "u1", eclairage_type: "concept", eclairage_source_id: "isole", eclairage_name: "Notion isolée", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" });
    fsrsStates.push({ user_id: "u1", state: "Review", stability: 60, last_review_at: now, memory_items: { subject_type: "concept", subject_source_id: "isole" } });
    solars.push({ id: 1, name: "Branche isolée" });
  }

  for (let i = 0; i < goodCount; i += 1) {
    const userSolarId = 100 + i * 2;
    const candidateSolarId = 101 + i * 2;
    const a1 = `acq${i}a`, a2 = `acq${i}b`, cand = `cand${i}`;
    acquisitions.push(
      { user_id: "u1", eclairage_type: "concept", eclairage_source_id: a1, eclairage_name: `Notion ${i}a`, solar_system_id: userSolarId, star_id: null, acquired_at: "2026-01-01" },
      { user_id: "u1", eclairage_type: "concept", eclairage_source_id: a2, eclairage_name: `Notion ${i}b`, solar_system_id: userSolarId, star_id: null, acquired_at: "2026-01-02" }
    );
    fsrsStates.push(
      { user_id: "u1", state: "Review", stability: 60, last_review_at: now, memory_items: { subject_type: "concept", subject_source_id: a1 } },
      { user_id: "u1", state: "Review", stability: 60, last_review_at: now, memory_items: { subject_type: "concept", subject_source_id: a2 } }
    );
    links.push(
      { id: i * 2 + 1, type_a: "concept", source_id_a: a1, name_a: `Notion ${i}a`, type_b: "citation", source_id_b: cand, name_b: `Candidat ${i}`, label: "lien" },
      { id: i * 2 + 2, type_a: "concept", source_id_a: a2, name_a: `Notion ${i}b`, type_b: "citation", source_id_b: cand, name_b: `Candidat ${i}`, label: "lien" }
    );
    nodes.push({ subject_type: "citation", subject_source_id: cand, display_name: `Candidat ${i}`, solar_system_id: candidateSolarId, star_id: null, link_degree: 3, acquisition_count: 50, importance_score: 0.8, importance_tier: "fondamental" });
    solars.push({ id: userSolarId, name: `Branche acquise ${i}` }, { id: candidateSolarId, name: `Branche candidate ${i}` });
  }

  return createSupabaseMock({
    user_article_acquisitions: acquisitions,
    user_solar_activations: [...new Set(acquisitions.map((a) => a.solar_system_id))].map((solar_system_id) => ({ user_id: "u1", solar_system_id })),
    culture_generale_notion_links: links,
    memory_item_fsrs_states: fsrsStates,
    recommendation_events: [],
    knowledge_nodes: nodes,
    solar_systems: solars
  });
}

const TARGET = learnNextConfig.DEFAULT_RECOMMENDATION_LIMIT;

test(`la cible par défaut du moteur est ${TARGET} (comportement "toujours ${TARGET} préconisations")`, () => {
  assert.equal(TARGET, 3);
});

for (const goodCount of [0, 1, 2, 3, 4]) {
  test(`composition : ${goodCount} bon(s) candidat(s) catalogue -> ${Math.min(goodCount, TARGET)} affiché(s), ${Math.max(0, TARGET - Math.min(goodCount, TARGET))} place(s) pour l'IA`, async () => {
    const supabase = buildGoodCandidatesFixture(goodCount);
    const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: TARGET });

    const expectedShown = Math.min(goodCount, TARGET);
    assert.equal(result.recommendations.length, expectedShown);
    assert.ok(result.recommendations.every((r) => r.subjectType === "citation"));

    const neededCount = Math.max(0, TARGET - result.recommendations.length);
    assert.equal(neededCount, TARGET - expectedShown);

    const shouldCallAi = learnNextAiFallback.shouldTriggerFallback({ neededCount, coldStart: result.coldStart }, learnNextConfig);
    assert.equal(shouldCallAi, neededCount > 0, "l'IA ne doit être sollicitée QUE s'il manque réellement des places");
  });
}

test("aucun candidat catalogue médiocre n'est conservé juste pour éviter un appel IA (seuil de pertinence réellement appliqué)", async () => {
  // Un seul cluster, mais délibérément TROP FAIBLE (une seule notion source,
  // pas assez de connexions/maîtrise pour franchir le seuil) : doit être
  // écarté de la liste affichée, jamais gardé comme "3e préconisation" par
  // défaut.
  const supabase = createSupabaseMock({
    user_article_acquisitions: [
      { user_id: "u1", eclairage_type: "concept", eclairage_source_id: "faible", eclairage_name: "Notion faible", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" }
    ],
    user_solar_activations: [{ user_id: "u1", solar_system_id: 1 }],
    culture_generale_notion_links: [
      { id: 1, type_a: "concept", source_id_a: "faible", name_a: "Notion faible", type_b: "citation", source_id_b: "mediocre", name_b: "Candidat médiocre", label: "lien ténu" }
    ],
    memory_item_fsrs_states: [], // pas de mastery mesurable -> neutre par défaut
    recommendation_events: [],
    knowledge_nodes: [
      { subject_type: "citation", subject_source_id: "mediocre", display_name: "Candidat médiocre", solar_system_id: 2, star_id: null, link_degree: 20, acquisition_count: 1, importance_score: 0.1, importance_tier: "secondaire" }
    ],
    solar_systems: [{ id: 1, name: "A" }, { id: 2, name: "B" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: TARGET });
  assert.equal(result.recommendations.length, 0, "un candidat techniquement disponible mais insuffisamment pertinent ne doit jamais remplir une place");

  const neededCount = TARGET - result.recommendations.length;
  assert.equal(neededCount, TARGET);
  assert.ok(learnNextAiFallback.shouldTriggerFallback({ neededCount, coldStart: result.coldStart }, learnNextConfig));
});

// ── Régression : doublons/quasi-doublons intra-pool (validation en conditions
// réelles du 30/08/2026) ─────────────────────────────────────────────────────
// Reproduit un cas RÉEL constaté en production : plusieurs fiches "notion:
// custom:*" distinctes (subject_source_id différents, générées séparément par
// différents visiteurs) partagent le même display_name — ex. trois fiches
// "Capitales du monde" dans knowledge_nodes. Avant le correctif, le cold-start
// réel produisait ["Brigades rouges","Capitales du monde","Capitales du
// monde"] : 2 des 3 places gâchées par la même fiche. Le filtre de redondance
// existant (isRedundant) ne compare un candidat qu'aux ACQUIS de l'utilisateur,
// jamais aux AUTRES candidats du pool — dedupeCandidatesByName (engine.js)
// comble ce trou juste avant assembleRecommendations.

test("cold-start : plusieurs fiches quasi-identiques dans le catalogue ne produisent jamais 2 préconisations identiques (régression production)", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [],
    user_solar_activations: [],
    culture_generale_notion_links: [],
    memory_item_fsrs_states: [],
    recommendation_events: [],
    knowledge_nodes: [
      // Reproduction fidèle du cas réel : 3 instances de "Capitales du monde",
      // scores volontairement proches du top pour qu'elles se disputent les
      // 3 places, une seule doit survivre (la mieux scorée).
      { subject_type: "custom", subject_source_id: "cap-1", display_name: "Capitales du monde", solar_system_id: 235, star_id: 15, link_degree: 7, acquisition_count: 5, importance_score: 0.8745, importance_tier: "fondamental" },
      { subject_type: "custom", subject_source_id: "cap-2", display_name: "Capitales du monde", solar_system_id: 235, star_id: 15, link_degree: 4, acquisition_count: 10, importance_score: 0.8429, importance_tier: "fondamental" },
      { subject_type: "custom", subject_source_id: "cap-3", display_name: "Les capitales du monde", solar_system_id: 235, star_id: 15, link_degree: 4, acquisition_count: 2, importance_score: 0.6295, importance_tier: "structurant" },
      { subject_type: "custom", subject_source_id: "brigades", display_name: "Brigades rouges", solar_system_id: 240, star_id: null, link_degree: 6, acquisition_count: 7, importance_score: 0.8845, importance_tier: "fondamental" },
      { subject_type: "custom", subject_source_id: "dieux-romains", display_name: "Dieux romains", solar_system_id: 241, star_id: null, link_degree: 4, acquisition_count: 5, importance_score: 0.7434, importance_tier: "fondamental" }
    ],
    solar_systems: [{ id: 235, name: "Géographie" }, { id: 240, name: "Histoire XXe" }, { id: 241, name: "Antiquité" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: TARGET });

  assert.equal(result.recommendations.length, TARGET, "le cold-start doit toujours produire 3 préconisations (assez de candidats distincts disponibles)");

  const names = result.recommendations.map((r) => r.name);
  const isSafeTopicEquivalent = require("../lib/topic-dedup").isSafeTopicEquivalent;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      assert.ok(!isSafeTopicEquivalent(names[i], names[j]), `doublon détecté entre "${names[i]}" et "${names[j]}" : ${JSON.stringify(names)}`);
    }
  }

  // Parmi les 3 fiches "Capitales du monde"/"Les capitales du monde", seule
  // la plus POPULAIRE doit survivre — cap-2 (10 acquisitions réelles),
  // jamais cap-1 (importance_score plus haut mais seulement 5 acquisitions) :
  // en cold-start, le classement se fait par popularité réelle (revue du
  // 30/08/2026), pas par importance_score.
  const capitalesPick = result.recommendations.find((r) => /capitale/i.test(r.name));
  assert.ok(capitalesPick, "une variante de \"Capitales du monde\" doit rester recommandée (la plus populaire)");
  assert.equal(capitalesPick.subjectSourceId, "cap-2", "seule l'instance la plus populaire (acquisition_count le plus haut) du groupe équivalent doit être retenue");
});

test("dédoublonnage intra-pool : neededCount reflète bien la place libérée par la suppression d'un doublon (l'IA complète réellement)", async () => {
  // Deux candidats connectés distincts mais quasi-identiques (même sujet,
  // deux générations différentes) + un candidat réellement différent : sans
  // dédoublonnage, on aurait 2 "bons candidats" (donc neededCount=1) alors
  // qu'il n'y a en réalité qu'UN SEUL sujet distinct de valeur -> neededCount
  // doit valoir 2, pas 1, pour que l'IA comble réellement la place libérée.
  const supabase = createSupabaseMock({
    user_article_acquisitions: [
      { user_id: "u1", eclairage_type: "concept", eclairage_source_id: "a1", eclairage_name: "Notion A1", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" },
      { user_id: "u1", eclairage_type: "concept", eclairage_source_id: "a2", eclairage_name: "Notion A2", solar_system_id: 1, star_id: null, acquired_at: "2026-01-02" }
    ],
    user_solar_activations: [{ user_id: "u1", solar_system_id: 1 }],
    culture_generale_notion_links: [
      // Deux candidats DIFFÉRENTS (ids distincts) mais quasi-identiques par le
      // nom, tous deux reliés aux 2 mêmes acquis (donc tous deux légitimement
      // "bons" pris isolément).
      { id: 1, type_a: "concept", source_id_a: "a1", name_a: "Notion A1", type_b: "citation", source_id_b: "dup-1", name_b: "Sujet dupliqué", label: "lien" },
      { id: 2, type_a: "concept", source_id_a: "a2", name_a: "Notion A2", type_b: "citation", source_id_b: "dup-1", name_b: "Sujet dupliqué", label: "lien" },
      { id: 3, type_a: "concept", source_id_a: "a1", name_a: "Notion A1", type_b: "citation", source_id_b: "dup-2", name_b: "Le sujet dupliqué", label: "lien" },
      { id: 4, type_a: "concept", source_id_a: "a2", name_a: "Notion A2", type_b: "citation", source_id_b: "dup-2", name_b: "Le sujet dupliqué", label: "lien" }
    ],
    memory_item_fsrs_states: [
      { user_id: "u1", state: "Review", stability: 60, last_review_at: new Date().toISOString(), memory_items: { subject_type: "concept", subject_source_id: "a1" } },
      { user_id: "u1", state: "Review", stability: 60, last_review_at: new Date().toISOString(), memory_items: { subject_type: "concept", subject_source_id: "a2" } }
    ],
    recommendation_events: [],
    knowledge_nodes: [
      { subject_type: "citation", subject_source_id: "dup-1", display_name: "Sujet dupliqué", solar_system_id: 2, star_id: null, link_degree: 3, acquisition_count: 50, importance_score: 0.9, importance_tier: "fondamental" },
      // Score légèrement inférieur -> doit être écarté au profit de dup-1.
      { subject_type: "citation", subject_source_id: "dup-2", display_name: "Le sujet dupliqué", solar_system_id: 2, star_id: null, link_degree: 3, acquisition_count: 40, importance_score: 0.7, importance_tier: "fondamental" }
    ],
    solar_systems: [{ id: 1, name: "A" }, { id: 2, name: "B" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: TARGET });

  assert.equal(result.recommendations.length, 1, "un seul sujet distinct de valeur existe réellement malgré 2 candidats bruts");
  assert.equal(result.recommendations[0].subjectSourceId, "dup-1", "la version la mieux scorée doit être conservée");

  const neededCount = TARGET - result.recommendations.length;
  assert.equal(neededCount, 2, "les 2 places restantes (dont celle libérée par le doublon supprimé) doivent revenir à l'IA");
  assert.ok(learnNextAiFallback.shouldTriggerFallback({ neededCount, coldStart: result.coldStart }, learnNextConfig));
});

// ── Cold-start : 3 apprentissages populaires du catalogue (demande du
// 30/08/2026) ────────────────────────────────────────────────────────────────
// Aucun acquis -> aucun signal personnel -> jamais une fausse personnalisation
// IA (shouldTriggerFallback bloque déjà l'IA à coldStart, cf. tests plus
// haut). Le classement des 3 sujets d'entrée doit se faire par POPULARITÉ
// RÉELLE (acquisition_count), pas par importance_score (qui mélange
// popularité ET connectivité du graphe à parts égales).

test("cold-start : classe par popularité réelle (acquisition_count), jamais par importance_score seul", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [],
    user_solar_activations: [],
    culture_generale_notion_links: [],
    memory_item_fsrs_states: [],
    recommendation_events: [],
    knowledge_nodes: [
      // "Sujet connecté" : importance_score élevé (fort link_degree) mais
      // très PEU adopté (acquisition_count=1) — ne doit PAS battre un sujet
      // réellement populaire.
      { subject_type: "custom", subject_source_id: "connecte", display_name: "Sujet très connecté", solar_system_id: 1, star_id: null, link_degree: 20, acquisition_count: 1, importance_score: 0.9, importance_tier: "fondamental" },
      // "Sujet populaire" : importance_score modeste (peu connecté) mais
      // largement le plus adopté — doit passer devant malgré un
      // importance_score plus faible.
      { subject_type: "custom", subject_source_id: "populaire", display_name: "Sujet populaire", solar_system_id: 2, star_id: null, link_degree: 1, acquisition_count: 50, importance_score: 0.3, importance_tier: "secondaire" },
      { subject_type: "custom", subject_source_id: "moyen", display_name: "Sujet moyen", solar_system_id: 3, star_id: null, link_degree: 2, acquisition_count: 8, importance_score: 0.4, importance_tier: "secondaire" }
    ],
    solar_systems: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: TARGET });
  assert.equal(result.coldStart, true);
  assert.equal(result.recommendations.length, 3);
  // Popularité décroissante : populaire (50) > moyen (8) > connecté (1),
  // malgré l'ordre inverse d'importance_score.
  assert.deepEqual(result.recommendations.map((r) => r.subjectSourceId), ["populaire", "moyen", "connecte"]);
});

test("cold-start : à popularité égale, départage par importance_score (qualité/importance déjà disponible)", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [],
    user_solar_activations: [],
    culture_generale_notion_links: [],
    memory_item_fsrs_states: [],
    recommendation_events: [],
    knowledge_nodes: [
      { subject_type: "custom", subject_source_id: "egal-faible", display_name: "Sujet A", solar_system_id: 1, star_id: null, link_degree: 1, acquisition_count: 5, importance_score: 0.3, importance_tier: "secondaire" },
      { subject_type: "custom", subject_source_id: "egal-fort", display_name: "Sujet B", solar_system_id: 2, star_id: null, link_degree: 1, acquisition_count: 5, importance_score: 0.8, importance_tier: "fondamental" }
    ],
    solar_systems: [{ id: 1, name: "A" }, { id: 2, name: "B" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: TARGET });
  assert.equal(result.recommendations[0].subjectSourceId, "egal-fort", "à popularité strictement égale, le meilleur importance_score doit passer devant");
});
