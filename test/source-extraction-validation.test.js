"use strict";

// Couvre lib/source-extraction-validation.js (V2 de la fiabilisation des
// sources, demande du 31/08/2026, section 4) — fonction pure et
// déterministe, aucun réseau. Cas réel à l'origine de cette couche :
// travail-emploi.gouv.fr, notée 81/100 par le scoring de candidat, a en
// réalité renvoyé une page "Vérification de sécurité" au lieu du vrai
// contenu lors d'une génération réelle (rapport du 31/08/2026).

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateExtractedSourceContent, MIN_EXPLOITABLE_TEXT_CHARS } = require("../lib/source-extraction-validation");

const LEGIT_ARTICLE = "La durée légale du travail effectif des salariés à temps complet est fixée à 35 heures par semaine, en application de l'article L3121-27 du Code du travail. Ce seuil déclenche le paiement des heures supplémentaires. Il existe aussi une durée maximale hebdomadaire de 48 heures, et une moyenne de 44 heures sur 12 semaines consécutives.";

// ── Vraie page normale ───────────────────────────────────────────────────

test("une vraie page normale, au contenu substantiel et cohérent, est acceptée", () => {
  const result = validateExtractedSourceContent({
    text: LEGIT_ARTICLE,
    extractedTitle: "La durée légale du travail",
    originalTitle: "La durée légale du travail",
    subjectTokens: ["duree", "legale", "travail"]
  });
  assert.equal(result.ok, true);
  assert.equal(result.contentLength, LEGIT_ARTICLE.length);
});

// ── Cas réel : "Vérification de sécurité" (travail-emploi.gouv.fr) ────────

test("régression réelle : une page 'Vérification de sécurité' (titre) est rejetée, même avec un contenu de taille correcte", () => {
  const text = "Vérification de sécurité. Un instant, nous vérifions que vous n'êtes pas un robot avant de continuer. Veuillez patienter pendant que nous vérifions votre navigateur. Cloudflare Ray ID: 8f2a3b19. Enable JavaScript and cookies to continue, please wait a moment.";
  const result = validateExtractedSourceContent({ text, extractedTitle: "Vérification de sécurité", originalTitle: "La durée légale du travail" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anti_bot_challenge");
});

// ── Just a moment... (Cloudflare) ───────────────────────────────────────

test("'Just a moment...' (titre générique Cloudflare) est rejeté", () => {
  const result = validateExtractedSourceContent({
    text: "Just a moment... Please enable JavaScript and cookies to continue. Checking your browser before accessing the website. This process is automatic.",
    extractedTitle: "Just a moment...",
    originalTitle: "Composition de l'atmosphère de Mars"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anti_bot_challenge");
});

// ── Cloudflare challenge (sans titre générique, mais vocabulaire dense sur texte court) ──

test("page de challenge Cloudflare identifiée par densité de vocabulaire de blocage sur un contenu court, même avec un titre neutre", () => {
  const result = validateExtractedSourceContent({
    text: "Vérifiez que vous êtes humain avant de continuer sur ce site. Ray ID généré par Cloudflare pour cette requête. Un trafic inhabituel a été détecté depuis votre adresse IP, l'accès est donc refusé temporairement le temps de la vérification. Veuillez réessayer dans quelques instants une fois la vérification terminée par notre système de protection.",
    extractedTitle: "Page de contenu",
    originalTitle: "Un sujet quelconque"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anti_bot_challenge");
});

// ── Captcha ──────────────────────────────────────────────────────────────

test("page avec captcha et blocage détecté sur contenu court est rejetée", () => {
  const result = validateExtractedSourceContent({
    text: "Merci de résoudre ce captcha pour continuer votre navigation sur ce site protégé. Un trafic inhabituel a été détecté sur ce réseau et l'accès est refusé jusqu'à la fin de la vérification de sécurité en cours sur votre navigateur.",
    extractedTitle: "Vérifiez votre navigateur",
    originalTitle: "Sujet"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anti_bot_challenge");
});

// ── Access denied ────────────────────────────────────────────────────────

test("'Access Denied' est rejeté", () => {
  const result = validateExtractedSourceContent({
    text: "Access Denied. You don't have permission to access this resource on this server. Forbidden. Reference #18.4a5b2c.",
    extractedTitle: "Access Denied",
    originalTitle: "Sujet"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anti_bot_challenge");
});

// ── Page vide ────────────────────────────────────────────────────────────

test("un contenu vide ou quasi vide est rejeté (too_short)", () => {
  assert.equal(validateExtractedSourceContent({ text: "", extractedTitle: "Titre", originalTitle: "Sujet" }).ok, false);
  const result = validateExtractedSourceContent({ text: "Contenu très bref.", extractedTitle: "Titre", originalTitle: "Sujet" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_short");
});

// ── Page de login ────────────────────────────────────────────────────────

test("une page de connexion (contenu court, vocabulaire de login) est rejetée", () => {
  const result = validateExtractedSourceContent({
    text: "Veuillez vous connecter pour accéder à ce contenu réservé aux membres inscrits sur ce site. Identifiant. Mot de passe. Créer un compte gratuitement si vous n'en possédez pas encore un pour continuer votre lecture.",
    extractedTitle: "Connexion",
    originalTitle: "Sujet"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "login_page");
});

// ── Contenu très court mais légitime ────────────────────────────────────

test("un contenu concis mais substantiel (au-dessus du plancher) reste accepté — le plancher ne pénalise pas la concision, seulement le quasi-vide", () => {
  const text = "La capitale de la France est Paris, qui compte environ 2,1 millions d'habitants intra-muros et constitue le centre politique, économique et culturel du pays depuis plusieurs siècles, accueillant les principales institutions de l'État.";
  assert.ok(text.length >= MIN_EXPLOITABLE_TEXT_CHARS, "le texte de test doit dépasser le plancher pour être pertinent");
  const result = validateExtractedSourceContent({ text, extractedTitle: "Paris", originalTitle: "Paris" });
  assert.equal(result.ok, true);
});

test("un contenu réellement trop court (quelques mots) est rejeté même sans aucun vocabulaire de blocage", () => {
  const result = validateExtractedSourceContent({ text: "Paris est la capitale.", extractedTitle: "Paris", originalTitle: "Paris" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_short");
});

// ── Contenu long mais hors sujet ────────────────────────────────────────

test("un contenu long mais hors-sujet n'est PAS rejeté par ce validateur (la pertinence est déjà filtrée en amont par le scoring/l'IA de sélection, pas ici) — évite un faux positif sur un long article légitime qui ne répète pas les mots exacts du sujet", () => {
  const longOffTopicText = "Les techniques de jardinage biologique reposent sur plusieurs principes fondamentaux. ".repeat(10);
  const result = validateExtractedSourceContent({
    text: longOffTopicText,
    extractedTitle: "Le jardinage biologique",
    originalTitle: "La durée légale du travail",
    subjectTokens: ["duree", "legale", "travail"]
  });
  assert.equal(result.ok, true, "ce validateur ne fait pas de contrôle de pertinence sur un contenu long, par conception");
});

test("un contenu COURT et hors-sujet (aucun recoupement avec le sujet ni le titre original) est rejeté (off_topic)", () => {
  const result = validateExtractedSourceContent({
    text: "Nos meilleures recettes de cuisine pour un dîner rapide en famille ce soir, simples et savoureuses, avec des ingrédients de saison faciles à trouver en supermarché toute l'année sans effort particulier.",
    extractedTitle: "Recettes rapides",
    originalTitle: "La durée légale du travail",
    subjectTokens: ["duree", "legale", "travail"]
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "off_topic");
});

test("sans subjectTokens fourni, le contrôle hors-sujet est simplement ignoré (jamais une erreur)", () => {
  const result = validateExtractedSourceContent({ text: "Nos meilleures recettes de cuisine pour ce soir.", extractedTitle: "Recettes", originalTitle: "Sujet" });
  // Ni too_short (le texte dépasse le plancher une fois complété), ni off_topic (pas de subjectTokens) : accepté.
  assert.equal(result.reason === "off_topic", false);
});

// ── Page d'erreur serveur ────────────────────────────────────────────────

test("une page d'erreur 404/serveur est rejetée", () => {
  const result = validateExtractedSourceContent({
    text: "404 Page introuvable. La page que vous recherchez n'existe pas ou a été déplacée vers une autre adresse. Retournez à l'accueil du site pour poursuivre votre navigation ou utilisez la barre de recherche.",
    extractedTitle: "Page introuvable",
    originalTitle: "Sujet"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "error_page");
});

// ── Éviter les faux positifs ─────────────────────────────────────────────

test("faux positif évité : un long article légitime qui mentionne 'captcha' une seule fois en passant n'est pas rejeté", () => {
  const text = "Les systèmes anti-robots comme le captcha sont de plus en plus utilisés sur le web pour lutter contre les abus automatisés. " + LEGIT_ARTICLE + " " + LEGIT_ARTICLE;
  const result = validateExtractedSourceContent({ text, extractedTitle: "Article sur la sécurité web", originalTitle: "Sujet" });
  assert.equal(result.ok, true);
});

test("faux positif évité : un article qui mentionne 'se connecter' une fois dans un contenu long n'est pas confondu avec une page de login", () => {
  const text = (LEGIT_ARTICLE + " Pour aller plus loin, vous pouvez vous connecter à votre espace personnel sur le site du ministère.").repeat(3);
  const result = validateExtractedSourceContent({ text, extractedTitle: "La durée légale du travail", originalTitle: "Sujet" });
  assert.equal(result.ok, true);
});
