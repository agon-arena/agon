"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLocalImageUrl, isSafeImageFilename } = require("../lib/historical-events/image-path");

test("un nom de fichier simple donne une URL locale valide", () => {
  assert.equal(buildLocalImageUrl("fr-0312.jpg"), "/images/historical-events/fr-0312.jpg");
  assert.equal(buildLocalImageUrl("Photo_1.PNG"), "/images/historical-events/Photo_1.PNG");
});

test("image_filename absent ou null retourne null", () => {
  assert.equal(buildLocalImageUrl(null), null);
  assert.equal(buildLocalImageUrl(undefined), null);
  assert.equal(buildLocalImageUrl(""), null);
});

test("les chemins contenant .. sont refusés", () => {
  assert.equal(isSafeImageFilename("../../etc/passwd.jpg"), false);
  assert.equal(isSafeImageFilename("..%2f..%2fevil.jpg"), false);
  assert.equal(buildLocalImageUrl("../secret.png"), null);
});

test("les chemins absolus sont refusés", () => {
  assert.equal(isSafeImageFilename("/etc/passwd.jpg"), false);
  assert.equal(isSafeImageFilename("C:\\evil.jpg"), false);
  assert.equal(isSafeImageFilename("\\\\server\\share\\x.jpg"), false);
});

test("les séparateurs de chemin sont refusés même sans ..", () => {
  assert.equal(isSafeImageFilename("sous-dossier/image.jpg"), false);
  assert.equal(isSafeImageFilename("sous-dossier\\image.jpg"), false);
});

test("les noms suspects sont refusés", () => {
  assert.equal(isSafeImageFilename("image.jpg.exe"), false);
  assert.equal(isSafeImageFilename("sans-extension"), false);
  assert.equal(isSafeImageFilename(".hidden.jpg"), false);
  assert.equal(isSafeImageFilename("image.jpg\u0000.png"), false);
  assert.equal(isSafeImageFilename("  image.jpg"), false);
  assert.equal(isSafeImageFilename("image.jpg  "), false);
  assert.equal(isSafeImageFilename(42), false);
  assert.equal(isSafeImageFilename({}), false);
});

test("les extensions image usuelles sont acceptées", () => {
  for (const ext of ["jpg", "jpeg", "png", "webp", "avif", "gif"]) {
    assert.equal(isSafeImageFilename(`ok.${ext}`), true, ext);
  }
});
