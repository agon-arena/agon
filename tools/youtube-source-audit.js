#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "public/script.js",
  "public/style.css",
  "views/index.html",
  "views/debate.html",
  "docs/youtube-source-contract.md"
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
      value: match[0].slice(0, 160)
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

function main() {
  const missingFiles = files.filter(file => !fs.existsSync(path.join(root, file)));
  if (missingFiles.length) {
    console.error("docs:youtube failed: missing files");
    for (const file of missingFiles) console.error(`- ${file}`);
    process.exit(1);
  }

  const script = readFile("public/script.js");
  const css = readFile("public/style.css");
  const indexHtml = readFile("views/index.html");
  const debateHtml = readFile("views/debate.html");

  const requiredAnchors = [
    check("buildIndexYouTubeEmbedHtml", has(script, /function\s+buildIndexYouTubeEmbedHtml\s*\(/)),
    check("initIndexYouTubeObserver", has(script, /function\s+initIndexYouTubeObserver\s*\(/)),
    check("initDebateYouTubeShell", has(script, /function\s+initDebateYouTubeShell\s*\(/)),
    check("cleanupDebateYouTubeShells", has(script, /function\s+cleanupDebateYouTubeShells\s*\(/)),
    check("bindIndexYouTubeSoundButton", has(script, /function\s+bindIndexYouTubeSoundButton\s*\(/)),
    check("updateYtSourceSoundButton", has(script, /function\s+updateYtSourceSoundButton\s*\(/)),
    check("postMessageToIndexYouTubeIframe", has(script, /function\s+postMessageToIndexYouTubeIframe\s*\(/)),
    check("debate source yt container", has(script, /ytContainer\.id\s*=\s*['"]debate-source-yt-container['"]/)),
    check("debate source shell init", has(script, /initDebateYouTubeShell\(ytContainer\)/)),
    check("youtube shell data attr", has(script, /data-index-youtube-shell/)),
    check("youtube poster data attr", has(script, /data-index-youtube-poster/)),
    check("youtube overlay data attr", has(script, /data-index-youtube-overlay/)),
    check("youtube sound data attr", has(script, /data-index-youtube-sound-btn/)),
    check("youtube sound class", has(script, /debate-card-youtube-source-sound-toggle/)),
    check("enablejsapi in embed src", has(script, /enablejsapi/)),
    check("mobile direct-child sound CSS", has(css, /\.debate-card-youtube-shell\s*>\s*\.debate-card-youtube-source-sound-toggle/)),
    check("mobile sound bottom-right", has(css, /bottom:\s*10px\s*!important/) && has(css, /right:\s*10px\s*!important/)),
    check("index youtube cache bust marker", has(indexHtml, /youtube-sound-inside-video/)),
    check("debate youtube cache bust marker", has(debateHtml, /youtube-sound-inside-video/))
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    note: "Read-only YouTube source preview audit. This command does not start the app or change files.",
    status: requiredAnchors.every(item => item.status === "ok") ? "ok" : "attention",
    requiredAnchors,
    counts: {
      dataIndexYouTubeShell: countMatches(script, /data-index-youtube-shell/g),
      dataIndexYouTubeSoundBtn: countMatches(script, /data-index-youtube-sound-btn/g),
      debateSourceYtContainer: countMatches(script, /debate-source-yt-container/g),
      youtubeSoundCssRules: countMatches(css, /debate-card-youtube-source-sound-toggle/g),
      enableJsApiMentions: countMatches(script, /enablejsapi/g)
    },
    locations: {
      soundButtonMarkup: locations(script, /class="debate-card-sound-toggle debate-card-youtube-source-sound-toggle"/g),
      soundButtonCss: locations(css, /\.debate-card-youtube-shell\s*>\s*\.debate-card-youtube-source-sound-toggle/g),
      debateContainer: locations(script, /debate-source-yt-container/g)
    },
    nonZeroRiskBoundary: [
      "Moving the sound button outside .debate-card-youtube-shell.",
      "Changing direct-child CSS placement selector.",
      "Changing enablejsapi or postMessage sound commands.",
      "Changing debate source preview hydration or cleanup.",
      "Changing swipe behavior around source media."
    ]
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
