function getViewCount(db, postId) {
  const row = db.prepare("SELECT COALESCE(view_count, 0) AS c FROM wall_posts WHERE id = ?").get(postId);
  return row?.c ?? 0;
}

/** Уникальный просмотр: один залогиненный пользователь — один раз (не автор поста). */
function recordPostView(db, postId, viewerId) {
  const post = db.prepare("SELECT user_id, status FROM wall_posts WHERE id = ?").get(postId);
  if (!post || post.status !== "published") return null;

  if (!viewerId || post.user_id === viewerId) {
    return { recorded: false, viewCount: getViewCount(db, postId) };
  }

  const ins = db
    .prepare("INSERT OR IGNORE INTO post_views (post_id, user_id, created_at) VALUES (?, ?, ?)")
    .run(postId, viewerId, Date.now());

  if (ins.changes > 0) {
    db.prepare("UPDATE wall_posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?").run(postId);
  }

  return { recorded: ins.changes > 0, viewCount: getViewCount(db, postId) };
}

module.exports = { recordPostView, getViewCount };
