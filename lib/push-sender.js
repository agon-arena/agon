const webPush = require("web-push");

function buildSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };
}

async function getLatestActiveSubscription(supabase) {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, last_seen_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function markSubscriptionRevoked(supabase, subscriptionId) {
  const { error } = await supabase
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", subscriptionId);

  if (error) throw error;
}

async function sendTestPushToLatestSubscription(supabase, vapidConfig) {
  webPush.setVapidDetails(
    vapidConfig.subject,
    vapidConfig.publicKey,
    vapidConfig.privateKey
  );

  const subscriptionRow = await getLatestActiveSubscription(supabase);
  if (!subscriptionRow) {
    return {
      sent: false,
      reason: "no-active-subscription"
    };
  }

  const payload = JSON.stringify({
    title: "agôn",
    body: "Notification test reçue.",
    url: "/notifications",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png"
  });

  try {
    await webPush.sendNotification(buildSubscription(subscriptionRow), payload);

    return {
      sent: true,
      subscription_id: subscriptionRow.id,
      user_id: subscriptionRow.user_id
    };
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await markSubscriptionRevoked(supabase, subscriptionRow.id);
    }

    throw error;
  }
}

module.exports = {
  sendTestPushToLatestSubscription
};
