#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const trackedFiles = [
  "server.js",
  "public/script.js",
  "public/style.css",
  "views/index.html",
  "views/debate.html",
  "package.json"
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJsonIfExists(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function countLines(text) {
  return text.length ? text.split("\n").length : 0;
}

function matchLocations(text, regex) {
  const locations = [];
  for (const match of text.matchAll(regex)) {
    locations.push({
      line: lineNumberAt(text, match.index || 0),
      value: match[0].slice(0, 160)
    });
  }
  return locations;
}

function topCounts(values, limit = 12) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function apiRoutes(server) {
  const routes = [];
  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;

  for (const match of server.matchAll(routeRegex)) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      line: lineNumberAt(server, match.index || 0)
    });
  }

  return routes;
}

function routeHotspots(routes) {
  return topCounts(routes.map(route => route.path.split("/").slice(0, 3).join("/") || "/"), 10);
}

function fileStats(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const text = readFile(relativePath);
  const bytes = fs.statSync(absolutePath).size;

  return {
    file: relativePath,
    lines: countLines(text),
    bytes
  };
}

function compareBudget(name, actual, max) {
  const exceededBy = actual - max;
  return {
    name,
    actual,
    max,
    status: exceededBy > 0 ? "over" : "ok",
    exceededBy: exceededBy > 0 ? exceededBy : 0
  };
}

function budgetReport(report, budgets) {
  if (!budgets) {
    return {
      status: "missing",
      note: "No tools/scale-budgets.json file found."
    };
  }

  const checks = [];
  const fileBudgets = budgets.files || {};
  const filesByName = new Map(report.files.map(file => [file.file, file]));

  for (const [file, budget] of Object.entries(fileBudgets)) {
    if (budget.maxLines && filesByName.has(file)) {
      checks.push(compareBudget(`${file} lines`, filesByName.get(file).lines, budget.maxLines));
    }
  }

  if (budgets.api?.maxRouteCount) {
    checks.push(compareBudget("api route count", report.api.routeCount, budgets.api.maxRouteCount));
  }

  if (budgets.api?.maxSupabaseSelectStarCount) {
    checks.push(compareBudget(
      "supabase select star count",
      report.dataAccess.supabaseSelectStarCount,
      budgets.api.maxSupabaseSelectStarCount
    ));
  }

  if (budgets.browserWork?.maxMutationObserverCount) {
    checks.push(compareBudget(
      "mutation observer count",
      report.browserWork.mutationObserverCount,
      budgets.browserWork.maxMutationObserverCount
    ));
  }

  if (budgets.browserWork?.maxIntersectionObserverCount) {
    checks.push(compareBudget(
      "intersection observer count",
      report.browserWork.intersectionObserverCount,
      budgets.browserWork.maxIntersectionObserverCount
    ));
  }

  if (budgets.browserWork?.maxAddEventListenerCount) {
    checks.push(compareBudget(
      "event listener count",
      report.browserWork.addEventListenerCount,
      budgets.browserWork.maxAddEventListenerCount
    ));
  }

  return {
    status: checks.some(check => check.status === "over") ? "over" : "ok",
    mode: "report-only",
    note: budgets.note || "Budgets are informational only.",
    checks
  };
}

function clientSignals(browserCode) {
  const eventNames = [];
  const listenerRegex = /addEventListener\(\s*["']([^"']+)["']/g;
  for (const match of browserCode.matchAll(listenerRegex)) {
    eventNames.push(match[1]);
  }

  const windowWrites = [];
  const windowWriteRegex = /window\.([A-Za-z0-9_$]+)\s*=/g;
  for (const match of browserCode.matchAll(windowWriteRegex)) {
    windowWrites.push(match[1]);
  }

  return {
    listenerEvents: topCounts(eventNames, 16),
    globalWindowWrites: topCounts(windowWrites, 16)
  };
}

function main() {
  const missing = trackedFiles.filter(file => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    console.error("audit:scale failed: missing files");
    for (const file of missing) console.error(`- ${file}`);
    process.exit(1);
  }

  const server = readFile("server.js");
  const client = readFile("public/script.js");
  const indexHtml = readFile("views/index.html");
  const debateHtml = readFile("views/debate.html");
  const browserCode = `${client}\n${indexHtml}\n${debateHtml}`;
  const routes = apiRoutes(server);
  const budgets = readJsonIfExists("tools/scale-budgets.json");

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Read-only scale audit. This command does not start the app, write data, or call external services.",
    files: trackedFiles.map(fileStats).sort((a, b) => b.lines - a.lines),
    api: {
      routeCount: routes.length,
      byMethod: topCounts(routes.map(route => route.method), 8),
      hotspots: routeHotspots(routes),
      routes
    },
    dataAccess: {
      supabaseSelectStarCount: matchLocations(server, /\.select\(["']\*["']\)/g).length,
      supabaseSelectStarLocations: matchLocations(server, /\.select\(["']\*["']\)/g)
    },
    browserWork: {
      mutationObserverCount: matchLocations(browserCode, /new MutationObserver/g).length,
      intersectionObserverCount: matchLocations(browserCode, /new IntersectionObserver/g).length,
      addEventListenerCount: matchLocations(browserCode, /addEventListener/g).length,
      ...clientSignals(browserCode)
    },
    riskFreeNextTargets: [
      "Turn recurring audit numbers into documented budgets without failing builds.",
      "Add focused contract checks for API response shapes using local fixtures only.",
      "Add route inventory documentation generated from server.js."
    ]
  };

  report.budgets = budgetReport(report, budgets);

  console.log(JSON.stringify(report, null, 2));
}

main();
