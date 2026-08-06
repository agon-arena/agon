// Page "Mon univers" : réutilise le moteur de bulles existant (tagTrendCloud.js), jamais
// dupliqué. Volontairement léger — pas de chargement de script.js (qui alourdirait la page
// pour un seul besoin : getKey(), reproduite ici à l'identique, cf. script.js getKey()/lsGet()).
import { renderTagTrendCloud } from "/tagTrendCloud.js";

// ---- Identité anonyme : même logique exacte que script.js, aucune nouvelle convention ----
function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, String(val)); } catch {} }

function getKey() {
  let k = lsGet("key");
  if (!k) {
    k = Math.random().toString(36);
    lsSet("key", k);
  }
  return k;
}

// ---- État local : un seul appel API, tout le reste se déduit de navPath ----
let universeData = null;
let navPath = []; // [] = galaxies ; [galaxyName] = systèmes ; [galaxyName, solarSystemId] = étoiles
let currentLevelItems = []; // objets métier dans le même ordre que les bulles actuellement affichées
const UNCLASSIFIED_KEY = "__unclassified__"; // sentinelle locale, jamais envoyée à l'API ni stockée

const cloudEl = document.getElementById("agon-universe-cloud");
const breadcrumbEl = document.getElementById("universe-breadcrumb");
const statusEl = document.getElementById("universe-status");
const backBtn = document.getElementById("universe-back-btn");

// ---- Normalisation des poids (0..1) avant de les confier au moteur existant ----
// Le moteur (computeBubblePxSize) amplifie déjà la différence via une courbe (^1.75) — cette
// fonction ne fait que fournir une plage raisonnable en entrée : jamais un poids si bas que la
// bulle devient illisible, jamais un poids si haut qu'une bulle écrase toutes les autres, et un
// palier commun si tout le monde a le même poids (ex. les étoiles, poids brut uniforme).
const UNIVERSE_MIN_WEIGHT = 0.30;
const UNIVERSE_MAX_WEIGHT = 0.95;

function normalizeUniverseWeights(items, getRawWeight) {
  const raws = items.map((item) => Math.max(0, Number(getRawWeight(item)) || 0));
  const max = raws.length ? Math.max(...raws) : 0;
  const min = raws.length ? Math.min(...raws) : 0;
  if (max === min) {
    const common = (UNIVERSE_MIN_WEIGHT + UNIVERSE_MAX_WEIGHT) / 2;
    return items.map(() => common);
  }
  return raws.map((raw) => UNIVERSE_MIN_WEIGHT + ((raw - min) / (max - min)) * (UNIVERSE_MAX_WEIGHT - UNIVERSE_MIN_WEIGHT));
}

function getGalaxyByName(name) {
  return (universeData?.galaxies || []).find((g) => g.name === name) || null;
}
function getSolarSystemById(galaxy, id) {
  return (galaxy?.solarSystems || []).find((s) => String(s.id) === String(id)) || null;
}

// ---- Construit les objets métier du niveau courant (déduit de navPath, aucun appel réseau) ----
function buildLevelItems() {
  if (!navPath.length) {
    const items = universeData.galaxies.map((g) => ({
      universeType: "galaxy",
      label: g.name,
      rawWeight: g.solarSystems.length, // taille = richesse en systèmes solaires, pas le total d'articles
      ref: g
    }));
    if (universeData.unclassified.length) {
      items.push({
        universeType: "unclassifiedGroup",
        label: "À classer",
        rawWeight: universeData.unclassified.length,
        ref: universeData.unclassified
      });
    }
    return items;
  }

  if (navPath[0] === UNCLASSIFIED_KEY) {
    return universeData.unclassified.map((article) => ({ universeType: "article", label: article.title || "Article", rawWeight: 1, ref: article }));
  }

  const galaxy = getGalaxyByName(navPath[0]);
  if (!galaxy) return [];

  if (navPath.length === 1) {
    return galaxy.solarSystems.map((s) => ({
      universeType: "solarSystem",
      label: s.name,
      rawWeight: s.articles.length,
      ref: s
    }));
  }

  const solarSystem = getSolarSystemById(galaxy, navPath[1]);
  if (!solarSystem) return [];
  return solarSystem.articles.map((article) => ({ universeType: "article", label: article.title || "Article", rawWeight: 1, ref: article }));
}

// Adapte chaque item métier au format attendu par renderTagTrendCloud. subjectId volontairement
// toujours vide : le laisser vide (jamais détourné) évite toute interaction avec le code Agôn
// existant (handleBubbleTagClick, cf. gestion du clic plus bas). dataset.bubbleIndex, déjà posé
// par le moteur pour son propre usage interne, sert ici à retrouver l'objet métier après coup.
function buildTrendsForItems(items) {
  const weights = normalizeUniverseWeights(items, (item) => item.rawWeight);
  return items.map((item, i) => ({ tag: item.label, sizeWeight: weights[i], subjectId: "" }));
}

function pluralize(n, word) { return `${n} ${word}${n > 1 ? "s" : ""}`; }

function ariaLabelFor(item) {
  if (item.universeType === "galaxy") return `Ouvrir la galaxie ${item.label}, ${pluralize(item.ref.solarSystems.length, "système solaire")}`;
  if (item.universeType === "unclassifiedGroup") return `Ouvrir le groupe À classer, ${pluralize(item.ref.length, "article")}`;
  if (item.universeType === "solarSystem") return `Ouvrir le système solaire ${item.label}, ${pluralize(item.ref.articles.length, "étoile")}`;
  if (item.universeType === "article") return `Ouvrir l'article ${item.label}`;
  return item.label;
}

function applyAriaLabels(items) {
  cloudEl.querySelectorAll(".agon-tag-bubble").forEach((bubble) => {
    const item = items[Number(bubble.dataset.bubbleIndex)];
    if (item) bubble.setAttribute("aria-label", ariaLabelFor(item));
  });
}

// ---- Rendu du niveau courant : réutilise renderTagTrendCloud tel quel (placement compact,
// anti-collision, auto-scale, labels — rien de tout ça n'est réimplémenté ici). maxBubbles =
// items.length : aucune galaxie/système/étoile tronquée silencieusement. ----
function renderLevelNow() {
  const items = buildLevelItems();
  currentLevelItems = items;
  renderBreadcrumb();
  updateBackButtonVisibility();

  if (!items.length) {
    // Cas défensif (ex. galaxie disparue entre deux navigations locales) : retombe au niveau
    // galaxies plutôt que d'afficher un écran vide sans issue.
    if (navPath.length) { navPath = []; renderLevelNow(); return; }
    showStatus("empty");
    return;
  }
  showStatus("none");

  const trends = buildTrendsForItems(items);
  try {
    renderTagTrendCloud(cloudEl, trends, () => {
      applyAriaLabels(items);
      cloudEl.classList.remove("universe-cloud--transitioning");
    }, items.length);
  } catch (error) {
    console.warn("[mon-univers] rendu du nuage interrompu :", error.message);
    cloudEl.classList.remove("universe-cloud--transitioning");
  }
}

// Zoom léger (opacity/scale, cf. style.css #agon-universe-cloud.universe-cloud--transitioning)
// avant de vider et re-rendre les bulles du niveau suivant.
function goToLevel(newPath) {
  cloudEl.classList.add("universe-cloud--transitioning");
  window.setTimeout(() => {
    navPath = newPath;
    renderLevelNow();
  }, 160);
}

function handleItemActivate(item) {
  if (item.universeType === "galaxy") { goToLevel([item.ref.name]); return; }
  if (item.universeType === "unclassifiedGroup") { goToLevel([UNCLASSIFIED_KEY]); return; }
  if (item.universeType === "solarSystem") { goToLevel([navPath[0], item.ref.id]); return; }
  if (item.universeType === "article") {
    const url = item.ref.url;
    if (url && /^https?:\/\//i.test(String(url))) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    // URL absente/invalide : aucune action, jamais d'erreur visible pour l'utilisateur.
  }
}

// Clic intercepté au niveau du conteneur (jamais sur document) + stopPropagation : empêche le
// listener global de public/script.js (.agon-tag-bubble -> handleBubbleTagClick, spécifique aux
// débats) de voir cet événement. Les bulles créées par renderTagTrendCloud sont de vrais
// <button> : Entrée et Espace déclenchent déjà nativement ce même "click", aucun code clavier
// supplémentaire nécessaire.
cloudEl.addEventListener("click", (event) => {
  const bubble = event.target.closest(".agon-tag-bubble");
  if (!bubble) return;
  event.stopPropagation();
  const item = currentLevelItems[Number(bubble.dataset.bubbleIndex)];
  if (item) handleItemActivate(item);
});

// ---- Fil d'Ariane ----
function renderBreadcrumb() {
  breadcrumbEl.innerHTML = "";
  const crumbs = [{ label: "Mon univers", path: [] }];

  if (navPath[0] === UNCLASSIFIED_KEY) {
    crumbs.push({ label: "À classer", path: [UNCLASSIFIED_KEY] });
  } else if (navPath.length >= 1) {
    crumbs.push({ label: navPath[0], path: [navPath[0]] });
    if (navPath.length >= 2) {
      const solarSystem = getSolarSystemById(getGalaxyByName(navPath[0]), navPath[1]);
      crumbs.push({ label: solarSystem ? solarSystem.name : "Système solaire", path: [navPath[0], navPath[1]] });
    }
  }

  crumbs.forEach((crumb, i) => {
    const isLast = i === crumbs.length - 1;
    if (isLast) {
      const span = document.createElement("span");
      span.className = "universe-breadcrumb__item universe-breadcrumb__item--current";
      span.textContent = crumb.label;
      span.setAttribute("aria-current", "page");
      breadcrumbEl.appendChild(span);
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "universe-breadcrumb__item";
    btn.textContent = crumb.label;
    btn.addEventListener("click", () => goToLevel(crumb.path));
    breadcrumbEl.appendChild(btn);
    const sep = document.createElement("span");
    sep.className = "universe-breadcrumb__sep";
    sep.textContent = "›";
    sep.setAttribute("aria-hidden", "true");
    breadcrumbEl.appendChild(sep);
  });
}

function updateBackButtonVisibility() {
  backBtn.classList.toggle("is-visible", navPath.length > 0);
}
backBtn.addEventListener("click", () => {
  if (!navPath.length) return;
  goToLevel(navPath.slice(0, -1));
});

// ---- États de page ----
function showStatus(kind) {
  if (kind === "none") {
    statusEl.hidden = true;
    cloudEl.hidden = false;
    return;
  }

  cloudEl.hidden = true;
  statusEl.hidden = false;
  statusEl.innerHTML = "";

  if (kind === "loading") {
    statusEl.textContent = "Chargement de ton univers…";
  } else if (kind === "empty") {
    const p = document.createElement("p");
    p.innerHTML = "Ton univers est encore vide.<br>Réponds correctement aux QCM d'actualité pour faire apparaître tes premières étoiles.";
    statusEl.appendChild(p);
  } else if (kind === "error") {
    const p = document.createElement("p");
    p.textContent = "Impossible de charger ton univers pour le moment.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "universe-status__retry";
    retry.textContent = "Réessayer";
    retry.addEventListener("click", loadUniverse);
    statusEl.append(p, retry);
  }
}

function isUniverseEmpty(data) {
  return (!data?.galaxies || !data.galaxies.length) && (!data?.unclassified || !data.unclassified.length);
}

// ---- Chargement (un seul appel, jamais relancé au changement de niveau) ----
async function loadUniverse() {
  breadcrumbEl.innerHTML = "";
  backBtn.classList.remove("is-visible");
  showStatus("loading");

  try {
    const response = await fetch(`/api/users/intellectual-universe?legacyKey=${encodeURIComponent(getKey())}`);
    if (!response.ok) throw new Error("http " + response.status);
    universeData = await response.json();
  } catch (error) {
    console.warn("[mon-univers] chargement échoué :", error.message);
    showStatus("error");
    return;
  }

  if (isUniverseEmpty(universeData)) {
    showStatus("empty");
    return;
  }

  navPath = [];
  renderLevelNow();
}

loadUniverse();
