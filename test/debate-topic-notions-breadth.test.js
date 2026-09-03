"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("les sujets à approfondir des arènes exigent des notions autonomes et non des micro-variantes", () => {
  assert.match(serverSource, /sujet encyclopédique autonome/);
  assert.match(serverSource, /Ne produis jamais plusieurs micro-variantes/);
  assert.match(serverSource, /Éthique du bonheur et pratique quotidienne/);
  assert.match(serverSource, /Philosophie morale/);
});
