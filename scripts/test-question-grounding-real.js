"use strict";

// Script de diagnostic en conditions réelles pour la traçabilité factuelle
// des QCM (V3, demande du 31/08/2026, section 19). Déclenche une vraie
// génération complète (recherche Brave réelle → fiche → admission →
// vérification → génération des questions avec supporting_claim/source_ids
// → validation déterministe + critique sémantique + régénération ciblée)
// via le serveur RÉELLEMENT en cours d'exécution (npm start / pm2), plutôt
// que de réimplémenter une approximation du pipeline ici — server.js n'est
// pas require()-able isolément (il démarre tout Express à l'import, même
// contrainte documentée dans lib/question-formats.js), et une réplique du
// pipeline dans ce script risquerait de diverger silencieusement du vrai
// comportement en production.
//
// Lit ensuite directement la ligne daily_quiz stockée (Supabase) pour
// afficher, par question effectivement acceptée : QUESTION / RÉPONSE /
// CLAIM / SOURCE(S). Les rejets individuels (avant régénération ciblée) ne
// sont volontairement PAS reconstruits ici depuis les logs serveur partagés
// (fragile sur un serveur en cours d'utilisation réelle) — ils sont déjà
// couverts de façon déterministe et reproductible par
// test/question-grounding-validation.test.js (26 cas) ; ce script mesure
// l'issue FINALE réelle (nombre de questions obtenues vs cible du niveau,
// présence effective de supporting_claim/source_ids en base).
//
// Usage : node scripts/test-question-grounding-real.js
// Nécessite le serveur démarré sur PORT (défaut 3001), BRAVE_SEARCH_API_KEY
// et OPENAI_API_KEY dans .env. Écrit de vraies lignes dans Supabase
// (daily_quiz) — comportement identique à un vrai clic utilisateur.

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Section 19 : dix sujets couvrant les cas demandés, avec un suffixe
// aléatoire pour ne jamais retomber sur un slot déjà généré (dédoublonnage
// existant du projet, cf. findEquivalentGeneratedCustomTopic) et forcer une
// vraie génération à chaque exécution du script.
const RUN_TAG = Date.now().toString(36);
const SUBJECTS = [
  `Extinction des dinosaures (${RUN_TAG})`,
  `La bataille de Verdun (${RUN_TAG})`,
  `Durée légale du travail en France (${RUN_TAG})`,
  `Composition de l'atmosphère de Mars (${RUN_TAG})`,
  `Comment bien se laver les mains (${RUN_TAG})`,
  `Les caractéristiques de l'impressionnisme (${RUN_TAG})`,
  `Les techniques de restauration des vitraux médiévaux (${RUN_TAG})`,
  `Comment nettoyer une poêle en inox (${RUN_TAG})`,
  `Le bilan chiffré de la bataille de Stalingrad (${RUN_TAG})`,
  `Un remède miracle méconnu contre le rhume (${RUN_TAG})`
];

async function generateOne(subject, index) {
  const legacyKey = `test-grounding-real-${RUN_TAG}-${index}`;
  const res = await fetch(`${BASE_URL}/api/users/notion-quizzes/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ legacyKey, topic: subject, level: "elementaire" })
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function fetchStoredQuestions(slot) {
  const { data, error } = await supabase
    .from("daily_quiz")
    .select("questions")
    .eq("slot", slot)
    .order("quiz_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.questions || [];
}

function describeQuestion(q) {
  const primary = Array.isArray(q.variants) && q.variants.length ? q.variants[0] : q;
  let answer = "(format sans réponse unique)";
  if (primary.type === "qcm_multi" && Array.isArray(primary.correctIndexes)) {
    answer = primary.correctIndexes.map((i) => primary.options?.[i]).join(" / ");
  } else if (Number.isInteger(primary.correctIndex) && Array.isArray(primary.options)) {
    answer = primary.options[primary.correctIndex];
  } else if (primary.type === "association") {
    answer = (primary.pairs || []).map((p) => `${p.left} → ${p.right}`).join(" ; ");
  } else if (primary.type === "ordre") {
    answer = (primary.items || []).join(" → ");
  }
  return { question: primary.question, answer, type: primary.type };
}

(async () => {
  const results = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    const subject = SUBJECTS[i];
    console.log(`\n${"=".repeat(80)}\nSUJET : ${subject}\n${"=".repeat(80)}`);
    try {
      const { status, body } = await generateOne(subject, i);
      if (status !== 200 || !body.ok) {
        console.log(`  échec de génération (HTTP ${status}) : ${body.error || "raison inconnue"}`);
        results.push({ subject, generated: 0, ok: false });
        continue;
      }
      console.log(`  slot=${body.slot} questionCount annoncé=${body.questionCount}`);
      const questions = await fetchStoredQuestions(body.slot);
      results.push({ subject, generated: questions.length, ok: true });
      questions.forEach((q, qi) => {
        const { question, answer, type } = describeQuestion(q);
        console.log(`\n  -- Question ${qi + 1} (${type}) --`);
        console.log(`  QUESTION : ${question}`);
        console.log(`  RÉPONSE  : ${answer}`);
        console.log(`  CLAIM    : ${q.supporting_claim || "(aucune — grounding indisponible pour ce sujet ou question antérieure au correctif)"}`);
        console.log(`  SOURCE(S): ${(q.source_ids || []).join(", ") || "(aucune)"}`);
      });
    } catch (error) {
      console.log(`  ERREUR : ${error.message}`);
      results.push({ subject, generated: 0, ok: false });
    }
  }

  console.log(`\n${"=".repeat(80)}\nRÉSUMÉ\n${"=".repeat(80)}`);
  const totalQuestions = results.reduce((sum, r) => sum + r.generated, 0);
  console.log(`Sujets traités : ${results.length}, réussis : ${results.filter((r) => r.ok).length}`);
  console.log(`Total de questions stockées : ${totalQuestions}`);
  results.forEach((r) => console.log(`  [${r.ok ? "OK" : "ÉCHEC"}] ${r.subject} → ${r.generated} question(s)`));
})();
