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

  const body = payload.message || "Nouvelle activité sur agôn.";

  let url = "/notifications";
  if (event.comment_id && event.debate_id) {
    url = `/debate?id=${event.debate_id}&highlight=comment-${event.comment_id}`;
  } else if (event.argument_id && event.debate_id) {
    url = `/debate?id=${event.debate_id}&highlight=argument-${event.argument_id}`;
  } else if (event.debate_id) {
    url = `/debate?id=${event.debate_id}&highlight=debate`;
  }

  return {
    title: "agôn",
    body,
    url,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png"
  };
}

async function getNotificationEventById(supabase, eventId) {
  const { data, error } = await supabase
    .from("notification_events")
    .select("id, event_type, recipient_user_id, debate_id, argument_id, comment_id, payload, status, created_at")
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getPendingPushEvents(supabase, limit) {
  const { data, error } = await supabase
    .from("notification_events")
    .select("id, event_type, recipient_user_id, debate_id, argument_id, comment_id, payload, created_at")
    .eq("status", "pending")
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

async function broadcastPush(supabase, vapidConfig, payload) {
  configureWebPush(vapidConfig);

  const { data: subscriptions, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .is("revoked_at", null);

  if (error) throw error;

  const results = [];
  for (const row of (subscriptions || [])) {
    try {
      await sendPushToSubscriptionRow(supabase, row, payload);
      results.push({ id: row.id, status: "sent" });
    } catch (err) {
      results.push({ id: row.id, status: "failed", reason: String(err?.statusCode || err?.message || "push-error") });
    }
  }

  return { total: results.length, results };
}

module.exports = {
  sendTestPushToLatestSubscription,
  sendNotificationEventPushById,
  processPendingPushEvents,
  broadcastPush
};
