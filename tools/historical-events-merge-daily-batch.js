#!/usr/bin/env node
"use strict";

// Convertit un lot "jour par jour" externe (index.json + schema.json +
// days/MM-DD.json, ex. cartes-jour-annee-aout-semaine-1) vers le format
// plat attendu par data/historical-events/events.json, puis fusionne
// (append) sans écraser les événements déjà présents. Aucun accès réseau,
// aucun appel IA. Dry-run par défaut : n'écrit qu'avec --write.
//
// Usage :
//   node tools/historical-events-merge-daily-batch.js <dossier-source> [--write] [--force]
//
// --write  écrit effectivement dans events.json (sinon simple aperçu).
// --force  autorise le remplacement d'un événement déjà présent sur le même
//          date_key/category (sinon la fusion est refusée si un doublon existe).

const fs = require("fs");
const path = require("path");
const { validateEvent, validateDataset, formatDateKey } = require("../lib/historical-events/validator");
const { CATEGORIES } = require("../lib/historical-events/constants");

const EVENTS_PATH = path.join(__dirname, "../data/historical-events/events.json");

function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`impossible de lire ${filePath} (${err.message}).`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON invalide dans ${filePath} (${err.message}).`);
  }
}

// review_status de l'app (draft/reviewed/validated/rejected) n'a pas
// d'équivalent direct au statut "test"/"draft"/"published" du lot source :
// tout ce qui n'est pas explicitement "published" devient "draft" (jamais
// "reviewed"/"validated" sans relecture humaine réelle dans Mnoria).
function mapReviewStatus(dayStatus) {
  return dayStatus === "published" ? "reviewed" : "draft";
}

// Dérive historical_source_name/url (obligatoires côté validateur) depuis
// sources[0] plutôt que d'assouplir cette exigence — la source primaire
// reste une vraie contrainte éditoriale, seule sa forme change. sources[1]
// alimente secondary_source_name/url quand il existe.
function convertEvent(categoryKey, rawEvent, dayFileLabel, dayDateKey, warnings) {
  if (!rawEvent || typeof rawEvent !== "object") {
    throw new Error(`${dayFileLabel} / ${categoryKey} : événement manquant ou invalide.`);
  }

  if (rawEvent.category && rawEvent.category !== categoryKey) {
    warnings.push(
      `${dayFileLabel} : incohérence corrigée — clé "${categoryKey}" mais category interne "${rawEvent.category}" ` +
      `(id ${rawEvent.id || "?"}), category forcée à "${categoryKey}" (celle qui définit réellement l'emplacement du jour).`
    );
  }

  // date_key n'existe qu'au niveau du fichier jour dans le lot source
  // (pas par événement) — transmis explicitement par l'appelant.
  const dateKey = String(dayDateKey || "").trim();
  const [monthStr, dayStr] = dateKey.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);

  const sources = Array.isArray(rawEvent.sources) ? rawEvent.sources : [];
  const primarySource = sources[0] || null;
  const secondarySource = sources[1] || null;

  return {
    id: rawEvent.id,
    month,
    day,
    date_key: dateKey,
    category: categoryKey,
    year: rawEvent.year,
    year_display: rawEvent.year_display,
    period: rawEvent.period,
    title: rawEvent.title,
    summary_short: rawEvent.summary_short,
    summary_long: rawEvent.summary_long,
    location: null,
    historical_source_name: primarySource ? primarySource.title : null,
    historical_source_url: primarySource ? primarySource.url : null,
    secondary_source_name: secondarySource ? secondarySource.title : null,
    secondary_source_url: secondarySource ? secondarySource.url : null,
    date_certainty: null,
    historical_importance: null,
    narrative_strength: null,
    image_relevance: null,
    image_filename: null,
    image_source_url: null,
    image_original_url: null,
    image_author: null,
    image_date: null,
    image_institution: null,
    image_license: null,
    image_license_url: null,
    image_credit: null,
    image_rights_verified: null,
    content_warnings: [],
    review_status: mapReviewStatus(rawEvent.__daySourceStatus),
    notes: `Importé depuis un lot externe (statut source : "${rawEvent.__daySourceStatus || "inconnu"}").`,
    // Champs propres au lot externe, conservés tels quels.
    why_it_matters: rawEvent.why_it_matters,
    anecdote: rawEvent.anecdote,
    anecdote_reliability: rawEvent.anecdote_reliability,
    tags: Array.isArray(rawEvent.tags) ? rawEvent.tags : [],
    sources
  };
}

function loadDayFiles(sourceDir) {
  const indexPath = path.join(sourceDir, "index.json");
  const index = readJson(indexPath);
  if (!index || !Array.isArray(index.files) || !index.files.length) {
    throw new Error(`index.json invalide ou vide dans ${sourceDir}.`);
  }

  const warnings = [];
  const converted = [];

  for (const relativeFile of index.files) {
    const dayPath = path.join(sourceDir, relativeFile);
    const dayData = readJson(dayPath);
    if (!dayData || typeof dayData !== "object" || !dayData.events || typeof dayData.events !== "object") {
      throw new Error(`${relativeFile} : structure invalide (events manquant).`);
    }
    for (const categoryKey of Object.keys(dayData.events)) {
      const rawEvent = dayData.events[categoryKey];
      if (!rawEvent) continue;
      rawEvent.__daySourceStatus = dayData.status;
      converted.push(convertEvent(categoryKey, rawEvent, relativeFile, dayData.date_key, warnings));
    }
  }

  return { converted, warnings, fileCount: index.files.length };
}

function main() {
  const args = process.argv.slice(2);
  const sourceDirArg = args.find((a) => !a.startsWith("--"));
  const write = args.includes("--write");
  const force = args.includes("--force");

  if (!sourceDirArg) {
    console.error("Usage: node tools/historical-events-merge-daily-batch.js <dossier-source> [--write] [--force]");
    process.exitCode = 1;
    return;
  }

  const sourceDir = path.resolve(sourceDirArg);
  if (!fs.existsSync(sourceDir)) {
    console.error(`Dossier source introuvable : ${sourceDir}`);
    process.exitCode = 1;
    return;
  }

  let loaded;
  try {
    loaded = loadDayFiles(sourceDir);
  } catch (err) {
    console.error(`Échec de lecture du lot source : ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (loaded.warnings.length) {
    console.log(`${loaded.warnings.length} correction(s) appliquée(s) :`);
    for (const w of loaded.warnings) console.log(`  - ${w}`);
    console.log("");
  }

  // Chaque événement converti individuellement, avant toute fusion — pour
  // localiser précisément une erreur dans le lot source, pas seulement dans
  // le jeu final combiné.
  const perEventErrors = [];
  for (const event of loaded.converted) {
    const result = validateEvent(event);
    if (!result.ok) perEventErrors.push({ id: event.id || "(id manquant)", errors: result.errors });
  }
  if (perEventErrors.length) {
    console.error(`${perEventErrors.length} événement(s) invalide(s) dans le lot source :`);
    for (const { id, errors } of perEventErrors) {
      console.error(`  [${id}] ${errors.join(" ; ")}`);
    }
    process.exitCode = 1;
    return;
  }

  let existingEvents;
  try {
    existingEvents = readJson(EVENTS_PATH);
  } catch (err) {
    console.error(`Impossible de lire ${EVENTS_PATH} : ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(existingEvents)) {
    console.error(`${EVENTS_PATH} doit contenir un tableau JSON.`);
    process.exitCode = 1;
    return;
  }

  // Refuse d'écraser silencieusement un événement déjà présent sur le même
  // date_key/category, sauf --force explicite.
  const existingSlots = new Set(existingEvents.map((e) => `${e.date_key}|${e.category}`));
  const conflicting = loaded.converted.filter((e) => existingSlots.has(`${e.date_key}|${e.category}`));
  let mergedEvents = existingEvents;
  if (conflicting.length && !force) {
    console.error(`${conflicting.length} événement(s) du lot source occupent un créneau déjà utilisé dans events.json :`);
    for (const e of conflicting) console.error(`  ${e.date_key}/${e.category} (id ${e.id})`);
    console.error("Relance avec --force pour remplacer ces créneaux existants.");
    process.exitCode = 1;
    return;
  }
  if (conflicting.length && force) {
    const conflictingSlots = new Set(conflicting.map((e) => `${e.date_key}|${e.category}`));
    mergedEvents = existingEvents.filter((e) => !conflictingSlots.has(`${e.date_key}|${e.category}`));
  }

  const finalEvents = [...mergedEvents, ...loaded.converted.map((e) => {
    // __daySourceStatus n'est qu'un accumulateur de conversion interne à ce
    // script, jamais un champ du schéma applicatif.
    const { __daySourceStatus, ...clean } = e;
    return clean;
  })];

  const datasetValidation = validateDataset(finalEvents);
  if (!datasetValidation.ok) {
    console.error(`Jeu de données final invalide (${datasetValidation.errors.length} erreur(s)) :`);
    for (const { id, message } of datasetValidation.errors.slice(0, 20)) console.error(`  [${id}] ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Lot source : ${loaded.fileCount} fichier(s) jour, ${loaded.converted.length} événement(s) converti(s).`);
  console.log(`events.json : ${existingEvents.length} événement(s) existant(s) -> ${finalEvents.length} après fusion.`);

  if (!write) {
    console.log("\nAperçu uniquement (dry-run) : relance avec --write pour écrire dans events.json.");
    return;
  }

  fs.writeFileSync(EVENTS_PATH, JSON.stringify(finalEvents, null, 2) + "\n", "utf8");
  console.log(`\n✓ ${EVENTS_PATH} mis à jour.`);
}

main();
