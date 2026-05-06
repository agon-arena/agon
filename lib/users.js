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

async function touchExistingLegacyUser(supabase, legacyKey, lastSeenAt) {
  const { data, error } = await supabase
    .from("users")
    .update({ last_seen_at: lastSeenAt })
    .eq("legacy_key", legacyKey)
    .select("id, legacy_key, created_at, last_seen_at")
    .single();

  if (error) throw error;
  return data;
}

async function resolveLegacyUser(supabase, legacyKey) {
  const lastSeenAt = new Date().toISOString();

  const { data: existing, error: selectError } = await supabase
    .from("users")
    .select("id, legacy_key, created_at, last_seen_at")
    .eq("legacy_key", legacyKey)
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    return {
      user: await touchExistingLegacyUser(supabase, legacyKey, lastSeenAt),
      created: false
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("users")
    .insert({ legacy_key: legacyKey, last_seen_at: lastSeenAt })
    .select("id, legacy_key, created_at, last_seen_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        user: await touchExistingLegacyUser(supabase, legacyKey, lastSeenAt),
        created: false
      };
    }

    throw insertError;
  }

  return { user: inserted, created: true };
}

module.exports = {
  normalizeLegacyKey,
  validateLegacyKey,
  resolveLegacyUser
};
