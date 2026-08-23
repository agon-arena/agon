"use strict";

const crypto = require("crypto");
const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { analyzeTextKnowledge, TEXT_KNOWLEDGE_MAX_CHARS } = require("./text-knowledge");

const URL_KNOWLEDGE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const URL_KNOWLEDGE_MAX_REDIRECTS = 3;
const URL_KNOWLEDGE_TIMEOUT_MS = 10_000;
const URL_KNOWLEDGE_MIN_TEXT_CHARS = 120;
const URL_ANALYSIS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

class UrlKnowledgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (!version) return true;
  if (version === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && ((b === 0 && c === 0) || (b === 0 && c === 2) || b === 168))
      || (a === 198 && [18, 19, 51].includes(b))
      || (a === 203 && b === 0 && c === 113);
  }
  const value = ip.toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);
  const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isBlockedIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return value === "::" || value === "::1" || /^f[cd]/.test(value)
    || /^fe[89ab]/.test(value) || /^ff/.test(value) || /^2001:db8/.test(value);
}

function parsePublicHttpUrl(rawUrl) {
  if (String(rawUrl || "").trim().length > 2048) throw new UrlKnowledgeError("invalid_url", "URL trop longue.");
  let parsed;
  try { parsed = new URL(String(rawUrl || "").trim()); }
  catch (error) { throw new UrlKnowledgeError("invalid_url", "URL invalide."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new UrlKnowledgeError("invalid_protocol", "Seules les URL HTTP et HTTPS sont acceptées.");
  if (parsed.username || parsed.password) throw new UrlKnowledgeError("invalid_url", "Les URL contenant des identifiants ne sont pas acceptées.");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0") {
    throw new UrlKnowledgeError("ssrf_blocked", "Cette adresse locale ou interne n'est pas autorisée.");
  }
  if (net.isIP(hostname) && isBlockedIp(hostname)) throw new UrlKnowledgeError("ssrf_blocked", "Cette adresse IP n'est pas autorisée.");
  parsed.hash = "";
  return parsed;
}

async function resolvePublicAddress(parsedUrl, lookup = dns.promises.lookup) {
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return { address: hostname, family: net.isIP(hostname) };
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
  catch (error) { throw new UrlKnowledgeError("dns_failed", "Impossible de résoudre cette adresse."); }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new UrlKnowledgeError("ssrf_blocked", "Cette adresse redirige vers un réseau non autorisé.");
  }
  return addresses[0];
}

async function resolvePublicAddressBeforeDeadline(parsedUrl, lookup, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      resolvePublicAddress(parsedUrl, lookup),
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new UrlKnowledgeError("timeout", "La page met trop de temps à répondre.")),
          timeoutMs
        );
        timeoutId.unref?.();
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function requestPinnedUrl(parsedUrl, address, options = {}) {
  const timeoutMs = options.timeoutMs || URL_KNOWLEDGE_TIMEOUT_MS;
  const maxBytes = options.maxBytes || URL_KNOWLEDGE_MAX_RESPONSE_BYTES;
  const transport = parsedUrl.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(parsedUrl, {
      method: "GET",
      headers: {
        "User-Agent": "MnoriaKnowledgeImporter/1.0",
        "Accept": "text/html,application/xhtml+xml;q=0.9"
      },
      lookup: (hostname, lookupOptions, callback) => callback(null, address.address, address.family)
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const contentLength = Number(response.headers["content-length"] || 0);
      if (contentLength > maxBytes) {
        response.destroy();
        reject(new UrlKnowledgeError("response_too_large", "La page dépasse la limite de 2 Mo."));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy(new UrlKnowledgeError("response_too_large", "La page dépasse la limite de 2 Mo."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new UrlKnowledgeError("timeout", "La page met trop de temps à répondre.")));
    req.on("error", (error) => reject(error instanceof UrlKnowledgeError ? error : new UrlKnowledgeError("fetch_failed", "Impossible de récupérer cette page.")));
    req.end();
  });
}

async function fetchPublicHtml(rawUrl, options = {}) {
  let current = parsePublicHttpUrl(rawUrl);
  const requestPage = options.requestPage || requestPinnedUrl;
  const lookup = options.lookup || dns.promises.lookup;
  const deadline = Date.now() + (options.timeoutMs || URL_KNOWLEDGE_TIMEOUT_MS);
  for (let redirectCount = 0; redirectCount <= URL_KNOWLEDGE_MAX_REDIRECTS; redirectCount += 1) {
    const remainingTimeoutMs = deadline - Date.now();
    if (remainingTimeoutMs <= 0) throw new UrlKnowledgeError("timeout", "La page met trop de temps à répondre.");
    const address = await resolvePublicAddressBeforeDeadline(current, lookup, remainingTimeoutMs);
    const requestTimeoutMs = deadline - Date.now();
    if (requestTimeoutMs <= 0) throw new UrlKnowledgeError("timeout", "La page met trop de temps à répondre.");
    const response = await requestPage(current, address, { ...options, timeoutMs: requestTimeoutMs });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.location;
      if (!location) throw new UrlKnowledgeError("invalid_redirect", "Redirection web invalide.");
      if (redirectCount >= URL_KNOWLEDGE_MAX_REDIRECTS) throw new UrlKnowledgeError("too_many_redirects", "La page effectue trop de redirections.");
      current = parsePublicHttpUrl(new URL(location, current).href);
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new UrlKnowledgeError("protected_page", "Cette page est protégée ou nécessite une authentification.");
    if (response.status < 200 || response.status >= 300) throw new UrlKnowledgeError("http_error", `La page a répondu avec le statut ${response.status}.`);
    const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)) {
      throw new UrlKnowledgeError("unsupported_content_type", "Ce lien ne pointe pas vers une page HTML textuelle.");
    }
    return { finalUrl: current.href, html: response.body.toString("utf8") };
  }
  throw new UrlKnowledgeError("too_many_redirects", "La page effectue trop de redirections.");
}

function extractReadableContent(html, sourceUrl) {
  const dom = new JSDOM(String(html || ""), { url: sourceUrl });
  try {
    const article = new Readability(dom.window.document).parse();
    const text = String(article?.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < URL_KNOWLEDGE_MIN_TEXT_CHARS) throw new UrlKnowledgeError("content_not_available", "Le contenu principal n'est pas disponible. Essaie le copier-coller ou une autre source.");
    if (text.length > TEXT_KNOWLEDGE_MAX_CHARS) throw new UrlKnowledgeError("content_too_long", "Cette page dépasse 50 000 caractères. Choisis un extrait avec Coller du texte.");
    const sourceTitle = String(article?.title || dom.window.document.title || "").trim().replace(/\s+/g, " ").slice(0, 160) || null;
    return { sourceTitle, text };
  } finally {
    dom.window.close();
  }
}

async function analyzeUrlKnowledge({ url, callOpenAI, fetchHtml = fetchPublicHtml }) {
  const page = await fetchHtml(url);
  const extracted = extractReadableContent(page.html, page.finalUrl);
  const selected = await analyzeTextKnowledge({ ...extracted, callOpenAI, feature: "url_knowledge_select" });
  return { status: "ok", sourceTitle: selected.sourceTitle, sourceUrl: page.finalUrl, knowledge: selected.knowledge };
}

function createUrlAnalysisToken(payload, secret, now = Date.now()) {
  if (!secret) throw new Error("Secret de signature URL manquant.");
  const encoded = Buffer.from(JSON.stringify({ sourceUrl: payload.sourceUrl, issuedAt: now })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyUrlAnalysisToken(token, secret, now = Date.now()) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || !secret) throw new Error("Jeton d'analyse URL invalide.");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Jeton d'analyse URL invalide.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  parsePublicHttpUrl(payload.sourceUrl);
  if (!Number.isFinite(payload.issuedAt) || now - payload.issuedAt > URL_ANALYSIS_TOKEN_TTL_MS || payload.issuedAt > now + 60_000) throw new Error("Jeton d'analyse URL expiré ou invalide.");
  return payload;
}

module.exports = {
  URL_KNOWLEDGE_MAX_RESPONSE_BYTES,
  URL_KNOWLEDGE_MAX_REDIRECTS,
  URL_KNOWLEDGE_TIMEOUT_MS,
  UrlKnowledgeError,
  isBlockedIp,
  parsePublicHttpUrl,
  resolvePublicAddress,
  requestPinnedUrl,
  fetchPublicHtml,
  extractReadableContent,
  analyzeUrlKnowledge,
  createUrlAnalysisToken,
  verifyUrlAnalysisToken
};
