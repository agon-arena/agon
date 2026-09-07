#!/usr/bin/env node
"use strict";
// Vérifications en lecture seule avant le canari de pré-génération (07/09/2026).
// N'écrit rien. Usage : node scripts/pregen-canary-precheck.js
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { normalizeCustomTopicKey, buildCustomTopicMasterSlot } = require("../lib/custom-topic-identity");

const CANARY_TITLE = process.argv[2] || "La photosynthèse";

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const report = {};

  const { error: queueErr } = await supabase.from("notion_quiz_pregeneration_queue").select("*").limit(1);
  const { error: callsErr } = await supabase.from("notion_quiz_pregeneration_calls").select("*").limit(1);
  report.queueTableOk = !queueErr;
  report.queueTableError = queueErr?.message || null;
  report.callsTableOk = !callsErr;
  report.callsTableError = callsErr?.message || null;

  report.envPregenerationSchedulerEnabled = process.env.PREGENERATION_SCHEDULER_ENABLED || "(absent)";

  const { data: activeRows, error: activeErr } = await supabase
    .from("notion_quiz_pregeneration_queue")
    .select("id, normalized_key, title, status, attempt_count, created_at")
    .in("status", ["pending", "queued", "generating"]);
  report.activeRowsError = activeErr?.message || null;
  report.activeRows = activeRows || [];

  const normalizedKey = normalizeCustomTopicKey(CANARY_TITLE);
  const masterSlot = buildCustomTopicMasterSlot(normalizedKey);
  const { data: existingDailyQuiz, error: dailyQuizErr } = await supabase
    .from("daily_quiz")
    .select("slot, quiz_date, progressive_status")
    .eq("slot", masterSlot);
  report.canary = { title: CANARY_TITLE, normalizedKey, masterSlot };
  report.canaryExistingDailyQuizRows = existingDailyQuiz || [];
  report.canaryExistingDailyQuizError = dailyQuizErr?.message || null;

  const { data: existingQueueRow, error: queueRowErr } = await supabase
    .from("notion_quiz_pregeneration_queue")
    .select("*")
    .eq("normalized_key", normalizedKey)
    .maybeSingle();
  report.canaryExistingQueueRow = existingQueueRow || null;
  report.canaryExistingQueueRowError = queueRowErr?.message || null;

  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error("ERREUR:", error.message);
  process.exit(1);
});
