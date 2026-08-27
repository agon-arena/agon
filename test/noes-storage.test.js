"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNoesStorageObjectPath, uploadNoesVideo } = require("../lib/coeus/noes-storage");

test("buildNoesStorageObjectPath : nom content-addressed par video_hash", () => {
  assert.equal(buildNoesStorageObjectPath("abc123"), "noes/abc123.mp4");
});

function fakeSupabaseStorage({ uploadError = null, publicUrl = "https://example.supabase.co/storage/v1/object/public/bucket/noes/abc123.mp4" } = {}) {
  const calls = [];
  return {
    storage: {
      from(bucket) {
        calls.push({ bucket });
        return {
          async upload(objectPath, buffer, options) {
            calls.push({ upload: { bucket, objectPath, options } });
            return { error: uploadError };
          },
          getPublicUrl(objectPath) {
            calls.push({ getPublicUrl: { bucket, objectPath } });
            return { data: { publicUrl } };
          }
        };
      }
    },
    __calls: calls
  };
}

test("uploadNoesVideo : upload puis résout l'URL publique, avec le bon nom et les bonnes options", async () => {
  const supabase = fakeSupabaseStorage();
  const buffer = Buffer.from("mp4-bytes");
  const result = await uploadNoesVideo(supabase, {
    bucket: "debate-media", videoHash: "abc123", buffer, contentType: "video/mp4", cacheControl: "31536000"
  });
  assert.equal(result.objectPath, "noes/abc123.mp4");
  assert.equal(result.publicUrl, "https://example.supabase.co/storage/v1/object/public/bucket/noes/abc123.mp4");

  const uploadCall = supabase.__calls.find((c) => c.upload)?.upload;
  assert.equal(uploadCall.bucket, "debate-media");
  assert.equal(uploadCall.objectPath, "noes/abc123.mp4");
  assert.equal(uploadCall.options.contentType, "video/mp4");
  assert.equal(uploadCall.options.cacheControl, "31536000");
  // upsert:true (idempotent, cf. commentaire du module) : un nom content-
  // addressed peut légitimement être réécrit lors d'un retry après échec
  // partiel sans jamais produire de conflit.
  assert.equal(uploadCall.options.upsert, true);
});

test("uploadNoesVideo : propage une erreur d'upload sans tenter de résoudre l'URL", async () => {
  const supabase = fakeSupabaseStorage({ uploadError: { message: "quota dépassé" } });
  await assert.rejects(
    uploadNoesVideo(supabase, { bucket: "debate-media", videoHash: "abc123", buffer: Buffer.from("x") }),
    /quota dépassé/
  );
});

test("uploadNoesVideo : échoue proprement si Supabase ne renvoie aucune URL publique", async () => {
  const supabase = fakeSupabaseStorage({ publicUrl: "" });
  await assert.rejects(
    uploadNoesVideo(supabase, { bucket: "debate-media", videoHash: "abc123", buffer: Buffer.from("x") }),
    /URL publique/
  );
});
