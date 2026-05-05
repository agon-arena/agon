#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "server.js",
  "public/script.js",
  "public/style.css",
  "views/index.html",
  "views/debate.html"
];

function readFile(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function topCounts(values, limit = 10) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function collect(text, regex, getValue) {
  const rows = [];
  for (const match of text.matchAll(regex)) {
    rows.push(getValue(match, lineAt(text, match.index || 0)));
  }
  return rows;
}

function duplicateFunctions(fileTexts) {
  const byName = new Map();
  for (const [file, text] of Object.entries(fileTexts)) {
    for (const match of text.matchAll(/\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g)) {
      const name = match[1];
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ file, line: lineAt(text, match.index || 0) });
    }
  }

  return [...byName.entries()]
    .filter(([, locations]) => locations.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, locations]) => ({ name, count: locations.length, locations }));
}

function main() {
  const missing = files.filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    console.error("docs:cleanup failed: missing files");
    for (const file of missing) console.error(`- ${file}`);
    process.exit(1);
  }

  const fileTexts = Object.fromEntries(files.map(file => [file, readFile(file)]));
  const browserCode = [
    fileTexts["public/script.js"],
    fileTexts["views/index.html"],
    fileTexts["views/debate.html"]
  ].join("\n");

  const windowNames = collect(browserCode, /window\.([A-Za-z0-9_$]+)\s*=/g, match => match[1]);
  const handlerNames = collect(browserCode, /\s(on[a-z]+)=["']/g, match => match[1]);
  const listenerEvents = collect(browserCode, /addEventListener\(\s*["']([^"']+)["']/g, match => match[1]);
  const duplicates = duplicateFunctions({
    "server.js": fileTexts["server.js"],
    "public/script.js": fileTexts["public/script.js"],
    "views/index.html": fileTexts["views/index.html"],
    "views/debate.html": fileTexts["views/debate.html"]
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    note: "Compact read-only cleanup summary. This command does not start the app or change files.",
    size: files.map(file => ({
      file,
      lines: fileTexts[file].length ? fileTexts[file].split("\n").length : 0,
      bytes: fs.statSync(path.join(root, file)).size
    })).sort((a, b) => b.lines - a.lines),
    runtimeSurfaces: {
      inlineScripts: countMatches(fileTexts["views/index.html"], /<script\b/gi)
        + countMatches(fileTexts["views/debate.html"], /<script\b/gi),
      inlineStyles: countMatches(fileTexts["views/index.html"], /<style\b/gi)
        + countMatches(fileTexts["views/debate.html"], /<style\b/gi),
      inlineHandlers: handlerNames.length,
      windowAssignments: windowNames.length,
      eventListeners: listenerEvents.length,
      mutationObservers: countMatches(browserCode, /new MutationObserver/g),
      intersectionObservers: countMatches(browserCode, /new IntersectionObserver/g)
    },
    topRuntimeNames: {
      inlineHandlers: topCounts(handlerNames),
      windowAssignments: topCounts(windowNames),
      eventListeners: topCounts(listenerEvents)
    },
    duplicateFunctionNames: duplicates.slice(0, 20),
    safestNextSteps: [
      "Document one sensitive runtime area before moving code.",
      "Map call sites for one duplicate helper before merging anything.",
      "Compare this summary before and after each cleanup attempt."
    ],
    nonZeroRiskBoundary: [
      "Moving inline scripts into public/script.js.",
      "Changing window assignments.",
      "Replacing inline handlers.",
      "Merging helpers used by both index and debate pages."
    ]
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
