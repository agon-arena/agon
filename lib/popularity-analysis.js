'use strict';

function safeJson(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function buildP5(analysisResult) {
  const { question, positionA, positionB, isOpen, camps } = analysisResult;

  const formatCamp = (campData) => {
    const args = campData.effectiveArguments || [];
    if (!args.length) return '  Aucun argument analysé.';
    return args.map(a =>
      `  - "${a.argumentText}" | ${a.votes} voix | score ${a.final_score}/100 | ${a.category}`
    ).join('\n');
  };

  const campABlock = camps?.A ? formatCamp(camps.A) : '  Aucun argument.';
  const campBBlock = (!isOpen && camps?.B) ? formatCamp(camps.B) : null;

  const totalArgs =
    (camps?.A?.effectiveArguments?.length || 0) +
    (camps?.B?.effectiveArguments?.length || 0);

  return `Tu analyses la relation entre la popularité (nombre de voix reçues) et la robustesse argumentative (score /100) dans le débat suivant.

Question : "${question}"
Camp A : "${positionA}"${!isOpen && positionB ? `\nCamp B : "${positionB}"` : ''}

Arguments Camp A — "${positionA}" :
${campABlock}
${campBBlock ? `\nArguments Camp B — "${positionB}" :\n${campBBlock}` : ''}

Rappel des catégories : faible = score 0-49, moyen = 50-64, bon = 65-79, excellent = 80-100.

Ta mission : écrire une analyse courte et pédagogique qui montre si les idées les plus populaires (voix) sont aussi les plus solides (score), et vice versa. Ton sobre, intellectuel, accessible. Ne pas juger les utilisateurs ni dire qu'ils ont "mal voté".

${totalArgs < 3 ? 'ATTENTION : peu d\'arguments disponibles. Si insuffisant, retourne hasEnoughData: false et laisse les champs textuels vides ou null.' : ''}

Retourne uniquement ce JSON (sans markdown) :
{
  "version": 2,
  "hasEnoughData": true,
  "mainFinding": "<1-2 phrases : constat principal sur la relation popularité/robustesse dans ce débat>",
  "summary": "<2-3 phrases d'analyse générale : comment les voix et les scores se distribuent, y a-t-il cohérence ou divergence notable ?>",
  "campAObservation": "<1-2 phrases spécifiques au camp \"${positionA}\" : popularité vs solidité de ses idées>",
  ${!isOpen ? `"campBObservation": "<1-2 phrases spécifiques au camp \\"${positionB}\\" : popularité vs solidité de ses idées>",` : '"campBObservation": null,'}
  "notableGaps": [
    {
      "argumentText": "<texte exact de l'argument>",
      "camp": "<A ou B>",
      "votes": <nombre>,
      "score": <nombre>,
      "category": "<faible|moyen|bon|excellent>",
      "type": "<popular_but_weak | robust_but_unpopular | popular_and_robust>"
    }
  ],
  "warning": "<1 phrase de prudence sur les limites de cette comparaison>"
}

Règles pour notableGaps :
- Inclure 2 à 3 cas maximum, uniquement les plus flagrants.
- "popular_but_weak" : argument avec beaucoup de voix mais score faible ou moyen (≤64).
- "robust_but_unpopular" : argument avec score bon ou excellent (≥65) mais peu de voix.
- "popular_and_robust" : argument avec beaucoup de voix ET bon/excellent score — cas positif à signaler si présent.
- Si aucun cas flagrant, retourner notableGaps: [].
- Ne pas inventer de texte : utiliser l'argumentText tel quel.`;
}

async function generatePopularityAnalysis(analysisResult, callOpenAI) {
  const prompt = buildP5(analysisResult);
  const raw    = await callOpenAI([{ role: 'user', content: prompt }]);
  const parsed = safeJson(raw);
  if (!parsed || parsed.version !== 2) {
    throw new Error('Réponse P5 invalide : ' + String(raw || '').slice(0, 200));
  }
  return parsed;
}

module.exports = { generatePopularityAnalysis };
