function normalizeText(value) {
  return String(value || "").trim();
}

function validatePushSubscription(value) {
  const endpoint = normalizeText(value?.endpoint);
  const p256dh = normalizeText(value?.keys?.p256dh);
  const auth = normalizeText(value?.keys?.auth);

  if (!endpoint || endpoint.length > 2048 || !endpoint.startsWith("https://")) {
    return { subscription: null, error: "Abonnement push invalide." };
  }

  if (!p256dh || p256dh.length > 512 || !auth || auth.length > 512) {
    return { subscription: null, error: "Cles push invalides." };
  }

  return {
    subscription: {
      endpoint,
      keys: { p256dh, auth }
    },
    error: ""
  };
}

async function registerPushSubscription(supabase, { userId, subscription, userAgent }) {
  const lastSeenAt = new Date().toISOString();
  const safeUserAgent = normalizeText(userAgent).slice(0, 512) || null;

  const { data, error } = await supabase
    .from("push_subscriptions")
    .upsert({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: safeUserAgent,
      last_seen_at: lastSeenAt,
      revoked_at: null
    }, { onConflict: "endpoint" })
    .select("id, user_id, endpoint, created_at, last_seen_at, revoked_at")
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  validatePushSubscription,
  registerPushSubscription
};
