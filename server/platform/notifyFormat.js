function resolveUsername(db, payload) {
  if (payload.fromUsername) return payload.fromUsername;
  if (payload.fromUserId) {
    const u = db.prepare("SELECT username FROM users WHERE id = ?").get(payload.fromUserId);
    return u?.username || "пользователь";
  }
  if (payload.playerUsername) return payload.playerUsername;
  return "пользователь";
}

function formatNotificationText(db, type, payload) {
  const p = payload || {};
  const who = resolveUsername(db, p);
  switch (type) {
    case "post_like":
      return `@${who} лайкнул ваш пост`;
    case "openver_like":
      return `@${who} лайкнул ваш опен`;
    case "post_comment":
      return p.parentId
        ? `@${who} ответил на ваш комментарий`
        : `@${who} прокомментировал ваш пост`;
    case "new_post":
      return `@${p.fromUsername || who} опубликовал новый пост`;
    case "dm_message":
      return `@${who} прислал сообщение`;
    case "track_rating":
      return p.score != null
        ? `@${who} оценил ваш трек: ${p.score}/10`
        : `@${who} оценил ваш трек`;
    case "king_win": {
      let title = p.releaseTitle;
      if (!title && p.releaseId) {
        const r = db.prepare("SELECT title FROM user_releases WHERE id = ?").get(p.releaseId);
        title = r?.title;
      }
      const player = p.playerUsername || who;
      if (title) {
        return `«${title}» победил в «Царь SoundCloud» — турнир провёл @${player}`;
      }
      return `Ваш трек победил в «Царь SoundCloud» — турнир провёл @${player}`;
    }
    case "tg_import":
      return "Пост из Telegram импортирован на стену";
    default:
      return "Новое уведомление";
  }
}

function getNotificationAction(type, payload, db) {
  const p = payload || {};
  if (type === "dm_message" && p.conversationId) {
    return { section: "messages", conversationId: p.conversationId };
  }
  if (type === "king_win" && p.releaseId) {
    return { section: "myTracks", releaseId: p.releaseId };
  }
  const u = resolveUsername(db, p);
  if (u && u !== "пользователь") return { section: "profile", username: u };
  return { section: "feed" };
}

module.exports = { formatNotificationText, getNotificationAction };
