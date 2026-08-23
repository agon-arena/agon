"use strict";

// Couvre lib/knowledge-image-search.js — recherche d'image pour le pipeline
// "connaissance" sujet libre / notion de débat avec niveau (seul pipeline
// "connaissance" qui n'a aucune image issue d'une rubrique Éclairages déjà
// enrichie en base, cf. lib/knowledge-admission.js). Aucun appel réseau réel
// ici : `fetchImpl` est injecté à chaque appel pour simuler les réponses de
// l'API Wikipedia (found / not found / error / timeout / metadata absentes).

const test = require("node:test");
const assert = require("node:assert/strict");
const { searchKnowledgeImage } = require("../lib/knowledge-image-search");

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

function wikipediaPageBody(overrides = {}) {
  return {
    query: {
      pages: {
        123: {
          title: "Aldo Moro",
          fullurl: "https://fr.wikipedia.org/wiki/Aldo_Moro",
          thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro.jpg" },
          ...overrides
        }
      }
    }
  };
}

test("searchKnowledgeImage : requête vide ou nulle renvoie null sans appeler fetch", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse({}); };
  assert.equal(await searchKnowledgeImage("", { fetchImpl }), null);
  assert.equal(await searchKnowledgeImage(null, { fetchImpl }), null);
  assert.equal(await searchKnowledgeImage("   ", { fetchImpl }), null);
  assert.equal(called, false);
});

test("searchKnowledgeImage : image pertinente trouvée dès le premier appel (fr) renvoie le format {url,credit,pageUrl,source}", async () => {
  const fetchImpl = async () => jsonResponse(wikipediaPageBody());
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.deepEqual(result, {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro.jpg",
    credit: null,
    pageUrl: "https://fr.wikipedia.org/wiki/Aldo_Moro",
    source: "wikipedia",
    // Pas de motif ".../NNNpx-..." dans cette URL de test : largeur inconnue,
    // jamais une valeur inventée (cf. extractDeliveredWidthFromUrl).
    width: null
  });
});

// Couvre extractDeliveredWidthFromUrl (demande du 18/08/2026, qualité en fond
// de QCM) : la largeur réellement livrée se lit dans le nom de fichier généré
// par le thumbnailer MediaWiki, jamais dans les champs width/thumbwidth de
// l'API — ceux-ci se sont avérés mensongers (ils échouent silencieusement à
// upscaler une source trop petite mais renvoient quand même la largeur
// DEMANDÉE, jamais la largeur réellement servie).
test("searchKnowledgeImage : largeur extraite du motif '.../NNNpx-...' de l'URL, jamais du champ width/thumbnail de l'API", async () => {
  const fetchImpl = async () => jsonResponse(wikipediaPageBody({
    thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/aldo-moro.jpg/1920px-aldo-moro.jpg", width: 5000 }
  }));
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.equal(result.width, 1920);
});

test("searchKnowledgeImage : aucun résultat pertinent (pages vide) après tous les essais renvoie null", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse({ query: { pages: {} } }); };
  const result = await searchKnowledgeImage("Sujet totalement introuvable", { fetchImpl });
  assert.equal(result, null);
  // 2 rounds x 2 langues (fr, en) = 4 tentatives Wikipedia, + 1 repli Commons.
  assert.equal(calls, 5);
});

test("searchKnowledgeImage : réponse HTTP non ok (ex. 500/429) traitée comme un échec, jamais une exception", async () => {
  const fetchImpl = async () => jsonResponse({}, false);
  const result = await searchKnowledgeImage("Sujet quelconque", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : erreur réseau/timeout sur un essai n'empêche pas les essais suivants, jamais de rejet non capturé", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw new Error("network down");
    return jsonResponse(wikipediaPageBody());
  };
  const result = await searchKnowledgeImage("Aldo Moro", { fetchImpl });
  assert.ok(result);
  assert.equal(result.url, "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro.jpg");
});

test("searchKnowledgeImage : toutes les tentatives échouent (réseau) renvoie null sans jamais lever", async () => {
  const fetchImpl = async () => { throw new Error("network down"); };
  const result = await searchKnowledgeImage("Sujet quelconque", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : JSON incomplet (pas de thumbnail) traité comme absence d'image", async () => {
  const fetchImpl = async () => jsonResponse({ query: { pages: { 1: { title: "Sujet" } } } });
  const result = await searchKnowledgeImage("Sujet", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : réponse totalement malformée (pas de champ query) ne plante pas", async () => {
  const fetchImpl = async () => jsonResponse({ unrelated: true });
  const result = await searchKnowledgeImage("Sujet", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : image hors domaine upload.wikimedia.org exclue (jamais un autre hébergeur)", async () => {
  const fetchImpl = async () => jsonResponse(wikipediaPageBody({ thumbnail: { source: "https://example.com/fake.jpg" } }));
  const result = await searchKnowledgeImage("Aldo Moro", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : SVG exclu (carte/drapeau/blason, jamais une photo/illustration éditoriale)", async () => {
  const fetchImpl = async () => jsonResponse(wikipediaPageBody({ thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/map.svg" } }));
  const result = await searchKnowledgeImage("Burundi", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : titre de la page sans mot significatif commun avec la requête (résultat hors sujet) exclu", async () => {
  const fetchImpl = async () => jsonResponse(wikipediaPageBody({ title: "Cuisine japonaise" }));
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : bascule fr -> en dans le même round quand fr ne trouve rien", async () => {
  const calledLangs = [];
  const fetchImpl = async (url) => {
    const lang = url.includes("//fr.") ? "fr" : "en";
    calledLangs.push(lang);
    if (lang === "fr") return jsonResponse({ query: { pages: {} } });
    return jsonResponse(wikipediaPageBody());
  };
  const result = await searchKnowledgeImage("Aldo Moro", { fetchImpl });
  assert.ok(result);
  assert.deepEqual(calledLangs, ["fr", "en"]);
});

test("searchKnowledgeImage : pageUrl reconstruite à partir du titre quand fullurl absent", async () => {
  const fetchImpl = async () => jsonResponse(wikipediaPageBody({ fullurl: undefined, title: "Aldo Moro" }));
  const result = await searchKnowledgeImage("Aldo Moro", { fetchImpl });
  assert.equal(result.pageUrl, "https://fr.wikipedia.org/wiki/Aldo_Moro");
});

// Couvre le passage de gsrlimit=1 à plusieurs candidats (demande du
// 18/08/2026) : le premier résultat renvoyé par l'API (par pageid, jamais
// trié) est écarté (pas de thumbnail), seul le second (index=1, réellement
// le mieux classé) doit être retenu.
test("searchKnowledgeImage : plusieurs candidats — celui de plus faible .index gagne, pas l'ordre d'itération de l'objet pages", async () => {
  const fetchImpl = async () => jsonResponse({
    query: {
      pages: {
        999: { index: 2, title: "Aldo Moro sans image" }, // pas de thumbnail : écarté
        123: {
          index: 1,
          title: "Aldo Moro",
          fullurl: "https://fr.wikipedia.org/wiki/Aldo_Moro",
          thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro.jpg" }
        }
      }
    }
  });
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.ok(result);
  assert.equal(result.url, "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro.jpg");
});

function commonsFileBody(overrides = {}) {
  return {
    query: {
      pages: {
        55: {
          index: 1,
          title: "File:Aldo Moro portrait.jpg",
          imageinfo: [{
            mime: "image/jpeg",
            url: "https://upload.wikimedia.org/wikipedia/commons/aldo-moro-full.jpg",
            thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro-commons.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Aldo_Moro_portrait.jpg",
            extmetadata: { Artist: { value: '<a href="#">Mario Rossi</a>' } },
            ...overrides
          }]
        }
      }
    }
  };
}

test("searchKnowledgeImage : repli Wikimedia Commons quand Wikipedia (fr+en, 2 tours) ne trouve rien", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("commons.wikimedia.org")) return jsonResponse(commonsFileBody());
    return jsonResponse({ query: { pages: {} } });
  };
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.deepEqual(result, {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/aldo-moro-commons.jpg",
    credit: "Mario Rossi",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Aldo_Moro_portrait.jpg",
    source: "wikimedia-commons",
    width: null
  });
});

// Couvre le repli sur imageinfo.width natif (demande du 18/08/2026) : aucun
// motif ".../NNNpx-..." dans thumburl (cas réel constaté — Commons sert
// alors l'original tel quel sans le passer par le thumbnailer) — la seule
// source fiable de largeur dans ce cas précis est le champ natif `width`
// (iiprop=size), jamais thumbwidth (mensonger dans ce même cas).
test("searchKnowledgeImage : Commons — largeur native (iiprop=size) utilisée quand thumburl n'a pas de motif NNNpx-", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("commons.wikimedia.org")) return jsonResponse(commonsFileBody({ width: 130, height: 180 }));
    return jsonResponse({ query: { pages: {} } });
  };
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.equal(result.width, 130);
});

test("searchKnowledgeImage : Commons — SVG/TIFF (non affichables par <img>) exclus, jamais retenus même sans alternative", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("commons.wikimedia.org")) return jsonResponse(commonsFileBody({ mime: "image/tiff" }));
    return jsonResponse({ query: { pages: {} } });
  };
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.equal(result, null);
});

test("searchKnowledgeImage : Commons — pageUrl reconstruite à partir du titre quand descriptionurl absent", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("commons.wikimedia.org")) return jsonResponse(commonsFileBody({ descriptionurl: undefined }));
    return jsonResponse({ query: { pages: {} } });
  };
  const result = await searchKnowledgeImage("Aldo Moro Italy 1970s", { fetchImpl });
  assert.equal(result.pageUrl, "https://commons.wikimedia.org/wiki/File%3AAldo_Moro_portrait.jpg");
});
