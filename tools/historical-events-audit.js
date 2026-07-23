#!/usr/bin/env node
"use strict";

// Audit hors-ligne de data/historical-events/events.json : validation
// complète du jeu de données + statistiques de couverture par jour/statut.
// Ne touche ni au réseau ni à Supabase. Usage : node tools/historical-events-audit.js

const fs = require("fs");
const path = require("path");
const { validateDataset } = require("../lib/historical-events/validator");
const { CATEGORIES } = require("../lib/historical-events/constants");

const eventsPath = path.join(__dirname, "../data/historical-events/events.json");

function loadEvents() {
  const raw = fs.readFileSync(eventsPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("events.json doit contenir un tableau.");
  return parsed;
}

function countByStatus(events) {
  const counts = {};
  for (const event of events) {
    const status = (event && event.review_status) || "(inconnu)";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function auditCoverage(events) {
  const byDateKey = new Map();
  for (const event of events) {
    if (!event || typeof event.date_key !== "string") continue;
    if (!byDateKey.has(event.date_key)) byDateKey.set(event.date_key, new Set());
    byDateKey.get(event.date_key).add(event.category);
  }
  const incomplete = [];
  for (const [dateKey, categories] of byDateKey) {
    const missing = CATEGORIES.filter((c) => !categories.has(c));
    if (missing.length) incomplete.push({ dateKey, missing });
  }
  incomplete.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return { totalDatesCovered: byDateKey.size, incomplete };
}

function run() {
  const events = loadEvents();
  console.log(`Événements chargés : ${events.length}\n`);

  const validation = validateDataset(events);
  if (validation.ok) {
    console.log("✓ Aucune erreur de validation.\n");
  } else {
    console.log(`✗ ${validation.errors.length} erreur(s) de validation :\n`);
    for (const { id, message } of validation.errors) console.log(`  [${id}] ${message}`);
    console.log("");
  }

  console.log("Répartition par statut :");
  const statusCounts = countByStatus(events);
  if (Object.keys(statusCounts).length === 0) console.log("  (aucun événement)");
  for (const [status, count] of Object.entries(statusCounts)) console.log(`  ${status}: ${count}`);
  console.log("");

  const coverage = auditCoverage(events);
  console.log(`Jours couverts (≥1 catégorie) : ${coverage.totalDatesCovered} / 366 possibles`);
  if (coverage.incomplete.length) {
    console.log(`Jours incomplets (catégorie(s) manquante(s)) : ${coverage.incomplete.length}`);
    for (const { dateKey, missing } of coverage.incomplete.slice(0, 20)) {
      console.log(`  ${dateKey} : manque ${missing.join(", ")}`);
    }
    if (coverage.incomplete.length > 20) console.log(`  … et ${coverage.incomplete.length - 20} de plus.`);
  }

  if (!validation.ok) process.exitCode = 1;
}

run();
