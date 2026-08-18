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

// resolveLegacyUser est appelé sur ~10 endpoints différents, potentiellement
// plusieurs fois par visite (un même visiteur enchaînant vote/commentaire/quiz
// en quelques secondes) : sans cache, chaque appel déclenchait son propre
// upsert+select Supabase rien que pour rafraîchir last_seen_at — identifié
// comme un contributeur du volume POST REST lors de l'audit egress du
// 18/08/2026. last_seen_at n'a pas besoin d'une précision à la seconde : le
// TTL courant suffit largement à l'usage (badge "vu récemment", etc.).
const USER_RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_RESOLVE_CACHE_MAX = 5000;
const _userResolveCache = new Map();

function _pruneUserResolveCacheIfNeeded() {
  if (_userResolveCache.size <= USER_RESOLVE_CACHE_MAX) return;
  const now = Date.now();
  for (const [key, entry] of _userResolveCache) {
    if (entry.expiresAt <= now) _userResolveCache.delete(key);
  }
  while (_userResolveCache.size > USER_RESOLVE_CACHE_MAX) {
    _userResolveCache.delete(_userResolveCache.keys().next().value);
  }
}

async function resolveLegacyUser(supabase, legacyKey) {
  const cached = _userResolveCache.get(legacyKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { user: cached.user, created: false };
  }

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
  _userResolveCache.set(legacyKey, { user: data, expiresAt: Date.now() + USER_RESOLVE_CACHE_TTL_MS });
  _pruneUserResolveCacheIfNeeded();
  return { user: data, created };
}

module.exports = {
  normalizeLegacyKey,
  validateLegacyKey,
  resolveLegacyUser
};
