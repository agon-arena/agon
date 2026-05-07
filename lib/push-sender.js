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

function configureWebPush(vapidConfig) {
  webPush.setVapidDetails(
    vapidConfig.subject,
    vapidConfig.publicKey,
    vapidConfig.privateKey
  );
}

async function sendPushToSubscriptionRow(supabase, subscriptionRow, payload) {
  try {
    await webPush.sendNotification(
      buildSubscription(subscriptionRow),
      JSON.stringify(payload)
    );

    return { sent: true };
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) {
      await markSubscriptionRevoked(supabase, subscriptionRow.id);
    }

    throw error;
  }
}

async function sendTestPushToLatestSubscription(supabase, vapidConfig) {
  configureWebPush(vapidConfig);

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

  await sendPushToSubscriptionRow(supabase, subscriptionRow, JSON.parse(payload));

  return {
    sent: true,
    subscription_id: subscriptionRow.id,
    user_id: subscriptionRow.user_id
  };
}

function buildEventPayload(event) {
  const payload = event.payload || {};

  if (event.event_type === "reply_to_comment") {
    return {
      title: "Nouvelle réponse",
      body: payload.preview
        ? `Réponse : ${payload.preview}`
        : "Quelqu'un a répondu à votre commentaire.",
      url: "/notifications",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png"
    };
  }

  return {
    title: "Nouveau commentaire",
    body: payload.preview
      ? `Commentaire : ${payload.preview}`
      : "Votre idée a reçu un commentaire.",
    url: "/notifications",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png"
  };
}

async function getNotificationEventById(supabase, eventId) {
  const { data, error } = await supabase
    .from("notification_events")
    .select("id, event_type, recipient_user_id, payload, status, created_at")
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getPendingPushEvents(supabase, limit) {
  const { data, error } = await supabase
    .from("notification_events")
    .select("id, event_type, recipient_user_id, payload, created_at")
    .eq("status", "pending")
    .in("event_type", ["comment_on_argument", "reply_to_comment"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function getActiveSubscriptionForUser(supabase, userId) {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, last_seen_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updateNotificationEventStatus(supabase, eventId, status, payload = {}) {
  const { error } = await supabase
    .from("notification_events")
    .update({
      status,
      processed_at: new Date().toISOString(),
      payload
    })
    .eq("id", eventId);

  if (error) throw error;
}

async function sendNotificationEventPush(supabase, event) {
  if (!event || event.status !== "pending") {
    return { id: event?.id || null, status: "skipped", reason: "not-pending" };
  }

  const subscriptionRow = await getActiveSubscriptionForUser(
    supabase,
    event.recipient_user_id
  );

  if (!subscriptionRow) {
    const payload = {
      ...(event.payload || {}),
      push_error: "no-active-subscription"
    };

    await updateNotificationEventStatus(supabase, event.id, "failed", payload);
    return { id: event.id, status: "failed", reason: "no-active-subscription" };
  }

  try {
    await sendPushToSubscriptionRow(supabase, subscriptionRow, buildEventPayload(event));

    await updateNotificationEventStatus(supabase, event.id, "sent", event.payload || {});
    return { id: event.id, status: "sent", subscription_id: subscriptionRow.id };
  } catch (error) {
    const payload = {
      ...(event.payload || {}),
      push_error: String(error?.statusCode || error?.message || "push-error").slice(0, 160)
    };

    await updateNotificationEventStatus(supabase, event.id, "failed", payload);
    return { id: event.id, status: "failed", reason: payload.push_error };
  }
}

async function sendNotificationEventPushById(supabase, vapidConfig, eventId) {
  configureWebPush(vapidConfig);

  const event = await getNotificationEventById(supabase, eventId);
  if (!event) {
    return { id: eventId, status: "skipped", reason: "event-not-found" };
  }

  return sendNotificationEventPush(supabase, event);
}

async function processPendingPushEvents(supabase, vapidConfig, { limit = 3 } = {}) {
  configureWebPush(vapidConfig);

  const events = await getPendingPushEvents(supabase, limit);
  const results = [];

  for (const event of events) {
    results.push(await sendNotificationEventPush(supabase, event));
  }

  return {
    processed: results.length,
    results
  };
}

module.exports = {
  sendTestPushToLatestSubscription,
  sendNotificationEventPushById,
  processPendingPushEvents
};
