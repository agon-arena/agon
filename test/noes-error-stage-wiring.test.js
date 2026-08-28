"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const view = fs.readFileSync(path.join(root, "views/qcm-du-jour.html"), "utf8");

test("la route de création expose l'étape sûre d'un échec Noès", () => {
  assert.match(server, /errorStage: video\.status === "failed" \? video\.error_stage : null/);
  assert.match(server, /configurationIssue:/);
  assert.match(server, /subtitleCues: video\.status === "ready" \? video\.subtitle_cues : null/);
});

test("l'interface traduit chaque étape Noès sans afficher l'erreur technique brute", () => {
  for (const stage of ["configuration", "submit", "runpod", "finalize", "timeout"]) {
    assert.match(view, new RegExp(`${stage}:`));
  }
  assert.match(view, /noesFailureMessage\(data\.errorStage, data\.configurationIssue\)/);
  assert.match(view, /Configuration Noès à corriger dans Render/);
  assert.match(view, /kind="subtitles" srclang="fr" label="Français"/);
  assert.match(view, /textTracks\[0\]\.mode = 'showing'/);
});
