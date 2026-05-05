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

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function collectMatches(text, regex, mapMatch) {
  const rows = [];
  for (const match of text.matchAll(regex)) {
    rows.push(mapMatch(match, lineAt(text, match.index || 0)));
  }
  return rows;
}

function fileStats(file) {
  const absolute = path.join(root, file);
  const text = readFile(file);
  return {
    file,
    lines: text.length ? text.split("\n").length : 0,
    bytes: fs.statSync(absolute).size
  };
}

function topCounts(values, limit = 20) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function duplicateFunctions(fileTexts) {
  const rows = [];
  for (const [file, text] of Object.entries(fileTexts)) {
    const regex = /\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g;
    for (const match of text.matchAll(regex)) {
      rows.push({ name: match[1], file, line: lineAt(text, match.index || 0) });
    }
  }

  const byName = new Map();
  for (const row of rows) {
    if (!byName.has(row.name)) byName.set(row.name, []);
    byName.get(row.name).push(row);
  }

  return [...byName.entries()]
    .filter(([, items]) => items.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, count: items.length, items }));
}

function inlineBlocks(file, text, tagName) {
  const regex = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  return collectMatches(text, regex, (match, line) => ({
    file,
    line,
    tag: match[0].slice(0, 180)
  }));
}

function main() {
  const missing = files.filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    console.error("docs:inventory failed: missing files");
    for (const file of missing) console.error(`- ${file}`);
    process.exit(1);
  }

  const fileTexts = Object.fromEntries(files.map(file => [file, readFile(file)]));
  const browserTexts = {
    "public/script.js": fileTexts["public/script.js"],
    "views/index.html": fileTexts["views/index.html"],
    "views/debate.html": fileTexts["views/debate.html"]
  };

  const windowAssignments = [];
  const inlineHandlers = [];
  const listeners = [];
  const observers = [];

  for (const [file, text] of Object.entries(browserTexts)) {
    windowAssignments.push(...collectMatches(text, /window\.([A-Za-z0-9_$]+)\s*=/g, (match, line) => ({
      file,
      line,
      name: match[1]
    })));

    inlineHandlers.push(...collectMatches(text, /\s(on[a-z]+)=["']/g, (match, line) => ({
      file,
      line,
      handler: match[1]
    })));

    listeners.push(...collectMatches(text, /addEventListener\(\s*["']([^"']+)["']/g, (match, line) => ({
      file,
      line,
      event: match[1]
    })));

    observers.push(...collectMatches(text, /new\s+(MutationObserver|IntersectionObserver)\b/g, (match, line) => ({
      file,
      line,
      type: match[1]
    })));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Read-only code inventory. This command does not start the app or change files.",
    files: files.map(fileStats).sort((a, b) => b.lines - a.lines),
    inlineHtml: {
      scripts: [
        ...inlineBlocks("views/index.html", fileTexts["views/index.html"], "script"),
        ...inlineBlocks("views/debate.html", fileTexts["views/debate.html"], "script")
      ],
      styles: [
        ...inlineBlocks("views/index.html", fileTexts["views/index.html"], "style"),
        ...inlineBlocks("views/debate.html", fileTexts["views/debate.html"], "style")
      ],
      handlers: {
        count: inlineHandlers.length,
        topHandlers: topCounts(inlineHandlers.map(row => row.handler)),
        locations: inlineHandlers
      }
    },
    browserSurface: {
      windowAssignments: {
        count: windowAssignments.length,
        topNames: topCounts(windowAssignments.map(row => row.name)),
        locations: windowAssignments
      },
      eventListeners: {
        count: listeners.length,
        topEvents: topCounts(listeners.map(row => row.event)),
        locations: listeners
      },
      observers: {
        count: observers.length,
        topTypes: topCounts(observers.map(row => row.type)),
        locations: observers
      }
    },
    duplicateFunctionNames: duplicateFunctions({
      "server.js": fileTexts["server.js"],
      "public/script.js": fileTexts["public/script.js"],
      "views/index.html": fileTexts["views/index.html"],
      "views/debate.html": fileTexts["views/debate.html"]
    }),
    cleanupGuidance: [
      "Prefer documentation and inventory updates before moving runtime code.",
      "Treat duplicate names across HTML and public/script.js as risky until call sites are mapped.",
      "Treat window assignments as public browser API for inline handlers and page patches."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
