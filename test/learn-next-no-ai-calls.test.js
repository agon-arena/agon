"use strict";

// Garantie de coût (section 15/20 du plan "À apprendre ensuite") : le calcul
// d'une recommandation individuelle ne doit JAMAIS déclencher d'appel IA.
// Vérifié ici de façon statique (lecture du code source, pas juste "le test
// n'a pas appelé l'IA cette fois") : aucun des fichiers du moteur ne doit
// référencer une clé API, un client HTTP sortant ou un des helpers d'appel
// IA déjà utilisés ailleurs dans le projet (fetchGpt.../OPENAI_API_KEY/fetch(
// vers une API externe). server.js reste libre d'appeler l'IA pour ENRICHIR
// une connaissance globale une seule fois (cf. findAndStoreCultureGeneraleNotionLink) —
// ce test ne couvre que lib/learn-next/, le chemin de lecture individuel.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LEARN_NEXT_DIR = path.join(__dirname, "..", "lib", "learn-next");
const FORBIDDEN_PATTERNS = [
  /OPENAI_API_KEY/i,
  /ANTHROPIC_API_KEY/i,
  /fetchGpt/i,
  /openai/i,
  /anthropic/i,
  /require\(\s*["']https?/i,
  /\bfetch\(/, // aucun appel réseau sortant propre à ce module (Supabase passe par le client injecté, jamais fetch() direct)
];

test("lib/learn-next/ ne référence aucun appel IA ni requête réseau directe", () => {
  const files = fs.readdirSync(LEARN_NEXT_DIR).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 4, "les modules du moteur doivent exister");
  for (const file of files) {
    const source = fs.readFileSync(path.join(LEARN_NEXT_DIR, file), "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} ne doit pas correspondre à ${pattern}`);
    }
  }
});
