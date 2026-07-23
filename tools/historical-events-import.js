#!/usr/bin/env node
"use strict";

// Import de data/historical-events/events.json vers la table Supabase
// "historical_events" (cf. data/migration-historical-events.sql).
// Toujours en dry-run par défaut : le mode réel n'est déclenché que par
// --live, et échoue explicitement si le jeu de données ne valide pas.
//
// Usage :
//   node tools/historical-events-import.js             (dry-run, aucun réseau)
//   node tools/historical-events-import.js --live       (upsert réel dans Supabase)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { validateDataset } = require("../lib/historical-events/validator");

const TABLE = "historical_events";
const eventsPath = path.join(__dirname, "../data/historical-events/events.json");

const args = process.argv.slice(2);
const isLive = args.includes("--live");

function loadEvents() {
  const parsed = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("events.json doit contenir un tableau.");
  return parsed;
}

async function run() {
  const events = loadEvents();
  console.log(`Événements chargés : ${events.length}`);

  const validation = validateDataset(events);
  if (!validation.ok) {
    console.error(`✗ ${validation.errors.length} erreur(s) de validation — import annulé :`);
    for (const { id, message } of validation.errors) console.error(`  [${id}] ${message}`);
    process.exit(1);
  }
  console.log("✓ Jeu de données valide.\n");

  if (!isLive) {
    console.log(`[DRY-RUN] ${events.length} ligne(s) seraient upsertées dans la table "${TABLE}" (onConflict: id).`);
    console.log("[DRY-RUN] Aucune connexion réseau effectuée. Relance avec --live pour exécuter réellement.");
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans l'environnement.");
    process.exit(1);
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  console.log(`Import réel de ${events.length} ligne(s) dans "${TABLE}"...\n`);
  let ok = 0;
  let fail = 0;
  for (const event of events) {
    const { error } = await supabase.from(TABLE).upsert(event, { onConflict: "id" });
    if (error) {
      console.error(`  ✗ ${event.id}: ${error.message}`);
      fail++;
    } else {
      console.log(`  ✓ ${event.id}`);
      ok++;
    }
  }

  console.log(`\n✓ Importés : ${ok}${fail ? `, ✗ échecs : ${fail}` : ""}`);
  if (fail) process.exitCode = 1;
}

run().catch((e) => {
  console.error("Erreur fatale:", e.message);
  process.exit(1);
});
