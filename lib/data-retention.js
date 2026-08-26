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
async function pruneOldRows(supabase, table, retentionDays, excludeLikeColumn = null, excludeLikePatterns = null, excludeIds = null) {
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
    // excludeIds (ex. opinion_articles encore référencées par user_article_acquisitions,
    // cf. runDataRetentionCleanup) : sans ça, ces lignes ressortaient à chaque exécution
    // (toujours plus vieilles que le cutoff), échouaient systématiquement au DELETE
    // (contrainte de clé étrangère), coupaient le batch en cours (le `break` sur erreur
    // ci-dessous) — constaté en prod le 26/08/2026, la même poignée de lignes bloquées
    // rejouait ce cycle raté à chaque redémarrage/exécution planifiée sans jamais purger
    // le reste de la table derrière elles.
    if (excludeIds && excludeIds.length) {
      query = query.not("id", "in", `(${excludeIds.join(",")})`);
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

// Toutes les tables qui référencent opinion_articles.id par une clé étrangère (constaté en
// prod le 26/08/2026 : au moins user_article_acquisitions ET article_secondary_classifications
// — cette dernière découverte seulement après coup, une fois la première exclue, la purge
// échouant alors sur son propre lot bloqué). Si une nouvelle contrainte apparaît un jour
// (nouvelle table de classification, par ex.), le même symptôme réapparaîtra ici
// (log "[retention] opinion_articles suppression : ... viole la contrainte ...") — l'ajouter
// à cette liste plutôt que de laisser la purge se couper silencieusement à chaque exécution.
const OPINION_ARTICLES_REFERENCING_TABLES = [
  { table: "user_article_acquisitions", column: "article_id" },
  { table: "article_secondary_classifications", column: "article_id" }
];

async function getReferencedOpinionArticleIds(supabase) {
  const ids = new Set();
  for (const { table, column } of OPINION_ARTICLES_REFERENCING_TABLES) {
    const { data, error } = await supabase.from(table).select(column).not(column, "is", null);
    if (error) {
      console.error(`[retention] lecture ${table} :`, error.message);
      continue;
    }
    (data || []).forEach((row) => { if (row[column] != null) ids.add(row[column]); });
  }
  return [...ids];
}

async function runDataRetentionCleanup(supabase) {
  await pruneOldRows(supabase, "page_visits", PAGE_VISITS_RETENTION_DAYS);
  await pruneOldRows(supabase, "notification_events", NOTIFICATION_EVENTS_RETENTION_DAYS);
  // Une opinion_article encore acquise par un utilisateur (cf. user_article_acquisitions,
  // "Ma mémoire") ne doit jamais être purgée : la contrainte de clé étrangère l'interdit de
  // toute façon, mais sans cette exclusion en amont, ces quelques lignes ressortaient à
  // chaque exécution, échouaient au DELETE et coupaient la purge du reste de la table
  // derrière elles (cf. commentaire détaillé dans pruneOldRows).
  const referencedOpinionArticleIds = await getReferencedOpinionArticleIds(supabase);
  await pruneOldRows(supabase, "opinion_articles", OPINION_ARTICLES_RETENTION_DAYS, null, null, referencedOpinionArticleIds);
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
