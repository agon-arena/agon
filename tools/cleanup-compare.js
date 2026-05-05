#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const baselinePath = path.join(root, "tools/cleanup-baseline.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runCleanupSummary() {
  const result = spawnSync(process.execPath, [path.join(root, "tools/cleanup-summary.js")], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    console.error(output || "docs:compare failed: cleanup summary failed");
    process.exit(result.status || 1);
  }

  return JSON.parse(result.stdout);
}

function compareNumbers(sectionName, baselineValues, currentValues) {
  const rows = [];
  const keys = new Set([
    ...Object.keys(baselineValues || {}),
    ...Object.keys(currentValues || {})
  ]);

  for (const key of [...keys].sort()) {
    const before = Number(baselineValues?.[key] || 0);
    const after = Number(currentValues?.[key] || 0);
    rows.push({
      name: `${sectionName}.${key}`,
      baseline: before,
      current: after,
      delta: after - before,
      status: before === after ? "same" : "changed"
    });
  }

  return rows;
}

function compareDuplicateNames(baselineNames, currentDuplicates) {
  const before = new Set(baselineNames || []);
  const after = new Set((currentDuplicates || []).map(item => item.name));
  const added = [...after].filter(name => !before.has(name)).sort();
  const removed = [...before].filter(name => !after.has(name)).sort();

  return {
    baselineCount: before.size,
    currentCount: after.size,
    status: added.length || removed.length ? "changed" : "same",
    added,
    removed
  };
}

function main() {
  if (!fs.existsSync(baselinePath)) {
    console.error("docs:compare failed: missing tools/cleanup-baseline.json");
    process.exit(1);
  }

  const baseline = readJson(baselinePath);
  const current = runCleanupSummary();
  const runtimeSurfaceDiffs = compareNumbers(
    "runtimeSurfaces",
    baseline.runtimeSurfaces,
    current.runtimeSurfaces
  );
  const duplicateFunctionNames = compareDuplicateNames(
    baseline.duplicateFunctionNames,
    current.duplicateFunctionNames
  );
  const changedRuntimeSurfaces = runtimeSurfaceDiffs.filter(row => row.status !== "same");

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Read-only cleanup comparison. This command reports differences only and does not fail on changes.",
    mode: "report-only",
    status: changedRuntimeSurfaces.length || duplicateFunctionNames.status !== "same" ? "changed" : "same",
    runtimeSurfaces: runtimeSurfaceDiffs,
    duplicateFunctionNames,
    guidance: [
      "Expected for docs-only changes: status should stay same.",
      "Expected for deliberate tiny runtime cleanup: only the targeted surface should change.",
      "Unexpected changes should stop the cleanup step before manual browser testing."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
