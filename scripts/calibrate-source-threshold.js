"use strict";

// Script de calibration du seuil minimal de qualité (V2 de la fiabilisation
// des sources, demande du 31/08/2026, section 7-9) — corpus de 40 sujets
// couvrant 20 domaines très différents (2 sujets chacun), recherche Brave
// réelle, scoring déterministe réel (même code que la production, y compris
// la relance ciblée), puis simulation de l'effet de plusieurs seuils
// candidats sans avoir à relancer une recherche par seuil.
//
// Fichier de DIAGNOSTIC autonome (même principe que
// scripts/test-source-scoring-real.js) : jamais exécuté par la suite de
// tests (network-free), jamais dans le chemin de production. N'appelle
// JAMAIS l'IA de sélection (aucun coût OpenAI) — seulement Brave + le
// scoring pur. L'extraction/validation anti-bot n'est PAS relancée ici pour
// chaque candidat (jusqu'à ~320 pages à récupérer, disproportionné pour une
// calibration de seuil) : elle est déjà couverte séparément par
// test/source-extraction-validation.test.js (16 cas déterministes) et
// vérifiée sur le cas réel travail-emploi.gouv.fr (cf. rapport).
//
// Usage : node scripts/calibrate-source-threshold.js
// Nécessite BRAVE_SEARCH_API_KEY dans .env. Ne modifie rien en base.

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
  shouldAttemptAuthorityRetry
} = require("../lib/source-scoring");

// 20 domaines × 2 sujets = 40, couvrant la liste demandée (section 7).
const CORPUS = [
  ["Histoire", "La bataille de Verdun"],
  ["Histoire", "La Révolution française"],
  ["Géographie", "Le désert du Sahara"],
  ["Géographie", "Les grands fleuves d'Europe"],
  ["Sciences", "La photosynthèse"],
  ["Sciences", "La théorie de la relativité restreinte"],
  ["Santé", "Comment bien se laver les mains"],
  ["Santé", "Les symptômes de la grippe saisonnière"],
  ["Droit", "Durée légale du travail en France"],
  ["Droit", "Le droit de rétractation pour un achat en ligne"],
  ["Économie", "L'inflation en France"],
  ["Économie", "Le fonctionnement de la Bourse"],
  ["Statistiques", "Population française actuelle"],
  ["Statistiques", "Taux de chômage en France"],
  ["Astronomie", "Composition de l'atmosphère de Mars"],
  ["Astronomie", "La formation des trous noirs"],
  ["Environnement", "Le réchauffement climatique"],
  ["Environnement", "La fonte des glaciers"],
  ["Art", "Les caractéristiques de l'impressionnisme"],
  ["Art", "Le mouvement cubiste"],
  ["Littérature", "Les caractéristiques du romantisme littéraire"],
  ["Littérature", "La biographie de Victor Hugo"],
  ["Technologie", "Le fonctionnement d'un moteur électrique"],
  ["Technologie", "Le fonctionnement de la 5G"],
  ["Informatique", "Qu'est-ce qu'un algorithme"],
  ["Informatique", "Le fonctionnement d'un processeur"],
  ["Vie quotidienne", "Comment nettoyer une poêle en inox"],
  ["Vie quotidienne", "Comment conserver le pain plus longtemps"],
  ["Sport", "Les règles du rugby à XV"],
  ["Sport", "L'histoire du Tour de France"],
  ["Actualité", "Les derniers résultats économiques annoncés aujourd'hui"],
  ["Actualité", "Les dernières décisions de la Banque centrale européenne"],
  ["Sujet scolaire", "Le théorème de Pythagore"],
  ["Sujet scolaire", "La conjugaison du verbe être au présent"],
  ["Sujet très spécialisé", "La vie des Grecs au IIIe siècle av. J.-C. dans les colonies septentrionales"],
  ["Sujet très spécialisé", "Les techniques de restauration des vitraux médiévaux"],
  ["Sujet obscur", "Généalogie précise des artisans tonneliers du village de Sarrant au XVIIe siècle"],
  ["Sujet obscur", "Histoire du hameau de Trois-Fontaines en Lozère"],
  ["Sujet ambigu", "Mercure"],
  ["Sujet ambigu", "Java"]
];

const THRESHOLDS_TO_COMPARE = [20, 25, 30, 35, 40, 45, 50];
const WEAK_SCORE_CEILING = 40; // sous ce score : considéré "faible" pour le rapport.

async function braveSearch(query) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) throw new Error("BRAVE_SEARCH_API_KEY manquant dans .env");
  const res = await fetch(buildBraveSearchUrl(query, 8), {
    headers: { Accept: "application/json", "X-Subscription-Token": braveKey }
  });
  if (!res.ok) throw new Error(`Brave a répondu ${res.status}`);
  return normalizeBraveResults(await res.json());
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length));
  return sortedValues[idx];
}

async function collectSubject(category, subject) {
  const rawResults = await braveSearch(subject);
  const rawOrderByUrl = new Map(rawResults.map((r, i) => [r.url, i]));
  let candidates = filterCandidateSources(rawResults);
  const topicContext = buildTopicContext(subject);
  let ranked = rankCandidates(candidates, topicContext);

  const retryAuthority = shouldAttemptAuthorityRetry(ranked, topicContext);
  if (retryAuthority) {
    try {
      const retryRaw = await braveSearch(buildAuthorityRetryQuery(subject, retryAuthority.domain));
      const existingDomains = new Set(candidates.map((c) => c.domain));
      const newCandidates = filterCandidateSources(retryRaw).filter((c) => !existingDomains.has(c.domain));
      if (newCandidates.length) {
        candidates = [...candidates, ...newCandidates];
        ranked = rankCandidates(candidates, topicContext);
      }
    } catch (error) {
      console.warn(`  [relance échouée] ${subject} :`, error.message);
    }
  }

  return ranked.map((c, i) => ({
    category,
    subject,
    domain: c.domain,
    finalScore: c.score.finalScore,
    rankBrave: rawOrderByUrl.has(c.url) ? rawOrderByUrl.get(c.url) : null,
    rankMnoria: i,
    knownAuthority: !!c.score.matchedAuthority && c.score.matchedAuthority !== "autorité contextuelle inférée",
    contextualAuthority: c.score.matchedAuthority === "autorité contextuelle inférée",
    retried: !!retryAuthority
  }));
}

(async () => {
  const allRows = [];
  for (const [category, subject] of CORPUS) {
    process.stdout.write(`Collecte : [${category}] ${subject} ... `);
    try {
      const rows = await collectSubject(category, subject);
      allRows.push(...rows);
      console.log(`${rows.length} candidat(s), meilleur score=${rows[0]?.finalScore ?? "—"}`);
    } catch (error) {
      console.log(`ÉCHEC (${error.message})`);
    }
  }

  console.log(`\n${"=".repeat(80)}\nCORPUS : ${CORPUS.length} sujets, ${allRows.length} candidats collectés au total\n${"=".repeat(80)}\n`);

  // ── Distribution des scores (section 8) ──────────────────────────────────
  const allScores = allRows.map((r) => r.finalScore).sort((a, b) => a - b);
  const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const median = percentile(allScores, 50);
  console.log("-- Distribution des scores (tous candidats confondus) --");
  console.log(`  moyenne = ${mean.toFixed(1)}`);
  console.log(`  médiane = ${median}`);
  console.log(`  p10 = ${percentile(allScores, 10)}, p25 = ${percentile(allScores, 25)}, p75 = ${percentile(allScores, 75)}, p90 = ${percentile(allScores, 90)}`);

  const topPerSubject = CORPUS.map(([, subject]) => {
    const rowsForSubject = allRows.filter((r) => r.subject === subject);
    return rowsForSubject.length ? Math.max(...rowsForSubject.map((r) => r.finalScore)) : null;
  }).filter((s) => s !== null).sort((a, b) => a - b);
  const topMean = topPerSubject.reduce((a, b) => a + b, 0) / topPerSubject.length;
  console.log(`\n-- Score du MEILLEUR candidat par sujet (${topPerSubject.length} sujets) --`);
  console.log(`  moyenne = ${topMean.toFixed(1)}, médiane = ${percentile(topPerSubject, 50)}`);
  console.log(`  p10 = ${percentile(topPerSubject, 10)}, p25 = ${percentile(topPerSubject, 25)}, p75 = ${percentile(topPerSubject, 75)}, p90 = ${percentile(topPerSubject, 90)}`);

  const excellent = allRows.filter((r) => r.finalScore >= 65).length;
  const reasonable = allRows.filter((r) => r.finalScore >= 40 && r.finalScore < 65).length;
  const weak = allRows.filter((r) => r.finalScore < 40).length;
  console.log(`\n-- Répartition par tranche --`);
  console.log(`  excellentes (>=65) : ${excellent} (${(100 * excellent / allRows.length).toFixed(0)}%)`);
  console.log(`  raisonnables (40-64) : ${reasonable} (${(100 * reasonable / allRows.length).toFixed(0)}%)`);
  console.log(`  faibles (<40) : ${weak} (${(100 * weak / allRows.length).toFixed(0)}%)`);

  // ── Comparaison des seuils (section 8-9) ─────────────────────────────────
  console.log(`\n-- Comparaison des seuils --`);
  for (const threshold of THRESHOLDS_TO_COMPARE) {
    const groundedSubjects = topPerSubject.filter((s) => s >= threshold).length;
    const weakPassing = allRows.filter((r) => r.finalScore >= threshold && r.finalScore < WEAK_SCORE_CEILING).length;
    console.log(`  Seuil ${threshold} → ${groundedSubjects}/${CORPUS.length} sujets groundés, ${weakPassing} source(s) faible(s) (score < ${WEAK_SCORE_CEILING}) qui passeraient quand même`);
  }

  // ── Sujets sans AUCUNE source exploitable même au seuil le plus bas ─────
  const neverGrounded = CORPUS
    .map(([category, subject]) => ({ category, subject, best: allRows.filter((r) => r.subject === subject).reduce((m, r) => Math.max(m, r.finalScore), 0) }))
    .filter((s) => s.best < THRESHOLDS_TO_COMPARE[0]);
  if (neverGrounded.length) {
    console.log(`\n-- Sujets sans source exploitable même au seuil le plus bas testé (${THRESHOLDS_TO_COMPARE[0]}) --`);
    neverGrounded.forEach((s) => console.log(`  [${s.category}] ${s.subject} (meilleur score : ${s.best})`));
  }

  // ── Table brute (section 7) ───────────────────────────────────────────────
  console.log(`\n-- Table brute (subject | domain | score | rankBrave | rankMnoria | knownAuthority | contextualAuthority) --`);
  allRows.forEach((r) => {
    console.log(`${r.subject} | ${r.domain} | ${r.finalScore} | ${r.rankBrave} | ${r.rankMnoria} | ${r.knownAuthority} | ${r.contextualAuthority}`);
  });
})();
