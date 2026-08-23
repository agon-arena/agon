"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  YoutubeKnowledgeError,
  parseYoutubeVideoUrl,
  normalizeTranscript,
  knowledgeLimitForYoutube,
  buildYoutubeBlocks,
  deduplicateYoutubeKnowledge,
  analyzeYoutubeKnowledge,
  createYoutubeAnalysisToken,
  verifyYoutubeAnalysisToken
} = require("../lib/youtube-knowledge");

test("accepte watch, youtu.be et shorts mais refuse domaines, playlists et pages non vidéo", () => {
  const id = "abcdefghijk";
  for (const url of [`https://youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://www.youtube.com/shorts/${id}`]) {
    assert.equal(parseYoutubeVideoUrl(url).canonicalUrl, `https://www.youtube.com/watch?v=${id}`);
  }
  for (const url of ["https://example.com/watch?v=abcdefghijk", "https://youtube.com/playlist?list=x", "https://youtube.com/@mnoria", "https://youtube.com/watch?list=x"]) {
    assert.throws(() => parseYoutubeVideoUrl(url), (error) => error.code === "invalid_url");
  }
});

test("nettoie la transcription, les répétitions techniques et calcule sa durée", () => {
  const result = normalizeTranscript([
    { text: "Bonjour &amp; bienvenue", offset: 0, duration: 2 },
    { text: "Bonjour &amp; bienvenue", offset: 2, duration: 2 },
    { text: "[Musique] La suite", offset: 4, duration: 3 }
  ]);
  assert.equal(result.text, "Bonjour & bienvenue La suite");
  assert.equal(result.durationSeconds, 7);
  assert.equal(result.segments.length, 2);
});

test("le plafond adaptatif suit exactement 20, 40, 60 et 100", () => {
  assert.equal(knowledgeLimitForYoutube(600), 20);
  assert.equal(knowledgeLimitForYoutube(601), 40);
  assert.equal(knowledgeLimitForYoutube(1801), 60);
  assert.equal(knowledgeLimitForYoutube(3601), 100);
  assert.equal(knowledgeLimitForYoutube(0, 14_000), 20);
  assert.equal(knowledgeLimitForYoutube(0, 46_000), 60);
});

test("les longues transcriptions sont découpées en plusieurs blocs ordonnés", () => {
  const blocks = buildYoutubeBlocks([
    { text: "A".repeat(80), offset: 0, duration: 10 },
    { text: "B".repeat(80), offset: 10, duration: 10 }
  ], 100);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => [block.startSeconds, block.endSeconds]), [[0, 10], [10, 20]]);
});

test("analyse tous les blocs avec gpt-4o-mini, déduplique et accepte knowledge vide", async () => {
  const calls = [];
  const result = await analyzeYoutubeKnowledge({
    url: "https://youtu.be/abcdefghijk",
    fetchTranscript: async () => [
      { text: "A".repeat(13_900), offset: 0, duration: 700 },
      { text: "B".repeat(13_900), offset: 700, duration: 700 }
    ],
    fetchMetadata: async () => ({ sourceTitle: "Cours public", author: "Chaîne test" }),
    callOpenAI: async (messages, options) => {
      calls.push({ messages, options });
      return calls.length === 1
        ? JSON.stringify({ knowledge: [{ knowledge: "Fait commun", evidence: "AAA" }] })
        : JSON.stringify({ knowledge: [{ knowledge: " fait commun ", evidence: "BBB" }] });
    }
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.model === "gpt-4o-mini" && call.options.feature === "youtube_knowledge_select"));
  assert.equal(result.knowledge.length, 1);
  assert.equal(result.maxKnowledge, 40);
  assert.equal(result.author, "Chaîne test");

  const empty = await analyzeYoutubeKnowledge({
    url: "https://youtube.com/watch?v=abcdefghijk",
    fetchTranscript: async () => [{ text: "Une transcription suffisamment longue pour être analysée sans connaissance notable.", offset: 0, duration: 60 }],
    fetchMetadata: async () => ({ sourceTitle: null, author: null }),
    callOpenAI: async () => JSON.stringify({ knowledge: [] })
  });
  assert.deepEqual(empty.knowledge, []);
});

test("transcript absent, vidéo indisponible et vidéo trop longue ont des codes distincts", async () => {
  await assert.rejects(
    analyzeYoutubeKnowledge({
      url: "https://youtu.be/abcdefghijk", fetchTranscript: async () => [], fetchMetadata: async () => ({}), callOpenAI: async () => "{}"
    }),
    (error) => error.code === "transcript_not_available"
  );
  await assert.rejects(
    analyzeYoutubeKnowledge({
      url: "https://youtu.be/abcdefghijk",
      fetchTranscript: async () => { throw new YoutubeKnowledgeError("video_unavailable", "indisponible"); },
      fetchMetadata: async () => ({}), callOpenAI: async () => "{}"
    }),
    (error) => error.code === "video_unavailable"
  );
  await assert.rejects(
    analyzeYoutubeKnowledge({
      url: "https://youtu.be/abcdefghijk",
      fetchTranscript: async () => [{ text: "Texte exploitable suffisamment long pour le test de durée.", offset: 7_199, duration: 2 }],
      fetchMetadata: async () => ({}), callOpenAI: async () => "{}"
    }),
    (error) => error.code === "video_too_long"
  );
});

test("la déduplication globale conserve uniquement les faits ancrés jusqu'au plafond", () => {
  const result = deduplicateYoutubeKnowledge([
    { knowledge: "La Terre tourne autour du Soleil.", evidence: "preuve" },
    { knowledge: " la terre tourne autour du soleil ", evidence: "autre" },
    { knowledge: "Le document mentionne la Terre.", evidence: "méta" }
  ], 20);
  assert.equal(result.length, 1);
});

test("le jeton protège URL, titre, auteur, durée et plafond", () => {
  const secret = "secret-test";
  const token = createYoutubeAnalysisToken({
    sourceTitle: "Titre", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", author: "Chaîne", durationSeconds: 1800, maxKnowledge: 40
  }, secret, 1_000);
  const payload = verifyYoutubeAnalysisToken(token, secret, 2_000);
  assert.equal(payload.sourceAuthor, "Chaîne");
  assert.equal(payload.maxKnowledge, 40);
  assert.throws(() => verifyYoutubeAnalysisToken(token + "x", secret, 2_000));
});

test("le serveur n'écrit pas pendant analyze et raccorde add au pipeline commun", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const view = fs.readFileSync(path.join(root, "views/photo-knowledge.html"), "utf8");
  const start = server.indexOf('app.post("/api/youtube-knowledge/analyze"');
  const end = server.indexOf("// ÉCRITURE séparée", start);
  const route = server.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(route, /supabase\.|daily_quiz|user_notion_quizzes/);
  assert.match(server, /sourceType: "youtube_import"/);
  assert.match(server, /addValidatedKnowledgeImport\(/);
  assert.match(view, /window\.location\.pathname === "\/youtube-knowledge"/);
  assert.match(view, /"\/api\/youtube-knowledge\/analyze"/);
  assert.match(view, /"\/api\/youtube-knowledge\/add"/);
});
