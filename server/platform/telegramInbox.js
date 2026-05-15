const { newId } = require("./authUtil");
const { notifySubscribersNewPost } = require("./notify");
const {
  parseMediaJson,
  mapMediaForApi,
  copyMediaToWallAttachments,
  mergeMediaLists,
  mediaHasPlayable,
  inboxBodySignalsMissingRichMedia,
  sanitizeInboxBodyForApi,
} = require("./telegramMedia");

function insertTelegramInbox(db, userId, { telegramMessageId, body, hasMedia, channelUsername, media }) {
  const tgMsgId = String(telegramMessageId);
  const mediaJson = JSON.stringify(media || []);
  const existing = db
    .prepare("SELECT * FROM telegram_inbox WHERE user_id = ? AND telegram_message_id = ?")
    .get(userId, tgMsgId);
  if (existing) {
    const oldMedia = parseMediaJson(existing.media_json);
    const merged = mergeMediaLists(oldMedia, media || []);
    const improvedPlayable = mediaHasPlayable(merged) && !mediaHasPlayable(oldMedia);
    const moreItems = merged.length > oldMedia.length;
    const stripDummyLater =
      inboxBodySignalsMissingRichMedia(String(existing.body || "")) && mediaHasPlayable(merged);
    const shouldUpdate = improvedPlayable || moreItems || stripDummyLater;
    if (shouldUpdate) {
      let nextBody = String(existing.body || "").trim();
      if (stripDummyLater || (improvedPlayable && inboxBodySignalsMissingRichMedia(nextBody))) {
        nextBody = sanitizeInboxBodyForApi(nextBody);
        const incoming = String(body || "").trim();
        if (incoming && !inboxBodySignalsMissingRichMedia(incoming)) nextBody = incoming;
      }
      db.prepare(
        `UPDATE telegram_inbox SET media_json = ?, has_media = 1,
         body = ? WHERE id = ?`
      ).run(JSON.stringify(merged), nextBody, existing.id);
    }
    return { duplicate: true, id: existing.id, status: existing.status };
  }

  const text = String(body || "").trim();
  const link =
    channelUsername && tgMsgId
      ? `https://t.me/${String(channelUsername).replace(/^@/, "")}/${tgMsgId}`
      : null;
  const hasM = Boolean(hasMedia || (media && media.length) || inboxBodySignalsMissingRichMedia(text));

  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO telegram_inbox (id, user_id, telegram_message_id, body, has_media, media_json, channel_message_link, status, wall_post_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`
  ).run(id, userId, tgMsgId, text, hasM ? 1 : 0, mediaJson, link, now);

  return { duplicate: false, id, status: "pending" };
}

function publishInboxToWall(db, inboxRow, userId) {
  if (inboxRow.status === "published" && inboxRow.wall_post_id) {
    return { duplicate: true, postId: inboxRow.wall_post_id };
  }

  const tgMsgId = inboxRow.telegram_message_id;
  const existingWall = db
    .prepare("SELECT id FROM wall_posts WHERE telegram_message_id = ? AND user_id = ?")
    .get(tgMsgId, userId);
  if (existingWall) {
    db.prepare("UPDATE telegram_inbox SET status = 'published', wall_post_id = ? WHERE id = ?").run(
      existingWall.id,
      inboxRow.id
    );
    return { duplicate: true, postId: existingWall.id };
  }

  const now = Date.now();
  const postId = newId();
  const editUntil = now + 24 * 60 * 60 * 1000;
  const body = String(inboxRow.body || "").trim();
  const media = parseMediaJson(inboxRow.media_json);

  db.prepare(
    `INSERT INTO wall_posts (id, user_id, body, source, telegram_message_id, repost_of_id, repost_comment, status, created_at, updated_at, edit_until)
     VALUES (?, ?, ?, 'telegram', ?, NULL, NULL, 'published', ?, ?, ?)`
  ).run(postId, userId, body, tgMsgId, now, now, editUntil);

  copyMediaToWallAttachments(db, postId, media);

  db.prepare("UPDATE telegram_inbox SET status = 'published', wall_post_id = ? WHERE id = ?").run(
    postId,
    inboxRow.id
  );

  notifySubscribersNewPost(userId, postId);
  return { duplicate: false, postId };
}

function mapInboxRow(row) {
  const media = mapMediaForApi(parseMediaJson(row.media_json));
  return {
    id: row.id,
    telegramMessageId: row.telegram_message_id,
    body: sanitizeInboxBodyForApi(row.body || ""),
    hasMedia: Boolean(row.has_media) || media.length > 0,
    media,
    channelMessageLink: row.channel_message_link,
    status: row.status,
    wallPostId: row.wall_post_id,
    createdAt: row.created_at,
  };
}

module.exports = {
  insertTelegramInbox,
  publishInboxToWall,
  mapInboxRow,
};
