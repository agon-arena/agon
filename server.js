require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const crypto = require("crypto");
const { createCanvas, loadImage } = require("canvas");
const app = express();
const PORT = process.env.PORT || 3001;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("❌ ADMIN_PASSWORD manquant !");
  process.exit(1);
}
const MAX_VOTES_PER_DEBATE = 5;

const sqlitePath = process.env.SQLITE_PATH || "./database.db";

console.log("📀 DATABASE PATH =", sqlitePath);

const db = new sqlite3.Database(sqlitePath);
const adminTokens = new Set();

app.use(express.json());
app.use(express.static("public"));

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
function normalizeSimilarityText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function computeIdeaSimilarity(textA, textB) {
  const wordsA = normalizeSimilarityText(textA);
  const wordsB = normalizeSimilarityText(textB);

  if (!wordsA.length || !wordsB.length) {
    return 0;
  }

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  const intersectionCount = [...setA].filter((word) => setB.has(word)).length;
  const unionCount = new Set([...setA, ...setB]).size;

  if (!unionCount) {
    return 0;
  }

  return intersectionCount / unionCount;
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

/* =========================
   OPEN GRAPH SHARE ROUTE
========================= */

app.get("/debate/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM debates WHERE id=?", [id], (err, debate) => {
    if (err) {
      return res.status(500).send("Erreur serveur.");
    }

    if (!debate) {
      return res.status(404).send("Débat introuvable.");
    }

    db.all(
      "SELECT side, votes FROM arguments WHERE debate_id=?",
      [id],
      (argsErr, args) => {
        if (argsErr) {
          return res.status(500).send("Erreur serveur.");
        }

        const { percentA, percentB } = computeDebatePercents(args);

        const shareTitle = debate.question || "Débat sur Agôn";
        const shareDescription = getDebateShareDescription(
          debate,
          percentA,
          percentB
        );

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
      }
    );
  });
});
app.get("/share-image/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM debates WHERE id=?", [id], (err, debate) => {
    if (err || !debate) {
      return res.status(404).send("Débat introuvable.");
    }

    db.all(
      "SELECT side, votes FROM arguments WHERE debate_id=?",
      [id],
      (argsErr, args) => {
        if (argsErr) {
          return res.status(500).send("Erreur serveur.");
        }

        const { percentA, percentB } = computeDebatePercents(args);

        const canvas = createCanvas(1200, 630);
        const ctx = canvas.getContext("2d");
       const logoPath = path.join(__dirname, "public/logo2.jpeg");
loadImage(logoPath).then((logo) => {
      
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
})
          .catch(() => {
            res.status(500).send("Erreur génération image");
          });
      }
    );
  });
});
app.get("/debate", (req, res) => {
  res.sendFile(path.join(__dirname, "views/debate.html"));
});
app.get("/admin-reports", (req, res) => {
  res.sendFile(path.join(__dirname, "views/admin-reports.html"));
});
db.serialize(() => {
 db.run(`
CREATE TABLE IF NOT EXISTS debates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  category TEXT NOT NULL,
  source_url TEXT,
  type TEXT DEFAULT 'debate',
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  creator_key TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)
`);
db.all(`PRAGMA table_info(debates)`, [], (err, rows) => {
  if (err) {
    console.error("Erreur PRAGMA debates:", err.message);
    return;
  }

  const hasType = rows.some((row) => row.name === "type");

  if (!hasType) {
    db.run(`ALTER TABLE debates ADD COLUMN type TEXT DEFAULT 'debate'`, [], (alterErr) => {
      if (alterErr) {
        console.error("Erreur ajout colonne type:", alterErr.message);
        return;
      }

      db.run(`
        UPDATE debates
        SET type = 'debate'
        WHERE type IS NULL OR type = ''
      `);
    });
  } else {
    db.run(`
      UPDATE debates
      SET type = 'debate'
      WHERE type IS NULL OR type = ''
    `);
  }
});
db.all(`PRAGMA table_info(debates)`, [], (err, rows) => {
  if (err) return;

  const hasSourceUrl = rows.some((row) => row.name === "source_url");

  if (!hasSourceUrl) {
    db.run(`ALTER TABLE debates ADD COLUMN source_url TEXT`);
  }
});
db.run(`
  CREATE TABLE IF NOT EXISTS arguments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debate_id INTEGER NOT NULL,
    side TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    votes INTEGER DEFAULT 0,
    author_key TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS votes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    argument_id INTEGER,
    voter_key TEXT,
    vote_count INTEGER DEFAULT 1,
    UNIQUE(argument_id, voter_key)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS comments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    argument_id INTEGER,
    content TEXT,
    stance TEXT,
    author_key TEXT,
    reply_to_comment_id INTEGER DEFAULT NULL,
    improvement_title TEXT DEFAULT '',
    improvement_body TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS comment_likes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER,
      voter_key TEXT,
      UNIQUE(comment_id, voter_key)
    )
  `);
db.all(`PRAGMA table_info(comment_likes)`, [], (err, rows) => {
  if (err) return;

  const hasValue = rows.some((row) => row.name === "value");

  if (!hasValue) {
    db.run(`ALTER TABLE comment_likes ADD COLUMN value INTEGER DEFAULT 1`, [], (alterErr) => {
      if (alterErr) return;

      db.run(`
        UPDATE comment_likes
        SET value = 1
        WHERE value IS NULL
      `);
    });
  } else {
    db.run(`
      UPDATE comment_likes
      SET value = 1
      WHERE value IS NULL
    `);
  }
});
db.run(`
  CREATE TABLE IF NOT EXISTS reports(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT,
    target_id INTEGER,
    reason TEXT,
    voter_key TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`); 
db.run(`
  CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    type TEXT NOT NULL,
    debate_id INTEGER,
    argument_id INTEGER,
    comment_id INTEGER,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.prepare(`
  CREATE TABLE IF NOT EXISTS page_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_key TEXT NOT NULL,
    page TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();
db.all(`PRAGMA table_info(votes)`, [], (err, rows) => {
  if (err) return;

  const hasVoteCount = rows.some((row) => row.name === "vote_count");

  if (!hasVoteCount) {
    db.run(`ALTER TABLE votes ADD COLUMN vote_count INTEGER DEFAULT 1`, [], (alterErr) => {
      if (alterErr) return;

      db.run(`
        UPDATE votes
        SET vote_count = 1
        WHERE vote_count IS NULL OR vote_count = 0
      `);
    });
  } else {
    db.run(`
      UPDATE votes
      SET vote_count = 1
      WHERE vote_count IS NULL OR vote_count = 0
    `);
  }
});
  db.all(`PRAGMA table_info(debates)`, [], (err, rows) => {
    if (err) return;

    const hasCreatedAt = rows.some((row) => row.name === "created_at");

    if (!hasCreatedAt) {
      db.run(
        `ALTER TABLE debates ADD COLUMN created_at TEXT`,
        [],
        (alterErr) => {
          if (alterErr) return;

          db.run(
            `UPDATE debates
             SET created_at = datetime('now','localtime')
             WHERE created_at IS NULL OR created_at = ''`
          );
        }
      );
    } else {
      db.run(
        `UPDATE debates
         SET created_at = datetime('now','localtime')
         WHERE created_at IS NULL OR created_at = ''`
      );
    }
  });
db.all(`PRAGMA table_info(reports)`, [], (err, rows) => {
  if (err) return;

  const hasVoterKey = rows.some((row) => row.name === "voter_key");

  if (!hasVoterKey) {
    db.run(`ALTER TABLE reports ADD COLUMN voter_key TEXT`);
  }
});
db.all(`PRAGMA table_info(debates)`, [], (err, rows) => {
  if (err) return;

  const hasCreatorKey = rows.some((row) => row.name === "creator_key");

  if (!hasCreatorKey) {
    db.run(`ALTER TABLE debates ADD COLUMN creator_key TEXT`);
  }
});

db.all(`PRAGMA table_info(arguments)`, [], (err, rows) => {
  if (err) return;

  const hasAuthorKey = rows.some((row) => row.name === "author_key");

  if (!hasAuthorKey) {
    db.run(`ALTER TABLE arguments ADD COLUMN author_key TEXT`);
  }
});

db.all(`PRAGMA table_info(comments)`, [], (err, rows) => {
  if (err) return;

  const hasAuthorKey = rows.some((row) => row.name === "author_key");

  if (!hasAuthorKey) {
    db.run(`ALTER TABLE comments ADD COLUMN author_key TEXT`);
  }
});

db.all(`PRAGMA table_info(comments)`, [], (err, rows) => {
  if (err) return;

  const hasStance = rows.some((row) => row.name === "stance");

  if (!hasStance) {
    db.run(`ALTER TABLE comments ADD COLUMN stance TEXT`);
  }
});
db.all(`PRAGMA table_info(comments)`, [], (err, rows) => {
  if (err) return;

  const hasReplyToCommentId = rows.some(
    (row) => row.name === "reply_to_comment_id"
  );

  if (!hasReplyToCommentId) {
    db.run(`ALTER TABLE comments ADD COLUMN reply_to_comment_id INTEGER DEFAULT NULL`);
  }
});
db.all(`PRAGMA table_info(comments)`, [], (err, rows) => {
  if (err) return;

  const hasImprovementTitle = rows.some((row) => row.name === "improvement_title");
  const hasImprovementBody = rows.some((row) => row.name === "improvement_body");

  if (!hasImprovementTitle) {
    db.run(`ALTER TABLE comments ADD COLUMN improvement_title TEXT DEFAULT ''`);
  }

  if (!hasImprovementBody) {
    db.run(`ALTER TABLE comments ADD COLUMN improvement_body TEXT DEFAULT ''`);
  }
});

  db.all(`PRAGMA table_info(arguments)`, [], (err, rows) => {
    if (err) return;

    const hasCreatedAt = rows.some((row) => row.name === "created_at");

    if (!hasCreatedAt) {
      db.run(
        `ALTER TABLE arguments ADD COLUMN created_at TEXT`,
        [],
        (alterErr) => {
          if (alterErr) return;

          db.run(
            `UPDATE arguments
             SET created_at = datetime('now','localtime')
             WHERE created_at IS NULL OR created_at = ''`
          );
        }
      );
    } else {
      db.run(
        `UPDATE arguments
         SET created_at = datetime('now','localtime')
         WHERE created_at IS NULL OR created_at = ''`
      );
    }
  });

  db.all(`PRAGMA table_info(comments)`, [], (err, rows) => {
    if (err) return;

    const hasCreatedAt = rows.some((row) => row.name === "created_at");

    if (!hasCreatedAt) {
      db.run(
        `ALTER TABLE comments ADD COLUMN created_at TEXT`,
        [],
        (alterErr) => {
          if (alterErr) return;

          db.run(
            `UPDATE comments
             SET created_at = datetime('now','localtime')
             WHERE created_at IS NULL OR created_at = ''`
          );
        }
      );
    } else {
      db.run(
        `UPDATE comments
         SET created_at = datetime('now','localtime')
         WHERE created_at IS NULL OR created_at = ''`
      );
    }
  });
});


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
function createNotification({ user_key, type, debate_id = null, argument_id = null, comment_id = null, message }) {
  if (!user_key || !message || !type) return;

  db.run(
    `
    INSERT INTO notifications(user_key, type, debate_id, argument_id, comment_id, message, is_read, created_at)
    VALUES(?,?,?,?,?,?,0,datetime('now','localtime'))
    `,
    [user_key, type, debate_id, argument_id, comment_id, message]
  );
}
app.post("/api/track-visit", (req, res) => {
  try {
    const { visitorKey, page } = req.body || {};

    if (!visitorKey || !page) {
      return res.status(400).json({ error: "visitorKey et page requis" });
    }

    db.run(
      `
      INSERT INTO page_visits(visitor_key, page, created_at)
      VALUES(?, ?, datetime('now','localtime'))
      `,
      [String(visitorKey), String(page)],
      function (err) {
    if (err) {
  return sendServerError(res, "Erreur enregistrement visite.");
}

        res.json({ success: true, id: this.lastID });
      }
    );
 } catch (error) {
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
app.get("/api/admin/visits/today", requireAdmin, (req, res) => {
  db.get(
    `
    SELECT COUNT(*) AS total_visits_today
    FROM page_visits
    WHERE date(created_at) = date('now','localtime')
    `,
    [],
    (errTotal, totalRow) => {
      if (errTotal) {
return sendServerError(res, "Erreur lecture visites.");      
}

      db.get(
        `
        SELECT COUNT(DISTINCT visitor_key) AS unique_visitors_today
        FROM page_visits
        WHERE date(created_at) = date('now','localtime')
        `,
        [],
        (errUnique, uniqueRow) => {
          if (errUnique) {
return sendServerError(res, "Erreur lecture visiteurs uniques.");          
}

          res.json({
            total_visits_today: Number(totalRow?.total_visits_today || 0),
            unique_visitors_today: Number(uniqueRow?.unique_visitors_today || 0)
          });
        }
      );
    }
  );
});
/* =========================
   REPORTS
========================= */

// créer un signalement
app.post("/api/reports", (req, res) => {
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

  db.get(
    `
    SELECT id
    FROM reports
    WHERE target_type = ?
      AND target_id = ?
      AND voter_key = ?
    `,
    [target_type, target_id, voterKey],
    (checkErr, existingReport) => {
      if (checkErr) {
return sendServerError(res, "Erreur vérification signalement.");      
}

      if (existingReport) {
        return res.status(400).json({ error: "already_reported" });
      }

      db.run(
        `
        INSERT INTO reports(target_type, target_id, reason, voter_key, created_at)
        VALUES(?,?,?,?,datetime('now','localtime'))
        `,
        [target_type, target_id, reason, voterKey],
        function (err) {
          if (err) {
            return res.status(500).json({ error: "Erreur création signalement." });
          }

          res.json({ success: true, id: this.lastID });
        }
      );
    }
  );
});

// voir les signalements (admin)
app.get("/api/admin/reports", requireAdmin, (req, res) => {
  db.all(
    `
    SELECT
  r.target_type,
  r.target_id,
  r.reason,
  COUNT(*) AS report_count,
  MAX(r.created_at) AS last_report_at,

      d.question AS debate_question,

      a.title AS argument_title,
      a.body AS argument_body,
      a.debate_id AS argument_debate_id,

      c.content AS comment_content,
      c.argument_id AS comment_argument_id,
      a2.debate_id AS comment_debate_id

    FROM reports r

    LEFT JOIN debates d
      ON r.target_type = 'debate' AND d.id = r.target_id

    LEFT JOIN arguments a
      ON r.target_type = 'argument' AND a.id = r.target_id

    LEFT JOIN comments c
      ON r.target_type = 'comment' AND c.id = r.target_id

    LEFT JOIN arguments a2
      ON r.target_type = 'comment' AND a2.id = c.argument_id

   GROUP BY r.target_type, r.target_id, r.reason

    ORDER BY report_count DESC, last_report_at DESC
    `,
    [],
    (err, rows) => {
      if (err) {
return sendServerError(res, "Erreur lecture signalements.");      
}

      res.json(rows);
    }
  );
});
// supprimer un signalement (admin)
app.delete("/api/admin/reports/by-target", requireAdmin, (req, res) => {

  const { target_type, target_id } = req.body || {};

  if (!target_type || !target_id) {
    return res.status(400).json({ error: "Paramètres manquants." });
  }

  db.run(
    `
    DELETE FROM reports
    WHERE target_type = ?
    AND target_id = ?
    `,
    [target_type, target_id],
    function (err) {

      if (err) {
return sendServerError(res, "Erreur suppression signalement.");      
}

      res.json({ success: true });
    }
  );

});

app.delete("/api/admin/reports/:id", requireAdmin, (req, res) => {
  const id = req.params.id;

  db.run(
    `DELETE FROM reports WHERE id = ?`,
    [id],
    function (err) {
      if (err) {
return sendServerError(res, "Erreur suppression signalement.");      
}

      res.json({ success: true });
    }
  );
});/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications", (req, res) => {
  const userKey = req.query.userKey;

  if (!userKey) {
    return res.status(400).json({ error: "Clé utilisateur manquante." });
  }

  db.all(
    `
    SELECT *
    FROM notifications
    WHERE user_key = ?
    ORDER BY is_read ASC, created_at DESC, id DESC
    `,
    [userKey],
    (err, rows) => {
      if (err) {
return sendServerError(res, "Erreur lecture notifications.");      
}

      res.json(rows);
    }
  );
});

app.post("/api/notifications/read-all", (req, res) => {
  const { userKey } = req.body || {};

  if (!userKey) {
    return res.status(400).json({ error: "Clé utilisateur manquante." });
  }

  db.run(
    `
    UPDATE notifications
    SET is_read = 1
    WHERE user_key = ?
    `,
    [userKey],
    function (err) {
      if (err) {
return sendServerError(res, "Erreur mise à jour notifications.");      
}

      res.json({ success: true });
    }
  );
});
app.post("/api/notifications/read-one", (req, res) => {
  const { userKey, notificationId } = req.body || {};

  if (!userKey || !notificationId) {
    return res.status(400).json({ error: "Paramètres manquants." });
  }

  db.run(
    `
    UPDATE notifications
    SET is_read = 1
    WHERE id = ?
    AND user_key = ?
    `,
    [notificationId, userKey],
    function (err) {
      if (err) {
return sendServerError(res, "Erreur mise à jour notification.");      
}

      res.json({ success: true });
    }
  );
});
/* =========================
   DEBATES
========================= */

/* =========================
   ADMIN EDIT
========================= */

// modifier un débat
app.put("/api/admin/debate/:id", requireAdmin, (req, res) => {
  const { question, option_a, option_b } = req.body || {};

  db.run(
    `
    UPDATE debates
    SET question = ?, option_a = ?, option_b = ?
    WHERE id = ?
    `,
    [question, option_a, option_b, req.params.id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Erreur modification débat." });
      }

      res.json({ success: true });
    }
  );
});

// modifier un argument
app.put("/api/admin/argument/:id", requireAdmin, (req, res) => {
  const { title, body } = req.body || {};

  db.run(
    `
    UPDATE arguments
    SET title = ?, body = ?
    WHERE id = ?
    `,
    [title, body, req.params.id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Erreur modification argument." });
      }

      res.json({ success: true });
    }
  );
});

app.get("/api/debates", (req, res) => {
  db.all(
    `
    SELECT 
      d.*,
      (SELECT COUNT(*) FROM arguments a WHERE a.debate_id = d.id) as argument_count,
      (SELECT MAX(a.created_at) FROM arguments a WHERE a.debate_id = d.id) as last_argument_at,
      (SELECT COALESCE(SUM(a.votes), 0) FROM arguments a WHERE a.debate_id = d.id AND a.side = 'A') as votes_a,
      (SELECT COALESCE(SUM(a.votes), 0) FROM arguments a WHERE a.debate_id = d.id AND a.side = 'B') as votes_b
    FROM debates d
    ORDER BY
      argument_count DESC,
      CASE WHEN last_argument_at IS NULL THEN d.created_at ELSE last_argument_at END DESC,
      d.created_at DESC,
      d.id DESC
    `,
    [],
    (err, rows) => {
      if (err) {
return sendServerError(res, "Erreur lecture débats.");      
}

      for (const row of rows) {
        const { percentA, percentB } = computeDebatePercents([
          { side: "A", votes: row.votes_a || 0 },
          { side: "B", votes: row.votes_b || 0 }
        ]);

        row.percent_a = percentA;
        row.percent_b = percentB;
      }

      res.json(rows);
    }
  );
});

app.post("/api/debates", (req, res) => {
  const { question, category, source_url, type, option_a, option_b, creatorKey } = req.body;

  db.run(
    `
    INSERT INTO debates(question, category, source_url, type, option_a, option_b, creator_key, created_at)
    VALUES(?,?,?,?,?,?,?,datetime('now','localtime'))
    `,
    [question, category, source_url || "", type || "debate", option_a, option_b, creatorKey || null],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Erreur création débat." });
      }

      res.json({ id: this.lastID });
    }
  );
});

app.get("/api/debates/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM debates WHERE id=?", [id], (err, debate) => {
    if (err || !debate) {
      return res.status(404).json({ error: "Débat introuvable." });
    }

    db.all("SELECT * FROM arguments WHERE debate_id=?", [id], (err2, args) => {
      if (err2) {
return sendServerError(res, "Erreur lecture arguments.");      
}

      const optionA = args.filter((a) => a.side === "A");
      const optionB = args.filter((a) => a.side === "B");

      const argumentIds = args.map((a) => a.id);

      if (argumentIds.length === 0) {
        return res.json({
          debate,
          optionA,
          optionB,
          commentsByArgument: {}
        });
      }

      const placeholders = argumentIds.map(() => "?").join(",");

      db.all(
        `
        SELECT
          c.*,
          (
  SELECT COALESCE(SUM(cl.value), 0)
  FROM comment_likes cl
  WHERE cl.comment_id = c.id
) as likes
           
        FROM comments c
        WHERE c.argument_id IN (${placeholders})
        ORDER BY c.id ASC
        `,
        argumentIds,
        (err3, comments) => {
          if (err3) {
return sendServerError(res, "Erreur lecture commentaires.");          
}

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
        }
      );
    });
  });
});

app.delete("/api/debates/:id", requireAdmin, (req, res) => {
  const debateId = req.params.id;

  db.all("SELECT id FROM arguments WHERE debate_id=?", [debateId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Erreur récupération arguments." });
    }

    const argumentIds = rows.map((row) => row.id);

    const finishDeleteDebate = () => {
      db.run("DELETE FROM debates WHERE id=?", [debateId], function (err4) {
        if (err4) {
          return res.status(500).json({ error: "Erreur suppression débat." });
        }
        res.json({ success: true });
      });
    };

    if (!argumentIds.length) {
      return finishDeleteDebate();
    }

    const placeholders = argumentIds.map(() => "?").join(",");

    db.all(
      `SELECT id FROM comments WHERE argument_id IN (${placeholders})`,
      argumentIds,
      (errComments, commentRows) => {
        if (errComments) {
          return res.status(500).json({ error: "Erreur récupération commentaires." });
        }

        const commentIds = commentRows.map((row) => row.id);

        const deleteCommentLikesThenContinue = (next) => {
          if (!commentIds.length) return next();

          const commentPlaceholders = commentIds.map(() => "?").join(",");
          db.run(
            `DELETE FROM comment_likes WHERE comment_id IN (${commentPlaceholders})`,
            commentIds,
            (errLikeDelete) => {
              if (errLikeDelete) {
                return res.status(500).json({ error: "Erreur suppression likes commentaires." });
              }
              next();
            }
          );
        };

        db.run(
          `DELETE FROM votes WHERE argument_id IN (${placeholders})`,
          argumentIds,
          (err2) => {
            if (err2) {
              return res.status(500).json({ error: "Erreur suppression votes." });
            }

            deleteCommentLikesThenContinue(() => {
              db.run(
                `DELETE FROM comments WHERE argument_id IN (${placeholders})`,
                argumentIds,
                (err3) => {
                  if (err3) {
                    return res.status(500).json({ error: "Erreur suppression commentaires." });
                  }

                  db.run(
                    "DELETE FROM arguments WHERE debate_id=?",
                    [debateId],
                    (err5) => {
                      if (err5) {
                        return res.status(500).json({ error: "Erreur suppression arguments." });
                      }

                      finishDeleteDebate();
                    }
                  );
                }
              );
            });
          }
        );
      }
    );
  });
});

/* =========================
   ARGUMENTS
========================= */

app.post("/api/arguments", (req, res) => {
  const { debate_id, side, title, body, authorKey } = req.body;

  const SIMILARITY_THRESHOLD = 0.6;

  const newCombinedText = `${title || ""} ${body || ""}`.trim();
  const normalizedNewWords = normalizeSimilarityText(newCombinedText);
  const shouldCheckSimilarity = normalizedNewWords.length >= 4;

  db.all(
    `
    SELECT id, title, body, side
    FROM arguments
    WHERE debate_id = ?
      AND side = ?
    `,
    [debate_id, side],
    (similarErr, existingArguments) => {
      if (similarErr) {
        return sendServerError(res, "Erreur vérification similarité.");
      }

      const similarArguments = shouldCheckSimilarity
        ? (existingArguments || [])
            .map((arg) => {
              const existingCombinedText = `${arg.title || ""} ${arg.body || ""}`.trim();
              const similarityScore = computeIdeaSimilarity(
                newCombinedText,
                existingCombinedText
              );

              return {
                ...arg,
                similarityScore
              };
            })
            .filter((arg) => arg.similarityScore >= SIMILARITY_THRESHOLD)
            .sort((a, b) => b.similarityScore - a.similarityScore)
            .slice(0, 3)
        : [];

      if (similarArguments.length > 0) {
        return res.status(409).json({
          error: "similar_arguments",
          similarArguments: similarArguments.map((arg) => ({
            id: arg.id,
            title: arg.title,
            body: arg.body,
            similarityScore: arg.similarityScore
          }))
        });
      }

      db.run(
        `
        INSERT INTO arguments(debate_id,side,title,body,author_key,created_at)
        VALUES(?,?,?,?,?,datetime('now','localtime'))
        `,
        [debate_id, side, title, body, authorKey || null],
        function (err) {
          if (err) {
            return sendServerError(res, "Erreur création argument.");
          }

          db.get(
            `SELECT creator_key, question FROM debates WHERE id = ?`,
            [debate_id],
            (debateErr, debateRow) => {
              if (
                !debateErr &&
                debateRow &&
                debateRow.creator_key &&
                debateRow.creator_key !== authorKey
              ) {
                createNotification({
                  user_key: debateRow.creator_key,
                  type: "argument_in_my_debate",
                  debate_id,
                  argument_id: this.lastID,
                  message: "Un nouvel argument a été posté dans votre débat."
                });
              }

              res.json({ success: true, id: this.lastID });
            }
          );
        }
      );
    }
  );
});

app.post("/api/arguments/:id/vote", (req, res) => {
  const id = req.params.id;
  const { voterKey } = req.body;

  db.get(
    "SELECT debate_id FROM arguments WHERE id=?",
    [id],
    (errArg, argument) => {
      if (errArg || !argument) {
        return res.status(404).json({ error: "Argument introuvable." });
      }

      db.get(
        `
        SELECT COALESCE(SUM(v.vote_count), 0) as total_votes
        FROM votes v
        JOIN arguments a ON a.id = v.argument_id
        WHERE a.debate_id = ? AND v.voter_key = ?
        `,
        [argument.debate_id, voterKey],
        (errTotal, totalRow) => {
          if (errTotal) {
return sendServerError(res, "Erreur vérification votes.");          
}

          const totalVotesUsed = Number(totalRow?.total_votes || 0);

          if (totalVotesUsed >= MAX_VOTES_PER_DEBATE) {
            return res.status(400).json({ error: "limit" });
          }

          db.get(
            `
            SELECT id, vote_count
            FROM votes
            WHERE argument_id = ? AND voter_key = ?
            `,
            [id, voterKey],
            (errExisting, existingVote) => {
              if (errExisting) {
return sendServerError(res, "Erreur lecture vote.");              
}

              const finishResponse = () => {
                db.get(
                  `
                  SELECT
                    a.votes as votes,
                    COALESCE(v.vote_count, 0) as myVotesOnArgument
                  FROM arguments a
                  LEFT JOIN votes v
                    ON v.argument_id = a.id
                    AND v.voter_key = ?
                  WHERE a.id = ?
                  `,
                  [voterKey, id],
                  (errFinal, rowFinal) => {
                    if (errFinal) {
                      return res.status(500).json({ error: "Erreur lecture résultat vote." });
                    }

                    res.json({
                      votes: Number(rowFinal?.votes || 0),
                      myVotesOnArgument: Number(rowFinal?.myVotesOnArgument || 0),
                      remainingVotes: MAX_VOTES_PER_DEBATE - (totalVotesUsed + 1)
                    });
                  }
                );
              };

              const notifyAuthorIfNeeded = () => {
                db.get(
                  `
                  SELECT author_key, debate_id
                  FROM arguments
                  WHERE id = ?
                  `,
                  [id],
                  (authorErr, argumentRow) => {
                    if (!authorErr && argumentRow && argumentRow.author_key && argumentRow.author_key !== voterKey) {
                      createNotification({
                        user_key: argumentRow.author_key,
                        type: "vote_on_argument",
                        debate_id: argumentRow.debate_id,
                        argument_id: id,
                        message: "Votre argument a reçu un vote."
                      });
                    }
                  }
                );
              };

              if (existingVote) {
                db.run(
                  `
                  UPDATE votes
                  SET vote_count = vote_count + 1
                  WHERE id = ?
                  `,
                  [existingVote.id],
                  (errUpdateVote) => {
                    if (errUpdateVote) {
                      return res.status(500).json({ error: "Erreur mise à jour vote." });
                    }

                    db.run(
                      `
                      UPDATE arguments
                      SET votes = votes + 1
                      WHERE id = ?
                      `,
                      [id],
                      (errUpdateArg) => {
                        if (errUpdateArg) {
                          return res.status(500).json({ error: "Erreur mise à jour argument." });
                        }

                        notifyAuthorIfNeeded();
                        finishResponse();
                      }
                    );
                  }
                );
              } else {
                db.run(
                  `
                  INSERT INTO votes(argument_id, voter_key, vote_count)
                  VALUES(?, ?, 1)
                  `,
                  [id, voterKey],
                  (errInsert) => {
                    if (errInsert) {
                      return res.status(500).json({ error: "Erreur création vote." });
                    }

                    db.run(
                      `
                      UPDATE arguments
                      SET votes = votes + 1
                      WHERE id = ?
                      `,
                      [id],
                      (errUpdateArg) => {
                        if (errUpdateArg) {
                          return res.status(500).json({ error: "Erreur mise à jour argument." });
                        }

                        notifyAuthorIfNeeded();
                        finishResponse();
                      }
                    );
                  }
                );
              }
            }
          );
        }
      );
    }
  );
});

app.post("/api/arguments/:id/unvote", (req, res) => {
  const id = req.params.id;
  const { voterKey } = req.body;

  db.get(
    `
    SELECT id, vote_count
    FROM votes
    WHERE argument_id = ? AND voter_key = ?
    `,
    [id, voterKey],
    (errVote, voteRow) => {
      if (errVote) {
return sendServerError(res, "Erreur lecture vote.");      
}

      if (!voteRow) {
        return res.status(400).json({ error: "no_vote" });
      }

      const finishResponse = () => {
        db.get(
          `
          SELECT
            a.votes as votes,
            COALESCE(v.vote_count, 0) as myVotesOnArgument
          FROM arguments a
          LEFT JOIN votes v
            ON v.argument_id = a.id
            AND v.voter_key = ?
          WHERE a.id = ?
          `,
          [voterKey, id],
          (errFinal, rowFinal) => {
            if (errFinal) {
              return res.status(500).json({ error: "Erreur lecture résultat vote." });
            }

            db.get(
              `
              SELECT COALESCE(SUM(v.vote_count), 0) as total_votes
              FROM votes v
              JOIN arguments a ON a.id = v.argument_id
              WHERE a.debate_id = (SELECT debate_id FROM arguments WHERE id = ?)
              AND v.voter_key = ?
              `,
              [id, voterKey],
              (errTotal, totalRow) => {
                if (errTotal) {
                  return res.status(500).json({ error: "Erreur lecture total votes." });
                }

                res.json({
                  votes: Number(rowFinal?.votes || 0),
                  myVotesOnArgument: Number(rowFinal?.myVotesOnArgument || 0),
                  remainingVotes: MAX_VOTES_PER_DEBATE - Number(totalRow?.total_votes || 0)
                });
              }
            );
          }
        );
      };

      const updateArgumentTotal = () => {
        db.run(
          `
          UPDATE arguments
          SET votes = votes - 1
          WHERE id = ? AND votes > 0
          `,
          [id],
          (errUpdateArg) => {
            if (errUpdateArg) {
              return res.status(500).json({ error: "Erreur mise à jour argument." });
            }

            finishResponse();
          }
        );
      };

      if (Number(voteRow.vote_count) > 1) {
        db.run(
          `
          UPDATE votes
          SET vote_count = vote_count - 1
          WHERE id = ?
          `,
          [voteRow.id],
          (errUpdateVote) => {
            if (errUpdateVote) {
              return res.status(500).json({ error: "Erreur mise à jour vote." });
            }

            updateArgumentTotal();
          }
        );
      } else {
        db.run(
          `
          DELETE FROM votes
          WHERE id = ?
          `,
          [voteRow.id],
          (errDeleteVote) => {
            if (errDeleteVote) {
              return res.status(500).json({ error: "Erreur suppression vote." });
            }

            updateArgumentTotal();
          }
        );
      }
    }
  );
});

/* =========================
   COMMENTS
========================= */

app.post("/api/comments", (req, res) => {
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

db.run(
  `
  INSERT INTO comments(
    argument_id,
    content,
    stance,
    author_key,
    reply_to_comment_id,
    improvement_title,
    improvement_body,
    created_at
  )
  VALUES(?,?,?,?,?,?,?,datetime('now','localtime'))
  `,
  [
    argument_id,
    content,
    safeStance,
    authorKey || null,
    reply_to_comment_id || null,
    safeImprovementTitle,
    safeImprovementBody
  ],
  
    function (err) {
      if (err) {
        return res.status(500).json({ error: "Erreur ajout commentaire." });
      }

      const newCommentId = this.lastID;

      db.get(
        `
        SELECT
          c.*,
         (
  SELECT COALESCE(SUM(cl.value), 0)
  FROM comment_likes cl
  WHERE cl.comment_id = c.id
) as likes
        FROM comments c
        WHERE c.id = ?
        `,
        [newCommentId],
        (err2, row) => {
          if (err2) {
            return res.status(500).json({ error: "Erreur lecture commentaire." });
          }

          db.get(
            `
            SELECT author_key, debate_id
            FROM arguments
            WHERE id = ?
            `,
            [argument_id],
            (errArg, argumentRow) => {
              const preview = String(content || "").trim();
              const shortPreview =
                preview.length > 120 ? preview.slice(0, 120) + "…" : preview;

              if (
                !errArg &&
                argumentRow &&
                argumentRow.author_key &&
                argumentRow.author_key !== (authorKey || null)
              ) {
                db.run(
                  `
                  INSERT INTO notifications(user_key, type, debate_id, argument_id, comment_id, message)
                  VALUES(?,?,?,?,?,?)
                  `,
                  [
                    argumentRow.author_key,
                    "comment_on_argument",
                    argumentRow.debate_id || null,
                    argument_id,
                    newCommentId,
                    shortPreview
                      ? `Nouveau commentaire : ${shortPreview}`
                      : "Nouveau commentaire sur votre argument"
                  ]
                );
              }

              if (reply_to_comment_id) {
                db.get(
                  `
                  SELECT id, author_key
                  FROM comments
                  WHERE id = ?
                  `,
                  [reply_to_comment_id],
                  (errReply, parentCommentRow) => {
                    if (
                      !errReply &&
                      parentCommentRow &&
                      parentCommentRow.author_key &&
                      parentCommentRow.author_key !== (authorKey || null)
                    ) {
                      db.run(
                        `
                        INSERT INTO notifications(user_key, type, debate_id, argument_id, comment_id, message)
                        VALUES(?,?,?,?,?,?)
                        `,
                        [
                          parentCommentRow.author_key,
                          "reply_to_comment",
                          argumentRow?.debate_id || null,
                          argument_id,
                          newCommentId,
                          shortPreview
                            ? `Réponse à votre commentaire : ${shortPreview}`
                            : "Quelqu’un a répondu à votre commentaire"
                        ]
                      );
                    }

                    return res.json(row);
                  }
                );

                return;
              }

              return res.json(row);
            }
          );
        }
      );
    }
  );
});
app.post("/api/comments/:id/vote", (req, res) => {
  const id = req.params.id;
  const { voterKey, value } = req.body;

  if (!voterKey) {
    return res.status(400).json({ error: "Clé utilisateur manquante." });
  }

  if (![1, 0, -1].includes(Number(value))) {
    return res.status(400).json({ error: "Vote invalide." });
  }

  const voteValue = Number(value);

  const finalize = () => {
    db.get(
      `
      SELECT
        c.id,
        c.stance,
        c.improvement_title,
        c.improvement_body,
        c.argument_id AS linked_argument_id,
        a.votes AS argument_votes,
        a.debate_id,
        c.author_key,
        COALESCE(SUM(cl.value), 0) as likes
      FROM comments c
      LEFT JOIN arguments a ON a.id = c.argument_id
      LEFT JOIN comment_likes cl ON cl.comment_id = c.id
      WHERE c.id=?
      GROUP BY c.id
      `,
      [id],
      (err2, commentRow) => {
        if (err2 || !commentRow) {
          return res.status(500).json({ error: "Erreur lecture score commentaire." });
        }

       if (commentRow.author_key && commentRow.author_key !== voterKey) {
  if (voteValue === 1) {
    createNotification({
      user_key: commentRow.author_key,
      type: "like_on_comment",
      debate_id: commentRow.debate_id,
      argument_id: commentRow.linked_argument_id,
      comment_id: id,
      message: "Votre commentaire a reçu un pouce vers le haut."
    });
  }

  if (voteValue === -1) {
    createNotification({
      user_key: commentRow.author_key,
      type: "dislike_on_comment",
      debate_id: commentRow.debate_id,
      argument_id: commentRow.linked_argument_id,
      comment_id: id,
      message: "Votre commentaire a reçu un pouce vers le bas."
    });
  }
}

        const likes = Number(commentRow.likes || 0);
        const argumentVotes = Number(commentRow.argument_votes || 0);
        const isImprovement = commentRow.stance === "amelioration";
        const improvementTitle = String(commentRow.improvement_title || "").trim();
        const improvementBody = String(commentRow.improvement_body || "").trim();

if (
  isImprovement &&
  improvementTitle &&
  improvementBody &&
  likes > argumentVotes
) {
  db.run(
    `UPDATE arguments SET title = ?, body = ? WHERE id = ?`,
    [improvementTitle, improvementBody, commentRow.linked_argument_id],
    (updateErr) => {
      if (updateErr) {
        return res.status(500).json({ error: "Erreur remplacement idée." });
      }

      if (commentRow.author_key) {
        createNotification({
          user_key: commentRow.author_key,
          type: "replacement_accepted",
          debate_id: commentRow.debate_id,
          argument_id: commentRow.linked_argument_id,
          comment_id: id,
          message: "Bravo, ta proposition de remplacement a convaincu, elle prend désormais la place de l’idée initiale !"
        });
      }

      db.run(
        `DELETE FROM comment_likes WHERE comment_id = ?`,
        [id],
        (deleteLikesErr) => {
          if (deleteLikesErr) {
            return res.status(500).json({ error: "Erreur suppression votes amélioration." });
          }

          db.run(
            `DELETE FROM reports WHERE target_type = 'comment' AND target_id = ?`,
            [id],
            (deleteReportsErr) => {
              if (deleteReportsErr) {
                return res.status(500).json({ error: "Erreur suppression signalements amélioration." });
              }

              db.run(
                `DELETE FROM notifications WHERE comment_id = ? AND type != 'replacement_accepted'`,
                [id],
                (deleteNotificationsErr) => {
                  if (deleteNotificationsErr) {
                    return res.status(500).json({ error: "Erreur suppression notifications amélioration." });
                  }

                  db.run(
                    `DELETE FROM comments WHERE id = ?`,
                    [id],
                    (deleteCommentErr) => {
                      if (deleteCommentErr) {
                        return res.status(500).json({ error: "Erreur suppression commentaire amélioration." });
                      }

                      return res.json({
                        likes,
                        replaced: true,
                        argumentId: commentRow.linked_argument_id
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
  return;
}

        res.json({ likes, replaced: false });
      }
    );
  };

  db.get(
    `SELECT value FROM comment_likes WHERE comment_id=? AND voter_key=?`,
    [id, voterKey],
    (err, existingVote) => {
      if (err) {
return sendServerError(res, "Erreur lecture vote commentaire.");      }

      if (!existingVote) {
        if (voteValue === 0) {
          return finalize();
        }

        db.run(
          `INSERT INTO comment_likes (comment_id, voter_key, value) VALUES (?, ?, ?)`,
          [id, voterKey, voteValue],
          (insertErr) => {
            if (insertErr) {
              return res.status(500).json({ error: "Erreur enregistrement vote commentaire." });
            }
            finalize();
          }
        );
        return;
      }

      if (voteValue === 0) {
        db.run(
          `DELETE FROM comment_likes WHERE comment_id=? AND voter_key=?`,
          [id, voterKey],
          (deleteErr) => {
            if (deleteErr) {
              return res.status(500).json({ error: "Erreur suppression vote commentaire." });
            }
            finalize();
          }
        );
        return;
      }

      db.run(
        `UPDATE comment_likes SET value=? WHERE comment_id=? AND voter_key=?`,
        [voteValue, id, voterKey],
        (updateErr) => {
          if (updateErr) {
            return res.status(500).json({ error: "Erreur mise à jour vote commentaire." });
          }
          finalize();
        }
      );
    }
  );
});

app.delete("/api/arguments/:id", (req, res) => {
  const id = req.params.id;
  const requesterKey = String(req.query.authorKey || "").trim();
  const adminMode = isAdmin(req);

  db.get(
    `SELECT author_key FROM arguments WHERE id = ?`,
    [id],
    (errAuthor, argumentRow) => {
      if (errAuthor) {
        return res.status(500).json({ error: "Erreur vérification auteur argument." });
      }

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

      db.all(
        `SELECT id FROM comments WHERE argument_id=?`,
        [id],
        (errComments, commentRows) => {
          if (errComments) {
            return res.status(500).json({ error: "Erreur récupération commentaires argument." });
          }

          const commentIds = commentRows.map((row) => row.id);

          const deleteCommentLikes = (next) => {
            if (!commentIds.length) return next();

            const placeholders = commentIds.map(() => "?").join(",");

            db.run(
              `DELETE FROM comment_likes WHERE comment_id IN (${placeholders})`,
              commentIds,
              (errLikes) => {
                if (errLikes) {
                  return res.status(500).json({ error: "Erreur suppression likes commentaires." });
                }
                next();
              }
            );
          };

          const deleteCommentReports = (next) => {
            if (!commentIds.length) return next();

            const placeholders = commentIds.map(() => "?").join(",");

            db.run(
              `DELETE FROM reports
               WHERE target_type='comment'
               AND target_id IN (${placeholders})`,
              commentIds,
              (errReports) => {
                if (errReports) {
                  return res.status(500).json({ error: "Erreur suppression signalements commentaires." });
                }
                next();
              }
            );
          };

          const deleteCommentNotifications = (next) => {
            if (!commentIds.length) return next();

            const placeholders = commentIds.map(() => "?").join(",");

            db.run(
              `DELETE FROM notifications
               WHERE comment_id IN (${placeholders})`,
              commentIds,
              (errNotifications) => {
                if (errNotifications) {
                  return res.status(500).json({ error: "Erreur suppression notifications commentaires." });
                }
                next();
              }
            );
          };

          db.run(
            `DELETE FROM votes WHERE argument_id=?`,
            [id],
            (errVotes) => {
              if (errVotes) {
                return res.status(500).json({ error: "Erreur suppression votes argument." });
              }

              deleteCommentLikes(() => {
                deleteCommentReports(() => {
                  deleteCommentNotifications(() => {
                    db.run(
                      `DELETE FROM comments WHERE argument_id=?`,
                      [id],
                      (errDeleteComments) => {
                        if (errDeleteComments) {
                          return res.status(500).json({ error: "Erreur suppression commentaires argument." });
                        }

                        db.run(
                          `DELETE FROM reports
                           WHERE target_type='argument'
                           AND target_id=?`,
                          [id],
                          (errArgumentReports) => {
                            if (errArgumentReports) {
                              return res.status(500).json({ error: "Erreur suppression signalements argument." });
                            }

                            db.run(
                              `DELETE FROM notifications WHERE argument_id=?`,
                              [id],
                              (errArgumentNotifications) => {
                                if (errArgumentNotifications) {
                                  return res.status(500).json({ error: "Erreur suppression notifications argument." });
                                }

                                db.run(
                                  `DELETE FROM arguments WHERE id=?`,
                                  [id],
                                  function (errDeleteArgument) {
                                    if (errDeleteArgument) {
                                      return res.status(500).json({ error: "Erreur suppression argument." });
                                    }

                                    res.json({ success: true });
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  });
                });
              });
            }
          );
        }
      );
    }
  );
});
app.delete("/api/comments/:id", (req, res) => {
  const id = req.params.id;
  const requesterKey = String(req.query.authorKey || "").trim();
  const adminMode = isAdmin(req);

  db.get(
    `SELECT author_key FROM comments WHERE id = ?`,
    [id],
    (errComment, commentRow) => {
      if (errComment) {
        return res.status(500).json({ error: "Erreur vérification auteur commentaire." });
      }

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

      db.run("DELETE FROM comment_likes WHERE comment_id=?", [id], (errLikes) => {
        if (errLikes) {
          return res.status(500).json({ error: "Erreur suppression likes commentaire." });
        }

        db.run(
          `DELETE FROM reports WHERE target_type='comment' AND target_id=?`,
          [id],
          (errReports) => {
            if (errReports) {
              return res.status(500).json({ error: "Erreur suppression signalements commentaire." });
            }

            db.run(
              `DELETE FROM notifications WHERE comment_id=?`,
              [id],
              (errNotifications) => {
                if (errNotifications) {
                  return res.status(500).json({ error: "Erreur suppression notifications commentaire." });
                }

                db.run("DELETE FROM comments WHERE id=?", [id], function (errDelete) {
                  if (errDelete) {
                    return res.status(500).json({ error: "Erreur suppression commentaire." });
                  }

                  res.json({ success: true });
                });
              }
            );
          }
        );
      });
    }
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
