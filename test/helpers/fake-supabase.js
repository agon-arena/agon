"use strict";

// Fausse implémentation minimale de supabase-js, multi-tables, pour les
// tests de la pré-génération (queue + scheduler) — AUCUN réseau. Supporte
// exactement les méthodes utilisées par lib/notion-quiz-pregeneration-*.js :
// .select/.eq/.not/.in/.order/.limit/.maybeSingle/.upsert/.update/.insert, et
// l'attente directe du builder comme un thenable (comme le vrai client).
//
// Chaque table est un tableau d'objets indépendant — `db.rows(table)` permet
// d'inspecter/pré-remplir l'état dans les tests.

function makeFakeSupabase(initialTables = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(initialTables)) {
    tables.set(name, rows.map((r) => ({ ...r })));
  }
  function tableRows(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }
  let nextIdByTable = new Map();
  function nextId(name) {
    const rows = tableRows(name);
    const current = nextIdByTable.get(name) || rows.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;
    nextIdByTable.set(name, current + 1);
    return current;
  }

  function applyFilters(list, filters) {
    return list.filter((row) => filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.val;
      if (f.type === "not-is-null") return row[f.col] != null;
      if (f.type === "in") return f.vals.includes(row[f.col]);
      return true;
    }));
  }

  function makeBuilder(tableName) {
    const filters = [];
    const orderSpecs = [];
    let limitN = null;
    let pendingOp = null;

    async function execute() {
      const rows = tableRows(tableName);
      if (pendingOp?.type === "upsert") {
        const { payload, options } = pendingOp;
        const conflictCols = (options?.onConflict || "").split(",");
        const existingIdx = rows.findIndex((r) => conflictCols.every((c) => r[c] === payload[c]));
        if (existingIdx >= 0) {
          if (!options?.ignoreDuplicates) rows[existingIdx] = { ...rows[existingIdx], ...payload };
          return { data: [rows[existingIdx]], error: null };
        }
        const row = { id: nextId(tableName), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (pendingOp?.type === "insert") {
        const row = { id: nextId(tableName), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...pendingOp.payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (pendingOp?.type === "update") {
        const matched = applyFilters(rows, filters);
        for (const row of matched) Object.assign(row, pendingOp.payload);
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      let result = applyFilters(rows, filters);
      if (orderSpecs.length) {
        result = [...result].sort((a, b) => {
          for (const spec of orderSpecs) {
            if (a[spec.col] < b[spec.col]) return spec.ascending ? -1 : 1;
            if (a[spec.col] > b[spec.col]) return spec.ascending ? 1 : -1;
          }
          return 0;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);
      return { data: result.map((r) => ({ ...r })), error: null };
    }

    const builder = {
      select() { return builder; },
      eq(col, val) { filters.push({ type: "eq", col, val }); return builder; },
      not(col, op, val) { if (op === "is" && val === null) filters.push({ type: "not-is-null", col }); return builder; },
      in(col, vals) { filters.push({ type: "in", col, vals }); return builder; },
      order(col, opts) { orderSpecs.push({ col, ascending: opts?.ascending !== false }); return builder; },
      limit(n) { limitN = n; return builder; },
      upsert(payload, options) { pendingOp = { type: "upsert", payload, options }; return builder; },
      insert(payload) { pendingOp = { type: "insert", payload }; return builder; },
      update(payload) { pendingOp = { type: "update", payload }; return builder; },
      async maybeSingle() {
        const { data, error } = await execute();
        return { data: (data && data[0]) || null, error };
      },
      async single() {
        const { data, error } = await execute();
        return { data: (data && data[0]) || null, error };
      },
      then(resolve, reject) { execute().then(resolve, reject); }
    };
    return builder;
  }

  return {
    from: (table) => makeBuilder(table),
    rows: (table) => tableRows(table)
  };
}

module.exports = { makeFakeSupabase };
