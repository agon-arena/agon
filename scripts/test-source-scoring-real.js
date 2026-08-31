"use strict";

// Script de comparaison manuelle en conditions réelles pour le scoring des
// sources web (demande du 31/08/2026, "Fiabilisation intelligente des
// sources Brave"). Interroge la vraie API Brave pour une batterie de sujets
// délibérément variés (histoire, droit, santé, statistiques, astronomie,
// actualité, culture, quotidien, sujet obscur) et affiche, pour chacun :
//   résultats bruts Brave → classement Mnoria (scoring déterministe) →
//   relance ciblée éventuelle → seuil minimal → sources qui seraient
//   soumises à l'IA de sélection.
// Fichier autonome (même principe que scripts/test-photo-knowledge.js) :
// ne réimporte jamais server.js (qui démarre tout le serveur Express au
// chargement), seulement les modules purs lib/web-search-grounding.js et
// lib/source-scoring.js + un fetch minimal vers Brave.
//
// Usage : node scripts/test-source-scoring-real.js
// Nécessite BRAVE_SEARCH_API_KEY dans .env. Ne modifie rien en base, ne fait
// aucun appel OpenAI (la sélection finale par IA n'est pas exercée ici,
// volontairement : ce script porte sur le classement déterministe en amont,
// cf. test/source-scoring.test.js pour les tests unitaires hors-réseau).

require("dotenv").config();
const {
  buildBraveSearchUrl,
  buildAuthorityRetryQuery,
  normalizeBraveResults,
  filterCandidateSources
} = require("../lib/web-search-grounding");
const {
  buildTopicContext,
  rankCandidates,
  filterByMinQuality,
  shouldAttemptAuthorityRetry,
  MIN_QUALITY_THRESHOLD,
  GOOD_ENOUGH_THRESHOLD
} = require("../lib/source-scoring");

const SUBJECTS = [
  "La bataille de Verdun",
  "La vie des Grecs au IIIe siècle av. J.-C. dans les colonies septentrionales",
  "Durée légale du travail en France",
  "Comment bien se laver les mains",
  "Population française actuelle",
  "Composition de l'atmosphère de Mars",
  "Les caractéristiques de l'impressionnisme",
  "Comment nettoyer une poêle en inox",
  "Généalogie précise des artisans tonneliers du village de Sarrant au XVIIe siècle"
];

async function braveSearch(query) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) throw new Error("BRAVE_SEARCH_API_KEY manquant dans .env");
  const res = await fetch(buildBraveSearchUrl(query, 8), {
    headers: { Accept: "application/json", "X-Subscription-Token": braveKey }
  });
  if (!res.ok) throw new Error(`Brave a répondu ${res.status}`);
  return normalizeBraveResults(await res.json());
}

async function runOne(subject) {
  console.log(`\n${"=".repeat(80)}\nSUJET : ${subject}\n${"=".repeat(80)}`);

  const rawResults = await braveSearch(subject);
  console.log(`\n-- Résultats bruts Brave (ordre Brave, ${rawResults.length}) --`);
  rawResults.forEach((r, i) => console.log(`  ${i}. ${r.url}`));

  let candidates = filterCandidateSources(rawResults);
  const topicContext = buildTopicContext(subject);
  let ranked = rankCandidates(candidates, topicContext);

  const retryAuthority = shouldAttemptAuthorityRetry(ranked, topicContext);
  if (retryAuthority) {
    const retryQuery = buildAuthorityRetryQuery(subject, retryAuthority.domain);
    console.log(`\n-- Relance ciblée déclenchée : "${retryQuery}" (autorité visée : ${retryAuthority.label}) --`);
    try {
      const retryRaw = await braveSearch(retryQuery);
      const existingDomains = new Set(candidates.map((c) => c.domain));
      const newCandidates = filterCandidateSources(retryRaw).filter((c) => !existingDomains.has(c.domain));
      console.log(`   → ${newCandidates.length} nouveau(x) candidat(s) trouvé(s) via la relance.`);
      if (newCandidates.length) {
        candidates = [...candidates, ...newCandidates];
        ranked = rankCandidates(candidates, topicContext);
      }
    } catch (error) {
      console.log(`   → échec de la relance : ${error.message}`);
    }
  } else {
    console.log("\n-- Aucune relance ciblée jugée nécessaire --");
  }

  console.log(`\n-- Classement Mnoria (freshnessLikely=${topicContext.freshnessLikely}) --`);
  ranked.forEach((c) => {
    console.log(`  ${String(c.score.finalScore).padStart(3)} | ${c.domain}`);
    console.log(`      relevance=${c.score.relevanceScore} authority=${c.score.authorityScore} primary=${c.score.primarySourceScore} specialization=${c.score.specializationScore} editorial=${c.score.editorialQualityScore} freshness=${c.score.freshnessScore}`);
    console.log(`      ${c.score.selectionReason}`);
  });

  const qualified = filterByMinQuality(ranked);
  const rejected = ranked.filter((c) => !qualified.includes(c));
  console.log(`\n-- Retenues pour la sélection IA (score >= ${MIN_QUALITY_THRESHOLD}) --`);
  console.log(qualified.length ? qualified.map((c) => `  ${c.domain} (${c.score.finalScore})`).join("\n") : "  (aucune — génération sans grounding pour ce sujet)");
  if (rejected.length) {
    console.log(`\n-- Écartées avant même le jugement de l'IA --`);
    console.log(rejected.map((c) => `  ${c.domain} (${c.score.finalScore})`).join("\n"));
  }

  const braveTop = rawResults[0];
  const mnoriaTop = ranked[0];
  if (braveTop && mnoriaTop && new URL(braveTop.url).hostname !== new URL(mnoriaTop.url).hostname) {
    console.log(`\n>> Reclassement effectif : Brave plaçait "${new URL(braveTop.url).hostname}" en tête, Mnoria retient "${mnoriaTop.domain}" en tête.`);
  }
}

(async () => {
  for (const subject of SUBJECTS) {
    try {
      await runOne(subject);
    } catch (error) {
      console.error(`\n[ERREUR] ${subject} :`, error.message);
    }
  }
  console.log(`\n${"=".repeat(80)}\nTerminé — GOOD_ENOUGH_THRESHOLD=${GOOD_ENOUGH_THRESHOLD}, MIN_QUALITY_THRESHOLD=${MIN_QUALITY_THRESHOLD}\n`);
})();
