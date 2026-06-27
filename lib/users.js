function normalizeLegacyKey(value) {
  return String(value || "").trim();
}

function validateLegacyKey(value) {
  const legacyKey = normalizeLegacyKey(value);

  if (legacyKey.length < 8 || legacyKey.length > 160) {
    return { legacyKey, error: "Cle utilisateur invalide." };
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(legacyKey)) {
    return { legacyKey, error: "Cle utilisateur invalide." };
  }

  return { legacyKey, error: "" };
}

async function resolveLegacyUser(supabase, legacyKey) {
  const lastSeenAt = new Date().toISOString();

  // Une seule requête : upsert sur legacy_key (unique).
  // created_at n'est pas écrasé grâce à ignoreDuplicates=false + la colonne
  // ayant un DEFAULT côté Supabase — on détecte la création via l'égalité des timestamps.
  const { data, error } = await supabase
    .from("users")
    .upsert(
      { legacy_key: legacyKey, last_seen_at: lastSeenAt },
      { onConflict: "legacy_key", ignoreDuplicates: false }
    )
    .select("id, legacy_key, created_at, last_seen_at")
    .single();

  if (error) throw error;

  // Si created_at ≈ last_seen_at (même seconde), c'est une création.
  const created = Math.abs(new Date(data.created_at) - new Date(lastSeenAt)) < 2000;
  return { user: data, created };
}

module.exports = {
  normalizeLegacyKey,
  validateLegacyKey,
  resolveLegacyUser
};
