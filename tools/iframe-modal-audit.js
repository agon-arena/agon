#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "public/script.js",
  "views/index.html",
  "views/debate.html",
  "docs/iframe-modal-contract.md"
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
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

function functionBody(text, functionName) {
  const startPattern = new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`);
  const match = startPattern.exec(text);
  if (!match) return "";

  let depth = 0;
  for (let i = match.index; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(match.index, i + 1);
    }
  }

  return "";
}

function main() {
  const missingFiles = files.filter(file => !fs.existsSync(path.join(root, file)));
  if (missingFiles.length) {
    console.error("docs:iframe failed: missing files");
    for (const file of missingFiles) console.error(`- ${file}`);
    process.exit(1);
  }

  const script = readFile("public/script.js");
  const indexHtml = readFile("views/index.html");
  const debateHtml = readFile("views/debate.html");
  const resolveInitialBody = functionBody(script, "resolveInitialOpenModalUrl");
  const syncIndexBody = functionBody(script, "syncIndexUrlWithOpenIframeModal");
  const closeBody = functionBody(script, "closeDebateIframeModal");

  const requiredAnchors = [
    check("IFRAME_LATEST_MODAL_URL_KEY", has(script, /const\s+IFRAME_LATEST_MODAL_URL_KEY\s*=\s*["']agon_iframe_latest_modal_url["']/)),
    check("getLatestStoredIframeModalUrl", has(script, /function\s+getLatestStoredIframeModalUrl\s*\(/)),
    check("isSafeInternalModalUrl", has(script, /function\s+isSafeInternalModalUrl\s*\(/)),
    check("resolveInitialOpenModalUrl", has(script, /function\s+resolveInitialOpenModalUrl\s*\(/)),
    check("resolveInitial does not read latest stored url", !/getLatestStoredIframeModalUrl|IFRAME_LATEST_MODAL_URL_KEY/.test(resolveInitialBody)),
    check("resolveInitial uses explicit openModal only", /normalizedOpenModalUrl/.test(resolveInitialBody) && /isSafeInternalModalUrl/.test(resolveInitialBody)),
    check("ensureDebateIframeModal", has(script, /function\s+ensureDebateIframeModal\s*\(/)),
    check("openDebateIframeModal", has(script, /function\s+openDebateIframeModal\s*\(/)),
    check("closeDebateIframeModal", has(script, /function\s+closeDebateIframeModal\s*\(/)),
    check("syncIndexUrlWithOpenIframeModal", has(script, /function\s+syncIndexUrlWithOpenIframeModal\s*\(/)),
    check("rememberLatestIframeModalUrl", has(script, /function\s+rememberLatestIframeModalUrl\s*\(/)),
    check("iframe page context bridge", has(script, /function\s+initIframePageContextBridge\s*\(/)),
    check("parent context notify", has(script, /function\s+notifyParentAboutIframePageContext\s*\(/)),
    check("sync parent index from iframe", has(script, /function\s+syncParentIndexUrlFromIframe\s*\(/)),
    check("modal DOM id", has(script, /debate-iframe-modal/)),
    check("modal frame DOM id", has(script, /debate-iframe-modal-frame/)),
    check("modal close DOM id", has(script, /debate-iframe-modal-close/)),
    check("open maps direct /debates/:id", has(script, /location\.pathname\.match\(\/\^\\\/debates\\\/\(\.\+\)\$\//)),
    check("openModal query support", has(script, /params\.get\(["']openModal["']\)/)),
    check("openDebate query support", has(script, /params\.get\(["']openDebate["']\)/)),
    check("notifications not burned into URL", /notifications/.test(syncIndexBody) && /ne pas le graver|isNotificationsUrl/.test(syncIndexBody)),
    check("close returns index URL", /syncIndexUrlWithOpenIframeModal\(["']["']\)/.test(closeBody)),
    check("iframe ready message", has(script, /agon:debate-iframe-ready/)),
    check("iframe context message", has(script, /agon:iframe-page-context/)),
    check("close message", has(script, /agon:close-debate-modal/)),
    check("open debate in parent message", has(script, /agon:open-debate-in-parent-modal/)),
    check("index references notifications top link", has(indexHtml, /home-topbar-notifications-link/)),
    check("debate iframe bridge calls parent", has(debateHtml + script, /notifyParentAboutIframePageContext/))
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Read-only iframe modal navigation audit. This command does not start the app or change files.",
    status: requiredAnchors.every(item => item.status === "ok") ? "ok" : "attention",
    requiredAnchors,
    counts: {
      postMessageAgonTypes: countMatches(script, /agon:[A-Za-z0-9_-]+/g),
      historyPushState: countMatches(script, /history\.pushState/g),
      historyReplaceState: countMatches(script, /history\.replaceState/g),
      iframeModalMentions: countMatches(script, /debate-iframe-modal/g),
      latestModalStorageMentions: countMatches(script, /IFRAME_LATEST_MODAL_URL_KEY|agon_iframe_latest_modal_url/g)
    },
    locations: {
      resolveInitialOpenModalUrl: locations(script, /function\s+resolveInitialOpenModalUrl\s*\(/g),
      syncIndexUrlWithOpenIframeModal: locations(script, /function\s+syncIndexUrlWithOpenIframeModal\s*\(/g),
      openDebateIframeModal: locations(script, /function\s+openDebateIframeModal\s*\(/g),
      closeDebateIframeModal: locations(script, /function\s+closeDebateIframeModal\s*\(/g),
      iframeMessages: locations(script, /agon:[A-Za-z0-9_-]+/g)
    },
    nonZeroRiskBoundary: [
      "Reading stale modal URL from sessionStorage during initial index load.",
      "Changing parent URL mapping for /debate and /debates/:id.",
      "Burning /notifications into the parent URL while used as a temporary overlay.",
      "Changing postMessage type names.",
      "Changing close modal teardown or scroll restore order."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
