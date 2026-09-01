'use strict';

// Trace durable d'un échec de génération de QCM notion/sujet libre (correctif
// UX du 01/09/2026 — incident "Marxisme" : une coupure de connexion côté
// navigateur pendant une génération longue (4-6 min avec gpt-5.6-luna)
// affichait un message d'échec alors que le backend continuait et finissait
// par réussir). Avant ce module, GET .../generation-status ne savait dire que
// "ready" ou rien — un échec réel restait invisible du client, seulement
// loggé côté serveur. Voir data/migration-notion-quiz-generation-failures.sql
// pour la table Supabase correspondante.
//
// Même règle qu'ai-usage-log.js/qcm-grounding-metrics.js : best-effort et non
// bloquant, jamais awaité par son appelant en production — une panne de cette
// télémétrie ne doit jamais retarder ni faire échouer la réponse d'erreur
// déjà envoyée au client.

// Fenêtre par défaut au-delà de laquelle un échec ancien n'est plus retenu :
// largement supérieure au plafond réel observé (4-6 min avec gpt-5.6-luna,
// retries internes inclus) pour ne jamais rater un échec légitime, mais assez
// courte pour qu'un échec ancien ne bloque jamais une nouvelle tentative sur
// le même sujet.
const DEFAULT_LOOKBACK_MS = 20 * 60 * 1000;

async function recordNotionQuizGenerationFailure(supabase, { identity, code, reason } = {}) {
  try {
    if (!supabase || !identity) return;
    const { error } = await supabase.from('notion_quiz_generation_failures').insert({
      identity,
      code: code || null,
      reason: reason ? String(reason).slice(0, 500) : null
    });
    if (error) console.warn('[notion-quiz-generation-failures] échec insertion (ignoré) :', error.message);
  } catch (err) {
    console.warn('[notion-quiz-generation-failures] échec enregistrement (ignoré) :', err.message);
  }
}

// Retourne, pour chaque identité demandée, son échec le plus récent (s'il en
// existe un dans la fenêtre de rétention) — jamais une exception : un souci
// de lecture ici doit se traduire par "aucun échec connu", pas par une panne
// de GET .../generation-status.
async function fetchRecentNotionQuizFailures(supabase, identities, { lookbackMs = DEFAULT_LOOKBACK_MS } = {}) {
  if (!supabase || !Array.isArray(identities) || !identities.length) return [];
  try {
    const cutoffIso = new Date(Date.now() - lookbackMs).toISOString();
    const { data, error } = await supabase
      .from('notion_quiz_generation_failures')
      .select('identity, code, reason, created_at')
      .in('identity', identities)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false });
    if (error || !Array.isArray(data)) return [];
    // `data` est trié du plus récent au plus ancien : la première occurrence
    // rencontrée par identité est donc déjà la plus récente.
    const seen = new Set();
    const latest = [];
    for (const row of data) {
      if (!row || seen.has(row.identity)) continue;
      seen.add(row.identity);
      latest.push(row);
    }
    return latest;
  } catch (err) {
    console.warn('[notion-quiz-generation-failures] échec lecture (ignoré) :', err.message);
    return [];
  }
}

module.exports = {
  DEFAULT_LOOKBACK_MS,
  recordNotionQuizGenerationFailure,
  fetchRecentNotionQuizFailures
};
