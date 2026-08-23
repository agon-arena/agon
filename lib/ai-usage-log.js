'use strict';

// Instrumentation légère des appels IA (audit du 22/08/2026, phase 1 —
// mesurer avant d'optimiser). Un seul endroit centralise les tarifs et le
// calcul de coût pour éviter de disperser des prix OpenAI dans tout le code ;
// un seul point d'écriture centralise le stockage. Voir data/migration-ai-usage-log.sql
// pour la table Supabase correspondante.
//
// Règle absolue : cette instrumentation ne doit jamais faire échouer ni
// ralentir un appel IA réel. recordAiUsage() n'est jamais awaité par ses
// appelants côté server.js/lib — elle s'exécute en tâche de fond et avale
// systématiquement ses propres erreurs.

// Tarifs USD par million de tokens, vérifiés le 22/08/2026 sur
// developers.openai.com/api/docs/pricing. Ne couvre que les modèles
// réellement utilisés par Mnoria à ce jour (cf. audit partie 2/4) — un
// modèle absent de cette table donne un coût "inconnu" plutôt qu'un chiffre
// inventé (cf. estimateCostUsd). À mettre à jour si OpenAI change ses tarifs
// ou si un nouveau modèle est adopté.
const MODEL_PRICING_USD_PER_MILLION_TOKENS = {
  'gpt-4o':       { input: 2.50, cachedInput: 1.25, output: 10.00 },
  'gpt-4o-mini':  { input: 0.15, cachedInput: 0.075, output: 0.60 },
  'gpt-4.1-mini': { input: 0.40, cachedInput: 0.10, output: 1.60 },
  'gpt-5-nano':   { input: 0.05, cachedInput: 0.005, output: 0.40 }
};

// Retourne un coût en USD, ou null si le modèle n'est pas dans la table de
// tarifs ci-dessus (mieux vaut "inconnu" qu'un chiffre inventé, cf. audit
// partie 4 — demande explicite de l'utilisateur).
// IMPORTANT — pas de double comptage : dans la réponse Chat Completions
// OpenAI, `usage.prompt_tokens` INCLUT déjà les tokens mis en cache (le champ
// `usage.prompt_tokens_details.cached_tokens` en est un SOUS-ENSEMBLE, jamais
// un supplément). `inputTokens` reçu ici est donc le total ; on le scinde en
// (inputTokens - cachedTokens) facturé au tarif plein + cachedTokens facturé
// au tarif réduit, ce qui reconstitue exactement prompt_tokens — jamais
// prompt_tokens + cachedTokens.
//
// `outputTokens` (= `usage.completion_tokens`) inclut lui aussi, pour les
// modèles de raisonnement (gpt-5-nano ici), les tokens de raisonnement caché
// (`usage.completion_tokens_details.reasoning_tokens`) : ils sont déjà
// facturés comme de l'output par OpenAI, donc déjà comptés correctement ici
// sans extraction séparée. Ce sous-détail n'est pas stocké comme colonne à
// part pour garder le schéma minimal (cf. rapport, partie 6) ; à ajouter
// facilement si un besoin de diagnostic plus fin apparaît un jour.
function estimateCostUsd(model, { inputTokens, cachedTokens = 0, outputTokens } = {}) {
  const pricing = MODEL_PRICING_USD_PER_MILLION_TOKENS[model];
  // inputTokens/outputTokens n'ont volontairement PAS de valeur par défaut à
  // 0 : un appel sans ces informations doit rendre un coût "inconnu" (null),
  // pas un coût de 0 $ qui laisserait croire à un appel gratuit. cachedTokens
  // peut en revanche défauter à 0 sans ambiguïté (absence de cache ≠ coût inconnu).
  if (!pricing || typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null;
  const uncachedInput = Math.max(0, inputTokens - (cachedTokens || 0));
  const cost = (uncachedInput / 1e6) * pricing.input
             + ((cachedTokens || 0) / 1e6) * pricing.cachedInput
             + (outputTokens / 1e6) * pricing.output;
  // 8 décimales : un seul appel coûte souvent une fraction de centime,
  // arrondir à 2 décimales écraserait la quasi-totalité des lignes à 0.00.
  return Math.round(cost * 1e8) / 1e8;
}

// Best-effort et non bloquant par construction : awaiter cette fonction est
// possible (utile en test) mais aucun appelant de production ne le fait —
// voir la règle en tête de fichier.
async function recordAiUsage(supabase, {
  feature,
  model,
  inputTokens = null,
  outputTokens = null,
  cachedTokens = null,
  latencyMs = null,
  success,
  error = null
} = {}) {
  try {
    if (!supabase || !feature) return;
    const estimatedCostUsd = (typeof inputTokens === 'number' && typeof outputTokens === 'number')
      ? estimateCostUsd(model, { inputTokens, cachedTokens: cachedTokens || 0, outputTokens })
      : null;

    const { error: insertError } = await supabase.from('ai_usage_log').insert({
      feature,
      model: model || null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      estimated_cost_usd: estimatedCostUsd,
      latency_ms: latencyMs,
      success: success !== false,
      error: error ? String(error).slice(0, 500) : null
    });
    if (insertError) console.warn('[ai-usage-log] échec insertion (ignoré) :', insertError.message);
  } catch (err) {
    // Ne jamais remonter : une panne de télémétrie ne doit jamais devenir une
    // panne de Mnoria (cf. audit partie 5).
    console.warn('[ai-usage-log] échec enregistrement (ignoré) :', err.message);
  }
}

// Extrait { inputTokens, outputTokens, cachedTokens } d'un objet `usage` de
// réponse Chat Completions OpenAI, quel que soit le modèle. Isolé ici pour
// ne pas dupliquer cette lecture dans chaque site d'appel.
function extractUsage(usage) {
  if (!usage || typeof usage !== 'object') return { inputTokens: null, outputTokens: null, cachedTokens: null };
  return {
    inputTokens:  typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
    cachedTokens: typeof usage.prompt_tokens_details?.cached_tokens === 'number'
      ? usage.prompt_tokens_details.cached_tokens
      : null
  };
}

module.exports = {
  MODEL_PRICING_USD_PER_MILLION_TOKENS,
  estimateCostUsd,
  recordAiUsage,
  extractUsage
};
