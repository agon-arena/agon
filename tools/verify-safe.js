#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "server.js",
  "public/script.js",
  "public/style.css",
  "views/index.html",
  "views/debate.html",
  "package.json"
];

function fail(message) {
  console.error(`verify:safe failed: ${message}`);
  process.exitCode = 1;
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`missing required file: ${file}`);
  }
}

for (const file of ["server.js", "public/script.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${file} has a syntax error${output ? `\n${output}` : ""}`);
  }
}

const server = readFile("server.js");
const client = readFile("public/script.js");
const indexHtml = readFile("views/index.html");
const debateHtml = readFile("views/debate.html");
const browserCode = `${client}\n${indexHtml}\n${debateHtml}`;

const metrics = {
  routes: countMatches(server, /app\.(get|post|put|patch|delete)\(/g),
  supabaseSelectStar: countMatches(server, /\.select\(["']\*["']\)/g),
  mutationObservers: countMatches(browserCode, /new MutationObserver/g),
  intersectionObservers: countMatches(browserCode, /new IntersectionObserver/g),
  eventListeners: countMatches(browserCode, /addEventListener/g),
  globalWindowWrites: countMatches(browserCode, /window\.[A-Za-z0-9_$]+\s*=/g)
};

if (!/app\.get\(["']\/api\/debates["']/.test(server)) {
  fail("missing /api/debates route");
}

if (!/app\.get\(["']\/api\/debates\/:id["']/.test(server)) {
  fail("missing /api/debates/:id route");
}

if (!/document\.addEventListener\(["']DOMContentLoaded["']/.test(client)) {
  fail("missing client DOMContentLoaded bootstrap");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("verify:safe ok");
console.log(JSON.stringify(metrics, null, 2));
