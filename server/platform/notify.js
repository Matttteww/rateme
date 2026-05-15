const { getDb } = require("./db");
const { newId } = require("./authUtil");
const { formatNotificationText, getNotificationAction } = require("./notifyFormat");
const { pushToUser } = require("./realtime");

function createNotification(userId, type, payload) {
  const db = getDb();
  const id = newId();
  const now = Date.now();
  const payloadObj = payload || {};
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, payload, read_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`
  ).run(id, userId, type, JSON.stringify(payloadObj), now);

  const item = {
    id,
    type,
    payload: payloadObj,
    text: formatNotificationText(db, type, payloadObj),
    action: getNotificationAction(type, payloadObj, db),
    readAt: null,
    createdAt: now,
  };
  pushToUser(userId, { type: "notification", item });
  return id;
}

function notifySubscribersNewPost(authorId, postId) {
  const db = getDb();
  const subs = db
    .prepare("SELECT follower_id FROM subscriptions WHERE following_id = ?")
    .all(authorId);
  const author = db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(authorId);
  for (const s of subs) {
    createNotification(s.follower_id, "new_post", {
      postId,
      fromUserId: authorId,
      fromUsername: author?.username,
      fromDisplayName: author?.display_name || author?.username,
    });
  }
}

module.exports = { createNotification, notifySubscribersNewPost };
