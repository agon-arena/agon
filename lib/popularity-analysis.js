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

const isPopular     = (cat) => cat === 'relatively_popular' || cat === 'very_popular';
const isUnsupported = (cat) => cat === 'unsupported' || cat === 'low_support';
const isWeakOrAvg   = (cat) => cat === 'weak' || cat === 'average';
const isRobustOrExc = (cat) => cat === 'robust' || cat === 'excellent';

// ── Labels par sous-catégorie — déterministes, jamais décidés par l'IA ─────────
const POPULAR_WEAK_LABEL = {
  weak:    'Populaire, mais faible argumentativement',
  average: 'Populaire, mais seulement moyen argumentativement'
};

const ROBUST_UNSUPPORTED_LABEL = {
  robust:    'Peu populaire, mais robuste argumentativement',
  excellent: 'Peu populaire, mais excellente argumentativement'
};

const GAP_LIST_LIMIT = 5;

// Construit une liste d'écarts filtrée, triée par écart le plus révélateur, plafonnée à 5.
function buildGapList(enriched, { popularityFilter, robustnessFilter, labelMap, sortCompare }) {
  return enriched
    .filter(a => popularityFilter(a.popularity) && robustnessFilter(a.robustness))
    .sort(sortCompare)
    .slice(0, GAP_LIST_LIMIT)
    .map(a => ({
      argumentText: a.argumentText,
      camp:         a.camp,
      votes:        a.votes,
      score:        a.score,
      robustness:   a.robustness,
      popularity:   a.popularity,
      label:        labelMap[a.robustness] || ''
    }));
}

// ── Build full insights object — code-side, deterministic ─────────────────────
function buildPopularityRobustnessInsights(analysisResult) {
  const { question, positionA, positionB, isOpen, camps } = analysisResult;

  const argsA = camps?.A?.effectiveArguments || [];
  const argsB = (!isOpen && camps?.B?.effectiveArguments) || [];
  const all   = [...argsA, ...argsB];

  if (all.length === 0) return null;

  // Une idée fusionnée porte la somme des votes de toutes ses formulations
  // (merged_votes, calculée en amont par resolveEffectiveArgs) — sans quoi une
  // idée largement reprise mais représentée par un exemplaire peu voté semblerait
  // artificiellement peu populaire. Repli sur les votes propres si pas de fusion.
  const effectiveVotes = (a) => Number(a.merged_votes ?? a.votes ?? 0);

  const allVotes   = all.map(effectiveVotes);
  const totalVotes = allVotes.reduce((s, v) => s + v, 0);

  // Enrich each argument with deterministic categories
  const enriched = all.map((a, i) => {
    const votes      = effectiveVotes(a);
    const score      = Number(a.final_score || 0);
    const robustness = classifyRobustness(score);
    const popularity = classifyPopularity(votes, allVotes);
    const camp       = i < argsA.length ? 'A' : 'B';
    return { argumentText: a.argumentText, votes, score, robustness, popularity, camp };
  });

  // Liste A — populaires mais faibles/moyens : priorité au plus de voix + score le plus bas
  const popularButWeakOrAverage = buildGapList(enriched, {
    popularityFilter: isPopular,
    robustnessFilter: isWeakOrAvg,
    labelMap:         POPULAR_WEAK_LABEL,
    sortCompare:      (a, b) => (a.score - b.score) || (b.votes - a.votes)
  });

  // Liste B — peu populaires mais robustes/excellentes : priorité au moins de voix + score le plus haut
  const robustButUnsupported = buildGapList(enriched, {
    popularityFilter: isUnsupported,
    robustnessFilter: isRobustOrExc,
    labelMap:         ROBUST_UNSUPPORTED_LABEL,
    sortCompare:      (a, b) => (b.score - a.score) || (a.votes - b.votes)
  });

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
      totalVotes: argsA.reduce((s, a) => s + effectiveVotes(a), 0),
      avgScore:   avgScore(argsA)
    },
    statsB: !isOpen ? {
      label:      camps?.B?.label || positionB,
      count:      argsB.length,
      totalVotes: argsB.reduce((s, a) => s + effectiveVotes(a), 0),
      avgScore:   avgScore(argsB)
    } : null,
    popularButWeakOrAverage,
    robustButUnsupported
  };
}

// ── AI prompt — narrative only, gap lists are already computed ────────────────
function buildP5(insights) {
  const {
    question, positionA, positionB, isOpen, totalVotes, statsA, statsB,
    popularButWeakOrAverage, robustButUnsupported
  } = insights;

  const campsSummary = isOpen
    ? `Idées partagées : ${statsA.count} idée(s), ${statsA.totalVotes} voix, score moyen ${statsA.avgScore}/100`
    : `Camp "${positionA}" : ${statsA.count} idée(s), ${statsA.totalVotes} voix, score moyen ${statsA.avgScore}/100` +
      (statsB ? `\nCamp "${positionB}" : ${statsB.count} idée(s), ${statsB.totalVotes} voix, score moyen ${statsB.avgScore}/100` : '');

  const formatGapList = (title, list) => list.length === 0
    ? `${title} : aucun écart notable détecté par le code.`
    : `${title} :\n` + list.map(g =>
        `  - [${g.label}] ${isOpen ? 'idées partagées' : `camp ${g.camp}`} | ${g.votes} voix (${g.popularity}) | score ${g.score}/100 (${g.robustness})\n    "${g.argumentText}"`
      ).join('\n');

  const headerBlock = isOpen
    ? `Arène libre : Idées partagées`
    : `Camp A : "${positionA}"${positionB ? `\nCamp B : "${positionB}"` : ''}`;
  const observationSchema = isOpen
    ? `"campAObservation": "<1-2 phrases sur les idées partagées uniquement : n'emploie jamais le mot camp, n'ajoute pas de guillemets autour d'Idées partagées, et formule naturellement, par exemple : Les idées partagées...>",
  "campBObservation": null`
    : `"campAObservation": "<1-2 phrases sur le camp \\"${positionA}\\" uniquement : c'est ICI, et seulement ici, que tu dis si ses idées sont populaires/peu populaires et robustes/faibles>",
  "campBObservation": "<1-2 phrases sur le camp \\"${positionB || ''}\\" uniquement : c'est ICI, et seulement ici, que tu dis si ses idées sont populaires/peu populaires et robustes/faibles>"`;
  const positionRule = isOpen
    ? '- Dans campAObservation : ne jamais écrire "camp", "camp A", "camp Idées partagées" ou "camp \\"Idées partagées\\"". Utilise seulement une formulation naturelle comme "Les idées partagées...".'
    : `- Dans campAObservation et campBObservation : ne jamais écrire "camp A" ou "camp B" — désigne chaque camp par sa position réelle entre guillemets, par exemple le camp "${positionA}" ou le camp "${positionB || ''}".`;

  const gapsBlock =
    formatGapList('Liste "Populaires, mais faibles ou moyens argumentativement"', popularButWeakOrAverage) +
    '\n\n' +
    formatGapList('Liste "Peu populaires, mais robustes argumentativement"', robustButUnsupported);

  return `Tu rédiges le commentaire narratif d'une analyse "popularité vs robustesse argumentative".

Débat : "${question}"
${headerBlock}
Total voix dans le débat : ${totalVotes}

Résumé statistique :
${campsSummary}

Écarts calculés par le code, déjà triés et plafonnés à 5 par liste (catégories et labels définitifs — ne pas les modifier) :
${gapsBlock}

Rédige uniquement les textes narratifs suivants en JSON strict (pas de markdown) :
{
  "mainFinding": "<2-3 phrases formant le \\"constat principal\\", STRICTEMENT transversal et général : l'écart entre popularité et robustesse existe-t-il dans cette arène, est-il fort / modéré / faible, et que révèle-t-il sur la manière dont cette arène associe (ou non) adhésion et solidité du raisonnement — SANS jamais dire quel camp est concerné>",
  ${observationSchema}
}

Règles strictes :
${positionRule}
- mainFinding est le « constat principal » : il doit rester STRICTEMENT transversal et général, au point de pouvoir être copié tel quel sur n'importe quelle arène sans perdre son sens. INTERDICTION ABSOLUE d'y faire référence — même indirectement, même par paraphrase — au contenu, au sujet, à la position ou au camp de l'un ou l'autre côté de l'arène (pas de "les arguments en faveur de...", pas de "les idées soutenant que...", pas de "le camp qui pense que...", pas de "${positionA}", pas de "${positionB || ''}", pas de paraphrase de la question "${question}"). N'utilise QUE des formulations génériques et interchangeables : "les idées les plus soutenues", "certaines idées largement adoptées", "un côté de l'arène", "les arguments les mieux notés", etc. — sans jamais préciser lequel des deux côtés est concerné. mainFinding ne doit traiter QUE de l'existence et l'intensité de l'écart popularité/robustesse, et de ce que cela révèle en général sur la façon dont cette arène associe (ou non) adhésion et qualité du raisonnement. Toute observation nommant un camp ou son contenu — qui est populaire, qui est robuste, pourquoi — appartient exclusivement à campAObservation${!isOpen ? ' et campBObservation' : ''}.
- Exemple de mainFinding CORRECT (transversal, à imiter) : "Cette arène montre un écart net entre adhésion et solidité argumentative. Les idées les plus soutenues ne sont pas automatiquement les plus robustes sur le plan logique, ce qui invite à distinguer popularité immédiate et qualité du raisonnement. Cette lecture ne désigne pas un camp comme vrai ou faux : elle compare seulement le soutien reçu et la construction argumentative des idées."
- Exemple à NE JAMAIS écrire dans mainFinding (ce type de phrase est réservé à campAObservation/campBObservation) : "Le camp A est très populaire mais moyen, tandis que le camp B est moins populaire mais plus robuste."
- Ne pas créer de nouveaux écarts ni modifier les listes ou labels fournis.
- Ne pas changer les catégories ni les scores.
- Ne pas mentionner qu'un argument est "populaire" s'il a 0 voix.
- Ne pas mentionner qu'un argument est "robuste" ou "excellent" si son score est inférieur à 70.
- Ton : sobre, intellectuel, accessible. Pas moralisateur, pas humiliant.
- Si les deux listes sont vides, le dire sobrement dans mainFinding, toujours sans nommer de camp.`;
}

// ── Safe JSON parser ───────────────────────────────────────────────────────────
function safeJson(raw, context = {}) {
  if (!raw) return null;
  const s    = String(raw).trim();
  const warn = (error) => console.warn('[popularity-analysis] JSON parsing failed', {
    ...context,
    error,
    rawPreview: s.slice(0, 200)
  });

  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start === -1 || end === -1) {
    warn('no JSON object found in response');
    return null;
  }
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    warn(e.message);
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generatePopularityAnalysis(analysisResult, callOpenAI) {
  const insights = buildPopularityRobustnessInsights(analysisResult);

  if (!insights) {
    return {
      version:       2,
      hasEnoughData: false,
      reason:        'no_scored_arguments',
      totalArgs:     0,
      totalVotes:    0
    };
  }

  if (insights.totalArgs < 2) {
    return {
      version:       2,
      hasEnoughData: false,
      reason:        'not_enough_scored_arguments',
      totalArgs:     insights.totalArgs,
      totalVotes:    insights.totalVotes
    };
  }

  const prompt     = buildP5(insights);
  const raw        = await callOpenAI([{ role: 'user', content: prompt }]);
  const aiNarrative = safeJson(raw, { prompt: 'PROMPT5_POPULARITY_NARRATIVE' }) || {};

  // Merge: gap lists come from code, narrative from AI
  return {
    version:                  2,
    hasEnoughData:            true,
    mainFinding:              String(aiNarrative.mainFinding  || ''),
    campAObservation:         String(aiNarrative.campAObservation || ''),
    campBObservation:         !analysisResult.isOpen
                                ? String(aiNarrative.campBObservation || '')
                                : null,
    popularButWeakOrAverage:  insights.popularButWeakOrAverage,  // toujours du code, jamais de l'IA
    robustButUnsupported:     insights.robustButUnsupported      // toujours du code, jamais de l'IA
  };
}

module.exports = { generatePopularityAnalysis };
