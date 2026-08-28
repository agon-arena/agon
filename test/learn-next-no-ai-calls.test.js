"use strict";

// Garantie de coût (section 15/20 du plan V1, section 1 de la mission V2 du
// 27/08/2026) : le calcul d'une recommandation V1 (GET normal) ne doit
// JAMAIS déclencher d'appel IA. Vérifié ici de façon statique (lecture du
// code source, pas juste "le test n'a pas appelé l'IA cette fois").
//
// La V2 (fallback IA, lib/learn-next/ai-fallback.js) a le DROIT de connaître
// le nom du modèle et la variable d'environnement à utiliser (c'est de la
// configuration, cf. lib/learn-next/config.js AI_FALLBACK_MODEL) — mais ne
// doit JAMAIS elle-même effectuer l'appel réseau : ce fichier reste pur
// (construit un prompt, valide une réponse déjà reçue), l'appel HTTP réel
// vers OpenAI reste dans server.js (même convention que le reste du projet,
// cf. fetchGpt5JsonContentWithRetry) où il est réutilisé, jamais dupliqué.
//
// Deux niveaux de vérification :
//  - STRICT, sur TOUS les fichiers de lib/learn-next/ sans exception : aucun
//    appel réseau sortant direct (fetch, helper d'appel IA, URL de l'API
//    OpenAI) ne doit jamais s'y trouver, pas même dans la V2.
//  - LARGE, sur les fichiers d'EXÉCUTION (scoring/repository/engine/
//    ai-fallback — jamais config.js, qui porte légitimement le nom du modèle
//    et de la variable d'environnement) : aucune référence à une clé API ou
//    au mot "openai"/"anthropic", pour empêcher qu'un appel s'y glisse un jour.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LEARN_NEXT_DIR = path.join(__dirname, "..", "lib", "learn-next");
const STRICT_PATTERNS = [
  /\bfetch\(/, // aucun appel réseau sortant propre à ce module (Supabase passe par le client injecté, jamais fetch() direct)
  /fetchGpt/i,
  /api\.openai\.com/i,
  /require\(\s*["']https?/i
];
const WIDE_PATTERNS = [
  /OPENAI_API_KEY/i,
  /ANTHROPIC_API_KEY/i,
  /openai/i,
  /anthropic/i
];
const CONFIG_ONLY_FILE = "config.js";

test("lib/learn-next/ ne référence aucun appel IA ni requête réseau directe", () => {
  const files = fs.readdirSync(LEARN_NEXT_DIR).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 4, "les modules du moteur doivent exister");
  for (const file of files) {
    const source = fs.readFileSync(path.join(LEARN_NEXT_DIR, file), "utf8");
    for (const pattern of STRICT_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} ne doit pas correspondre à ${pattern}`);
    }
    if (file === CONFIG_ONLY_FILE) continue;
    for (const pattern of WIDE_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} ne doit pas correspondre à ${pattern}`);
    }
  }
});
