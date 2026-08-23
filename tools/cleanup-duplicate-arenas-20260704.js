// Nettoyage du 2026-07-04 : supprime les arènes en double au sein d'un même groupe
// politique (règle : une variante par groupe général/gauche/droite, jamais deux).
// Doublons créés par le pipeline veille/Certamen avant les gardes du commit c443bd5
// (dédup bot contournée, double POST concurrent, check-similar rate-limité).
//
// Pour chaque groupe de questions identiques (normalisées) on garde l'arène avec du
// contenu (à égalité, la plus ancienne) et on supprime les autres — toutes ont été
// vérifiées : 0 vote et 0 commentaire sur les supprimées, leurs idées sont des seeds
// IA dupliqués. Seule 1223 a des idées à déplacer (vers 1159, canonique de 1193).
//
// Usage :
//   node tools/cleanup-duplicate-arenas-20260704.js prepare   # sauvegarde + déplacement idées + re-ciblage map
//   npx pm2 restart mnoria-server                               # recharge la map en mémoire
//   node tools/cleanup-duplicate-arenas-20260704.js delete    # suppressions via la route admin (cascade complète)
//
// Idempotent : chaque phase peut être relancée sans risque.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MNORIA_URL = "http://localhost:3001";
const BACKUP_PATH = path.join(__dirname, "..", "data", "cleanup-duplicate-arenas-20260704-backup.json");

// Arènes à supprimer (doublon conservé indiqué en commentaire)
const DELETE_IDS = [
  379,  // = 372  Israël peine de mort militaire
  477,  // = 476  désinformation climatique
  480,  // = 479  flottille pour Gaza
  578,  // = 577  frappes américaines en Iran
  588,  // = 583  suspension des frappes (fusionnée, 0 contenu propre)
  679,  // = 676  SMIC vs déficits
  684,  // = 680  sécurité grandes célébrations
  687,  // = 683  Colombie extrême droite
  713,  // = 710  Ukraine riposte militaire
  726,  // = 725  investissement SoftBank (triple)
  727,  // = 725  investissement SoftBank (triple)
  729,  // = 720  UE contrôle migratoire
  839,  // = 834  Knicks titre NBA
  865,  // = 859  célébration PSG (fusionnée, 0 contenu propre)
  894,  // = 895  Europe 3e Dali — on garde la jumelle qui a 17 idées et 6 votes
  971,  // = 975  affaire Lyhanna — on garde la jumelle avec idées
  972,  // = 976  comptage morts canicule — idem
  973,  // = 977  imprescriptibilité violences sexuelles — idem
  1056, // = 1048 protection des animaux (fusionnée, 0 contenu propre)
  1088, // = 1089 jeunes de Nanterre (paire du 27/06, on garde la plus fournie)
  1091, // = 1090 chantiers canicule (paire du 27/06)
  1095, // = 1094 agir contre la canicule (paire du 27/06)
  1097, // = 1096 investissements adaptation (paire du 27/06)
  1099, // = 1098 lutte canicule individuel/politique (paire du 27/06)
  1221, // = 1220 attaque russe sur Kiev (même lot du 03/07)
  1223, // = 1193 incendies dans le Sud (idées déplacées vers 1159, canonique de 1193)
  1236, // = 1205 Guillaume Erner (fusionnée, 0 contenu propre)
  1255  // = 1237 Hamza «La Douane» (republication du 03/07)
];

// Idées à déplacer avant suppression : { arène source : arène cible }
// 1223 → 1159 : 1193 (jumelle conservée) est fusionnée dans l'espace 1159 ;
// ses idées doivent donc vivre sous 1159 pour rester visibles.
const ARG_MOVES = { 1223: 1159 };

// Liens de la map à re-cibler avant suppression (sinon la route delete orphelinise
// les arènes qui pointaient vers la supprimée) : { source : nouvelle cible }
const MAP_REPOINTS = { "1235": "1159" };

async function loadMap() {
  const { data, error } = await supabase
    .from("app_config").select("value").eq("key", "shared_debate_links").maybeSingle();
  if (error) throw error;
  return data?.value || {};
}

async function prepare() {
  const map = await loadMap();

  const { data: debatesBefore, error: dErr } = await supabase
    .from("debates").select("*").in("id", DELETE_IDS);
  if (dErr) throw dErr;
  const { data: argsBefore, error: aErr } = await supabase
    .from("arguments").select("*").in("debate_id", DELETE_IDS);
  if (aErr) throw aErr;

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({
      savedAt: new Date().toISOString(),
      shared_debate_links: map,
      debates: debatesBefore,
      arguments: argsBefore
    }, null, 2), "utf8");
    console.log(`Sauvegarde écrite : ${BACKUP_PATH}`);
  } else {
    console.log("Sauvegarde déjà présente, conservée telle quelle.");
  }

  for (const [sourceId, targetId] of Object.entries(ARG_MOVES)) {
    const { error, count } = await supabase
      .from("arguments")
      .update({ debate_id: Number(targetId) }, { count: "exact" })
      .eq("debate_id", Number(sourceId));
    if (error) throw error;
    console.log(`Idées ${sourceId} → ${targetId} : ${count} déplacée(s)`);
  }

  let changed = false;
  for (const [src, dst] of Object.entries(MAP_REPOINTS)) {
    if (map[src] !== dst) { map[src] = dst; changed = true; console.log(`Lien re-ciblé : ${src} → ${dst}`); }
  }
  if (changed) {
    const { error } = await supabase.from("app_config")
      .upsert({ key: "shared_debate_links", value: map, updated_at: new Date().toISOString() });
    if (error) throw error;
    console.log("Map shared_debate_links mise à jour — redémarre mnoria-server avant la phase delete.");
  } else {
    console.log("Map déjà correcte.");
  }
}

async function doDelete() {
  const loginRes = await fetch(`${MNORIA_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });
  if (!loginRes.ok) throw new Error(`Login admin impossible (HTTP ${loginRes.status})`);
  const { token } = await loginRes.json();
  if (!token) throw new Error("Token admin absent de la réponse login.");

  let deleted = 0, absent = 0, failed = 0;
  for (const id of DELETE_IDS) {
    const res = await fetch(`${MNORIA_URL}/api/debates/${id}`, {
      method: "DELETE",
      headers: { "x-admin-token": token }
    });
    if (res.ok) { deleted += 1; console.log(`✓ Arène ${id} supprimée`); }
    else if (res.status === 404) { absent += 1; console.log(`- Arène ${id} déjà absente`); }
    else {
      failed += 1;
      const body = await res.text().catch(() => "");
      console.error(`✗ Arène ${id} : HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`\nBilan : ${deleted} supprimée(s), ${absent} déjà absente(s), ${failed} échec(s).`);

  const map = await loadMap();
  const leftovers = [];
  for (const [src, dst] of Object.entries(map)) {
    if (DELETE_IDS.includes(Number(src)) || DELETE_IDS.includes(Number(dst))) leftovers.push(`${src}→${dst}`);
  }
  console.log(leftovers.length
    ? `ATTENTION, liens résiduels vers des arènes supprimées : ${leftovers.join(" ; ")}`
    : "Map finale propre : aucun lien ne référence une arène supprimée.");
}

const phase = String(process.argv[2] || "").trim();
(phase === "prepare" ? prepare() : phase === "delete" ? doDelete() : Promise.reject(new Error("Usage : prepare | delete")))
  .catch((err) => { console.error("ÉCHEC :", err.message); process.exit(1); });
