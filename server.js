require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createCanvas, loadImage } = require("canvas");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3001;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("❌ ADMIN_PASSWORD manquant !");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant !");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const MAX_VOTES_PER_DEBATE = 5;
const adminTokens = new Set();

app.use(express.json());
app.use(express.static("public"));
app.use("/migration-export", express.static("/var/data"));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeMetaContent(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildAbsoluteUrl(req, pathname) {
  return `${req.protocol}://${req.get("host")}${pathname}`;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
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
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      const lineWidth = ctx.measureText(line).width;
      ctx.fillText(line, centerX - lineWidth / 2, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  const lineWidth = ctx.measureText(line).width;
  ctx.fillText(line, centerX - lineWidth / 2, currentY);
}

function getDebateShareDescription(debate, percentA, percentB) {
  return `${percentA}% — ${debate.option_a} | ${percentB}% — ${debate.option_b} | Comparez les arguments sur agôn - l'arène des idées`;
}

function computeDebatePercents(args) {
  let votesA = 0;
  let votesB = 0;

  for (const arg of args || []) {
    const voteCount = Number(arg.votes || 0);
    if (arg.side === "A") votesA += voteCount;
    if (arg.side === "B") votesB += voteCount;
  }

  const totalVotes = votesA + votesB;

  if (totalVotes > 0) {
    const percentA = Math.round((votesA / totalVotes) * 100);
    return {
      votesA,
      votesB,
      percentA,
      percentB: 100 - percentA
    };
  }

  return {
    votesA,
    votesB,
    percentA: 50,
    percentB: 50
  };
}

function sendServerError(res, message = "Erreur serveur.") {
  return res.status(500).json({ error: message });
}

function isAdmin(req) {
  const token = req.headers["x-admin-token"];
  return !!token && adminTokens.has(token);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Accès admin refusé." });
  }
  next();
}

function nowIso() {
  return new Date().toISOString();
}

async function createNotification({
  user_key,
  type,
  debate_id = null,
  argument_id = null,
  comment_id = null,
  message
}) {
  if (!user_key || !message || !type) return;

  await supabase.from("notifications").insert({
    user_key,
    type,
    debate_id,
    argument_id,
    comment_id,
    message,
    is_read: 0,
    created_at: nowIso()
  });
}

async function getDebateById(id) {
  const { data, error } = await supabase
    .from("debates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getArgumentById(id) {
  const { data, error } = await supabase
    .from("arguments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getCommentById(id) {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getArgumentsByDebateId(debateId) {
  const { data, error } = await supabase
    .from("arguments")
    .select("*")
    .eq("debate_id", debateId)
    .order("id", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getCommentsByArgumentIds(argumentIds) {
  if (!argumentIds.length) return [];

  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .in("argument_id", argumentIds)
    .order("id", { ascending: true });

  if (error) throw error;

  const comments = data || [];
  if (!comments.length) return [];

  const commentIds = comments.map((c) => c.id);
  const { data: likesRows, error: likesErr } = await supabase
    .from("comment_likes")
    .select("comment_id,value")
    .in("comment_id", commentIds);

  if (likesErr) throw likesErr;

  const likesMap = new Map();
  for (const row of likesRows || []) {
    const current = Number(likesMap.get(row.comment_id) || 0);
    likesMap.set(row.comment_id, current + Number(row.value || 0));
  }

  return comments.map((c) => ({
    ...c,
    likes: Number(likesMap.get(c.id) || 0)
  }));
}

async function getCommentLikesTotal(commentId) {
  const { data, error } = await supabase
    .from("comment_likes")
    .select("value")
    .eq("comment_id", commentId);

  if (error) throw error;

  return (data || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
}

async function getUserVotesUsedInDebate(debateId, voterKey) {
  try {
    const { data, error } = await supabase
      .from("votes")
      .select("vote_count, arguments!inner(debate_id)")
      .eq("voter_key", voterKey)
      .eq("arguments.debate_id", debateId);

    if (!error) {
      return (data || []).reduce((sum, row) => sum + Number(row.vote_count || 0), 0);
    }
  } catch (error) {
    // fallback silencieux vers l'ancienne logique
  }

  const { data: args, error: argsErr } = await supabase
    .from("arguments")
    .select("id")
    .eq("debate_id", debateId);

  if (argsErr) throw argsErr;

  const argumentIds = (args || []).map((a) => a.id);
  if (!argumentIds.length) return 0;

  const { data: votes, error: votesErr } = await supabase
    .from("votes")
    .select("vote_count")
    .eq("voter_key", voterKey)
    .in("argument_id", argumentIds);

  if (votesErr) throw votesErr;

  return (votes || []).reduce((sum, row) => sum + Number(row.vote_count || 0), 0);
}

async function getVoteRow(argumentId, voterKey) {
  const { data, error } = await supabase
    .from("votes")
    .select("*")
    .eq("argument_id", argumentId)
    .eq("voter_key", voterKey)
    .maybeSingle();

  if (error) throw error;
  return data;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views/index.html"));
});

app.get("/create", (req, res) => {
  res.sendFile(path.join(__dirname, "views/create.html"));
});

app.get("/notifications", (req, res) => {
  res.sendFile(path.join(__dirname, "views/notifications.html"));
});

app.get("/debate", (req, res) => {
  res.sendFile(path.join(__dirname, "views/debate.html"));
});

app.get("/admin-reports", (req, res) => {
  res.sendFile(path.join(__dirname, "views/admin-reports.html"));
});

/* =========================
   OPEN GRAPH SHARE ROUTES
========================= */

app.get("/debate/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const debate = await getDebateById(id);

    if (!debate) {
      return res.status(404).send("Débat introuvable.");
    }

    const args = await getArgumentsByDebateId(id);
    const { percentA, percentB } = computeDebatePercents(args);

    const shareTitle = debate.question || "Débat sur Agôn";
    const shareDescription = getDebateShareDescription(debate, percentA, percentB);

    const canonicalUrl = buildAbsoluteUrl(req, `/debate/${id}`);
    const redirectUrl = `/debate?id=${id}`;
    const ogImageUrl = buildAbsoluteUrl(req, `/share-image/${id}`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(shareTitle)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <meta property="og:site_name" content="Agôn" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeMetaContent(shareTitle)}" />
  <meta property="og:description" content="${escapeMetaContent(shareDescription)}" />
  <meta property="og:url" content="${escapeMetaContent(canonicalUrl)}" />
  <meta property="og:image" content="${escapeMetaContent(ogImageUrl)}" />
  <meta property="og:image:alt" content="${escapeMetaContent(`AGÔN — ${shareTitle}`)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeMetaContent(shareTitle)}" />
  <meta name="twitter:description" content="${escapeMetaContent(shareDescription)}" />
  <meta name="twitter:image" content="${escapeMetaContent(ogImageUrl)}" />

  <meta http-equiv="refresh" content="0; url=${escapeMetaContent(redirectUrl)}" />
  <link rel="canonical" href="${escapeMetaContent(canonicalUrl)}" />
</head>
<body>
  <script>
    window.location.replace(${JSON.stringify(redirectUrl)});
  </script>

  <noscript>
    <p>Redirection vers le débat…</p>
    <p><a href="${escapeHtml(redirectUrl)}">Cliquez ici si rien ne se passe</a></p>
  </noscript>
</body>
</html>`);
  } catch (error) {
    console.error(error);
    return res.status(500).send("Erreur serveur.");
  }
});

app.get("/share-image/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const debate = await getDebateById(id);

    if (!debate) {
      return res.status(404).send("Débat introuvable.");
    }

    const args = await getArgumentsByDebateId(id);
    const { percentA, percentB } = computeDebatePercents(args);

    const canvas = createCanvas(1200, 630);
    const ctx = canvas.getContext("2d");
    const logoPath = path.join(__dirname, "public/logo2.jpeg");
    const logo = await loadImage(logoPath);

    const cardWidth = 1200;
    const cardHeight = 630;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cardWidth, cardHeight);

    const logoWidth = 220;
    const logoHeight = 220;
    const logoX = (cardWidth - logoWidth) / 2;
    const logoY = 28;

    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);

    ctx.fillStyle = "#111111";
    ctx.font = "bold 42px Arial";
    wrapTextCentered(ctx, debate.question || "Débat sur Agôn", cardWidth / 2, 250, 920, 52);

    const barX = 140;
    const barY = 340;
    const barWidth = 920;
    const barHeight = 26;

    const fillA = Math.round((barWidth * percentA) / 100);
    const fillB = barWidth - fillA;

    ctx.font = "bold 32px Arial";

    ctx.fillStyle = "#0f766e";
    ctx.fillText(`${percentA}%`, 140, 315);

    ctx.fillStyle = "#b91c1c";
    const textB = `${percentB}%`;
    const textBWidth = ctx.measureText(textB).width;
    ctx.fillText(textB, 1060 - textBWidth, 315);

    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    ctx.fillStyle = "#0f766e";
    ctx.fillRect(barX, barY, fillA, barHeight);

    ctx.fillStyle = "#b91c1c";
    ctx.fillRect(barX + fillA, barY, fillB, barHeight);

    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    ctx.fillStyle = "#111111";
    ctx.font = "bold 28px Arial";

    wrapText(ctx, debate.option_a || "", 140, 430, 380, 38);
    wrapText(ctx, debate.option_b || "", 680, 430, 380, 38);

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(600, 405);
    ctx.lineTo(600, 530);
    ctx.stroke();

    ctx.fillStyle = "#4b5563";
    ctx.font = "28px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Comparez les arguments sur agôn - l'arène des idées", cardWidth / 2, 590);
    ctx.textAlign = "left";

    res.setHeader("Content-Type", "image/png");
    canvas.createPNGStream().pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur génération image");
  }
});

/* =========================
   TRACK VISITS
========================= */

app.post("/api/track-visit", async (req, res) => {
  try {
    const { visitorKey, page } = req.body || {};

    if (!visitorKey || !page) {
      return res.status(400).json({ error: "visitorKey et page requis" });
    }

    const { data, error } = await supabase
      .from("page_visits")
      .insert({
        visitor_key: String(visitorKey),
        page: String(page),
        created_at: nowIso()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur enregistrement visite.");
    }

    res.json({ success: true, id: data.id });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur serveur.");
  }
});

/* =========================
   ADMIN
========================= */

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }

  const token = crypto.randomBytes(24).toString("hex");
  adminTokens.add(token);

  res.json({ success: true, token });
});

app.post("/api/admin/logout", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token) {
    adminTokens.delete(token);
  }
  res.json({ success: true });
});

app.get("/api/admin/visits/today", requireAdmin, async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("page_visits")
      .select("visitor_key, created_at")
      .gte("created_at", start.toISOString());

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture visites.");
    }

    const rows = data || [];
    const uniqueVisitors = new Set(rows.map((r) => r.visitor_key));

    res.json({
      total_visits_today: rows.length,
      unique_visitors_today: uniqueVisitors.size
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture visites.");
  }
});

/* =========================
   REPORTS
========================= */

app.post("/api/reports", async (req, res) => {
  try {
    const { target_type, target_id, reason, voterKey } = req.body || {};

    const allowedTypes = ["debate", "argument", "comment"];
    const allowedReasons = ["inapproprie", "doublon", "plusieurs_arguments"];

    if (!allowedTypes.includes(target_type)) {
      return res.status(400).json({ error: "Type de signalement invalide." });
    }

    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({ error: "Motif de signalement invalide." });
    }

    if (!voterKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const { data: existingReport, error: checkErr } = await supabase
      .from("reports")
      .select("id")
      .eq("target_type", target_type)
      .eq("target_id", target_id)
      .eq("voter_key", voterKey)
      .maybeSingle();

    if (checkErr) {
      console.error(checkErr);
      return sendServerError(res, "Erreur vérification signalement.");
    }

    if (existingReport) {
      return res.status(400).json({ error: "already_reported" });
    }

    const { data, error } = await supabase
      .from("reports")
      .insert({
        target_type,
        target_id,
        reason,
        voter_key: voterKey,
        created_at: nowIso()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur création signalement." });
    }

    res.json({ success: true, id: data.id });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur création signalement.");
  }
});

app.get("/api/admin/reports", requireAdmin, async (req, res) => {
  try {
    const { data: reports, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture signalements.");
    }

    const reportRows = reports || [];

    const debateIds = [...new Set(reportRows.filter((r) => r.target_type === "debate").map((r) => r.target_id))];
    const argumentIds = [...new Set(reportRows.filter((r) => r.target_type === "argument").map((r) => r.target_id))];
    const commentIds = [...new Set(reportRows.filter((r) => r.target_type === "comment").map((r) => r.target_id))];

    const debatesMap = new Map();
    const argumentsMap = new Map();
    const commentsMap = new Map();

    if (debateIds.length) {
      const { data: debatesData } = await supabase
        .from("debates")
        .select("id,question")
        .in("id", debateIds);

      for (const row of debatesData || []) debatesMap.set(row.id, row);
    }

    if (argumentIds.length) {
      const { data: argumentsData } = await supabase
        .from("arguments")
        .select("id,title,body,debate_id")
        .in("id", argumentIds);

      for (const row of argumentsData || []) argumentsMap.set(row.id, row);
    }

    if (commentIds.length) {
      const { data: commentsData } = await supabase
        .from("comments")
        .select("id,content,argument_id")
        .in("id", commentIds);

      for (const row of commentsData || []) commentsMap.set(row.id, row);

      const commentArgumentIds = [...new Set((commentsData || []).map((c) => c.argument_id).filter(Boolean))];
      const missingArgumentIds = commentArgumentIds.filter((id) => !argumentsMap.has(id));

      if (missingArgumentIds.length) {
        const { data: extraArguments } = await supabase
          .from("arguments")
          .select("id,title,body,debate_id")
          .in("id", missingArgumentIds);

        for (const row of extraArguments || []) argumentsMap.set(row.id, row);
      }
    }

    const grouped = new Map();

    for (const r of reportRows) {
      const key = `${r.target_type}__${r.target_id}__${r.reason}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          target_type: r.target_type,
          target_id: r.target_id,
          reason: r.reason,
          report_count: 0,
          last_report_at: r.created_at,
          debate_question: null,
          argument_title: null,
          argument_body: null,
          argument_debate_id: null,
          comment_content: null,
          comment_argument_id: null,
          comment_debate_id: null
        });
      }

      const item = grouped.get(key);
      item.report_count += 1;

      if (!item.last_report_at || new Date(r.created_at) > new Date(item.last_report_at)) {
        item.last_report_at = r.created_at;
      }

      if (r.target_type === "debate") {
        const debate = debatesMap.get(r.target_id);
        item.debate_question = debate?.question || null;
      }

      if (r.target_type === "argument") {
        const argument = argumentsMap.get(r.target_id);
        item.argument_title = argument?.title || null;
        item.argument_body = argument?.body || null;
        item.argument_debate_id = argument?.debate_id || null;
      }

      if (r.target_type === "comment") {
        const comment = commentsMap.get(r.target_id);
        const argument = comment ? argumentsMap.get(comment.argument_id) : null;
        item.comment_content = comment?.content || null;
        item.comment_argument_id = comment?.argument_id || null;
        item.comment_debate_id = argument?.debate_id || null;
      }
    }

    const rows = [...grouped.values()].sort((a, b) => {
      if (b.report_count !== a.report_count) return b.report_count - a.report_count;
      return new Date(b.last_report_at) - new Date(a.last_report_at);
    });

    res.json(rows);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture signalements.");
  }
});

app.delete("/api/admin/reports/by-target", requireAdmin, async (req, res) => {
  try {
    const { target_type, target_id } = req.body || {};

    if (!target_type || !target_id) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("target_type", target_type)
      .eq("target_id", target_id);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur suppression signalement.");
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression signalement.");
  }
});

app.delete("/api/admin/reports/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const { error } = await supabase
      .from("reports")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur suppression signalement.");
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur suppression signalement.");
  }
});

/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications", async (req, res) => {
  try {
    const userKey = req.query.userKey;

    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_key", userKey)
      .order("is_read", { ascending: true })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture notifications.");
    }

    res.json(data || []);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture notifications.");
  }
});

app.post("/api/notifications/read-all", async (req, res) => {
  try {
    const { userKey } = req.body || {};

    if (!userKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: 1 })
      .eq("user_key", userKey);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur mise à jour notifications.");
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur mise à jour notifications.");
  }
});

app.post("/api/notifications/read-one", async (req, res) => {
  try {
    const { userKey, notificationId } = req.body || {};

    if (!userKey || !notificationId) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: 1 })
      .eq("id", notificationId)
      .eq("user_key", userKey);

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur mise à jour notification.");
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur mise à jour notification.");
  }
});

/* =========================
   ADMIN EDIT
========================= */

app.put("/api/admin/debate/:id", requireAdmin, async (req, res) => {
  try {
    const { question, option_a, option_b } = req.body || {};

    const { error } = await supabase
      .from("debates")
      .update({ question, option_a, option_b })
      .eq("id", req.params.id);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur modification débat." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur modification débat." });
  }
});

app.put("/api/admin/argument/:id", requireAdmin, async (req, res) => {
  try {
    const { title, body } = req.body || {};

    const { error } = await supabase
      .from("arguments")
      .update({ title, body })
      .eq("id", req.params.id);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur modification argument." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur modification argument." });
  }
});

/* =========================
   DEBATES
========================= */

app.get("/api/debates", async (req, res) => {
  try {
    const { data: debates, error } = await supabase
      .from("debates")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur lecture débats.");
    }

    const debateRows = debates || [];
    if (!debateRows.length) {
      return res.json([]);
    }

    const debateIds = debateRows.map((d) => d.id);

    const { data: args, error: argsErr } = await supabase
      .from("arguments")
      .select("id,debate_id,side,votes,created_at")
      .in("debate_id", debateIds);

    if (argsErr) {
      console.error(argsErr);
      return sendServerError(res, "Erreur lecture débats.");
    }

    const argsByDebate = new Map();
    for (const arg of args || []) {
      if (!argsByDebate.has(arg.debate_id)) argsByDebate.set(arg.debate_id, []);
      argsByDebate.get(arg.debate_id).push(arg);
    }

    const rows = debateRows.map((d) => {
      const debateArgs = argsByDebate.get(d.id) || [];
      const argument_count = debateArgs.length;
      const last_argument_at = debateArgs.length
        ? debateArgs
            .map((a) => a.created_at)
            .filter(Boolean)
            .sort()
            .slice(-1)[0]
        : null;

      const votes_a = debateArgs
        .filter((a) => a.side === "A")
        .reduce((sum, a) => sum + Number(a.votes || 0), 0);

      const votes_b = debateArgs
        .filter((a) => a.side === "B")
        .reduce((sum, a) => sum + Number(a.votes || 0), 0);

      const { percentA, percentB } = computeDebatePercents([
        { side: "A", votes: votes_a },
        { side: "B", votes: votes_b }
      ]);

      return {
        ...d,
        argument_count,
        last_argument_at,
        votes_a,
        votes_b,
        percent_a: percentA,
        percent_b: percentB
      };
    });

    rows.sort((a, b) => {
      if (b.argument_count !== a.argument_count) return b.argument_count - a.argument_count;
      const aDate = a.last_argument_at || a.created_at || "";
      const bDate = b.last_argument_at || b.created_at || "";
      if (bDate !== aDate) return new Date(bDate) - new Date(aDate);
      return Number(b.id) - Number(a.id);
    });

    res.json(rows);
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture débats.");
  }
});

app.post("/api/debates", async (req, res) => {
  try {
    const { question, category, source_url, type, option_a, option_b, creatorKey } = req.body || {};

    const { data, error } = await supabase
      .from("debates")
      .insert({
        question,
        category,
        source_url: source_url || "",
        type: type || "debate",
        option_a,
        option_b,
        creator_key: creatorKey || null,
        created_at: nowIso()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur création débat." });
    }

    res.json({ id: data.id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur création débat." });
  }
});

app.get("/api/debates/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const debate = await getDebateById(id);
    if (!debate) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    const args = await getArgumentsByDebateId(id);
    const optionA = args.filter((a) => a.side === "A");
    const optionB = args.filter((a) => a.side === "B");

    const argumentIds = args.map((a) => a.id);
    if (!argumentIds.length) {
      return res.json({
        debate,
        optionA,
        optionB,
        commentsByArgument: {}
      });
    }

    const comments = await getCommentsByArgumentIds(argumentIds);
    const commentsByArgument = {};

    for (const comment of comments) {
      if (!commentsByArgument[comment.argument_id]) {
        commentsByArgument[comment.argument_id] = [];
      }
      commentsByArgument[comment.argument_id].push(comment);
    }

    res.json({
      debate,
      optionA,
      optionB,
      commentsByArgument
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture arguments.");
  }
});

app.delete("/api/debates/:id", requireAdmin, async (req, res) => {
  try {
    const debateId = req.params.id;

    const { data: argumentsRows, error: argsErr } = await supabase
      .from("arguments")
      .select("id")
      .eq("debate_id", debateId);

    if (argsErr) {
      console.error(argsErr);
      return res.status(500).json({ error: "Erreur récupération arguments." });
    }

    const argumentIds = (argumentsRows || []).map((row) => row.id);

    if (argumentIds.length) {
      const { data: commentRows, error: commentsErr } = await supabase
        .from("comments")
        .select("id")
        .in("argument_id", argumentIds);

      if (commentsErr) {
        console.error(commentsErr);
        return res.status(500).json({ error: "Erreur récupération commentaires." });
      }

      const commentIds = (commentRows || []).map((row) => row.id);

      if (commentIds.length) {
        await supabase.from("comment_likes").delete().in("comment_id", commentIds);
        await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", commentIds);
        await supabase.from("notifications").delete().in("comment_id", commentIds);
      }

      await supabase.from("votes").delete().in("argument_id", argumentIds);
      await supabase.from("comments").delete().in("argument_id", argumentIds);
      await supabase.from("reports").delete().eq("target_type", "argument").in("target_id", argumentIds);
      await supabase.from("notifications").delete().in("argument_id", argumentIds);
      await supabase.from("arguments").delete().eq("debate_id", debateId);
    }

    await supabase.from("reports").delete().eq("target_type", "debate").eq("target_id", debateId);
    await supabase.from("notifications").delete().eq("debate_id", debateId);
    const { error: deleteErr } = await supabase.from("debates").delete().eq("id", debateId);

    if (deleteErr) {
      console.error(deleteErr);
      return res.status(500).json({ error: "Erreur suppression débat." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression débat." });
  }
});

/* =========================
   ARGUMENTS
========================= */

app.post("/api/arguments", async (req, res) => {
  try {
    const { debate_id, side, title, body, authorKey } = req.body || {};

    const { data, error } = await supabase
      .from("arguments")
      .insert({
        debate_id,
        side,
        title,
        body,
        author_key: authorKey || null,
        votes: 0,
        created_at: nowIso()
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return sendServerError(res, "Erreur création argument.");
    }

    const debateRow = await getDebateById(debate_id);

    if (
      debateRow &&
      debateRow.creator_key &&
      debateRow.creator_key !== authorKey
    ) {
      await createNotification({
        user_key: debateRow.creator_key,
        type: "argument_in_my_debate",
        debate_id,
        argument_id: data.id,
        message: "Un nouvel argument a été posté dans votre débat."
      });
    }

    res.json({ success: true, id: data.id });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur création argument.");
  }
});

app.post("/api/arguments/:id/vote", async (req, res) => {
  try {
    const id = req.params.id;
    const { voterKey } = req.body || {};

    const argument = await getArgumentById(id);
    if (!argument) {
      return res.status(404).json({ error: "Argument introuvable." });
    }

    const totalVotesUsed = await getUserVotesUsedInDebate(argument.debate_id, voterKey);

    if (totalVotesUsed >= MAX_VOTES_PER_DEBATE) {
      return res.status(400).json({ error: "limit" });
    }

    const existingVote = await getVoteRow(id, voterKey);

    if (existingVote) {
      const { error: updateVoteErr } = await supabase
        .from("votes")
        .update({ vote_count: Number(existingVote.vote_count || 0) + 1 })
        .eq("id", existingVote.id);

      if (updateVoteErr) {
        console.error(updateVoteErr);
        return res.status(500).json({ error: "Erreur mise à jour vote." });
      }
    } else {
      const { error: insertErr } = await supabase
        .from("votes")
        .insert({
          argument_id: id,
          voter_key: voterKey,
          vote_count: 1
        });

      if (insertErr) {
        console.error(insertErr);
        return res.status(500).json({ error: "Erreur création vote." });
      }
    }

    const newVotes = Number(argument.votes || 0) + 1;
    const latestVoteAt = nowIso();
    let effectiveLastVotedAt = latestVoteAt;

    let { error: updateArgErr } = await supabase
      .from("arguments")
      .update({
        votes: newVotes,
        last_voted_at: latestVoteAt
      })
      .eq("id", id);

    if (updateArgErr && /last_voted_at/i.test(String(updateArgErr.message || ""))) {
      effectiveLastVotedAt = argument.last_voted_at || null;
      const fallbackUpdate = await supabase
        .from("arguments")
        .update({ votes: newVotes })
        .eq("id", id);
      updateArgErr = fallbackUpdate.error;
    }

    if (updateArgErr) {
      console.error(updateArgErr);
      return res.status(500).json({ error: "Erreur mise à jour argument." });
    }

    const myVotesOnArgument = existingVote
      ? Number(existingVote.vote_count || 0) + 1
      : 1;

    res.json({
      votes: newVotes,
      myVotesOnArgument,
      remainingVotes: MAX_VOTES_PER_DEBATE - (totalVotesUsed + 1),
      lastVotedAt: effectiveLastVotedAt
    });

    if (argument.author_key && argument.author_key !== voterKey) {
      createNotification({
        user_key: argument.author_key,
        type: "vote_on_argument",
        debate_id: argument.debate_id,
        argument_id: id,
        message: "Votre argument a reçu un vote."
      }).catch((notificationError) => {
        console.error(notificationError);
      });
    }
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture vote.");
  }
});

app.post("/api/arguments/:id/unvote", async (req, res) => {
  try {
    const id = req.params.id;
    const { voterKey } = req.body || {};

    const voteRow = await getVoteRow(id, voterKey);
    if (!voteRow) {
      return res.status(400).json({ error: "no_vote" });
    }

    const argument = await getArgumentById(id);
    if (!argument) {
      return res.status(404).json({ error: "Argument introuvable." });
    }

    if (Number(voteRow.vote_count) > 1) {
      const { error: updateVoteErr } = await supabase
        .from("votes")
        .update({ vote_count: Number(voteRow.vote_count) - 1 })
        .eq("id", voteRow.id);

      if (updateVoteErr) {
        console.error(updateVoteErr);
        return res.status(500).json({ error: "Erreur mise à jour vote." });
      }
    } else {
      const { error: deleteVoteErr } = await supabase
        .from("votes")
        .delete()
        .eq("id", voteRow.id);

      if (deleteVoteErr) {
        console.error(deleteVoteErr);
        return res.status(500).json({ error: "Erreur suppression vote." });
      }
    }

    const newVotes = Math.max(0, Number(argument.votes || 0) - 1);
    const { error: updateArgErr } = await supabase
      .from("arguments")
      .update({ votes: newVotes })
      .eq("id", id);

    if (updateArgErr) {
      console.error(updateArgErr);
      return res.status(500).json({ error: "Erreur mise à jour argument." });
    }

    const myVotesOnArgument = Math.max(0, Number(voteRow.vote_count || 0) - 1);

    res.json({
      votes: newVotes,
      myVotesOnArgument,
      remainingVotes: null,
      lastVotedAt: argument.last_voted_at || null
    });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture vote.");
  }
});

app.delete("/api/arguments/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const requesterKey = String(req.query.authorKey || "").trim();
    const adminMode = isAdmin(req);

    const argumentRow = await getArgumentById(id);
    if (!argumentRow) {
      return res.status(404).json({ error: "Idée introuvable." });
    }

    const isOwner =
      requesterKey &&
      argumentRow.author_key &&
      String(argumentRow.author_key) === requesterKey;

    if (!adminMode && !isOwner) {
      return res.status(403).json({ error: "Suppression non autorisée." });
    }

    const { data: commentRows, error: commentsErr } = await supabase
      .from("comments")
      .select("id")
      .eq("argument_id", id);

    if (commentsErr) {
      console.error(commentsErr);
      return res.status(500).json({ error: "Erreur récupération commentaires argument." });
    }

    const commentIds = (commentRows || []).map((row) => row.id);

    await supabase.from("votes").delete().eq("argument_id", id);

    if (commentIds.length) {
      await supabase.from("comment_likes").delete().in("comment_id", commentIds);
      await supabase.from("reports").delete().eq("target_type", "comment").in("target_id", commentIds);
      await supabase.from("notifications").delete().in("comment_id", commentIds);
    }

    await supabase.from("comments").delete().eq("argument_id", id);
    await supabase.from("reports").delete().eq("target_type", "argument").eq("target_id", id);
    await supabase.from("notifications").delete().eq("argument_id", id);

    const { error: deleteErr } = await supabase
      .from("arguments")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error(deleteErr);
      return res.status(500).json({ error: "Erreur suppression argument." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression argument." });
  }
});

/* =========================
   COMMENTS
========================= */

app.post("/api/comments", async (req, res) => {
  try {
    const {
      argument_id,
      content,
      authorKey,
      stance,
      reply_to_comment_id,
      improvement_title,
      improvement_body
    } = req.body || {};

    const safeStance = ["favorable", "defavorable", "amelioration"].includes(stance) ? stance : null;
    const safeImprovementTitle = safeStance === "amelioration" ? String(improvement_title || "").trim() : "";
    const safeImprovementBody = safeStance === "amelioration" ? String(improvement_body || "").trim() : "";

    if (safeStance === "amelioration") {
      if (!safeImprovementTitle) {
        return res.status(400).json({ error: "Titre d'amélioration requis." });
      }

      if (!safeImprovementBody) {
        return res.status(400).json({ error: "Texte d'amélioration requis." });
      }
    }

    const { data: inserted, error } = await supabase
      .from("comments")
      .insert({
        argument_id,
        content,
        stance: safeStance,
        author_key: authorKey || null,
        reply_to_comment_id: reply_to_comment_id || null,
        improvement_title: safeImprovementTitle,
        improvement_body: safeImprovementBody,
        created_at: nowIso()
      })
      .select("*")
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur ajout commentaire." });
    }

    const newCommentId = inserted.id;
    const row = {
      ...inserted,
      likes: 0
    };

    const argumentRow = await getArgumentById(argument_id);
    const preview = String(content || "").trim();
    const shortPreview = preview.length > 120 ? preview.slice(0, 120) + "…" : preview;

    if (
      argumentRow &&
      argumentRow.author_key &&
      argumentRow.author_key !== (authorKey || null)
    ) {
      await supabase.from("notifications").insert({
        user_key: argumentRow.author_key,
        type: "comment_on_argument",
        debate_id: argumentRow.debate_id || null,
        argument_id,
        comment_id: newCommentId,
        message: shortPreview
          ? `Nouveau commentaire : ${shortPreview}`
          : "Nouveau commentaire sur votre argument",
        is_read: 0,
        created_at: nowIso()
      });
    }

    if (reply_to_comment_id) {
      const parentCommentRow = await getCommentById(reply_to_comment_id);

      if (
        parentCommentRow &&
        parentCommentRow.author_key &&
        parentCommentRow.author_key !== (authorKey || null)
      ) {
        await supabase.from("notifications").insert({
          user_key: parentCommentRow.author_key,
          type: "reply_to_comment",
          debate_id: argumentRow?.debate_id || null,
          argument_id,
          comment_id: newCommentId,
          message: shortPreview
            ? `Réponse à votre commentaire : ${shortPreview}`
            : "Quelqu’un a répondu à votre commentaire",
          is_read: 0,
          created_at: nowIso()
        });
      }
    }

    return res.json(row);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur ajout commentaire." });
  }
});

app.post("/api/comments/:id/vote", async (req, res) => {
  try {
    const id = req.params.id;
    const { voterKey, value } = req.body || {};

    if (!voterKey) {
      return res.status(400).json({ error: "Clé utilisateur manquante." });
    }

    if (![1, 0, -1].includes(Number(value))) {
      return res.status(400).json({ error: "Vote invalide." });
    }

    const voteValue = Number(value);

    const existingCommentVoteRes = await supabase
      .from("comment_likes")
      .select("*")
      .eq("comment_id", id)
      .eq("voter_key", voterKey)
      .maybeSingle();

    if (existingCommentVoteRes.error) {
      console.error(existingCommentVoteRes.error);
      return sendServerError(res, "Erreur lecture vote commentaire.");
    }

    const existingVote = existingCommentVoteRes.data;

    if (!existingVote) {
      if (voteValue !== 0) {
        const { error: insertErr } = await supabase
          .from("comment_likes")
          .insert({
            comment_id: id,
            voter_key: voterKey,
            value: voteValue
          });

        if (insertErr) {
          console.error(insertErr);
          return res.status(500).json({ error: "Erreur enregistrement vote commentaire." });
        }
      }
    } else if (voteValue === 0) {
      const { error: deleteErr } = await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", id)
        .eq("voter_key", voterKey);

      if (deleteErr) {
        console.error(deleteErr);
        return res.status(500).json({ error: "Erreur suppression vote commentaire." });
      }
    } else {
      const { error: updateErr } = await supabase
        .from("comment_likes")
        .update({ value: voteValue })
        .eq("comment_id", id)
        .eq("voter_key", voterKey);

      if (updateErr) {
        console.error(updateErr);
        return res.status(500).json({ error: "Erreur mise à jour vote commentaire." });
      }
    }

    const commentRow = await getCommentById(id);
    if (!commentRow) {
      return res.status(500).json({ error: "Erreur lecture score commentaire." });
    }

    const argumentRow = await getArgumentById(commentRow.argument_id);
    const likes = await getCommentLikesTotal(id);
    const argumentVotes = Number(argumentRow?.votes || 0);

    if (commentRow.author_key && commentRow.author_key !== voterKey) {
      if (voteValue === 1) {
        await createNotification({
          user_key: commentRow.author_key,
          type: "like_on_comment",
          debate_id: argumentRow?.debate_id,
          argument_id: commentRow.argument_id,
          comment_id: id,
          message: "Votre commentaire a reçu un pouce vers le haut."
        });
      }

      if (voteValue === -1) {
        await createNotification({
          user_key: commentRow.author_key,
          type: "dislike_on_comment",
          debate_id: argumentRow?.debate_id,
          argument_id: commentRow.argument_id,
          comment_id: id,
          message: "Votre commentaire a reçu un pouce vers le bas."
        });
      }
    }

    const isImprovement = commentRow.stance === "amelioration";
    const improvementTitle = String(commentRow.improvement_title || "").trim();
    const improvementBody = String(commentRow.improvement_body || "").trim();

    if (isImprovement && improvementTitle && improvementBody && likes > argumentVotes) {
      const { error: replaceErr } = await supabase
        .from("arguments")
        .update({
          title: improvementTitle,
          body: improvementBody
        })
        .eq("id", commentRow.argument_id);

      if (replaceErr) {
        console.error(replaceErr);
        return res.status(500).json({ error: "Erreur remplacement idée." });
      }

      if (commentRow.author_key) {
        await createNotification({
          user_key: commentRow.author_key,
          type: "replacement_accepted",
          debate_id: argumentRow?.debate_id,
          argument_id: commentRow.argument_id,
          comment_id: id,
          message: "Bravo, ta proposition de remplacement a convaincu, elle prend désormais la place de l’idée initiale !"
        });
      }

      await supabase.from("comment_likes").delete().eq("comment_id", id);
      await supabase.from("reports").delete().eq("target_type", "comment").eq("target_id", id);
      await supabase.from("notifications").delete().eq("comment_id", id).neq("type", "replacement_accepted");
      await supabase.from("comments").delete().eq("id", id);

      return res.json({
        likes,
        replaced: true,
        argumentId: commentRow.argument_id
      });
    }

    res.json({ likes, replaced: false });
  } catch (error) {
    console.error(error);
    return sendServerError(res, "Erreur lecture vote commentaire.");
  }
});

app.delete("/api/comments/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const requesterKey = String(req.query.authorKey || "").trim();
    const adminMode = isAdmin(req);

    const commentRow = await getCommentById(id);
    if (!commentRow) {
      return res.status(404).json({ error: "Commentaire introuvable." });
    }

    const isOwner =
      requesterKey &&
      commentRow.author_key &&
      String(commentRow.author_key) === requesterKey;

    if (!adminMode && !isOwner) {
      return res.status(403).json({ error: "Suppression non autorisée." });
    }

    await supabase.from("comment_likes").delete().eq("comment_id", id);
    await supabase.from("reports").delete().eq("target_type", "comment").eq("target_id", id);
    await supabase.from("notifications").delete().eq("comment_id", id);

    const { error: deleteErr } = await supabase
      .from("comments")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error(deleteErr);
      return res.status(500).json({ error: "Erreur suppression commentaire." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur suppression commentaire." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});