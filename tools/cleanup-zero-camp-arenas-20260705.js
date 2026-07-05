// Nettoyage du 2026-07-05 : supprime les arènes gauche/droite sans AUCUNE source
// de leur camp (règle : un sujet sans source de droite ne peut pas être publié à
// droite — garde-fou ajouté le même jour dans /api/admin/veille/publish, ce script
// purge l'existant). Toutes ont 0 commentaire humain ; leurs idées sont des seeds
// IA et les votes des vagues auto.
//
// 14 des 19 arènes sont les espaces canoniques de leurs jumelles (map
// shared_debate_links) : leurs idées sont déplacées vers la jumelle générale
// (sinon gauche) et la map est re-ciblée avant suppression.
//
// Usage :
//   node tools/cleanup-zero-camp-arenas-20260705.js prepare   # audit + sauvegarde + déplacement idées + re-ciblage map
//   npx pm2 restart agon-server                               # recharge la map en mémoire
//   node tools/cleanup-zero-camp-arenas-20260705.js delete    # suppressions via la route admin (cascade complète)
//
// Idempotent : chaque phase peut être relancée sans risque.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const AGON_URL = "http://localhost:3001";
const BACKUP_PATH = path.join(__dirname, "..", "data", "cleanup-zero-camp-arenas-20260705-backup.json");

// ── Copies exactes des helpers de comptage de server.js ──
function normalizeCloudSourceName(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['']/g, " ")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeCloudSourceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try { return new URL(raw).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return raw.toLowerCase(); }
}
function getCloudOrientationGroupFromLabel(orientation) {
  const value = String(orientation || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (value.includes("gauche") || value.includes("ecolog")) return "left";
  if (value.includes("droite") || value.includes("conservateur") || value.includes("souverainiste") || value.includes("liberal")) return "right";
  return "neutral";
}
function getCloudSourceOrientationGroup(name, url, maps) {
  const nameKey = normalizeCloudSourceName(name);
  if (nameKey) {
    if (maps.byName.has(nameKey)) return maps.byName.get(nameKey);
    for (const [known, group] of maps.byName) {
      if ((known.length >= 4 && nameKey.includes(known)) || (nameKey.length >= 4 && known.includes(nameKey))) return group;
    }
  }
  const hostname = normalizeCloudSourceUrl(url);
  if (hostname) {
    for (const [domain, group] of maps.byDomain) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return group;
    }
  }
  return "neutral";
}
function countCloudSourcesForGroup(debate, politicalGroup, maps) {
  const sources = new Map();
  (Array.isArray(debate?.media_extras) ? debate.media_extras : []).forEach((extra) => {
    if (!extra || typeof extra !== "object") return;
    if (String(extra.type || "source").trim() !== "source") return;
    const url = String(extra.url || extra.source_url || "").trim();
    const rawName = String(extra.source || extra.media || extra.publisher || "").trim();
    const sourceKey = normalizeCloudSourceName(rawName) || normalizeCloudSourceUrl(url);
    if (sourceKey && !sources.has(sourceKey)) sources.set(sourceKey, getCloudSourceOrientationGroup(rawName, url, maps));
  });
  if (!sources.size && debate?.source_url) {
    const sourceKey = normalizeCloudSourceUrl(debate.source_url);
    if (sourceKey) sources.set(sourceKey, getCloudSourceOrientationGroup("", debate.source_url, maps));
  }
  let count = 0;
  sources.forEach((g) => { if (g === politicalGroup) count++; });
  return count;
}

async function buildOrientationMaps() {
  const res = await fetch(`${AGON_URL}/api/about/medias`);
  if (!res.ok) throw new Error(`/api/about/medias HTTP ${res.status}`);
  const medias = (await res.json()).medias || [];
  const maps = { byDomain: new Map(), byName: new Map() };
  for (const media of medias) {
    const group = getCloudOrientationGroupFromLabel(media.orientation);
    if (group === "neutral") continue;
    if (media.domain && media.domain !== "youtube.com") maps.byDomain.set(media.domain, group);
    const nameKey = normalizeCloudSourceName(media.nom);
    if (nameKey) maps.byName.set(nameKey, group);
    const handleKey = normalizeCloudSourceName(media.handle || "");
    if (handleKey) maps.byName.set(handleKey, group);
  }
  return maps;
}

async function loadMap() {
  const { data, error } = await supabase
    .from("app_config").select("value").eq("key", "shared_debate_links").maybeSingle();
  if (error) throw error;
  return data?.value || {};
}

async function saveMap(map) {
  const { error } = await supabase.from("app_config")
    .upsert({ key: "shared_debate_links", value: map, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function findZeroCampArenas() {
  const maps = await buildOrientationMaps();
  const { data: debates, error } = await supabase
    .from("debates")
    .select("id, question, political_group, media_extras, source_url")
    .in("political_group", ["left", "right"]);
  if (error) throw error;
  return (debates || []).filter((d) => countCloudSourcesForGroup(d, d.political_group, maps) === 0);
}

async function prepare() {
  const zeroCamp = await findZeroCampArenas();
  if (!zeroCamp.length) { console.log("Aucune arène gauche/droite sans source de son camp."); return; }
  const deleteIds = zeroCamp.map((d) => Number(d.id)).sort((a, b) => a - b);
  console.log(`${deleteIds.length} arène(s) à supprimer : ${deleteIds.join(", ")}`);

  const map = await loadMap();
  const { data: debatesBefore, error: dErr } = await supabase
    .from("debates").select("*").in("id", deleteIds);
  if (dErr) throw dErr;
  const { data: argsBefore, error: aErr } = await supabase
    .from("arguments").select("*").in("debate_id", deleteIds);
  if (aErr) throw aErr;

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({
      savedAt: new Date().toISOString(),
      deleteIds,
      shared_debate_links: map,
      debates: debatesBefore,
      arguments: argsBefore
    }, null, 2), "utf8");
    console.log(`Sauvegarde écrite : ${BACKUP_PATH}`);
  } else {
    console.log("Sauvegarde déjà présente, conservée telle quelle.");
    const saved = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
    if (JSON.stringify(saved.deleteIds) !== JSON.stringify(deleteIds)) {
      console.warn(`ATTENTION : la liste sauvegardée diffère (${saved.deleteIds.join(", ")}).`);
    }
  }

  // Groupes politiques des jumelles (pour choisir le nouveau canonique)
  const inboundByDeleted = new Map();
  for (const [src, dst] of Object.entries(map)) {
    if (deleteIds.includes(Number(dst))) {
      if (!inboundByDeleted.has(Number(dst))) inboundByDeleted.set(Number(dst), []);
      inboundByDeleted.get(Number(dst)).push(Number(src));
    }
  }
  const twinIds = [...new Set([...inboundByDeleted.values()].flat())];
  const { data: twins, error: tErr } = twinIds.length
    ? await supabase.from("debates").select("id, political_group").in("id", twinIds)
    : { data: [], error: null };
  if (tErr) throw tErr;
  const groupOf = new Map((twins || []).map((t) => [Number(t.id), (t.political_group === "left" || t.political_group === "right") ? t.political_group : "mixed"]));

  let mapChanged = false;
  for (const deletedId of deleteIds) {
    const inbound = inboundByDeleted.get(deletedId) || [];
    if (inbound.length) {
      const missingTwin = inbound.find((src) => !groupOf.has(src));
      if (missingTwin !== undefined) throw new Error(`Jumelle ${missingTwin} introuvable (pointe vers ${deletedId}).`);
      const inDeleteList = inbound.find((src) => deleteIds.includes(src));
      if (inDeleteList !== undefined) throw new Error(`Jumelle ${inDeleteList} de ${deletedId} est elle-même à supprimer : cas non géré.`);
      // Nouveau canonique : la jumelle générale, sinon gauche, sinon la première.
      const canonical = inbound.find((src) => groupOf.get(src) === "mixed")
        ?? inbound.find((src) => groupOf.get(src) === "left")
        ?? inbound[0];

      const { error: moveErr, count } = await supabase
        .from("arguments")
        .update({ debate_id: canonical }, { count: "exact" })
        .eq("debate_id", deletedId);
      if (moveErr) throw moveErr;
      console.log(`Idées ${deletedId} → ${canonical} : ${count || 0} déplacée(s)`);

      for (const src of inbound) {
        if (src === canonical) {
          if (map[String(src)] !== undefined) { delete map[String(src)]; mapChanged = true; }
        } else if (map[String(src)] !== String(canonical)) {
          map[String(src)] = String(canonical);
          mapChanged = true;
          console.log(`Lien re-ciblé : ${src} → ${canonical}`);
        }
      }
    }
    // Lien sortant de l'arène supprimée (ses idées vivent ailleurs, rien à déplacer)
    if (map[String(deletedId)] !== undefined) {
      delete map[String(deletedId)];
      mapChanged = true;
      console.log(`Lien sortant retiré : ${deletedId}`);
    }
  }

  if (mapChanged) {
    await saveMap(map);
    console.log("Map shared_debate_links mise à jour — redémarre agon-server avant la phase delete.");
  } else {
    console.log("Map déjà correcte.");
  }
}

async function doDelete() {
  if (!fs.existsSync(BACKUP_PATH)) throw new Error("Sauvegarde absente : lancer la phase prepare d'abord.");
  const { deleteIds } = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));

  const loginRes = await fetch(`${AGON_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });
  if (!loginRes.ok) throw new Error(`Login admin impossible (HTTP ${loginRes.status})`);
  const { token } = await loginRes.json();
  if (!token) throw new Error("Token admin absent de la réponse login.");

  let deleted = 0, absent = 0, failed = 0;
  for (const id of deleteIds) {
    const res = await fetch(`${AGON_URL}/api/debates/${id}`, {
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
    if (deleteIds.includes(Number(src)) || deleteIds.includes(Number(dst))) leftovers.push(`${src}→${dst}`);
  }
  console.log(leftovers.length
    ? `ATTENTION, liens résiduels vers des arènes supprimées : ${leftovers.join(" ; ")}`
    : "Map finale propre : aucun lien ne référence une arène supprimée.");
}

const phase = String(process.argv[2] || "").trim();
(phase === "prepare" ? prepare() : phase === "delete" ? doDelete() : Promise.reject(new Error("Usage : prepare | delete")))
  .catch((err) => { console.error("ÉCHEC :", err.message); process.exit(1); });
