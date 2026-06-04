'use strict';

// ── Prompt templates ──────────────────────────────────────────────────────────

const PROMPT1 = `Tu es un agent chargé de regrouper des arguments similaires dans un débat.

Ta mission n'est PAS de noter les arguments.
Ta mission n'est PAS de décider quel camp a raison.
Ta mission est uniquement de repérer les vrais doublons argumentatifs.

Données fournies :

Question du débat : {{question}}

Camp analysé : {{camp}}

Liste des arguments : {{arguments}}

RÈGLE CENTRALE

Deux arguments ne doivent être regroupés que s'ils défendent la même idée avec la même justification principale.

Ne regroupe pas deux arguments simplement parce qu'ils :
- vont dans le même sens ;
- appartiennent au même camp ;
- parlent du même thème ;
- utilisent des mots proches ;
- soutiennent la même conclusion générale.

Tu dois conserver séparément les arguments qui apportent une nuance réelle, par exemple :
- une raison différente ;
- une conséquence différente ;
- un exemple différent important ;
- une source ou un fait structurant différent ;
- une objection différente ;
- un angle différent : justice, liberté, sécurité, efficacité, coût, démocratie, confiance, faisabilité, égalité, risque d'abus, effets secondaires, etc.

Exemple :
"Les élus ne doivent pas être au-dessus des lois."
et
"Lever l'immunité peut restaurer la confiance dans les institutions."
ne sont pas des doublons : le premier repose sur l'égalité devant la loi, le second sur la confiance démocratique.

En revanche :
"Les élus ne doivent pas être au-dessus des lois."
et
"Personne, même un parlementaire, ne doit être au-dessus de la justice."
sont des doublons argumentatifs : même idée, même justification principale.

MÉTHODE

1. Lis tous les arguments du camp.
2. Identifie uniquement les vrais doublons ou quasi-doublons.
3. Crée des groupes seulement lorsque la similarité argumentative est forte.
4. Pour chaque groupe, choisis le meilleur représentant.
5. Les arguments uniques doivent rester seuls.
6. Ne fusionne jamais par simple proximité thématique.
7. En cas de doute, conserve les arguments séparés.

CRITÈRES POUR CHOISIR LE MEILLEUR REPRÉSENTANT

Choisis l'argument qui combine le mieux :
- thèse claire ;
- raisonnement complet ;
- formulation précise ;
- présence éventuelle d'un fait, d'un exemple ou d'une source utile ;
- ton acceptable ;
- absence d'insulte ou de formulation trop confuse.

RÈGLE TECHNIQUE IMPORTANTE

Dans mergedArgumentIds, inclus tous les arguments du groupe, y compris l'argument représentant.

Réponds uniquement en JSON valide, sans texte autour.

Format attendu :

{
  "groups": [
    {
      "groupId": "G1",
      "representativeArgumentId": "id_argument_retenu",
      "representativeArgumentText": "texte de l'argument retenu",
      "mergedArgumentIds": ["id_argument_retenu", "id_argument_doublon"],
      "sharedIdea": "idée commune très courte",
      "reasonForGrouping": "explique brièvement pourquoi ces arguments sont de vrais doublons"
    }
  ],
  "uniqueArguments": [
    {
      "argumentId": "id_argument",
      "argumentText": "texte de l'argument",
      "reasonKeptSeparate": "explique brièvement la nuance qui justifie de le garder séparé"
    }
  ],
  "warnings": [
    "signaler ici les cas ambigus ou les arguments difficiles à classer"
  ]
}`;

const PROMPT2 = `Tu es un évaluateur chargé de noter la qualité argumentative d'un argument dans un débat.

Tu ne dois pas décider quel camp a raison.
Tu ne dois pas juger la vérité politique, morale ou idéologique de la position.
Tu dois uniquement évaluer la solidité argumentative de l'argument fourni.

IMPORTANT

Tu ne dois PAS détecter les sources.
Tu ne dois PAS évaluer les sources.
Tu ne dois PAS attribuer de note aux sources, faits ou exemples.
La partie "sources / faits / exemples" sera traitée séparément par un autre prompt.

Données fournies :

Question du débat : {{question}}

Camp défendu : {{camp}}

Identifiant de l'argument : {{argumentId}}

Argument à évaluer : {{argument}}

BARÈME À APPLIQUER SUR 80 POINTS

1. Pertinence par rapport à la question — /20

L'argument répond-il vraiment au débat posé ?

- 0–5 : hors sujet ou presque.
- 6–10 : lien vague avec le sujet.
- 11–15 : répond clairement à la question.
- 16–20 : répond directement au cœur du débat avec un angle important.

2. Clarté de la thèse — /15

Comprend-on immédiatement ce que l'argument défend ?

- 0–4 : incompréhensible ou très confus.
- 5–8 : idée devinable mais mal formulée.
- 9–12 : idée claire.
- 13–15 : position très claire, précise et bien formulée.

3. Qualité du raisonnement — /25

L'argument tient-il logiquement ?

- 0–6 : contradiction, slogan, raccourci grossier.
- 7–12 : raisonnement faible ou trop affirmatif.
- 13–18 : raisonnement cohérent.
- 19–22 : raisonnement solide avec lien cause/conséquence clair.
- 23–25 : raisonnement très robuste, difficile à écarter sans réponse sérieuse.

4. Nuance et prise en compte des objections — /15

L'argument reconnaît-il une limite, un risque ou une objection ?

- 0–4 : caricatural, totalement unilatéral.
- 5–8 : argument affirmatif mais sans nuance.
- 9–12 : reconnaît une limite ou une objection.
- 13–15 : intègre une objection importante et y répond.

5. Qualité du débat / ton — /5

L'argument contribue-t-il à un débat acceptable ?

- 0 : insulte, attaque personnelle, mépris pur.
- 1–2 : ton très agressif, mais idée récupérable.
- 3–4 : ton engagé mais acceptable.
- 5 : ton clair, ferme et constructif.

CALCUL OBLIGATOIRE

total_without_sources = pertinence + clarity + reasoning + nuance + tone

Catégories provisoires hors sources :

- 0–39 : faible
- 40–55 : moyen
- 56–67 : bon
- 68–80 : excellent

RÈGLES IMPORTANTES

Ne récompense pas un argument simplement parce qu'il est long.

Ne pénalise pas un argument simplement parce qu'il défend une opinion minoritaire ou controversée.

Un argument peut être vif ou engagé, tant qu'il reste compréhensible et argumentatif.

Si l'argument est surtout une attaque personnelle, un slogan ou une émotion brute, la note doit être basse.

Si l'argument est clair, pertinent, logique et nuancé, il peut avoir une bonne note même si tu n'es pas d'accord avec lui.

Ne donne jamais de verdict du type "cet argument est vrai" ou "ce camp a raison".

Évalue seulement sa solidité argumentative hors sources.

Ne mentionne pas les sources dans les forces ou faiblesses : elles seront évaluées séparément.

Réponds uniquement en JSON valide, sans texte autour.

Format attendu :

{
  "argumentId": "{{argumentId}}",
  "camp": "{{camp}}",
  "scores_without_sources": {
    "pertinence": 0,
    "clarity": 0,
    "reasoning": 0,
    "nuance": 0,
    "tone": 0,
    "total_without_sources": 0
  },
  "category_without_sources": "faible | moyen | bon | excellent",
  "strengths": [
    "point fort principal",
    "autre point fort éventuel"
  ],
  "weaknesses": [
    "limite principale",
    "autre limite éventuelle"
  ],
  "short_explanation": "Explication courte en 2 ou 3 phrases maximum."
}`;

const PROMPT3 = `Tu es un évaluateur chargé d'analyser uniquement les sources associées à un argument.

Tu ne dois pas décider quel camp a raison.
Tu ne dois pas noter la qualité générale de l'argument.
Tu ne dois pas noter la clarté, le raisonnement, la nuance ou le ton.
Tu dois seulement évaluer les URL fournies dans le champ source dédié de l'idée.

Données fournies :

Question du débat : {{question}}

Camp défendu : {{camp}}

Identifiant de l'argument : {{argumentId}}

Argument à évaluer : {{argument}}

URL(s) saisie(s) dans le champ source dédié : {{sourceUrls}}

Contenu éventuel des sources si déjà récupéré : {{source_contents}}

RÈGLE ABSOLUE

Tu dois analyser uniquement les URL fournies dans {{sourceUrls}}.

Ne cherche pas de source ailleurs.
N'invente aucune source.
Ne complète pas avec ta mémoire.
Ne prends pas en compte une simple mention de média, d'institution, d'auteur ou d'étude si elle n'est pas fournie sous forme d'URL dans {{sourceUrls}}.

Si une URL apparaît dans le texte de l'argument mais n'est pas présente dans {{sourceUrls}}, signale-le dans main_issue, mais ne la note pas comme source officielle de l'idée.

Exemples d'URL valides dans {{sourceUrls}} :
- https://www.insee.fr/...
- http://www.lemonde.fr/...
- www.senat.fr/...
- lemonde.fr/article/...

Ne compte PAS comme source :
- "selon une étude"
- "d'après les experts"
- "j'ai vu dans un article"
- "l'INSEE dit que...", sans URL dans {{sourceUrls}}
- "un rapport affirme que...", sans URL dans {{sourceUrls}}
- une simple mention de média, institution ou auteur sans lien dans {{sourceUrls}}

TA MISSION

1. Vérifier si {{sourceUrls}} contient au moins une URL exploitable.
2. Évaluer si les URL fournies sont pertinentes par rapport à l'argument.
3. Évaluer la fiabilité apparente des sources fournies.
4. Évaluer si les sources soutiennent réellement la conclusion de l'argument.
5. Repérer les problèmes éventuels : URL absente, URL cassée ou incomplète, source peu fiable, source hors sujet, source seulement partiellement liée, source utilisée de manière excessive ou trompeuse.

IMPORTANT

Si le contenu complet de l'URL est fourni dans {{source_contents}}, tu peux t'appuyer dessus pour évaluer le lien entre la source et l'argument.

Si le contenu complet de l'URL n'est PAS fourni, ne prétends jamais l'avoir lu.

Dans ce cas, évalue seulement :
- la présence de l'URL ;
- le type de domaine ;
- la cohérence apparente entre le lien, le titre éventuel, le domaine et l'argument ;
- les limites de vérification.

RÈGLE DE PRUDENCE

Si le contenu réel de la source n'est pas fourni, la note ne doit normalement pas dépasser 14/20, sauf si l'URL pointe clairement vers une source primaire ou institutionnelle directement liée au sujet.

BARÈME "SOURCES / FAITS / EXEMPLES" SUR 20

- 0 : aucune URL fournie dans {{sourceUrls}}.
- 1–4 : URL présente mais inutilisable, très incomplète, manifestement hors sujet ou impossible à interpréter.
- 5–9 : URL présente mais appui faible : source peu identifiable, domaine peu fiable, lien vague, ou rapport très indirect avec l'argument.
- 10–14 : URL identifiable et plutôt pertinente, mais le lien avec la conclusion reste partiel, insuffisant ou non vérifiable entièrement.
- 15–18 : URL pertinente, identifiable, issue d'une source apparemment fiable, et bien reliée à l'argument.
- 19–20 : URL très pertinente, source très fiable ou primaire, directement liée à l'argument, et utilisée de façon précise et prudente.

CONSIGNES DE NOTATION

La présence d'une URL ne suffit pas à obtenir une bonne note.

Une source institutionnelle, scientifique, juridique ou statistique peut être fortement valorisée si elle est directement liée à l'argument.

Un média reconnu peut être valorisé si le lien semble pertinent et informatif.

Une source militante, commerciale ou très partisane peut être utilisée, mais doit être notée avec prudence si elle n'est pas corroborée.

Une URL hors sujet ou seulement décorative doit recevoir une note faible.

Si plusieurs URL sont fournies, note l'ensemble de l'appui sourcé, pas chaque lien séparément.

Ne donne jamais un score élevé si les sources ne soutiennent pas clairement l'argument.

Ne donne jamais de verdict du type "l'argument est vrai" ou "le camp a raison".

Si aucune URL n'est fournie dans {{sourceUrls}}, has_url_source doit être false et source_score doit être 0.

Réponds uniquement en JSON valide, sans texte autour.

Format attendu :

{
  "argumentId": "{{argumentId}}",
  "camp": "{{camp}}",
  "urls_analyzed": [
    "url_1",
    "url_2"
  ],
  "has_url_source": true,
  "source_score": 0,
  "source_level": "aucune | faible | correcte | solide | excellente",
  "source_relevance": "aucune | hors_sujet | partielle | directe",
  "source_reliability": "inconnue | faible | moyenne | forte",
  "supports_argument": "non_verifiable | non | partiellement | oui",
  "main_issue": "résumé très court du principal problème, ou null si aucun problème majeur",
  "short_explanation": "Explication courte en 2 ou 3 phrases maximum."
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

function safeJson(str) {
  try {
    const s = String(str || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(s);
  } catch (_) { return null; }
}

function formatArgList(args) {
  if (!args.length) return '(aucun argument)';
  return args.map((a, i) => `${i + 1}. ID:${a.id} — ${a.text}`).join('\n');
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildP1(question, camp, args) {
  return fill(PROMPT1, { question, camp, arguments: formatArgList(args) });
}

function buildP2(question, camp, arg) {
  return fill(PROMPT2, { question, camp, argumentId: String(arg.id), argument: arg.text });
}

function buildP3(question, camp, arg) {
  const sourceUrls = String(arg.source_url || '').trim() || '(aucune URL fournie)';
  return fill(PROMPT3, {
    question, camp,
    argumentId:      String(arg.id),
    argument:        arg.text,
    sourceUrls,
    source_contents: '(non disponible)'
  });
}

// ── Duplicate resolution ──────────────────────────────────────────────────────

function resolveEffectiveArgs(dupResult, args) {
  if (!dupResult) return args;
  const kept = new Set();
  for (const g of (dupResult.groups || [])) {
    kept.add(String(g.representativeArgumentId));
  }
  for (const u of (dupResult.uniqueArguments || [])) {
    kept.add(String(u.argumentId));
  }
  if (!kept.size) return args;
  const filtered = args.filter(a => kept.has(String(a.id)));
  // Fallback : si aucun ID retourné par l'IA ne correspond aux vrais IDs,
  // on analyse tous les arguments (l'IA a peut-être utilisé des IDs incorrects)
  return filtered.length ? filtered : args;
}

const PROMPT4 = `Tu es un analyste argumentatif pour Agôn.

À partir des données fournies, produis deux choses :
1. Une évaluation comparative par critère sous forme de pourcentages.
2. Une phrase finale de conclusion éditoriale.

DONNÉES FOURNIES

Question : {{question}}
Position A : {{positionA}}
Position B : {{positionB}}

Verdict calculé (ne pas le contredire) :
- Position ayant l'avantage : {{winner}}
- Score A : {{scoreA}}/100
- Score B : {{scoreB}}/100
- Confiance : {{confidence}}

Meilleurs arguments de {{positionA}} :
{{topArgsA}}

Meilleurs arguments de {{positionB}} :
{{topArgsB}}

CRITÈRES À ÉVALUER

Pour chaque critère, attribue un pourcentage à chaque position.
Les deux pourcentages d'un même critère doivent totaliser exactement 100.

1. Réponse à la question — dans quelle mesure chaque position répond au cœur du débat ?
2. Solidité argumentative — quel camp présente les raisonnements les plus solides ?
3. Sources et faits vérifiables — quel camp appuie mieux ses arguments sur des preuves ?
4. Prise en compte des objections — quel camp anticipe et répond mieux aux contre-arguments ?
5. Force de conviction — quel camp est globalement le plus persuasif ?

RÈGLES

- Les pourcentages doivent être cohérents avec le verdict calculé.
- Si le débat est équilibré, utilise des scores proches de 50/50.
- Ne jamais descendre sous 20 % ni dépasser 80 % sauf domination écrasante et évidente.
- La phrase finale doit être éditoriale, prudente, en une seule phrase.
- La phrase finale ne doit pas répéter le verdict — elle doit apporter un éclairage complémentaire sur la nature du débat.
- Ne mentionne jamais "Camp A" ou "Camp B" — utilise les intitulés réels des positions.

Réponds uniquement en JSON valide, sans texte autour.

Format attendu :

{
  "criteria": [
    {"name": "Réponse à la question",         "scoreA": 0, "scoreB": 0},
    {"name": "Solidité argumentative",         "scoreA": 0, "scoreB": 0},
    {"name": "Sources et faits vérifiables",   "scoreA": 0, "scoreB": 0},
    {"name": "Prise en compte des objections", "scoreA": 0, "scoreB": 0},
    {"name": "Force de conviction",            "scoreA": 0, "scoreB": 0}
  ],
  "conclusion": "Phrase finale de conclusion."
}`;

// ── Budget constants ──────────────────────────────────────────────────────────

const MAX_AI_ANALYSIS_COST_EUR = 0.05;
const MAX_ARGS_PER_CAMP        = 10;

// Conservative per-call cost estimates (gpt-4o-mini, EUR)
// Input: $0.15/1M tokens · Output: $0.60/1M tokens · taux ~1.08 EUR/USD
// Marges incluses pour tenir compte des arguments longs.
const CALL_COST_EUR = {
  P1: 0.0006, // détection doublons : ~900 in + 400 out tokens par camp
  P2: 0.0004, // notation hors sources : ~700 in + 280 out tokens
  P3: 0.0003, // notation sources : ~750 in + 180 out tokens (uniquement si URL)
  P4: 0.0004, // rapport critères + conclusion : ~800 in + 200 out tokens
};

function _estimateBatchCost(argsA, argsB, runP1A, runP1B, isOpen) {
  let cost = 0;
  if (runP1A) cost += CALL_COST_EUR.P1;
  if (runP1B) cost += CALL_COST_EUR.P1;
  for (const a of argsA) {
    cost += CALL_COST_EUR.P2;
    if (String(a.source_url || '').trim()) cost += CALL_COST_EUR.P3;
  }
  for (const a of argsB) {
    cost += CALL_COST_EUR.P2;
    if (String(a.source_url || '').trim()) cost += CALL_COST_EUR.P3;
  }
  if (!isOpen) cost += CALL_COST_EUR.P4;
  return cost;
}

function buildP4(question, labelA, labelB, verdict, scoredA, scoredB) {
  const top = (args) => [...args]
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, 3)
    .map((a, i) => `${i + 1}. [${a.final_score}/100] ${a.argumentText}`)
    .join('\n') || '(aucun argument solide)';

  const winnerLabel = verdict?.winnerLabel || 'Indéterminé';
  const scoreA      = verdict?.scoreA ?? 0;
  const scoreB      = verdict?.scoreB ?? 0;
  const confidence  = verdict?.confidence || 'faible';

  return fill(PROMPT4, {
    question, positionA: labelA, positionB: labelB,
    winner: winnerLabel, scoreA, scoreB, confidence,
    topArgsA: top(scoredA),
    topArgsB: top(scoredB)
  });
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function toCategory(score) {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'bon';
  if (score >= 50) return 'moyen';
  return 'faible';
}

function weightedStats(scoredArgs) {
  const qualified = scoredArgs.filter(a => a.category === 'bon' || a.category === 'excellent');
  if (!qualified.length) return { avg: 0, count: 0 };
  let wSum = 0, wTotal = 0;
  for (const a of qualified) {
    const w = a.category === 'excellent' ? 2 : 1;
    wSum   += a.final_score * w;
    wTotal += w;
  }
  return { avg: wTotal ? Math.round(wSum / wTotal) : 0, count: qualified.length };
}

// ── Verdict ───────────────────────────────────────────────────────────────────

function buildVerdict(statsA, statsB, labelA, labelB) {
  const { avg: avgA, count: cntA } = statsA;
  const { avg: avgB, count: cntB } = statsB;
  const diff = Math.abs(avgA - avgB);

  let winner, winnerLabel, loserLabel = '';

  if (cntA === 0 && cntB === 0) {
    winner = 'indeterminate'; winnerLabel = 'Impossible à déterminer';
  } else if (cntA === 0) {
    winner = 'B'; winnerLabel = labelB; loserLabel = labelA;
  } else if (cntB === 0) {
    winner = 'A'; winnerLabel = labelA; loserLabel = labelB;
  } else if (diff <= 5) {
    winner = 'egalite'; winnerLabel = 'Égalité argumentative';
  } else if (avgA > avgB) {
    winner = 'A'; winnerLabel = labelA; loserLabel = labelB;
  } else {
    winner = 'B'; winnerLabel = labelB; loserLabel = labelA;
  }

  const confidence = diff >= 15 ? 'forte' : diff >= 8 ? 'moyenne' : 'faible';

  let caveat = null;
  let note   = null;
  if (winner !== 'egalite' && winner !== 'indeterminate') {
    const winCnt = winner === 'A' ? cntA : cntB;
    const losCnt = winner === 'A' ? cntB : cntA;
    const s = (n) => n > 1 ? 's' : '';
    if (losCnt === 0) {
      // Victoire sans doute possible : note factuelle, pas de mise en garde
      note = `${loserLabel} n'a apporté aucun argument bon ou excellent dans ce débat.`;
    } else if (losCnt > winCnt * 2) {
      // Perdant a strictement plus du double d'arguments utiles : bémol de prudence
      caveat = `${winnerLabel} présente le meilleur score moyen, mais avec ${winCnt} argument${s(winCnt)} solide${s(winCnt)} face à ${losCnt} pour ${loserLabel} — verdict à interpréter avec prudence.`;
    }
  }

  return { winner, winnerLabel, loserLabel, scoreA: avgA, scoreB: avgB, goodExcellentCountA: cntA, goodExcellentCountB: cntB, confidence, caveat, note };
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generateAnalysisJson(payload, callOpenAI) {
  const { question, positionA, positionB, argumentsA: rawArgsA, argumentsB: rawArgsB } = payload;
  const isOpen = !String(positionA || '').trim() && !String(positionB || '').trim();
  const labelA = String(positionA || '').trim() || 'Camp A';
  const labelB = String(positionB || '').trim() || 'Camp B';

  // ── 1. Prioriser par votes, plafonner par camp ───────────────────────
  const byVotes = (args) => [...args].sort((a, b) => (b.votes || 0) - (a.votes || 0));

  let argsA = byVotes(rawArgsA).slice(0, MAX_ARGS_PER_CAMP);
  let argsB = byVotes(isOpen ? [] : rawArgsB).slice(0, MAX_ARGS_PER_CAMP);

  // ── 2. Vérifier le budget et réduire si nécessaire ───────────────────
  let runP1A = argsA.length >= 2;
  let runP1B = !isOpen && argsB.length >= 2;
  let estimated = _estimateBatchCost(argsA, argsB, runP1A, runP1B, isOpen);
  let budgetForcedReduction = false;

  if (estimated > MAX_AI_ANALYSIS_COST_EUR) {
    budgetForcedReduction = true;
    let capA = argsA.length, capB = argsB.length;
    while ((capA + capB) > 0 && estimated > MAX_AI_ANALYSIS_COST_EUR) {
      // Réduire le camp le plus chargé en premier
      if (capA >= capB && capA > 0) capA--;
      else if (capB > 0) capB--;
      else capA--;
      runP1A = capA >= 2;
      runP1B = !isOpen && capB >= 2;
      estimated = _estimateBatchCost(argsA.slice(0, capA), argsB.slice(0, capB), runP1A, runP1B, isOpen);
    }
    argsA = argsA.slice(0, capA);
    argsB = argsB.slice(0, capB);
  }

  // ── 3. Construire le bloc budget ─────────────────────────────────────
  const totalRaw      = rawArgsA.length + (!isOpen ? rawArgsB.length : 0);
  const totalAnalyzed = argsA.length + argsB.length;
  const totalSkipped  = totalRaw - totalAnalyzed;
  const isComplete    = totalSkipped === 0 && !budgetForcedReduction;

  const plural = (n) => n > 1 ? 's' : '';
  const budget = {
    maxCostEur:             MAX_AI_ANALYSIS_COST_EUR,
    estimatedCostEur:       Math.round(estimated * 1e5) / 1e5,
    budgetReached:          budgetForcedReduction,
    analysisComplete:       isComplete,
    analyzedArgumentsCount: totalAnalyzed,
    skippedArgumentsCount:  totalSkipped,
    reason: budgetForcedReduction
      ? `Analyse partielle : budget de ${MAX_AI_ANALYSIS_COST_EUR} € atteint — ${totalAnalyzed} argument${plural(totalAnalyzed)} analysé${plural(totalAnalyzed)} en priorité, ${totalSkipped} ignoré${plural(totalSkipped)}.`
      : (totalSkipped > 0
          ? `${totalAnalyzed} argument${plural(totalAnalyzed)} analysé${plural(totalAnalyzed)} en priorité (seuil de ${MAX_ARGS_PER_CAMP} par camp) — ${totalSkipped} argument${plural(totalSkipped)} non analysé${plural(totalSkipped)}.`
          : null)
  };

  // ── 4. Prompt1 — détection doublons (en parallèle, uniquement si ≥ 2 args) ──
  const [p1RawA, p1RawB] = await Promise.all([
    runP1A ? callOpenAI([{ role: 'user', content: buildP1(question, labelA, argsA) }]) : Promise.resolve(null),
    runP1B ? callOpenAI([{ role: 'user', content: buildP1(question, labelB, argsB) }]) : Promise.resolve(null)
  ]);

  const dupA = safeJson(p1RawA);
  const dupB = safeJson(p1RawB);

  // ── 5. Résoudre les arguments effectifs (représentants + uniques) ────
  const effA = resolveEffectiveArgs(dupA, argsA);
  const effB = resolveEffectiveArgs(dupB, argsB);

  // ── 6. Prompt2 + Prompt3 par argument (P3 uniquement si URL) ────────
  async function scoreOne(arg, camp) {
    const hasUrl = Boolean(String(arg.source_url || '').trim());
    const [p2Raw, p3Raw] = await Promise.all([
      callOpenAI([{ role: 'user', content: buildP2(question, camp, arg) }]),
      hasUrl ? callOpenAI([{ role: 'user', content: buildP3(question, camp, arg) }]) : Promise.resolve(null)
    ]);

    const p2 = safeJson(p2Raw) || {};
    const p3 = hasUrl ? (safeJson(p3Raw) || {}) : {};

    const scoreWithout = Math.max(0, Math.min(80, Number(p2.scores_without_sources?.total_without_sources) || 0));
    const scoreSource  = hasUrl ? Math.max(0, Math.min(20, Number(p3.source_score) || 0)) : 0;
    const finalScore   = scoreWithout + scoreSource;

    // Catégorie (et donc coefficient) basée sur la qualité argumentative P2 seule,
    // normalisée sur 100 (×1.25) pour aligner les seuils P2 avec l'échelle finale.
    // L'URL bonifie la note finale mais ne détermine pas le poids dans le verdict.
    const category = toCategory(Math.round(scoreWithout * 1.25));

    return {
      argumentId:               arg.id,
      argumentText:             arg.text,
      scores_without_sources:   p2.scores_without_sources || {},
      category_without_sources: p2.category_without_sources || toCategory(Math.round(scoreWithout * 1.25)),
      source_score:             scoreSource,
      has_url_source:           hasUrl,
      final_score:              finalScore,
      category,
      strengths:                p2.strengths || [],
      weaknesses:               p2.weaknesses || [],
      short_explanation:        p2.short_explanation || '',
      source_level:             p3.source_level || 'aucune',
      source_relevance:         p3.source_relevance || 'aucune',
      source_explanation:       p3.short_explanation || ''
    };
  }

  const [scoredA, scoredB] = await Promise.all([
    Promise.all(effA.map(a => scoreOne(a, labelA))),
    Promise.all(effB.map(a => scoreOne(a, labelB)))
  ]);

  // Mettre à jour le compte réel après résolution des doublons
  budget.analyzedArgumentsCount = scoredA.length + scoredB.length;

  // ── 7. Verdict ───────────────────────────────────────────────────────
  const statsA = weightedStats(scoredA);
  const statsB = weightedStats(scoredB);

  let verdict = null;
  if (!isOpen) {
    verdict = buildVerdict(statsA, statsB, labelA, labelB);
    if (!isComplete && budget.analyzedArgumentsCount > 0) {
      const note = `Verdict établi sur les ${budget.analyzedArgumentsCount} argument${plural(budget.analyzedArgumentsCount)} prioritaires uniquement.`;
      verdict.caveat = verdict.caveat ? `${verdict.caveat} ${note}` : note;
    }
  }

  // ── 8. Prompt4 — rapport critères + conclusion (débats binaires uniquement) ──
  let scoringReport = null;
  if (!isOpen) {
    const p4Raw = await callOpenAI([{ role: 'user', content: buildP4(question, labelA, labelB, verdict, scoredA, scoredB) }]);
    scoringReport = safeJson(p4Raw);
  }

  return {
    version:   2,
    question,
    positionA: labelA,
    positionB: labelB,
    isOpen,
    budget,
    camps: {
      A: {
        label:              labelA,
        duplicateGroups:    dupA?.groups || [],
        uniqueArguments:    dupA?.uniqueArguments || [],
        warnings:           dupA?.warnings || [],
        effectiveArguments: scoredA,
        weightedAverage:    statsA.avg,
        goodExcellentCount: statsA.count
      },
      B: {
        label:              labelB,
        duplicateGroups:    dupB?.groups || [],
        uniqueArguments:    dupB?.uniqueArguments || [],
        warnings:           dupB?.warnings || [],
        effectiveArguments: scoredB,
        weightedAverage:    statsB.avg,
        goodExcellentCount: statsB.count
      }
    },
    verdict,
    scoringReport
  };
}

module.exports = { generateAnalysisJson };
