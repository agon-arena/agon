"use strict";

// Validation du CONTENU réellement extrait d'une page source (V2 de la
// fiabilisation des sources, demande du 31/08/2026, section 4) — distinct du
// scoring du CANDIDAT (lib/source-scoring.js, qui juge le résultat de
// recherche AVANT récupération). Une source excellemment notée peut très
// bien renvoyer, une fois récupérée, une page de vérification anti-bot
// (Cloudflare, "Just a moment...", captcha...), une page de connexion, une
// page d'erreur ou un contenu hors-sujet — cas réel observé le 31/08/2026 :
// travail-emploi.gouv.fr, pourtant notée 81/100, a renvoyé une page
// "Vérification de sécurité" au lieu du vrai contenu.
//
// Fichier volontairement PUR (aucun accès réseau/DOM ici) : reçoit le texte
// déjà extrait par lib/url-knowledge.js (extractReadableContent) et décide
// s'il est réellement exploitable comme grounding. Jamais une seule liste de
// chaînes exactes comme unique critère (demande explicite) : combine
// plusieurs signaux simples et déterministes (titre générique de challenge,
// densité de vocabulaire de blocage sur un texte court, page de connexion,
// page d'erreur, contenu hors-sujet quand le texte est court).

const { overlapFraction } = require("./source-scoring");

// Sous ce nombre de caractères, un contenu est structurellement inexploitable
// comme grounding — même si extractReadableContent l'a laissé passer (son
// propre plancher, URL_KNOWLEDGE_MIN_TEXT_CHARS, est plus permissif : pensé
// pour l'import d'URL par un humain qui relit le résultat, pas pour un
// contenu injecté tel quel dans un prompt).
const MIN_EXPLOITABLE_TEXT_CHARS = 200;

// Titre générique de page de vérification/challenge — signal fort à lui
// seul (un vrai article n'a structurellement jamais ce genre de titre),
// couvre les principales plateformes anti-bot (Cloudflare, Akamai...) et
// leurs équivalents français.
const CHALLENGE_TITLE_PATTERN = /\b(just a moment|attention required|access denied|forbidden|security check|checking your browser|please wait|verifying you are human|are you a robot|un instant|un moment|vérification|verification en cours|patientez)\b/i;

// Vocabulaire de blocage/challenge — jamais le SEUL critère (une longue page
// légitime peut mentionner "captcha" en passant) : combiné à un contenu
// court (cf. isAntiBotChallenge) pour éviter les faux positifs sur un
// article réel qui traite, par exemple, du sujet des CAPTCHA eux-mêmes.
const CHALLENGE_VOCABULARY_PATTERN = /\b(captcha|cloudflare|ddos.?protection|checking your browser|enable javascript|activer javascript|verify you are human|verifiez que vous etes humain|ray id|challenge.?platform|unusual traffic|trafic inhabituel|robot detecte|automated (queries|requests)|access denied|acces refuse|forbidden|403 forbidden|blocked by|bloque par)\b/gi;

// Vocabulaire de page de connexion — combiné à un contenu court : une page
// d'aide qui MENTIONNE la connexion dans un long article ne doit pas être
// confondue avec une vraie page de login sans contenu exploitable.
const LOGIN_PAGE_PATTERN = /\b(se connecter|connexion requise|mot de passe|identifiant|sign in|log in|nom d'utilisateur|username|password required|creer un compte|create an account)\b/i;

// Vocabulaire de page d'erreur serveur/introuvable.
const ERROR_PAGE_PATTERN = /\b(404|erreur 500|internal server error|page introuvable|page non trouvee|not found|service (temporairement )?indisponible|service unavailable|une erreur est survenue|something went wrong)\b/i;

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

// Retourne { ok: true, contentLength } si le contenu est exploitable, ou
// { ok: false, reason, detail, contentLength } sinon. `reason` est un code
// stable destiné aux logs/tests (jamais affiché à l'utilisateur) :
// "anti_bot_challenge" | "too_short" | "login_page" | "error_page" | "off_topic".
//
// `subjectTokens` (optionnel, cf. lib/source-scoring.js buildTopicContext)
// permet le dernier contrôle (hors-sujet manifeste sur un contenu court) —
// omis, l'appelant perd seulement ce dernier contrôle, jamais une erreur.
// `originalTitle` (le titre du résultat Brave AVANT extraction) est accepté
// pour l'observabilité de l'appelant (cf. server.js) mais n'entre dans
// AUCUN calcul ici — il correspond par construction au sujet recherché, s'en
// servir dans le recoupement le rendrait toujours artificiellement positif.
function validateExtractedSourceContent({ text, extractedTitle, originalTitle, subjectTokens } = {}) {
  const cleanText = String(text || "").trim();
  const contentLength = cleanText.length;
  const titleLower = String(extractedTitle || "").trim().toLowerCase();

  // 1. Titre générique de challenge — signal fort à lui seul, jamais besoin
  // de le combiner (un vrai article n'a jamais ce type de titre).
  if (titleLower && CHALLENGE_TITLE_PATTERN.test(titleLower)) {
    return { ok: false, reason: "anti_bot_challenge", detail: `titre générique de vérification ("${extractedTitle}")`, contentLength };
  }

  // 2. Contenu quasi vide — structurellement inexploitable pour du grounding,
  // quel qu'en soit le motif réel (extraction partielle, page vide...).
  if (contentLength < MIN_EXPLOITABLE_TEXT_CHARS) {
    return { ok: false, reason: "too_short", detail: `${contentLength} caractère(s), sous le plancher de ${MIN_EXPLOITABLE_TEXT_CHARS}`, contentLength };
  }

  // 3. Densité de vocabulaire de blocage sur un texte COURT (jamais sur un
  // texte long : une mention isolée de "captcha" dans un long article
  // légitime ne doit jamais déclencher un rejet).
  const challengeMatches = countMatches(cleanText, CHALLENGE_VOCABULARY_PATTERN);
  if (contentLength < 1500 && challengeMatches >= 2) {
    return { ok: false, reason: "anti_bot_challenge", detail: `${challengeMatches} marqueur(s) de blocage sur un contenu court (${contentLength} car.)`, contentLength };
  }

  // 4. Page de connexion — même logique : uniquement sur un contenu court,
  // jamais sur un long article qui mentionnerait la connexion en passant.
  if (contentLength < 800 && LOGIN_PAGE_PATTERN.test(cleanText)) {
    return { ok: false, reason: "login_page", detail: "vocabulaire de page de connexion sur un contenu court", contentLength };
  }

  // 5. Page d'erreur serveur/introuvable.
  if (contentLength < 600 && ERROR_PAGE_PATTERN.test(cleanText)) {
    return { ok: false, reason: "error_page", detail: "vocabulaire de page d'erreur sur un contenu court", contentLength };
  }

  // 6. Hors-sujet manifeste sur un contenu court : aucun recoupement avec le
  // sujet demandé dans le texte extrait lui-même — seulement quand le
  // contenu reste court (un long article peut légitimement ne pas répéter
  // les mots exacts du sujet dans ses premières phrases). `originalTitle`
  // n'entre JAMAIS dans ce recoupement : il correspond par construction au
  // sujet recherché, l'y inclure garantirait artificiellement un
  // recouvrement non nul et rendrait ce contrôle inopérant.
  if (contentLength < 500 && Array.isArray(subjectTokens) && subjectTokens.length) {
    const overlap = overlapFraction(subjectTokens, cleanText);
    if (overlap === 0) {
      return { ok: false, reason: "off_topic", detail: "aucun recoupement lexical avec le sujet sur un contenu court", contentLength };
    }
  }

  return { ok: true, contentLength };
}

module.exports = {
  MIN_EXPLOITABLE_TEXT_CHARS,
  CHALLENGE_TITLE_PATTERN,
  CHALLENGE_VOCABULARY_PATTERN,
  LOGIN_PAGE_PATTERN,
  ERROR_PAGE_PATTERN,
  validateExtractedSourceContent
};
