#!/usr/bin/env node
// Complète data/migration-solar-taxonomy-scope.sql pour les solars référencés
// UNIQUEMENT par daily_quiz.questions[].sourcePlacement (jamais encore acquis
// par personne, donc absents de user_article_acquisitions — le seul cas que
// la migration SQL ne peut pas couvrir, le JSON de daily_quiz n'étant pas
// indexable simplement en SQL). Sans ce backfill, un solar déjà utilisé par
// une fiche générée mais pas encore répondue resterait 'unknown' et serait
// donc ignoré par le moteur (cf. isKnowledgeCandidate) — pas dangereux, mais
// sous-optimal (le moteur recréerait un solar concurrent au lieu de réutiliser
// celui déjà en place).
//
// Idempotent, additif : ne touche que taxonomy_scope='unknown', jamais un
// scope déjà résolu ('knowledge', 'news' ou 'both').
//
// Usage : node tools/backfill-taxonomy-scope.js [--dry-run]
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const DRY_RUN = process.argv.includes("--dry-run");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAll(table, select) {
  let all = [], from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return all;
}

(async () => {
  const [unknownSolars, quizRows, opArticles] = await Promise.all([
    fetchAll("solar_systems", "id, galaxy, name, taxonomy_scope").then((rows) => rows.filter((r) => r.taxonomy_scope === "unknown")),
    fetchAll("daily_quiz", "questions"),
    fetchAll("opinion_articles", "solar_system_id")
  ]);
  const unknownIds = new Set(unknownSolars.map((s) => s.id));
  // Un cas ambigu (référencé à la fois par une fiche QCM ET par le pipeline
  // actu) reçoit explicitement 'both' — jamais silencieusement 'knowledge'
  // (masquerait sa nature news) ni laissé 'unknown' (le rendrait invisible au
  // pipeline connaissances alors qu'il y est réellement utilisé). Même
  // principe que le correctif du 16/08/2026 sur
  // data/migration-solar-taxonomy-scope.sql.
  const newsIds = new Set(opArticles.map((r) => r.solar_system_id).filter(Boolean));

  const foundIds = new Set();
  const bothIds = new Set();
  for (const row of quizRows) {
    for (const q of row.questions || []) {
      const id = q.sourcePlacement?.solarSystemId;
      if (id == null || !unknownIds.has(Number(id))) continue;
      if (newsIds.has(Number(id))) bothIds.add(Number(id));
      else foundIds.add(Number(id));
    }
  }
  if (bothIds.size) {
    console.log(`référencés à la fois par une fiche QCM ET par opinion_articles (-> taxonomy_scope='both') : ${bothIds.size}`);
    unknownSolars.filter((s) => bothIds.has(s.id)).forEach((s) => console.log(`  -> ${s.galaxy} > ${s.name} (id=${s.id})`));
  }

  console.log(`solar_systems en scope 'unknown' : ${unknownSolars.length}`);
  console.log(`référencés par au moins une fiche QCM UNIQUEMENT (-> taxonomy_scope='knowledge') : ${foundIds.size}`);
  if (foundIds.size) {
    unknownSolars.filter((s) => foundIds.has(s.id)).forEach((s) => console.log(`  -> ${s.galaxy} > ${s.name} (id=${s.id})`));
  }

  if (DRY_RUN) {
    console.log("\n--dry-run : aucune écriture effectuée.");
    return;
  }
  if (!foundIds.size && !bothIds.size) {
    console.log("\nRien à mettre à jour.");
    return;
  }
  if (foundIds.size) {
    const { error } = await supabase
      .from("solar_systems")
      .update({ taxonomy_scope: "knowledge" })
      .in("id", [...foundIds])
      .eq("taxonomy_scope", "unknown"); // re-vérifié côté requête : jamais un scope déjà résolu écrasé
    if (error) throw error;
    console.log(`\n${foundIds.size} solar(s) mis à jour en taxonomy_scope='knowledge'.`);
  }
  if (bothIds.size) {
    const { error } = await supabase
      .from("solar_systems")
      .update({ taxonomy_scope: "both" })
      .in("id", [...bothIds])
      .eq("taxonomy_scope", "unknown");
    if (error) throw error;
    console.log(`${bothIds.size} solar(s) mis à jour en taxonomy_scope='both'.`);
  }
})().catch((err) => {
  console.error("[backfill-taxonomy-scope] échec :", err.message);
  process.exit(1);
});
