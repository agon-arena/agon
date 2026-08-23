"use strict";
const { workerData, parentPort } = require("worker_threads");
const { createCanvas, loadImage } = require("canvas");

const HTML_ENTITY_MAP = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  laquo: "«", raquo: "»", lsquo: "'", rsquo: "'", sbquo: "'",
  ldquo: '"', rdquo: '"', bdquo: '"',
  ndash: "-", mdash: "-", hellip: "...", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", deg: "°",
  euro: "€", cent: "¢", pound: "£", yen: "¥", sect: "§", para: "¶",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å",
  aelig: "æ", ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï", eth: "ð", ntilde: "ñ",
  ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ",
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å",
  AElig: "Æ", Ccedil: "Ç", Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï", Ntilde: "Ñ",
  Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý"
};

function decodeHtmlEntities(value) {
  let output = String(value ?? "");
  for (let i = 0; i < 3; i++) {
    const decoded = output
      .replace(/&#(\d+);/g, (m, c) => { const n = Number.parseInt(c, 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; })
      .replace(/&#x([0-9a-fA-F]+);/g, (m, c) => { const n = Number.parseInt(c, 16); return Number.isFinite(n) ? String.fromCodePoint(n) : m; })
      .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, name) => Object.prototype.hasOwnProperty.call(HTML_ENTITY_MAP, name) ? HTML_ENTITY_MAP[name] : m)
      .replace(/\\\//g, "/");
    if (decoded === output) break;
    output = decoded;
  }
  return output;
}

function normalizeText(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .normalize("NFC")
    .replace(/[''′]/g, "'").replace(/[""″]/g, '"').replace(/[–—−]/g, "-")
    .replace(/…/g, "...").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

function wrapTextCentered(ctx, text, centerX, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      ctx.fillText(line, centerX - ctx.measureText(line).width / 2, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, centerX - ctx.measureText(line).width / 2, currentY);
}

async function generate() {
  const { question, option_a, option_b, isOpen, percentA, percentB, logoPath } = workerData;

  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");
  const logo = await loadImage(logoPath);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1200, 630);

  ctx.drawImage(logo, (1200 - 220) / 2, 28, 220, 220);

  ctx.fillStyle = "#111111";
  ctx.font = "bold 42px Arial";
  wrapTextCentered(ctx, normalizeText(question || "Débat sur mnoria"), 600, 250, 920, 52);

  if (isOpen) {
    ctx.fillStyle = "#4b5563";
    ctx.font = "28px Arial";
    ctx.textAlign = "center";
    wrapTextCentered(ctx, normalizeText("Découvrez les idées partagées sur mnoria - l'arène des idées"), 600, 380, 860, 38);
    ctx.fillStyle = "#6b7280";
    ctx.font = "24px Arial";
    ctx.fillText("Participez et ajoutez votre réponse", 600, 540);
    ctx.textAlign = "left";
  } else {
    const barX = 140, barY = 340, barWidth = 920, barHeight = 26;
    const fillA = Math.round((barWidth * percentA) / 100);

    // Mêmes couleurs que la jauge de la page débat : --color-a / --color-b
    // (public/style.css).
    ctx.font = "bold 32px Arial";
    ctx.fillStyle = "#516776";
    ctx.fillText(`${percentA}%`, 140, 315);
    ctx.fillStyle = "#AEC0CC";
    const textB = `${percentB}%`;
    ctx.fillText(textB, 1060 - ctx.measureText(textB).width, 315);

    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = "#516776";
    ctx.fillRect(barX, barY, fillA, barHeight);
    ctx.fillStyle = "#AEC0CC";
    ctx.fillRect(barX + fillA, barY, barWidth - fillA, barHeight);
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    ctx.fillStyle = "#111111";
    ctx.font = "bold 28px Arial";
    wrapText(ctx, normalizeText(option_a || ""), 140, 430, 380, 38);
    wrapText(ctx, normalizeText(option_b || ""), 680, 430, 380, 38);

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(600, 405);
    ctx.lineTo(600, 530);
    ctx.stroke();

    ctx.fillStyle = "#4b5563";
    ctx.font = "28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(normalizeText("Comparez les arguments sur mnoria - l'arène des idées"), 600, 590);
    ctx.textAlign = "left";
  }

  const buffer = await new Promise((resolve, reject) => {
    const chunks = [];
    const stream = canvas.createPNGStream();
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  parentPort.postMessage(buffer);
}

generate().catch(err => { throw err; });
