"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  URL_KNOWLEDGE_MAX_REDIRECTS,
  UrlKnowledgeError,
  isBlockedIp,
  parsePublicHttpUrl,
  resolvePublicAddress,
  buildPinnedLookup,
  fetchPublicHtml,
  extractReadableContent,
  analyzeUrlKnowledge,
  createUrlAnalysisToken,
  verifyUrlAnalysisToken
} = require("../lib/url-knowledge");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const htmlHeaders = { "content-type": "text/html; charset=utf-8" };

test("les protocoles non HTTP(S), localhost et les IP privées sont refusés", async () => {
  assert.throws(() => parsePublicHttpUrl("file:///etc/passwd"), /HTTP et HTTPS/);
  assert.throws(() => parsePublicHttpUrl(`https://example.test/${"a".repeat(2048)}`), /trop longue/);
  assert.throws(() => parsePublicHttpUrl("http://localhost/admin"), /locale ou interne/);
  assert.throws(() => parsePublicHttpUrl("http://[::1]/admin"), /IP n'est pas autorisée/);
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp("93.184.216.34"), false);
  await assert.rejects(() => resolvePublicAddress(new URL("https://example.test"), async () => [{ address: "10.0.0.4", family: 4 }]), /réseau non autorisé/);
});

// ---- buildPinnedLookup : régression Happy Eyeballs (31/08/2026) ----
// Node active autoSelectFamily par défaut : https.request appelle ce lookup
// avec {all:true} et attend un TABLEAU d'adresses. L'ancienne implémentation
// (callback(null, address, family) inconditionnel) répondait dans ce cas
// avec le mauvais format et faisait échouer silencieusement TOUTE requête
// HTTPS pinnée avec "Invalid IP address: undefined" — jamais couvert par les
// tests existants car requestPage (donc requestPinnedUrl) y est mocké.

test("buildPinnedLookup : répond au format tableau attendu quand lookupOptions.all est demandé (Happy Eyeballs)", () => {
  const lookup = buildPinnedLookup({ address: "93.184.216.34", family: 4 });
  lookup("example.test", { all: true }, (err, result) => {
    assert.equal(err, null);
    assert.deepEqual(result, [{ address: "93.184.216.34", family: 4 }]);
  });
});

test("buildPinnedLookup : répond au format legacy (address, family séparés) quand lookupOptions.all n'est pas demandé", () => {
  const lookup = buildPinnedLookup({ address: "93.184.216.34", family: 4 });
  lookup("example.test", {}, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
  lookup("example.test", undefined, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
});

test("une URL publique HTML simple est acceptée et l'URL finale est renvoyée", async () => {
  const result = await fetchPublicHtml("https://example.test/article", {
    lookup: publicLookup,
    requestPage: async () => ({ status: 200, headers: htmlHeaders, body: Buffer.from("<html><body><article>Contenu</article></body></html>") })
  });
  assert.equal(result.finalUrl, "https://example.test/article");
  assert.match(result.html, /Contenu/);
});

test("chaque redirection est revalidée et une redirection privée est bloquée", async () => {
  let requests = 0;
  await assert.rejects(() => fetchPublicHtml("https://example.test/start", {
    lookup: publicLookup,
    requestPage: async () => {
      requests += 1;
      return { status: 302, headers: { location: "http://127.0.0.1/private" }, body: Buffer.alloc(0) };
    }
  }), /adresse IP n'est pas autorisée/);
  assert.equal(requests, 1);
});

test("le nombre de redirections est strictement plafonné", async () => {
  let requests = 0;
  await assert.rejects(() => fetchPublicHtml("https://example.test/0", {
    lookup: publicLookup,
    requestPage: async (url) => {
      requests += 1;
      return { status: 302, headers: { location: `/${Number(url.pathname.slice(1)) + 1}` }, body: Buffer.alloc(0) };
    }
  }), /trop de redirections/);
  assert.equal(requests, URL_KNOWLEDGE_MAX_REDIRECTS + 1);
});

test("PDF, contenu binaire et pages protégées sont refusés", async () => {
  await assert.rejects(() => fetchPublicHtml("https://example.test/file.pdf", {
    lookup: publicLookup,
    requestPage: async () => ({ status: 200, headers: { "content-type": "application/pdf" }, body: Buffer.from("%PDF-") })
  }), /HTML textuelle/);
  await assert.rejects(() => fetchPublicHtml("https://example.test/private", {
    lookup: publicLookup,
    requestPage: async () => ({ status: 403, headers: htmlHeaders, body: Buffer.alloc(0) })
  }), /protégée/);
});

test("timeout et réponse trop grosse sont propagés proprement", async () => {
  for (const error of [
    new UrlKnowledgeError("timeout", "La page met trop de temps à répondre."),
    new UrlKnowledgeError("response_too_large", "La page dépasse la limite de 2 Mo.")
  ]) {
    await assert.rejects(() => fetchPublicHtml("https://example.test/article", {
      lookup: publicLookup,
      requestPage: async () => { throw error; }
    }), (received) => received.code === error.code);
  }
});

test("Readability extrait le titre et le contenu principal sans le menu évident", () => {
  const html = `<!doctype html><html><head><title>La photosynthèse</title></head><body>
    <nav>Accueil Produits Contact Publicité</nav>
    <main><article><h1>La photosynthèse</h1>
      <p>La photosynthèse permet aux végétaux chlorophylliens de produire de la matière organique grâce à l'énergie lumineuse.</p>
      <p>Ce mécanisme consomme du dioxyde de carbone et libère du dioxygène dans les conditions décrites par ce cours.</p>
    </article></main><footer>Mentions légales Cookies Navigation</footer></body></html>`;
  const result = extractReadableContent(html, "https://example.test/article");
  assert.match(result.sourceTitle, /photosynthèse/i);
  assert.match(result.text, /matière organique/);
  assert.doesNotMatch(result.text, /Accueil Produits Contact/);
  assert.doesNotMatch(result.text, /Mentions légales/);
});

test("une page JS-only sans texte exploitable retourne content_not_available", () => {
  assert.throws(() => extractReadableContent('<html><body><div id="app"></div><script src="app.js"></script></body></html>', "https://example.test/app"), (error) => error.code === "content_not_available");
});

// ---- enforceMaxLength (31/08/2026, "privilégier Wikipédia") : une page très
// longue (typiquement un article Wikipédia complet) ne doit bloquer que le
// flux qui a réellement besoin du texte intégral, jamais le grounding web
// (lib/web-search-grounding.js), qui tronque de toute façon chaque source
// bien avant cette limite.

function buildLongArticleHtml(paragraphCount) {
  const paragraph = "Phrase factuelle assez longue pour peser sur la taille totale du texte extrait par Readability. ".repeat(6);
  const body = Array.from({ length: paragraphCount }, () => `<p>${paragraph}</p>`).join("");
  return `<!doctype html><html><head><title>Article long</title></head><body><main><article><h1>Article long</h1>${body}</article></main></body></html>`;
}

test("extractReadableContent : par défaut (enforceMaxLength non précisé), un article de plus de 50 000 caractères est rejeté (content_too_long) — comportement inchangé pour /api/url-knowledge/analyze", () => {
  const html = buildLongArticleHtml(600);
  assert.throws(() => extractReadableContent(html, "https://example.test/long"), (error) => error.code === "content_too_long");
});

test("extractReadableContent : enforceMaxLength:false conserve le texte intégral malgré les 50 000 caractères", () => {
  const html = buildLongArticleHtml(600);
  const result = extractReadableContent(html, "https://example.test/long", { enforceMaxLength: false });
  assert.ok(result.text.length > 50000, `attendu >50000, obtenu ${result.text.length}`);
  assert.match(result.sourceTitle, /Article long/);
});

test("l'analyse utilise la sélection textuelle et la feature url_knowledge_select", async () => {
  const calls = [];
  const result = await analyzeUrlKnowledge({
    url: "https://example.test/article",
    fetchHtml: async () => ({ finalUrl: "https://www.example.test/article", html: `<html><body><article><h1>Biologie</h1><p>${"La photosynthèse utilise l'énergie lumineuse. ".repeat(5)}</p></article></body></html>` }),
    callOpenAI: async (messages, opts) => {
      calls.push({ messages, opts });
      return JSON.stringify({ sourceTitle: "Biologie", knowledge: [] });
    }
  });
  assert.equal(result.status, "ok");
  assert.equal(result.sourceUrl, "https://www.example.test/article");
  assert.deepEqual(result.knowledge, []);
  assert.equal(calls[0].opts.model, "gpt-4o-mini");
  assert.equal(calls[0].opts.feature, "url_knowledge_select");
});

test("le jeton signé protège l'URL finale persistée", () => {
  const token = createUrlAnalysisToken({ sourceUrl: "https://example.test/final" }, "secret", 1_000);
  assert.equal(verifyUrlAnalysisToken(token, "secret", 2_000).sourceUrl, "https://example.test/final");
  assert.throws(() => verifyUrlAnalysisToken(token + "x", "secret", 2_000), /invalide/);
  assert.throws(() => verifyUrlAnalysisToken(token, "secret", 3 * 60 * 60 * 1000), /expiré/);
});

test("la route d'analyse n'écrit rien et l'ajout rejoint url_import", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const view = fs.readFileSync(path.join(__dirname, "..", "views", "photo-knowledge.html"), "utf8");
  const start = server.indexOf('app.post("/api/url-knowledge/analyze"');
  const end = server.indexOf("// ÉCRITURE séparée", start);
  const route = server.slice(start, end);
  assert.doesNotMatch(route, /\.from\(|insert\(|upsert\(|MemoryItem|FSRS/);
  assert.match(server, /sourceType: "url_import"/);
  assert.match(server, /sourceUrl: token\.sourceUrl/);
  assert.match(view, /window\.location\.pathname === "\/url-knowledge"/);
  assert.match(view, /"\/api\/url-knowledge\/analyze"/);
  assert.match(view, /"\/api\/url-knowledge\/add"/);
});
