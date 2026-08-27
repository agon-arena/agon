#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { validateQuestionBatchQuality, aggregateReasonCodes } = require("../lib/qcm-quality");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function loadRows() {
  const input = arg("--input");
  if (input) return JSON.parse(fs.readFileSync(input, "utf8"));
  if (!process.argv.includes("--from-db")) throw new Error("Utilise --input <fichier.json> ou --from-db (lecture seule). Aucun mode écriture n’est exécuté.");
  if (process.argv.includes("--write") && !process.argv.includes("--allow-write")) throw new Error("Toute mutation exige --allow-write ; ce script d’audit n’implémente volontairement aucune écriture.");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY manquants.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  let query = client.from("daily_quiz").select("quiz_date,slot,questions").order("quiz_date", { ascending: false });
  if (arg("--date-from")) query = query.gte("quiz_date", arg("--date-from"));
  if (arg("--date-to")) query = query.lte("quiz_date", arg("--date-to"));
  if (arg("--slot")) query = query.eq("slot", arg("--slot"));
  const { data, error } = await query.limit(Math.min(5000, Number(arg("--limit")) || 2000));
  if (error) throw error;
  return data || [];
}

(async () => {
  const rows = await loadRows();
  const questions = rows.flatMap((row) => (row.questions || []).map((question) => ({ ...question, __slot: row.slot, __date: row.quiz_date })));
  const report = validateQuestionBatchQuality(questions);
  const rejectedIndexes = new Set(report.rejected.map((entry) => entry.index));
  const byType = {};
  const byPeriod = {};
  questions.forEach((question, index) => {
    const type = String(question.type || "unknown");
    const period = String(question.__date || "unknown").slice(0, 7);
    const rejected = rejectedIndexes.has(index);
    byType[type] ||= { analyzed: 0, rejected: 0 };
    byPeriod[period] ||= { analyzed: 0, rejected: 0 };
    byType[type].analyzed += 1;
    byPeriod[period].analyzed += 1;
    if (rejected) {
      byType[type].rejected += 1;
      byPeriod[period].rejected += 1;
    }
  });
  process.stdout.write(JSON.stringify({
    readOnly: true,
    rows: rows.length,
    questions: questions.length,
    accepted: report.accepted.length,
    rejected: report.rejected.length,
    reasonCounts: aggregateReasonCodes(report.rejected),
    byType,
    byPeriod
  }, null, 2) + "\n");
})().catch((error) => { process.stderr.write(`Audit impossible : ${error.message}\n`); process.exitCode = 1; });
