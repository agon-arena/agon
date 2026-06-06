'use strict';

// ── Robustness — deterministic, based solely on score ─────────────────────────
function classifyRobustness(score) {
  const s = Number(score || 0);
  if (s >= 85) return 'excellent';
  if (s >= 70) return 'robust';
  if (s >= 50) return 'average';
  return 'weak';
}

// ── Popularity — deterministic, based on votes vs. full debate distribution ───
function classifyPopularity(votes, allVotes) {
  const v     = Number(votes || 0);
  const total = allVotes.length;

  if (v === 0) return 'unsupported';
  if (v === 1) return 'low_support';
  if (total === 0) return 'low_support';

  // Count how many arguments have strictly more votes (0 = most popular)
  const morePopular = allVotes.filter(vv => Number(vv || 0) > v).length;

  // Top third (strictest threshold for very_popular)
  const isTopThird = morePopular < Math.ceil(total / 3);
  // Top half (for relatively_popular)
  const isTopHalf  = morePopular < Math.ceil(total / 2);

  if (v >= 5 && isTopThird) return 'very_popular';
  if (v >= 2 && isTopHalf)  return 'relatively_popular';
  return 'low_support';
}

// ── Gap type — deterministic, with all exclusions enforced ────────────────────
const GAP_LABEL = {
  popular_but_weak:           'Populaire, mais faible argumentativement',
  popular_but_average:        'Populaire, mais seulement moyen argumentativement',
  robust_but_less_supported:  'Robuste, mais peu soutenue',
  aligned_popular_and_robust: 'Populaire et robuste'
};

function classifyGap(popularityCat, robustnessCat) {
  const isPopular = popularityCat === 'relatively_popular' || popularityCat === 'very_popular';
  const isRobust  = robustnessCat === 'robust' || robustnessCat === 'excellent';
  const isWeak    = robustnessCat === 'weak';
  const isAverage = robustnessCat === 'average';

  // Exclusions explicites (0 voix + faible/moyen, faible/moyen non populaire)
  if (isWeak    && !isPopular) return null;
  if (isAverage && !isPopular) return null;

  // 0 voix + robuste/excellent → robust_but_less_supported (valide, c'est un écart intéressant)
  if (isPopular && isWeak)     return 'popular_but_weak';
  if (isPopular && isAverage)  return 'popular_but_average';
  if (isRobust  && !isPopular) return 'robust_but_less_supported';
  if (isRobust  && isPopular)  return 'aligned_popular_and_robust';

  return null;
}

// ── Build full insights object — code-side, deterministic ─────────────────────
function buildPopularityRobustnessInsights(analysisResult) {
  const { question, positionA, positionB, isOpen, camps } = analysisResult;

  const argsA = camps?.A?.effectiveArguments || [];
  const argsB = (!isOpen && camps?.B?.effectiveArguments) || [];
  const all   = [...argsA, ...argsB];

  if (all.length === 0) return null;

  const allVotes   = all.map(a => Number(a.votes || 0));
  const totalVotes = allVotes.reduce((s, v) => s + v, 0);

  // Enrich each argument with deterministic categories
  const enriched = all.map((a, i) => {
    const votes      = Number(a.votes || 0);
    const score      = Number(a.final_score || 0);
    const robustness = classifyRobustness(score);
    const popularity = classifyPopularity(votes, allVotes);
    const gapType    = classifyGap(popularity, robustness);
    const camp       = i < argsA.length ? 'A' : 'B';
    return { argumentText: a.argumentText, votes, score, robustness, popularity, gapType, camp };
  });

  const notableGaps = enriched
    .filter(a => a.gapType !== null)
    .map(a => ({
      argumentText: a.argumentText,
      camp:         a.camp,
      votes:        a.votes,
      score:        a.score,
      robustness:   a.robustness,
      popularity:   a.popularity,
      type:         a.gapType,
      label:        GAP_LABEL[a.gapType]
    }));

  const avgScore = (args) => args.length
    ? Math.round(args.reduce((s, a) => s + Number(a.final_score || 0), 0) / args.length)
    : 0;

  return {
    question,
    positionA: camps?.A?.label || positionA,
    positionB: !isOpen ? (camps?.B?.label || positionB) : null,
    isOpen,
    totalVotes,
    totalArgs: all.length,
    statsA: {
      label:      camps?.A?.label || positionA,
      count:      argsA.length,
      totalVotes: argsA.reduce((s, a) => s + Number(a.votes || 0), 0),
      avgScore:   avgScore(argsA)
    },
    statsB: !isOpen ? {
      label:      camps?.B?.label || positionB,
      count:      argsB.length,
      totalVotes: argsB.reduce((s, a) => s + Number(a.votes || 0), 0),
      avgScore:   avgScore(argsB)
    } : null,
    notableGaps
  };
}

// ── AI prompt — narrative only, gaps are already computed ─────────────────────
function buildP5(insights) {
  const { question, positionA, positionB, isOpen, totalVotes, statsA, statsB, notableGaps } = insights;

  const campsSummary =
    `Camp "${positionA}" : ${statsA.count} idée(s), ${statsA.totalVotes} voix, score moyen ${statsA.avgScore}/100` +
    (statsB ? `\nCamp "${positionB}" : ${statsB.count} idée(s), ${statsB.totalVotes} voix, score moyen ${statsB.avgScore}/100` : '');

  const gapsBlock = notableGaps.length === 0
    ? 'Aucun écart notable détecté par le code.'
    : notableGaps.map(g =>
        `  - [${g.label}] camp ${g.camp} | ${g.votes} voix (${g.popularity}) | score ${g.score}/100 (${g.robustness})\n    "${g.argumentText}"`
      ).join('\n');

  return `Tu rédiges le commentaire narratif d'une analyse "popularité vs robustesse argumentative".

Débat : "${question}"
Camp A : "${positionA}"${!isOpen && positionB ? `\nCamp B : "${positionB}"` : ''}
Total voix dans le débat : ${totalVotes}

Résumé statistique :
${campsSummary}

Écarts calculés par le code (catégories définitives — ne pas les modifier) :
${gapsBlock}

Rédige uniquement les textes narratifs suivants en JSON strict (pas de markdown) :
{
  "mainFinding": "<1-2 phrases : constat principal sobre sur la relation popularité/robustesse>",
  "summary": "<2-3 phrases d'analyse générale pédagogique>",
  "campAObservation": "<1-2 phrases sur le camp \"${positionA}\" uniquement>",
  ${!isOpen ? `"campBObservation": "<1-2 phrases sur le camp \\"${positionB || ''}\\" uniquement>",` : '"campBObservation": null,'}
  "warning": "<1 phrase de prudence sur les limites de cette comparaison>"
}

Règles strictes :
- Ne pas créer de nouveaux écarts ni modifier les labels fournis.
- Ne pas changer les catégories ni les scores.
- Ne pas mentionner qu'un argument est "populaire" s'il a 0 voix.
- Ne pas mentionner qu'un argument est "robuste" si son score est inférieur à 70.
- Ton : sobre, intellectuel, accessible. Pas moralisateur, pas humiliant.
- Si aucun écart n'a été fourni, le dire sobrement dans mainFinding.`;
}

// ── Safe JSON parser ───────────────────────────────────────────────────────────
function safeJson(raw) {
  if (!raw) return null;
  const s     = String(raw).trim();
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generatePopularityAnalysis(analysisResult, callOpenAI) {
  const insights = buildPopularityRobustnessInsights(analysisResult);

  if (!insights) {
    return { version: 2, hasEnoughData: false };
  }

  if (insights.totalArgs < 2) {
    return { version: 2, hasEnoughData: false };
  }

  const prompt     = buildP5(insights);
  const raw        = await callOpenAI([{ role: 'user', content: prompt }]);
  const aiNarrative = safeJson(raw) || {};

  // Merge: gaps come from code, narrative from AI
  return {
    version:           2,
    hasEnoughData:     true,
    mainFinding:       String(aiNarrative.mainFinding  || ''),
    summary:           String(aiNarrative.summary       || ''),
    campAObservation:  String(aiNarrative.campAObservation || ''),
    campBObservation:  !analysisResult.isOpen
                         ? String(aiNarrative.campBObservation || '')
                         : null,
    notableGaps:       insights.notableGaps,  // toujours du code, jamais de l'IA
    warning:           String(aiNarrative.warning || '')
  };
}

module.exports = { generatePopularityAnalysis };
