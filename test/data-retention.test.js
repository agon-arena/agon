"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pruneOldRows, runDataRetentionCleanup } = require("../lib/data-retention");

function likeToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`);
}

// Fake Supabase client couvrant uniquement le sous-ensemble de l'API du
// query builder utilisé par pruneOldRows : from().select().lt().not()...limit()
// pour la lecture, from().delete().in() pour la suppression. Suffisant pour
// tester la logique de purge sans dépendre d'un vrai réseau/DB.
function createFakeSupabase(initialTables) {
  const tables = {};
  for (const [table, rows] of Object.entries(initialTables)) {
    tables[table] = rows.map((row) => ({ ...row }));
  }

  return {
    from(table) {
      const notLikeFilters = [];
      let ltFilter = null;
      const builder = {
        select() {
          return builder;
        },
        lt(col, val) {
          ltFilter = (row) => row[col] < val;
          return builder;
        },
        not(col, op, pattern) {
          assert.equal(op, "like", "seul l'opérateur like est simulé");
          const re = likeToRegex(pattern);
          notLikeFilters.push((row) => !re.test(String(row[col])));
          return builder;
        },
        limit(n) {
          const rows = tables[table] || [];
          const filtered = rows.filter(
            (row) => (!ltFilter || ltFilter(row)) && notLikeFilters.every((f) => f(row))
          );
          return Promise.resolve({ data: filtered.slice(0, n), error: null });
        },
        delete() {
          return {
            in(col, ids) {
              const idSet = new Set(ids);
              tables[table] = (tables[table] || []).filter((row) => !idSet.has(row[col]));
              return Promise.resolve({ error: null });
            }
          };
        }
      };
      return builder;
    },
    _tables: tables
  };
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("F1 : une réponse de repasse (cgreview-*) vieille de plus de 30j n'est pas purgée", async () => {
  const fakeSupabase = createFakeSupabase({
    daily_quiz_answers: [
      { id: "old-review", question_id: "cgreview-abc123", created_at: daysAgoIso(90) },
      { id: "old-notion", question_id: "notion:custom:xyz:expert", created_at: daysAgoIso(90) },
      { id: "old-ordinary", question_id: "culture_generale-def456", created_at: daysAgoIso(90) },
      { id: "recent-ordinary", question_id: "culture_generale-ghi789", created_at: daysAgoIso(1) }
    ]
  });

  await pruneOldRows(fakeSupabase, "daily_quiz_answers", 30, "question_id", ["notion:%", "cgreview-%"]);

  const remainingIds = fakeSupabase._tables.daily_quiz_answers.map((row) => row.id).sort();
  assert.deepEqual(remainingIds, ["old-notion", "old-review", "recent-ordinary"]);
});

test("pruneOldRows sans exclusion supprime toute ligne plus vieille que la rétention", async () => {
  const fakeSupabase = createFakeSupabase({
    page_visits: [
      { id: "old", created_at: daysAgoIso(120) },
      { id: "recent", created_at: daysAgoIso(1) }
    ]
  });

  await pruneOldRows(fakeSupabase, "page_visits", 90);

  const remainingIds = fakeSupabase._tables.page_visits.map((row) => row.id);
  assert.deepEqual(remainingIds, ["recent"]);
});

test("runDataRetentionCleanup préserve les repasses cgreview- sur toutes les tables purgées", async () => {
  const fakeSupabase = createFakeSupabase({
    page_visits: [],
    notification_events: [],
    opinion_articles: [],
    opinion_article_clicks: [],
    daily_quiz: [
      { id: "notion-quiz", slot: "notion:custom:abc:expert", created_at: daysAgoIso(60) }
    ],
    daily_quiz_answers: [
      { id: "old-review", question_id: "cgreview-abc123", created_at: daysAgoIso(90) },
      { id: "old-ordinary", question_id: "culture_generale-def456", created_at: daysAgoIso(90) }
    ]
  });

  await runDataRetentionCleanup(fakeSupabase);

  const remainingAnswerIds = fakeSupabase._tables.daily_quiz_answers.map((row) => row.id);
  assert.deepEqual(remainingAnswerIds, ["old-review"]);
  assert.deepEqual(fakeSupabase._tables.daily_quiz.map((row) => row.id), ["notion-quiz"]);
});
