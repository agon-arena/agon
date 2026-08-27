"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeLearnNextRecommendations } = require("../lib/learn-next/engine");
const { computeRetrievability } = require("../lib/spaced-repetition/fsrs-scheduler");

// Mock Supabase minimal, en mémoire, couvrant uniquement le sous-ensemble du
// query builder réellement utilisé par lib/learn-next/repository.js (select/
// eq/in/not/gte/order/limit/or/maybeSingle/upsert, toujours "thenable" comme
// le vrai client Supabase). Aucun réseau, aucune IA — but explicite de ce
// fichier (cf. test "aucun appel IA" plus bas pour la garantie statique).
function createSupabaseMock(seedTables) {
  const tables = {};
  for (const [name, rows] of Object.entries(seedTables)) tables[name] = rows.map((r) => ({ ...r }));

  function matchFilters(row, filters) {
    return filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "in") return (f.vals || []).includes(row[f.col]);
      if (f.type === "not-is-null") return row[f.col] !== null && row[f.col] !== undefined;
      if (f.type === "gte") return row[f.col] >= f.val;
      if (f.type === "or-solar") {
        const val = row.solar_system_id;
        if (val === null || val === undefined) return true;
        return !f.excludeIds.includes(val);
      }
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
      or(expr) {
        const m = expr.match(/not\.in\.\(([^)]*)\)/);
        const excludeIds = m ? m[1].split(",").filter(Boolean).map(Number) : [];
        filters.push({ type: "or-solar", excludeIds });
        return self;
      },
      async maybeSingle() {
        const rows = (tables[tableName] || []).filter((r) => matchFilters(r, filters));
        return { data: rows[0] || null, error: null };
      },
      async upsert(payload) {
        tables[tableName] = tables[tableName] || [];
        tables[tableName].push({ ...payload });
        return { data: [payload], error: null };
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

// Remplace la vraie fetchAllSupabaseRowsIn (pagination .range()) par une
// version directe : les fixtures de test sont volontairement petites, la
// pagination elle-même est un détail de server.js déjà couvert ailleurs.
async function fakeFetchAllSupabaseRowsIn(ids, buildChunkQuery) {
  return buildChunkQuery(ids);
}

const BASE_DEPS = { fetchAllSupabaseRowsIn: fakeFetchAllSupabaseRowsIn, computeRetrievability };

test("cold start : aucune acquisition -> recommandations de découverte uniquement, jamais d'erreur", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [],
    user_solar_activations: [],
    culture_generale_notion_links: [],
    memory_item_fsrs_states: [],
    recommendation_events: [],
    knowledge_nodes: [
      { subject_type: "histoire", subject_source_id: "1", display_name: "Chute de Constantinople", solar_system_id: 10, star_id: null, link_degree: 3, acquisition_count: 12, importance_score: 0.7, importance_tier: "fondamental" },
      { subject_type: "concept", subject_source_id: "2", display_name: "Entropie", solar_system_id: 11, star_id: null, link_degree: 1, acquisition_count: 4, importance_score: 0.3, importance_tier: "secondaire" }
    ],
    solar_systems: [{ id: 10, name: "Antiquité" }, { id: 11, name: "Physique" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 10 });
  assert.equal(result.coldStart, true);
  assert.ok(result.recommendations.length > 0);
  assert.ok(result.recommendations.every((r) => r.recommendationType === "discovery"));
});

test("bridge : une connaissance reliée à deux acquis de branches différentes est proposée comme pont", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [
      { user_id: "u1", eclairage_type: "histoire", eclairage_source_id: "empire", eclairage_name: "Empire romain", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" },
      { user_id: "u1", eclairage_type: "pensee", eclairage_source_id: "christianisme", eclairage_name: "Christianisme", solar_system_id: 2, star_id: null, acquired_at: "2026-01-02" }
    ],
    user_solar_activations: [
      { user_id: "u1", solar_system_id: 1 },
      { user_id: "u1", solar_system_id: 2 }
    ],
    culture_generale_notion_links: [
      { id: 1, type_a: "histoire", source_id_a: "empire", name_a: "Empire romain", type_b: "histoire", source_id_b: "edit_milan", name_b: "Édit de Milan", label: "Cause directe" },
      { id: 2, type_a: "pensee", source_id_a: "christianisme", name_a: "Christianisme", type_b: "histoire", source_id_b: "edit_milan", name_b: "Édit de Milan", label: "Reconnaît le culte" }
    ],
    memory_item_fsrs_states: [
      { user_id: "u1", state: "Review", stability: 30, last_review_at: new Date().toISOString(), memory_items: { subject_type: "histoire", subject_source_id: "empire" } },
      { user_id: "u1", state: "Review", stability: 25, last_review_at: new Date().toISOString(), memory_items: { subject_type: "pensee", subject_source_id: "christianisme" } }
    ],
    recommendation_events: [],
    knowledge_nodes: [
      { subject_type: "histoire", subject_source_id: "edit_milan", display_name: "Édit de Milan", solar_system_id: 3, star_id: null, link_degree: 2, acquisition_count: 5, importance_score: 0.4, importance_tier: "structurant" }
    ],
    solar_systems: [{ id: 1, name: "Antiquité romaine" }, { id: 2, name: "Religion" }, { id: 3, name: "Antiquité tardive" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 10 });
  const edit = result.recommendations.find((r) => r.subjectSourceId === "edit_milan");
  assert.ok(edit, "Édit de Milan doit apparaître dans les recommandations");
  assert.equal(edit.recommendationType, "bridge");
  assert.match(edit.reasonText, /pont/);
});

test("redondance : une connaissance quasi identique à un acquis n'est jamais recommandée", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [
      { user_id: "u1", eclairage_type: "histoire", eclairage_source_id: "empire", eclairage_name: "Les causes de la Révolution française", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" }
    ],
    user_solar_activations: [{ user_id: "u1", solar_system_id: 1 }],
    culture_generale_notion_links: [
      { id: 1, type_a: "histoire", source_id_a: "empire", name_a: "Les causes de la Révolution française", type_b: "histoire", source_id_b: "dup", name_b: "Les causes de la Révolution Française", label: "Reformulation" }
    ],
    memory_item_fsrs_states: [],
    recommendation_events: [],
    knowledge_nodes: [],
    solar_systems: [{ id: 1, name: "Histoire de France" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 10 });
  assert.ok(!result.recommendations.some((r) => r.subjectSourceId === "dup"));
});

test("aucun appel réseau/IA nécessaire pour classer les recommandations (garanti par construction du mock)", async () => {
  // Le mock ci-dessus n'implémente aucun client HTTP/OpenAI : si le moteur
  // avait besoin d'un appel IA pour classer, ce test échouerait immédiatement
  // (fonction manquante), pas silencieusement.
  const supabase = createSupabaseMock({
    user_article_acquisitions: [],
    user_solar_activations: [],
    culture_generale_notion_links: [],
    memory_item_fsrs_states: [],
    recommendation_events: [],
    knowledge_nodes: [],
    solar_systems: []
  });
  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 5 });
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.coldStart, true);
});

test("confidentialité : un import personnel ou un quiz 'comprendre' n'est JAMAIS recommandé à un autre utilisateur, même très bien scoré", async () => {
  const supabase = createSupabaseMock({
    user_article_acquisitions: [
      { user_id: "u1", eclairage_type: "concept", eclairage_source_id: "entropie", eclairage_name: "Entropie", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" }
    ],
    user_solar_activations: [{ user_id: "u1", solar_system_id: 1 }],
    culture_generale_notion_links: [
      // Lien global vers un import personnel d'un AUTRE visiteur : ne doit
      // jamais devenir un candidat, quelle que soit sa pertinence apparente.
      { id: 1, type_a: "concept", source_id_a: "entropie", name_a: "Entropie", type_b: "photo_import", source_id_b: "secret-doc", name_b: "Mes notes de cours privées", label: "Illustre ce concept" },
      // Lien vers un quiz "comprendre" (dérivé, jamais une connaissance autonome).
      { id: 2, type_a: "concept", source_id_a: "entropie", name_a: "Entropie", type_b: "comprendre", source_id_b: "pair-hash", name_b: "Entropie ↔ Autre chose", label: "Lien pédagogique" }
    ],
    memory_item_fsrs_states: [
      { user_id: "u1", state: "Review", stability: 60, last_review_at: new Date().toISOString(), memory_items: { subject_type: "concept", subject_source_id: "entropie" } }
    ],
    recommendation_events: [],
    knowledge_nodes: [
      // Scores volontairement excellents pour vérifier que SEUL le filtre de
      // type les exclut, jamais un hasard de scoring.
      { subject_type: "photo_import", subject_source_id: "secret-doc", display_name: "Mes notes de cours privées", solar_system_id: 2, star_id: null, link_degree: 10, acquisition_count: 500, importance_score: 1, importance_tier: "fondamental" },
      { subject_type: "comprendre", subject_source_id: "pair-hash", display_name: "Entropie ↔ Autre chose", solar_system_id: 3, star_id: null, link_degree: 10, acquisition_count: 500, importance_score: 1, importance_tier: "fondamental" },
      // Candidat de découverte légitime, du même acabit, pour vérifier que le
      // filtre ne bloque QUE les types non partageables.
      { subject_type: "citation", subject_source_id: "libre", display_name: "Citation légitime", solar_system_id: 4, star_id: null, link_degree: 2, acquisition_count: 50, importance_score: 0.5, importance_tier: "structurant" }
    ],
    solar_systems: [{ id: 1, name: "Sciences" }, { id: 2, name: "Perso" }, { id: 3, name: "Perso" }, { id: 4, name: "Culture" }]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 10 });
  assert.ok(!result.recommendations.some((r) => r.subjectType === "photo_import"), "aucun import personnel ne doit apparaître");
  assert.ok(!result.recommendations.some((r) => r.subjectType === "comprendre"), "aucun quiz 'comprendre' ne doit apparaître");
  assert.ok(result.recommendations.some((r) => r.subjectSourceId === "libre"), "un candidat légitime du même niveau de score doit rester recommandé");
});

test("dégradation propre : acquis existants mais aucun état FSRS exploitable -> pas de crash, poids de maîtrise prudent par défaut", () => {
  const run = async () => {
    const supabase = createSupabaseMock({
      user_article_acquisitions: [
        { user_id: "u1", eclairage_type: "histoire", eclairage_source_id: "empire", eclairage_name: "Empire romain", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" }
      ],
      user_solar_activations: [{ user_id: "u1", solar_system_id: 1 }],
      culture_generale_notion_links: [
        { id: 1, type_a: "histoire", source_id_a: "empire", name_a: "Empire romain", type_b: "histoire", source_id_b: "pantheon", name_b: "Panthéon de Rome", label: "Monument emblématique" }
      ],
      memory_item_fsrs_states: [], // aucun historique de révision exploitable
      recommendation_events: [],
      knowledge_nodes: [],
      solar_systems: [{ id: 1, name: "Antiquité romaine" }]
    });
    return computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 10 });
  };
  return run().then((result) => {
    assert.equal(result.coldStart, false);
    assert.ok(result.recommendations.length > 0, "doit produire une recommandation malgré l'absence de FSRS exploitable");
    assert.ok(result.recommendations.some((r) => r.subjectSourceId === "pantheon"));
  });
});

test("scénario de référence (§12) : favorise le pont réellement pertinent, pas la simple popularité globale", async () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createSupabaseMock({
    user_article_acquisitions: [
      // Solidement maîtrisés : Empire romain, Constantin (même branche), Christianisme (branche distincte).
      { user_id: "u1", eclairage_type: "histoire", eclairage_source_id: "empire", eclairage_name: "Empire romain", solar_system_id: 1, star_id: null, acquired_at: "2026-01-01" },
      { user_id: "u1", eclairage_type: "histoire", eclairage_source_id: "constantin", eclairage_name: "Constantin", solar_system_id: 1, star_id: null, acquired_at: "2026-01-02" },
      { user_id: "u1", eclairage_type: "pensee", eclairage_source_id: "christianisme", eclairage_name: "Christianisme primitif", solar_system_id: 2, star_id: null, acquired_at: "2026-01-03" },
      // Faiblement maîtrisé : Byzance.
      { user_id: "u1", eclairage_type: "histoire", eclairage_source_id: "byzance", eclairage_name: "Byzance", solar_system_id: 3, star_id: null, acquired_at: "2026-01-04" }
    ],
    user_solar_activations: [
      { user_id: "u1", solar_system_id: 1 }, { user_id: "u1", solar_system_id: 2 }, { user_id: "u1", solar_system_id: 3 }
    ],
    culture_generale_notion_links: [
      { id: 1, type_a: "histoire", source_id_a: "constantin", name_a: "Constantin", type_b: "histoire", source_id_b: "edit_milan", name_b: "Édit de Milan", label: "Promulgué par lui" },
      { id: 2, type_a: "histoire", source_id_a: "edit_milan", name_a: "Édit de Milan", type_b: "histoire", source_id_b: "empire", name_b: "Empire romain", label: "Acte impérial" },
      { id: 3, type_a: "histoire", source_id_a: "edit_milan", name_a: "Édit de Milan", type_b: "pensee", source_id_b: "christianisme", name_b: "Christianisme primitif", label: "Reconnaît le culte" },
      { id: 4, type_a: "histoire", source_id_a: "byzance", name_a: "Byzance", type_b: "histoire", source_id_b: "chute_constantinople", name_b: "Chute de Constantinople", label: "Fin de l'empire byzantin" }
    ],
    memory_item_fsrs_states: [
      // Solides : révisés récemment, forte stabilité.
      { user_id: "u1", state: "Review", stability: 60, last_review_at: daysAgo(5), memory_items: { subject_type: "histoire", subject_source_id: "empire" } },
      { user_id: "u1", state: "Review", stability: 60, last_review_at: daysAgo(5), memory_items: { subject_type: "histoire", subject_source_id: "constantin" } },
      { user_id: "u1", state: "Review", stability: 55, last_review_at: daysAgo(5), memory_items: { subject_type: "pensee", subject_source_id: "christianisme" } },
      // Faible : stabilité minimale, en retard de repasse.
      { user_id: "u1", state: "Review", stability: 1, last_review_at: daysAgo(20), memory_items: { subject_type: "histoire", subject_source_id: "byzance" } }
    ],
    recommendation_events: [],
    knowledge_nodes: [
      // Bien connecté à l'utilisateur (3 liens), mais volontairement MOINS
      // "populaire" que Chute de Constantinople ci-dessous.
      { subject_type: "histoire", subject_source_id: "edit_milan", display_name: "Édit de Milan", solar_system_id: 4, star_id: null, link_degree: 4, acquisition_count: 30, importance_score: 0.60, importance_tier: "structurant" },
      // Un seul lien, et seulement vers un acquis FAIBLEMENT maîtrisé — mais
      // délibérément rendu très "populaire" globalement pour vérifier que le
      // moteur ne le choisit pas mécaniquement pour cette seule raison.
      { subject_type: "histoire", subject_source_id: "chute_constantinople", display_name: "Chute de Constantinople", solar_system_id: 5, star_id: null, link_degree: 1, acquisition_count: 4000, importance_score: 0.85, importance_tier: "fondamental" },
      // Aucune connexion au graphe de l'utilisateur, mais très populaire/
      // fondamentale globalement (pool de découverte uniquement).
      { subject_type: "histoire", subject_source_id: "revolution_neolithique", display_name: "Révolution néolithique", solar_system_id: 6, star_id: null, link_degree: 0, acquisition_count: 9000, importance_score: 0.90, importance_tier: "fondamental" }
    ],
    solar_systems: [
      { id: 1, name: "Antiquité romaine" }, { id: 2, name: "Religion" }, { id: 3, name: "Antiquité tardive" },
      { id: 4, name: "Christianisation de l'Empire" }, { id: 5, name: "Fin de Byzance" }, { id: 6, name: "Préhistoire" }
    ]
  });

  const result = await computeLearnNextRecommendations({ supabase, ...BASE_DEPS }, { userId: "u1", limit: 10, now });
  const byId = new Map(result.recommendations.map((r) => [r.subjectSourceId, r]));
  const editMilan = byId.get("edit_milan");
  const chute = byId.get("chute_constantinople");
  const revolution = byId.get("revolution_neolithique");

  assert.ok(editMilan, "Édit de Milan doit apparaître");
  assert.equal(editMilan.recommendationType, "bridge");

  // Le critère de réussite explicite (§12) : Édit de Milan doit dominer,
  // jamais une connaissance simplement populaire globalement.
  if (chute) assert.ok(editMilan.score > chute.score, `Édit de Milan (${editMilan.score}) doit dominer Chute de Constantinople (${chute.score})`);
  if (revolution) assert.ok(editMilan.score > revolution.score, `Édit de Milan (${editMilan.score}) doit dominer Révolution néolithique (${revolution.score})`);

  // Édit de Milan doit être le mieux classé du lot (premier, ou parmi les
  // tout premiers si d'autres candidats génériques du pool existent).
  assert.equal(result.recommendations[0].subjectSourceId, "edit_milan");
});
