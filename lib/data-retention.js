// Ces tables ne reçoivent que des inserts (un visiteur de page, un push
// envoyé) et n'avaient jusqu'ici aucune purge : elles grossissent indéfiniment
// depuis le lancement du site, probable cause principale de l'épuisement de
// quota/ressources Supabase constaté le 20/06/2026. page_visits n'est lue que
// pour les stats du jour (/api/admin/visits/today) ; notification_events n'a
// plus d'utilité une fois le push traité, hormis pour du débogage récent.
const PAGE_VISITS_RETENTION_DAYS = 90;
const NOTIFICATION_EVENTS_RETENTION_DAYS = 30;
// Volume élevé (jusqu'à ~300-600 lignes/jour depuis qu'Autres sources couvre tous les articles
// non encore publiés en débat, pas seulement la presse d'opinion) et sans intérêt passé
// quelques jours — GET /api/opinion-articles ne montre de toute façon que les 200 plus
// récentes.
// Passé de 2 à 7 jours le 19/07/2026 (demande : plus de cartes consultables sur
// Autres actus), sans rapport avec l'incident de quota du 20/06/2026 (tables
// sans purge). L'estimation initiale de volume (~2000-4000 lignes en base)
// est dépassée : 7 880 lignes mesurées le 12/08/2026, OPINION_ARTICLES_SELECTION_SCAN_LIMIT
// étant passé à 10 000 entretemps (27/07/2026) — la passe légère de
// buildFreshOpinionArticlesSelection couvre donc désormais la table entière à
// chaque reconstruction plutôt qu'une fenêtre bornée. Coût egress compensé en
// espaçant les reconstructions (cf. OPINION_ARTICLES_CACHE_TTL_MS, relevé à 15
// min le même jour) plutôt qu'en réduisant la limite de scan, qui pénaliserait
// la diversité de la sélection (orientations peu représentées).
const OPINION_ARTICLES_RETENTION_DAYS = 7;
// Un QCM par jour : 30 jours suffisent largement pour les stats/debug, sans
// accumuler indéfiniment (même logique que les autres tables purgées ici).
const DAILY_QUIZ_RETENTION_DAYS = 30;
// Clics sur les cartes Autres actus (cf. /api/opinion-articles/recommended) : doit survivre
// nettement plus longtemps que opinion_articles (7j) pour garder un profil d'affinité
// exploitable sur un visiteur qui revient occasionnellement, sans grossir indéfiniment.
const OPINION_ARTICLE_CLICKS_RETENTION_DAYS = 45;
const RETENTION_DELETE_BATCH_SIZE = 500;
const RETENTION_DELETE_MAX_BATCHES_PER_RUN = 20; // plafonne à 10 000 lignes/table/jour : purge progressive plutôt qu'un DELETE massif sur une base déjà sous tension.

// excludeLikeColumn/excludeLikePatterns : un QCM de notion doit survivre tant
// qu'il reste dans la liste "Mes QCM" de quelqu'un (cf. user_notion_quizzes),
// indépendamment de son âge — jamais purgé comme le reste, contrairement au
// QCM actu d'avant (éphémère par nature). daily_quiz.slot et
// daily_quiz_answers.question_id sont tous deux préfixés "notion:..." pour
// ces lignes (cf. buildNotionQuestions), d'où l'exclusion par LIKE sur la
// colonne concernée plutôt qu'une jointure. Les repasses ("Refaire"/ancrage)
// écrivent question_id sous la forme "cgreview-<questionId>" (cf.
// fetchCultureGeneraleReviewInjectionForToday) : un deuxième motif LIKE est
// nécessaire pour ces lignes-là, sans quoi l'historique de mémorisation
// long terme se faisait purger au bout de 30j comme du bruit ordinaire
// (bug F1 identifié à l'audit du 12/08/2026).
async function pruneOldRows(supabase, table, retentionDays, excludeLikeColumn = null, excludeLikePatterns = null) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const patterns = excludeLikePatterns
    ? (Array.isArray(excludeLikePatterns) ? excludeLikePatterns : [excludeLikePatterns])
    : [];
  let totalDeleted = 0;

  for (let batch = 0; batch < RETENTION_DELETE_MAX_BATCHES_PER_RUN; batch++) {
    let query = supabase
      .from(table)
      .select("id")
      .lt("created_at", cutoff);
    if (excludeLikeColumn) {
      for (const pattern of patterns) {
        query = query.not(excludeLikeColumn, "like", pattern);
      }
    }
    const { data: staleRows, error: selectError } = await query.limit(RETENTION_DELETE_BATCH_SIZE);

    if (selectError) {
      console.error(`[retention] ${table} lecture :`, selectError.message);
      break;
    }

    const staleIds = (staleRows || []).map((row) => row.id);
    if (!staleIds.length) break;

    const { error: deleteError } = await supabase.from(table).delete().in("id", staleIds);
    if (deleteError) {
      console.error(`[retention] ${table} suppression :`, deleteError.message);
      break;
    }

    totalDeleted += staleIds.length;
    if (staleIds.length < RETENTION_DELETE_BATCH_SIZE) break;
  }

  if (totalDeleted > 0) {
    console.log(`[retention] ${table} : ${totalDeleted} ligne(s) de plus de ${retentionDays}j supprimée(s).`);
  }
}

async function runDataRetentionCleanup(supabase) {
  await pruneOldRows(supabase, "page_visits", PAGE_VISITS_RETENTION_DAYS);
  await pruneOldRows(supabase, "notification_events", NOTIFICATION_EVENTS_RETENTION_DAYS);
  await pruneOldRows(supabase, "opinion_articles", OPINION_ARTICLES_RETENTION_DAYS);
  await pruneOldRows(supabase, "daily_quiz", DAILY_QUIZ_RETENTION_DAYS, "slot", ["notion:%"]);
  await pruneOldRows(supabase, "daily_quiz_answers", DAILY_QUIZ_RETENTION_DAYS, "question_id", ["notion:%", "cgreview-%"]);
  await pruneOldRows(supabase, "opinion_article_clicks", OPINION_ARTICLE_CLICKS_RETENTION_DAYS);
}

module.exports = {
  pruneOldRows,
  runDataRetentionCleanup,
  PAGE_VISITS_RETENTION_DAYS,
  NOTIFICATION_EVENTS_RETENTION_DAYS,
  OPINION_ARTICLES_RETENTION_DAYS,
  DAILY_QUIZ_RETENTION_DAYS,
  OPINION_ARTICLE_CLICKS_RETENTION_DAYS,
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_DELETE_MAX_BATCHES_PER_RUN
};
