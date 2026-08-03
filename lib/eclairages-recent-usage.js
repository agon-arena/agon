"use strict";

// Évite qu'un même concept/mécanisme/citation/œuvre/parallèle revienne trop
// vite d'un jour à l'autre sur une rubrique Éclairages donnée (ex. "Le Cri"
// choisi comme œuvre d'art deux jours de suite) : chaque service Éclairages
// relit sa propre table pour bannir, à la génération suivante, tout ce qui a
// déjà été publié dans les RECENT_REPEAT_AVOIDANCE_DAYS derniers jours — pas
// de récurrence par sujet d'actualité (la même œuvre peut très bien revenir
// en écho à un tout autre sujet plus tard, seul le nom lui-même compte ici).
// Zéro dépendance à server.js : ne prend que ce qui lui est passé en argument
// (même principe que les 6 services Éclairages qui l'utilisent).

const RECENT_REPEAT_AVOIDANCE_DAYS = 7;

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// Un aller-retour Supabase, lecture seule — les RECENT_REPEAT_AVOIDANCE_DAYS
// jours avant todayDateKey (jour courant exclu, jamais encore publié au
// moment de l'appel). Renvoie à la fois la liste brute (à afficher dans le
// prompt) et l'ensemble normalisé (à comparer côté validation).
async function fetchRecentEclairagesIdentities({
  supabase,
  table,
  contentKey,
  identityField,
  todayDateKey,
  days = RECENT_REPEAT_AVOIDANCE_DAYS,
  logger = console
}) {
  const since = new Date(`${todayDateKey}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - days);
  const sinceKey = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from(table)
    .select("date, content")
    .eq("status", "published")
    .gte("date", sinceKey)
    .lt("date", todayDateKey);
  if (error) {
    logger.error(`[eclairages-recent-usage] lecture historique ${table} :`, error.message);
    return { raw: [], normalized: new Set() };
  }

  const raw = [];
  const normalized = new Set();
  for (const row of data || []) {
    const items = Array.isArray(row.content?.[contentKey]) ? row.content[contentKey] : [];
    for (const item of items) {
      const value = String(item?.[identityField] || "").trim();
      if (!value) continue;
      raw.push(value);
      normalized.add(normalizeIdentity(value));
    }
  }
  return { raw, normalized };
}

module.exports = { RECENT_REPEAT_AVOIDANCE_DAYS, normalizeIdentity, fetchRecentEclairagesIdentities };
