#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "server.js",
  "lib/users.js",
  "docs/api-data-contract.md"
];

const expectedTables = [
  "users",
  "debates",
  "arguments",
  "comments",
  "votes",
  "comment_likes",
  "notifications",
  "reports",
  "page_visits"
];

const criticalRoutes = [
  { method: "post", path: "/api/users/resolve" },
  { method: "get", path: "/api/debates" },
  { method: "get", path: "/api/debates/:id" },
  { method: "post", path: "/api/debates" },
  { method: "post", path: "/api/arguments" },
  { method: "post", path: "/api/arguments/:id/vote" },
  { method: "post", path: "/api/arguments/:id/unvote" },
  { method: "post", path: "/api/comments" },
  { method: "post", path: "/api/comments/:id/vote" },
  { method: "get", path: "/api/notifications" },
  { method: "get", path: "/api/admin/reports" }
];

const cacheAnchors = [
  "debatesApiResponseCache",
  "debateDetailResponseCache",
  "notificationsApiResponseCache",
  "externalPreviewCache",
  "ogImageCache",
  "getCachedDebatesApiResponse",
  "setCachedDebatesApiResponse",
  "clearDebatesApiResponseCache",
  "getCachedDebateDetailResponse",
  "setCachedDebateDetailResponse",
  "clearDebateDetailResponseCache",
  "getCachedNotificationsApiResponse",
  "setCachedNotificationsApiResponse",
  "clearNotificationsApiResponseCache",
  "invalidateDebateCaches"
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

function locations(text, regex) {
  const rows = [];
  for (const match of text.matchAll(regex)) {
    rows.push({
      line: lineAt(text, match.index || 0),
      value: match[0].slice(0, 180)
    });
  }
  return rows;
}

function has(text, pattern) {
  return pattern.test(text);
}

function check(name, ok, detail = "") {
  return {
    name,
    status: ok ? "ok" : "missing",
    detail
  };
}

function routeRegex(method, routePath) {
  const escaped = String(routePath || "")
    .split("")
    .map(char => "\\^$.*+?()[]{}|".includes(char) ? "\\" + char : char)
    .join("");
  return new RegExp("app\\\." + method + "\\\(\\\s*[\"\']" + escaped + "[\"\']", "g");
}

function collectTables(server) {
  const tables = [];
  for (const match of server.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) {
    tables.push(match[1]);
  }
  return [...new Set(tables)].sort();
}

function collectRpc(server) {
  const rpc = [];
  for (const match of server.matchAll(/\.rpc\(\s*["']([^"']+)["']\s*,/g)) {
    rpc.push(match[1]);
  }
  return [...new Set(rpc)].sort();
}

function main() {
  const missingFiles = files.filter(file => !fs.existsSync(path.join(root, file)));
  if (missingFiles.length) {
    console.error("docs:data failed: missing files");
    for (const file of missingFiles) console.error(`- ${file}`);
    process.exit(1);
  }

  const server = readFile("server.js");
  const dataSourceCode = ["server.js", "lib/users.js"]
    .map(readFile)
    .join("\n");
  const tables = collectTables(dataSourceCode);
  const rpc = collectRpc(dataSourceCode);

  const requiredAnchors = [
    check("supabase createClient import", has(server, /createClient/)),
    check("SUPABASE_URL env", has(server, /SUPABASE_URL/)),
    check("SUPABASE_SERVICE_ROLE_KEY env", has(server, /SUPABASE_SERVICE_ROLE_KEY/)),
    check("SUPABASE_DEBATE_MEDIA_BUCKET env", has(server, /SUPABASE_DEBATE_MEDIA_BUCKET/)),
    check("cast_argument_vote rpc", rpc.includes("cast_argument_vote")),
    ...expectedTables.map(table => check(`table:${table}`, tables.includes(table))),
    ...criticalRoutes.map(route => check(`${route.method.toUpperCase()} ${route.path}`, routeRegex(route.method, route.path).test(server))),
    ...cacheAnchors.map(anchor => check(`cache:${anchor}`, server.includes(anchor))),
    check("debates select star tracked", countMatches(server, /\.from\(["']debates["']\)[\s\S]{0,120}?\.select\(["']\*["']\)/g) >= 1),
    check("notifications cache cleared", has(server, /clearNotificationsApiResponseCache\(\)/)),
    check("debate caches invalidated", has(server, /invalidateDebateCaches\(/))
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Read-only API/Supabase data contract audit. This command does not start the app, connect to Supabase, or change files.",
    status: requiredAnchors.every(item => item.status === "ok") ? "ok" : "attention",
    requiredAnchors,
    counts: {
      routes: countMatches(server, /app\.(get|post|put|patch|delete)\(/g),
      supabaseFromCalls: countMatches(dataSourceCode, /\.from\(/g),
      supabaseSelectStar: countMatches(dataSourceCode, /\.select\(["']\*["']\)/g),
      supabaseRpcCalls: countMatches(dataSourceCode, /\.rpc\(/g),
      cacheMentions: countMatches(server, /Cache|cache/g),
      invalidateDebateCachesCalls: countMatches(server, /invalidateDebateCaches\(/g),
      clearNotificationsCacheCalls: countMatches(server, /clearNotificationsApiResponseCache\(/g)
    },
    tables,
    rpc,
    locations: {
      selectStar: locations(server, /\.select\(["']\*["']\)/g),
      criticalRoutes: criticalRoutes.flatMap(route => locations(server, routeRegex(route.method, route.path))),
      invalidateDebateCaches: locations(server, /invalidateDebateCaches\(/g),
      clearNotificationsApiResponseCache: locations(server, /clearNotificationsApiResponseCache\(/g)
    },
    nonZeroRiskBoundary: [
      "Changing /api/debates response shape.",
      "Changing /api/debates/:id response shape.",
      "Changing cache keys or invalidation calls.",
      "Changing Supabase selectors from select star without response-shape checks.",
      "Changing vote/comment notification side effects.",
      "Changing cast_argument_vote payload expectations."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
