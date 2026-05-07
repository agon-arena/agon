function normalizeLegacyKey(value) {
  return String(value || "").trim();
}

function isValidLegacyKey(legacyKey) {
  return legacyKey.length >= 8
    && legacyKey.length <= 160
    && /^[A-Za-z0-9._:-]+$/.test(legacyKey);
}

async function getUserByLegacyKey(supabase, legacyKey) {
  const normalizedLegacyKey = normalizeLegacyKey(legacyKey);
  if (!isValidLegacyKey(normalizedLegacyKey)) return null;

  const { data, error } = await supabase
    .from("users")
    .select("id, legacy_key")
    .eq("legacy_key", normalizedLegacyKey)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getOrCreateUserByLegacyKey(supabase, legacyKey) {
  const normalizedLegacyKey = normalizeLegacyKey(legacyKey);
  if (!isValidLegacyKey(normalizedLegacyKey)) return null;

  const existingUser = await getUserByLegacyKey(supabase, normalizedLegacyKey);
  if (existingUser) return existingUser;

  const { data, error } = await supabase
    .from("users")
    .insert({ legacy_key: normalizedLegacyKey })
    .select("id, legacy_key")
    .single();

  if (error) {
    if (error.code === "23505") {
      return getUserByLegacyKey(supabase, normalizedLegacyKey);
    }

    throw error;
  }

  return data || null;
}

async function createNotificationEventSafe(supabase, {
  eventType,
  actorLegacyKey,
  recipientLegacyKey,
  debateId = null,
  argumentId = null,
  commentId = null,
  parentCommentId = null,
  payload = {}
}) {
  try {
    const recipientUser = await getOrCreateUserByLegacyKey(supabase, recipientLegacyKey);
    if (!recipientUser?.id) return null;

    const actorUser = actorLegacyKey
      ? await getUserByLegacyKey(supabase, actorLegacyKey)
      : null;

    const { data, error } = await supabase
      .from("notification_events")
      .insert({
        event_type: eventType,
        actor_user_id: actorUser?.id || null,
        recipient_user_id: recipientUser.id,
        debate_id: debateId,
        argument_id: argumentId,
        comment_id: commentId,
        parent_comment_id: parentCommentId,
        payload,
        status: "pending"
      })
      .select("id")
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function queueCommentNotificationEvents(supabase, {
  authorKey,
  argumentRow,
  parentCommentRow,
  argumentId,
  commentId,
  replyToCommentId,
  shortPreview,
  stance
}) {
  if (
    argumentRow?.author_key &&
    argumentRow.author_key !== (authorKey || null)
  ) {
    createNotificationEventSafe(supabase, {
      eventType: "comment_on_argument",
      actorLegacyKey: authorKey || null,
      recipientLegacyKey: argumentRow.author_key,
      debateId: argumentRow.debate_id || null,
      argumentId,
      commentId,
      payload: {
        argument_title: argumentRow.title || "",
        preview: shortPreview || "",
        stance: stance || null
      }
    });
  }

  if (
    replyToCommentId &&
    parentCommentRow?.author_key &&
    parentCommentRow.author_key !== (authorKey || null)
  ) {
    createNotificationEventSafe(supabase, {
      eventType: "reply_to_comment",
      actorLegacyKey: authorKey || null,
      recipientLegacyKey: parentCommentRow.author_key,
      debateId: argumentRow?.debate_id || null,
      argumentId,
      commentId,
      parentCommentId: replyToCommentId,
      payload: {
        parent_comment_preview: parentCommentRow.content || "",
        preview: shortPreview || "",
        stance: stance || null
      }
    });
  }
}

module.exports = {
  queueCommentNotificationEvents
};
