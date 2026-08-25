"use strict";

// Non-régression du cache court ajouté sur POST /api/admin/veille/check-similar
// (audit egress PostgREST du 25/08/2026) : avant ce changement, chaque appel
// rechargeait sans cache les 300 débats récents (avec leur colonne `content`
// complète) depuis Supabase, alors que check-similar est appelé une fois PAR
// SUJET en attente pendant un même lot d'auto-publication. server.js est un
// monolithe qui se connecte à Supabase et démarre l'app dès son chargement
// (`require`) : comme pour test/debate-analysis-prompt-caching.test.js, ce test
// lit le code source directement plutôt que d'importer/booter server.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("le TTL du cache recent-debates est de 90s", () => {
  assert.match(SOURCE, /RECENT_DEBATES_FOR_SIMILARITY_CACHE_TTL_MS\s*=\s*90\s*\*\s*1000/);
});

test("getRecentDebatesForSimilarity() : HIT si le cache est frais, sinon requête Supabase puis mémorisation", () => {
  const m = SOURCE.match(/async function getRecentDebatesForSimilarity\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "fonction getRecentDebatesForSimilarity introuvable");
  const body = m[1];
  assert.match(body, /recentDebatesForSimilarityCacheAt\)\s*<\s*RECENT_DEBATES_FOR_SIMILARITY_CACHE_TTL_MS/, "condition de fraîcheur du cache manquante");
  assert.match(body, /cache HIT/, "log HIT manquant");
  assert.match(body, /cache MISS/, "log MISS manquant");
  assert.match(body, /\.from\("debates"\)[\s\S]*\.select\("id, question, option_a, option_b, type, content, created_at"\)[\s\S]*\.limit\(300\)/, "requête Supabase de repli inchangée (mêmes colonnes/limite qu'avant l'optimisation)");
  // L'erreur doit être levée AVANT toute affectation du cache, pour ne jamais mémoriser un résultat partiel/vide sur échec.
  const errorThrowIdx = body.indexOf("if (error) throw new Error(error.message);");
  const cacheAssignIdx = body.indexOf("recentDebatesForSimilarityCache = debates");
  assert.ok(errorThrowIdx !== -1 && cacheAssignIdx !== -1 && errorThrowIdx < cacheAssignIdx, "le cache ne doit être renseigné qu'après confirmation de l'absence d'erreur Supabase");
});

test("POST /api/admin/veille/check-similar utilise le cache au lieu d'une requête Supabase inline", () => {
  const m = SOURCE.match(/app\.post\("\/api\/admin\/veille\/check-similar"[\s\S]*?\n\}\);/);
  assert.ok(m, "route check-similar introuvable");
  const body = m[0];
  assert.match(body, /await getRecentDebatesForSimilarity\(\)/, "la route doit appeler getRecentDebatesForSimilarity()");
  assert.doesNotMatch(body, /\.from\("debates"\)/, "la route ne doit plus interroger Supabase elle-même (doit passer par le cache)");
});

test("mise à jour incrémentale du cache après insertion réussie dans /api/admin/veille/publish", () => {
  const insertIdx = SOURCE.indexOf('let { data, error } = await supabase.from("debates").insert(newDebateRow).select("id").single();');
  assert.ok(insertIdx !== -1, "insert de /api/admin/veille/publish introuvable");
  const after = SOURCE.slice(insertIdx, insertIdx + 900);
  assert.match(after, /recordNewlyPublishedDebateInSimilarityCache\(\{/, "mise à jour du cache manquante après l'insert de /publish");
  assert.match(after, /"veille publish"/, "raison de mise à jour manquante pour /publish");
  // La mise à jour doit intervenir après la vérification d'erreur, jamais avant (ne
  // jamais ajouter au cache une ligne dont l'insert Supabase a en réalité échoué).
  const throwIdx = after.indexOf("throw new Error(error.message);");
  const updateIdx = after.indexOf("recordNewlyPublishedDebateInSimilarityCache({");
  assert.ok(throwIdx !== -1 && updateIdx !== -1 && throwIdx < updateIdx, "la mise à jour du cache doit avoir lieu après la vérification d'erreur de l'insert");
});

test("mise à jour incrémentale du cache après insertion réussie dans POST /api/debates", () => {
  const routeMatch = SOURCE.match(/app\.post\("\/api\/debates"[\s\S]*?\n\}\);/);
  assert.ok(routeMatch, "route POST /api/debates introuvable");
  assert.match(routeMatch[0], /recordNewlyPublishedDebateInSimilarityCache\(\{/, "mise à jour du cache manquante après l'insert de POST /api/debates");
  assert.match(routeMatch[0], /"api\/debates"/, "raison de mise à jour manquante pour /api/debates");
});

test("recordNewlyPublishedDebateInSimilarityCache() n'appelle jamais Supabase", () => {
  const m = SOURCE.match(/function recordNewlyPublishedDebateInSimilarityCache\(row, reason = ""\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "fonction recordNewlyPublishedDebateInSimilarityCache introuvable");
  assert.doesNotMatch(m[1], /supabase/, "cette fonction ne doit faire aucun appel Supabase (mise à jour purement en mémoire)");
  assert.match(m[1], /\.slice\(0,\s*300\)/, "le cache mis à jour doit rester borné à 300 lignes, comme la requête d'origine");
});

test("second contrôle anti-doublon de /api/admin/veille/publish conservé, sans colonne content", () => {
  const routeMatch = SOURCE.match(/app\.post\("\/api\/admin\/veille\/publish"[\s\S]*?\n\}\);/);
  assert.ok(routeMatch, "route /api/admin/veille/publish introuvable");
  const body = routeMatch[0];
  assert.match(body, /\.select\("id, question, political_group"\)/, "le contrôle anti-doublon dédié (colonnes légères) doit être conservé tel quel");
  assert.match(body, /\.gte\("created_at", dupCutoffIso\)/, "la fenêtre 24h du contrôle anti-doublon doit être conservée");
});

test("loadVeillePending() n'utilise plus select('*')", () => {
  const m = SOURCE.match(/async function loadVeillePending\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "fonction loadVeillePending introuvable");
  const body = m[1];
  assert.doesNotMatch(body, /\.select\("\*"\)/, "loadVeillePending ne doit plus faire select('*')");
  for (const col of ["id", "question", "position_a", "position_b", "theme", "resume", "sources", "links", "pending_keywords", "added_at", "pending_linked_debate_id", "pending_story_selection", "political_group"]) {
    assert.ok(body.includes(col), `colonne ${col} (utilisée par le .map() de loadVeillePending) doit rester sélectionnée`);
  }
});
