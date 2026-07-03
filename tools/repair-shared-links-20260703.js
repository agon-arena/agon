// Réparation du 2026-07-03 : défait les fusions d'arènes fautives créées par le
// match IA trop permissif (cf. garde-fou confirmSameDebateQuestionForMerge ajouté
// dans server.js) et réaffecte les idées IA à leur arène d'origine.
//
// Incident : l'arène Certamen 1131 « que ferait la police si l'extrême droite gagne
// en 2027 ? » avait été fusionnée à tort avec 1114 « les ministres peuvent-ils
// soutenir qui ils veulent ? », puis 1173 (même question police) a hérité du lien
// empoisonné. Même problème pour 1158/1160/1172→1144, 1166→1152, 1170→1135, 1171→1145.
//
// Idempotent : peut être relancé sans risque (utile si le process prod, encore en
// mémoire avec l'ancienne map, ré-écrase app_config avant le redéploiement).
// Une sauvegarde de l'état avant réparation est écrite dans data/ au premier run.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BACKUP_PATH = path.join(__dirname, "..", "data", "repair-shared-links-20260703-backup.json");

// Arguments à réaffecter : { nouvelle arène cible : [ids d'arguments] }
const ARG_MOVES = {
  1131: [2213, 2214, 2215, 2216, 2217, 2218, 2219, 2220, 2528, 2529, 2530, 2531, 2532, 2533, 2534, 2535, 2536],
  1158: [2419, 2428, 2429, 2430, 2431, 2432, 2433, 2434, 2435],
  1171: [2511, 2512, 2513, 2514, 2515, 2516, 2517, 2518, 2519],
  1166: [2475, 2476, 2477, 2478, 2479, 2480, 2481],
  1170: [2504, 2505, 2506, 2507, 2508, 2509, 2510],
  1172: [2520, 2521, 2522, 2523, 2524, 2525, 2526, 2527]
};

// Liens à supprimer (fusions fautives) et à re-cibler (fusions légitimes à préserver)
const LINKS_TO_DELETE = ["1131", "1158", "1166", "1170", "1171", "1172"];
const LINKS_TO_SET = { "1173": "1131", "1160": "1158" };

(async () => {
  const { data: cfg, error: cfgErr } = await supabase
    .from("app_config").select("value").eq("key", "shared_debate_links").maybeSingle();
  if (cfgErr) throw cfgErr;
  const map = cfg?.value || {};

  const allArgIds = Object.values(ARG_MOVES).flat();
  const { data: argsBefore, error: argsErr } = await supabase
    .from("arguments").select("id, debate_id").in("id", allArgIds);
  if (argsErr) throw argsErr;

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({
      savedAt: new Date().toISOString(),
      shared_debate_links: map,
      arguments: argsBefore
    }, null, 2), "utf8");
    console.log(`Sauvegarde écrite : ${BACKUP_PATH}`);
  }

  for (const [targetDebateId, argIds] of Object.entries(ARG_MOVES)) {
    const { error, count } = await supabase
      .from("arguments")
      .update({ debate_id: Number(targetDebateId) }, { count: "exact" })
      .in("id", argIds)
      .neq("debate_id", Number(targetDebateId));
    if (error) throw error;
    console.log(`Arguments → arène ${targetDebateId} : ${count} déplacé(s) (${argIds.length} attendus au premier run)`);
  }

  let changed = false;
  for (const key of LINKS_TO_DELETE) {
    if (map[key] !== undefined) { delete map[key]; changed = true; console.log(`Lien supprimé : ${key}`); }
  }
  for (const [src, dst] of Object.entries(LINKS_TO_SET)) {
    if (map[src] !== dst) { map[src] = dst; changed = true; console.log(`Lien re-ciblé : ${src} → ${dst}`); }
  }
  if (changed) {
    const { error } = await supabase.from("app_config")
      .upsert({ key: "shared_debate_links", value: map, updated_at: new Date().toISOString() });
    if (error) throw error;
    console.log("Map shared_debate_links mise à jour dans app_config.");
  } else {
    console.log("Map shared_debate_links déjà correcte, rien à écrire.");
  }

  console.log("\nRappel : le serveur prod garde l'ancienne map en mémoire jusqu'au redéploiement/restart.");
})().catch((err) => { console.error("ÉCHEC réparation :", err.message); process.exit(1); });
