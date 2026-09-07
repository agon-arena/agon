#!/usr/bin/env node
"use strict";
// Canari manuel de pré-génération (07/09/2026) : login admin + boucle
// d'appels à /api/admin/pregeneration/run-canary jusqu'à état terminal
// (ready/failed) ou nombre max de cycles. N'active jamais le scheduler
// continu — appelle un cycle réel à la fois, via la route admin qui
// réutilise runPregenerationCycle() telle quelle.
require("dotenv").config();

const TITLE = process.argv[2] || "La photosynthèse";
const MAX_CYCLES = parseInt(process.argv[3], 10) || 20;
const INTERVAL_MS = parseInt(process.argv[4], 10) || 30_000;
const BASE_URL = process.env.PREGEN_CANARY_BASE_URL || "http://localhost:3001";

async function login() {
  const res = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD })
  });
  const data = await res.json();
  if (!data.token) throw new Error("Échec login admin.");
  return data.token;
}

async function runCycle(token) {
  const res = await fetch(`${BASE_URL}/api/admin/pregeneration/run-canary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify({ title: TITLE })
  });
  return res.json();
}

(async () => {
  const token = await login();
  for (let i = 1; i <= MAX_CYCLES; i++) {
    const result = await runCycle(token);
    const q = result.queueRow || {};
    const calls = (result.calls || []).map((c) => `${c.call_key}:${c.status}`).join(", ");
    console.log(`[cycle ${i}] ${new Date().toISOString()} status=${q.status} attempt=${q.attempt_count} error=${q.error_reason || "-"}`);
    console.log(`  calls: ${calls}`);
    if (q.status === "ready" || q.status === "failed") {
      console.log(`TERMINAL: ${q.status}`);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log("MAX_CYCLES atteint sans état terminal.");
})().catch((error) => {
  console.error("ERREUR:", error.message);
  process.exit(1);
});
