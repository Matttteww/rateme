const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { getDb } = require("./db");
const {
  hashPassword,
  verifyPassword,
  newId,
  sessionExpiryMs,
  SESSION_COOKIE,
  LOGIN_CHANGE_MS,
  validateUsername,
  validateRoles,
  publicUser,
  parseTelegramChannelMeta,
} = require("./authUtil");
const { optionalAuth, requireAuth, requireAdmin, requireStaff } = require("./middleware");
const { createNotification, notifySubscribersNewPost } = require("./notify");
const { pushToUser, broadcastAll } = require("./realtime");
const { formatNotificationText, getNotificationAction } = require("./notifyFormat");
const {
  uploadReleaseAudio,
  uploadOpenverAudio,
  uploadBeatAudio,
  uploadAvatar,
  uploadBanner,
  uploadWallFiles,
  uploadDmFiles,
  relPath,
  mapAudioRow,
} = require("./upload");
const king = require("./king");
const { verifyTelegramLogin } = require("./telegramAuth");
const { applyTelegramProfile } = require("./telegramProfile");
const { requireSyncSecret } = require("./syncAuth");
const { recordPostView } = require("./postViews");

const { getTelegramPublicConfig, TELEGRAM_BOT_TOKEN, ensureTelegramBotInfo } = require("./telegramBot");
const { fetchTelegramChannelInfo, normalizeChannelUsername } = require("./telegramChannel");
const { insertTelegramInbox, publishInboxToWall, mapInboxRow } = require("./telegramInbox");
const {
  fetchPublicChannelMessages,
  importFromPreviewHtml,
  importMessagesToInbox,
} = require("./telegramChannelHistory");
const { enrichInboxMedia } = require("./telegramMedia");

const STREAMER_USERNAME = (process.env.STREAMER_USERNAME || process.env.TWITCH_TOKEN_OWNER_LOGIN || "")
  .trim()
  .toLowerCase();

function multerWrap(mw) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (err) res.status(400).json({ error: err.message || String(err) });
      else next();
    });
  };
}

function mapPost(row, db, viewerId) {
  const author = db.prepare("SELECT id, username, display_name, avatar_path FROM users WHERE id = ?").get(row.user_id);
  const attachments = db
    .prepare("SELECT * FROM wall_attachments WHERE post_id = ? ORDER BY sort_order")
    .all(row.id)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.file_path ? `/uploads/${a.file_path}` : a.url,
    }));
  const likeCount = db.prepare("SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?").get(row.id).c;
  const liked = viewerId
    ? db.prepare("SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?").get(row.id, viewerId)
    : null;
  const commentCount = db.prepare("SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ?").get(row.id).c;
  let repostOf = null;
  if (row.repost_of_id) {
    const orig = db.prepare("SELECT * FROM wall_posts WHERE id = ? AND status = 'published'").get(row.repost_of_id);
    if (orig) {
      const oa = db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(orig.user_id);
      repostOf = {
        id: orig.id,
        body: orig.body,
        author: oa ? { username: oa.username, displayName: oa.display_name || oa.username } : null,
      };
    }
  }
  const now = Date.now();
  return {
    id: row.id,
    userId: row.user_id,
    body: row.body,
    source: row.source,
    repostOfId: row.repost_of_id,
    repostComment: row.repost_comment,
    repostOf,
    editUntil: row.edit_until,
    canEdit: viewerId === row.user_id && now <= row.edit_until,
    isOwner: viewerId === row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: author
      ? {
          id: author.id,
          username: author.username,
          displayName: author.display_name || author.username,
          avatarUrl: author.avatar_path ? `/uploads/${author.avatar_path}` : null,
        }
      : null,
    attachments,
    likeCount,
    liked: Boolean(liked),
    commentCount,
    viewCount: row.view_count ?? 0,
    pinnedAt: row.pinned_at != null ? row.pinned_at : null,
  };
}

function postLikeStats(db, postId, viewerId) {
  const likeCount = db.prepare("SELECT COUNT(*) AS c FROM post_likes WHERE post_id = ?").get(postId).c;
  const liked = viewerId
    ? Boolean(db.prepare("SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?").get(postId, viewerId))
    : false;
  return { likeCount, liked };
}

function mapCommentRow(c) {
  return {
    id: c.id,
    parentId: c.parent_id,
    body: c.body,
    createdAt: c.created_at,
    author: {
      username: c.username,
      displayName: c.display_name || c.username,
      avatarUrl: c.avatar_path ? `/uploads/${c.avatar_path}` : null,
    },
  };
}

function findDmBetween(db, userA, userB) {
  return db
    .prepare(
      `SELECT c.id FROM dm_conversations c
       INNER JOIN dm_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       INNER JOIN dm_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
       WHERE (SELECT COUNT(*) FROM dm_members m WHERE m.conversation_id = c.id) = 2
       LIMIT 1`
    )
    .get(userA, userB);
}

function isDmMember(db, convId, userId) {
  return Boolean(
    db.prepare("SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?").get(convId, userId)
  );
}

function mapDmMessage(db, row, viewerId) {
  const sender = db.prepare("SELECT username, display_name, avatar_path FROM users WHERE id = ?").get(row.sender_id);
  const attachments = db
    .prepare("SELECT * FROM dm_attachments WHERE message_id = ? ORDER BY sort_order")
    .all(row.id)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      url: a.file_path ? `/uploads/${a.file_path}` : a.url,
      mime: a.mime,
    }));
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    senderId: row.sender_id,
    isMine: row.sender_id === viewerId,
    sender: {
      username: sender?.username,
      displayName: sender?.display_name || sender?.username,
      avatarUrl: sender?.avatar_path ? `/uploads/${sender.avatar_path}` : null,
    },
    attachments,
  };
}

function mapDmConversation(db, convId, viewerId) {
  const conv = db.prepare("SELECT * FROM dm_conversations WHERE id = ?").get(convId);
  if (!conv) return null;
  const other = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_path
       FROM dm_members dm JOIN users u ON u.id = dm.user_id
       WHERE dm.conversation_id = ? AND dm.user_id != ?`
    )
    .get(convId, viewerId);
  const lastMsg = db
    .prepare(
      `SELECT m.* FROM dm_messages m WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 1`
    )
    .get(convId);
  const myMember = db
    .prepare("SELECT last_read_at FROM dm_members WHERE conversation_id = ? AND user_id = ?")
    .get(convId, viewerId);
  const lastRead = myMember?.last_read_at || 0;
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS c FROM dm_messages
       WHERE conversation_id = ? AND sender_id != ? AND created_at > ?`
    )
    .get(convId, viewerId, lastRead).c;
  let preview = null;
  if (lastMsg) {
    const from = db.prepare("SELECT username FROM users WHERE id = ?").get(lastMsg.sender_id);
    preview = {
      body: lastMsg.body,
      createdAt: lastMsg.created_at,
      fromUsername: from?.username,
      isMine: lastMsg.sender_id === viewerId,
    };
  }
  return {
    id: conv.id,
    updatedAt: conv.updated_at,
    otherUser: other
      ? {
          id: other.id,
          username: other.username,
          displayName: other.display_name || other.username,
          avatarUrl: other.avatar_path ? `/uploads/${other.avatar_path}` : null,
        }
      : null,
    preview,
    unread,
  };
}

function attachUserSession(res, db, userId, remember = true) {
  const sessionId = newId();
  const exp = sessionExpiryMs(remember);
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    sessionId,
    userId,
    exp,
    now
  );
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: (remember ? 30 : 7) * 24 * 60 * 60 * 1000,
  });
}

function pickTelegramUsername(db, tgUsername, telegramId) {
  if (tgUsername) {
    const vu = validateUsername(tgUsername);
    if (!vu.error && !db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(vu.username)) {
      return vu.username;
    }
  }
  const base = `tg${String(telegramId).slice(-8)}`;
  let candidate = base;
  let n = 0;
  while (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(candidate)) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

function mountPlatformRoutes(app) {
  const router = express.Router();
  router.use(optionalAuth);

  router.get("/config/public", (_req, res) => {
    res.json(getTelegramPublicConfig());
  });

  router.get("/search", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ users: [], releases: [], openvers: [], beats: [] });
    const db = getDb();
    const likePrefix = `${q}%`;
    const likeAny = `%${q}%`;
    const mapUser = (u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      avatarUrl: u.avatar_path ? `/uploads/${u.avatar_path}` : null,
    });
    const users = db
      .prepare(
        `SELECT id, username, display_name, avatar_path FROM users
         WHERE is_banned = 0 AND (username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)
         LIMIT 10`
      )
      .all(likePrefix, likeAny)
      .map(mapUser);
    const releases = db
      .prepare(
        `SELECT r.*, u.username FROM user_releases r
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'published' AND (r.title LIKE ? COLLATE NOCASE OR r.artist_display LIKE ? COLLATE NOCASE)
         ORDER BY r.created_at DESC LIMIT 15`
      )
      .all(likeAny, likeAny)
      .map((r) => ({ ...mapAudioRow(r, "release"), ownerUsername: r.username }));
    const openvers = db
      .prepare(
        `SELECT o.*, u.username FROM openvers o
         JOIN users u ON u.id = o.user_id
         WHERE o.status = 'published' AND (o.title LIKE ? COLLATE NOCASE OR o.artist_display LIKE ? COLLATE NOCASE)
         ORDER BY o.created_at DESC LIMIT 10`
      )
      .all(likeAny, likeAny)
      .map((r) => ({ ...mapAudioRow(r, "openver"), ownerUsername: r.username }));
    const beats = db
      .prepare(
        `SELECT b.*, u.username FROM beats b
         JOIN users u ON u.id = b.user_id
         WHERE b.status = 'published' AND (b.title LIKE ? COLLATE NOCASE OR b.artist_display LIKE ? COLLATE NOCASE)
         ORDER BY b.created_at DESC LIMIT 10`
      )
      .all(likeAny, likeAny)
      .map((r) => ({ ...mapAudioRow(r, "beat"), ownerUsername: r.username }));
    res.json({ users, releases, openvers, beats });
  });

  router.get("/discover", (req, res) => {
    const db = getDb();
    const viewerId = req.user?.id || null;
    const newUsers = db
      .prepare(
        `SELECT id, username, display_name, avatar_path, created_at FROM users
         WHERE is_banned = 0 ORDER BY created_at DESC LIMIT 3`
      )
      .all()
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_path ? `/uploads/${u.avatar_path}` : null,
        createdAt: u.created_at,
      }));
    let topRows = db
      .prepare(
        `SELECT r.*, u.username,
          AVG(rr.score) AS avg_score,
          COUNT(rr.score) AS rating_count
         FROM user_releases r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN release_ratings rr ON rr.release_id = r.id AND rr.skipped = 0 AND rr.score IS NOT NULL
         WHERE r.status = 'published'
         GROUP BY r.id
         HAVING rating_count >= 1
         ORDER BY avg_score DESC
         LIMIT 5`
      )
      .all();
    let topMode = "rated";
    if (topRows.length === 0) {
      topMode = "recent";
      topRows = db
        .prepare(
          `SELECT r.*, u.username, NULL AS avg_score, 0 AS rating_count
           FROM user_releases r
           JOIN users u ON u.id = r.user_id
           WHERE r.status = 'published'
           ORDER BY r.created_at DESC
           LIMIT 5`
        )
        .all();
    }
    const topReleases = topRows.map((r, i) => ({
      rank: i + 1,
      ...mapAudioRow(r, "release"),
      ownerUsername: r.username,
      avgScore: r.avg_score != null ? Math.round(r.avg_score * 100) / 100 : null,
      ratingCount: r.rating_count || 0,
    }));
    const postRows = db
      .prepare(
        `SELECT * FROM wall_posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 5`
      )
      .all();
    const latestReleases = db
      .prepare(
        `SELECT r.*, u.username FROM user_releases r
         JOIN users u ON u.id = r.user_id
         WHERE r.status = 'published'
         ORDER BY r.created_at DESC LIMIT 8`
      )
      .all()
      .map((r) => ({ ...mapAudioRow(r, "release"), ownerUsername: r.username }));

    const freshRows = db
      .prepare(
        `SELECT kind, id, title, artist_display, created_at, is_demo, username FROM (
           SELECT 'release' AS kind, r.id, r.title, r.artist_display, r.created_at, r.is_demo, u.username
           FROM user_releases r
           JOIN users u ON u.id = r.user_id
           WHERE r.status = 'published'
           UNION ALL
           SELECT 'openver', o.id, o.title, o.artist_display, o.created_at, 0, u.username
           FROM openvers o
           JOIN users u ON u.id = o.user_id
           WHERE o.status = 'published'
           UNION ALL
           SELECT 'beat', b.id, b.title, b.artist_display, b.created_at, 0, u.username
           FROM beats b
           JOIN users u ON u.id = b.user_id
           WHERE b.status = 'published'
         )
         ORDER BY created_at DESC
         LIMIT 8`
      )
      .all();
    const latestUploads = freshRows.map((r) => ({
      id: r.id,
      uploadKind: r.kind,
      title: r.title,
      artistDisplay: r.artist_display,
      isDemo: r.kind === "release" ? !!r.is_demo : false,
      createdAt: r.created_at,
      ownerUsername: r.username,
    }));

    res.json({
      newUsers,
      topReleases,
      topMode,
      latestReleases,
      latestUploads,
      recentPosts: postRows.map((p) => mapPost(p, db, viewerId)),
    });
  });

  router.post("/auth/register", async (req, res) => {
    try {
      const vu = validateUsername(req.body?.username);
      if (vu.error) return res.status(400).json({ error: vu.error });
      const password = String(req.body?.password || "");
      if (password.length < 8) return res.status(400).json({ error: "Пароль: минимум 8 символов." });
      const vr = validateRoles(req.body?.roles || []);
      if (vr.error) return res.status(400).json({ error: vr.error });

      const db = getDb();
      if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(vu.username)) {
        return res.status(409).json({ error: "Логин занят." });
      }

      const id = newId();
      const now = Date.now();
      const isStreamer = vu.username.toLowerCase() === STREAMER_USERNAME && STREAMER_USERNAME ? 1 : 0;
      const displayName = String(req.body?.displayName || vu.username).trim() || vu.username;
      const hash = await hashPassword(password);

      db.prepare(
        `INSERT INTO users (id, username, password_hash, display_name, bio, avatar_path, is_banned, is_frozen, staff_role, is_streamer, king_wins, games_played, login_changed_at, password_changed_at, created_at)
         VALUES (?, ?, ?, ?, '', NULL, 0, 0, NULL, ?, 0, 0, ?, ?, ?)`
      ).run(id, vu.username, hash, displayName, isStreamer, now, now, now);

      const insRole = db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)");
      for (const r of vr.roles) insRole.run(id, r);
      if (isStreamer) {
        try {
          insRole.run(id, "streamer");
        } catch {
          /* dup */
        }
      }

      const sessionId = newId();
      const exp = sessionExpiryMs(true);
      db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
        sessionId,
        id,
        exp,
        now
      );

      res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(id).map((x) => x.role);
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      broadcastAll({ type: "discover_changed", uploadKind: "user" });
      res.status(201).json({ user: publicUser(row, roles) });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/auth/login", async (req, res) => {
    try {
      const login = String(req.body?.loginOrEmail || req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      const db = getDb();
      const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(login);
      if (!row || row.is_banned) return res.status(401).json({ error: "Неверный логин или пароль." });
      if (!(await verifyPassword(password, row.password_hash))) {
        return res.status(401).json({ error: "Неверный логин или пароль." });
      }
      if (row.is_frozen) return res.status(403).json({ error: "Аккаунт ограничен." });

      const sessionId = newId();
      const exp = sessionExpiryMs(Boolean(req.body?.remember));
      const now = Date.now();
      db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
        sessionId,
        row.id,
        exp,
        now
      );
      res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: (req.body?.remember ? 30 : 7) * 24 * 60 * 60 * 1000,
      });
      const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(row.id).map((x) => x.role);
      res.json({ user: publicUser(row, roles) });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/auth/logout", (req, res) => {
    const db = getDb();
    const sid = require("./authUtil").parseCookies(req)[SESSION_COOKIE];
    if (sid) db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/auth/me", (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: req.user });
  });

  router.post("/auth/telegram", async (req, res) => {
    try {
      const verified = verifyTelegramLogin(req.body, TELEGRAM_BOT_TOKEN);
      if (!verified.ok) return res.status(400).json({ error: verified.error });

      const db = getDb();
      let row = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(verified.telegramId);
      const now = Date.now();

      if (!row) {
        const username = pickTelegramUsername(db, verified.username, verified.telegramId);
        const displayName = [verified.firstName, verified.lastName].filter(Boolean).join(" ") || username;
        const id = newId();
        const hash = await hashPassword(crypto.randomBytes(24).toString("hex"));
        const isStreamer =
          username.toLowerCase() === STREAMER_USERNAME && STREAMER_USERNAME ? 1 : 0;
        db.prepare(
          `INSERT INTO users (id, username, password_hash, display_name, bio, avatar_path, is_banned, is_frozen, staff_role, is_streamer, king_wins, games_played, login_changed_at, password_changed_at, created_at, telegram_id, telegram_channel, telegram_linked_at)
           VALUES (?, ?, ?, ?, '', NULL, 0, 0, NULL, ?, 0, 0, ?, ?, ?, ?, NULL, ?)`
        ).run(
          id,
          username,
          hash,
          displayName,
          isStreamer,
          now,
          now,
          now,
          verified.telegramId,
          now
        );
        db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)").run(id, "listener");
        if (isStreamer) {
          try {
            db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)").run(id, "streamer");
          } catch {
            /* */
          }
        }
        row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      } else {
        db.prepare("UPDATE users SET telegram_linked_at = ? WHERE id = ?").run(now, row.id);
      }

      await applyTelegramProfile(db, row.id, verified);

      if (row.is_banned) return res.status(403).json({ error: "Аккаунт заблокирован." });
      if (row.is_frozen) return res.status(403).json({ error: "Аккаунт ограничен." });

      attachUserSession(res, db, row.id, true);
      const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(row.id).map((x) => x.role);
      const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
      res.json({ user: publicUser(fresh, roles) });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  function telegramChannelStats(db, userId) {
    const syncedPostsCount =
      db.prepare(
        `SELECT COUNT(*) AS c FROM wall_posts WHERE user_id = ? AND source = 'telegram'`
      ).get(userId)?.c || 0;
    const lastSyncedAt =
      db
        .prepare(
          `SELECT created_at FROM wall_posts WHERE user_id = ? AND source = 'telegram' ORDER BY created_at DESC LIMIT 1`
        )
        .get(userId)?.created_at || null;
    return { syncedPostsCount, lastSyncedAt };
  }

  async function respondTelegramChannel(req, res) {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const botInfo = await ensureTelegramBotInfo();
    const stats = telegramChannelStats(db, req.user.id);
    const channel = row.telegram_channel || null;
    const pendingInbox = db
      .prepare("SELECT COUNT(*) AS c FROM telegram_inbox WHERE user_id = ? AND status = 'pending'")
      .get(req.user.id)?.c || 0;
    res.json({
      channel,
      meta: parseTelegramChannelMeta(row),
      publicLink: channel ? `https://t.me/${channel}` : null,
      syncMode: row.telegram_sync_mode === "auto" ? "auto" : "manual",
      pendingInboxCount: pendingInbox,
      ...stats,
      botConfigured: Boolean(TELEGRAM_BOT_TOKEN),
      botUsername: botInfo.username || null,
      streamerUsername: STREAMER_USERNAME || null,
      isStreamer: Boolean(req.user.isStreamer),
    });
  }

  router.get("/users/me/telegram-channel", requireAuth, respondTelegramChannel);
  router.get("/telegram/my-channel", requireAuth, respondTelegramChannel);

  router.patch("/users/me/telegram-channel", requireAuth, async (req, res) => {
    const raw = normalizeChannelUsername(req.body?.channel);
    if (!raw) return res.status(400).json({ error: "Укажи @username канала." });

    const syncModeRaw = req.body?.syncMode;
    if (syncModeRaw != null && syncModeRaw !== "auto" && syncModeRaw !== "manual") {
      return res.status(400).json({ error: "syncMode: auto или manual." });
    }

    const info = await fetchTelegramChannelInfo(raw);
    if (!info.ok) return res.status(400).json({ error: info.error });

    const db = getDb();
    const prev = db.prepare("SELECT telegram_channel FROM users WHERE id = ?").get(req.user.id);
    if (prev?.telegram_channel && prev.telegram_channel !== raw) {
      db.prepare("DELETE FROM telegram_inbox WHERE user_id = ?").run(req.user.id);
    }
    const now = Date.now();
    const syncMode = syncModeRaw === "auto" ? "auto" : syncModeRaw === "manual" ? "manual" : null;
    if (syncMode) {
      db.prepare(
        "UPDATE users SET telegram_channel = ?, telegram_channel_meta = ?, telegram_linked_at = ?, telegram_sync_mode = ? WHERE id = ?"
      ).run(raw, JSON.stringify(info.meta), now, syncMode, req.user.id);
    } else {
      db.prepare(
        "UPDATE users SET telegram_channel = ?, telegram_channel_meta = ?, telegram_linked_at = ? WHERE id = ?"
      ).run(raw, JSON.stringify(info.meta), now, req.user.id);
    }

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(req.user.id).map((x) => x.role);
    const warnings = [];
    if (!info.meta.botIsAdmin) {
      warnings.push("Добавьте бота администратором канала — иначе посты не попадут во входящие.");
    }
    const pendingInbox = db
      .prepare("SELECT COUNT(*) AS c FROM telegram_inbox WHERE user_id = ? AND status = 'pending'")
      .get(req.user.id)?.c || 0;
    res.json({
      channel: raw,
      meta: info.meta,
      publicLink: info.meta.inviteLink || `https://t.me/${raw}`,
      syncMode: row.telegram_sync_mode === "auto" ? "auto" : "manual",
      pendingInboxCount: pendingInbox,
      user: publicUser(row, roles),
      warnings,
      ...telegramChannelStats(db, req.user.id),
    });
  });

  router.patch("/users/me/telegram-sync-mode", requireAuth, (req, res) => {
    const mode = req.body?.syncMode;
    if (mode !== "auto" && mode !== "manual") {
      return res.status(400).json({ error: "Укажи syncMode: auto или manual." });
    }
    const db = getDb();
    db.prepare("UPDATE users SET telegram_sync_mode = ? WHERE id = ?").run(mode, req.user.id);
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(req.user.id).map((x) => x.role);
    res.json({ syncMode: mode, user: publicUser(row, roles) });
  });

  router.get("/users/me/telegram-inbox", requireAuth, (req, res) => {
    const db = getDb();
    const status = String(req.query.status || "pending");
    const allowed = ["pending", "published", "dismissed", "all"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "status: pending|published|dismissed|all" });
    }
    let rows;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    if (status === "all") {
      rows = db
        .prepare(
          `SELECT * FROM telegram_inbox WHERE user_id = ? ORDER BY CAST(telegram_message_id AS INTEGER) DESC, created_at DESC LIMIT ?`
        )
        .all(req.user.id, limit);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM telegram_inbox WHERE user_id = ? AND status = ? ORDER BY CAST(telegram_message_id AS INTEGER) DESC, created_at DESC LIMIT ?`
        )
        .all(req.user.id, status, limit);
    }
    res.json({ items: rows.map(mapInboxRow) });
  });

  function respondInboxImport(db, userId, limit, stats, source) {
    const pendingInbox =
      db
        .prepare("SELECT COUNT(*) AS c FROM telegram_inbox WHERE user_id = ? AND status = 'pending'")
        .get(userId)?.c || 0;
    return {
      ok: true,
      source,
      ...stats,
      pendingInboxCount: pendingInbox,
      items: db
        .prepare(
          `SELECT * FROM telegram_inbox WHERE user_id = ? ORDER BY CAST(telegram_message_id AS INTEGER) DESC, created_at DESC LIMIT ?`
        )
        .all(userId, limit)
        .map(mapInboxRow),
    };
  }

  /** Не блокируем ответ импорта — иначе клиент «висит» минутами; превью догоняет фоном. */
  function scheduleInboxMediaEnrich(userId, channelUsername, limit) {
    const db = getDb();
    setImmediate(() => {
      enrichInboxMedia(db, userId, channelUsername, {
        limit: Math.min(limit, 48),
        maxMs: 55000,
      }).catch(() => {});
    });
  }

  router.post("/users/me/telegram-inbox/import-history", requireAuth, async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!row?.telegram_channel) {
      return res.status(400).json({ error: "Сначала привяжите канал." });
    }
    const limit = Math.min(80, Math.max(5, Number(req.body?.limit) || 40));
    const fetched = await fetchPublicChannelMessages(row.telegram_channel, { limit, maxPages: 2 });
    if (!fetched.ok) {
      return res.status(400).json({
        error: fetched.error,
        retryViaBrowser: Boolean(fetched.retryViaBrowser),
      });
    }
    const stats = importMessagesToInbox(db, req.user.id, row.telegram_channel, fetched.items);
    const payload = {
      ...respondInboxImport(db, req.user.id, limit, stats, fetched.source || "server"),
      mediaEnriched: 0,
      mediaEnrichScheduled: true,
      details: fetched.details || null,
    };
    res.json(payload);
    scheduleInboxMediaEnrich(req.user.id, row.telegram_channel, limit);
  });

  router.post("/users/me/telegram-inbox/enrich-media", requireAuth, async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!row?.telegram_channel) {
      return res.status(400).json({ error: "Сначала привяжите канал." });
    }
    const limit = Math.min(80, Math.max(5, Number(req.body?.limit) || 50));
    const enrich = await enrichInboxMedia(db, req.user.id, row.telegram_channel, {
      limit: Math.min(limit, 50),
      maxMs: 45000,
    });
    res.json({
      ok: true,
      ...enrich,
      items: db
        .prepare(
          `SELECT * FROM telegram_inbox WHERE user_id = ? ORDER BY CAST(telegram_message_id AS INTEGER) DESC LIMIT ?`
        )
        .all(req.user.id, limit)
        .map(mapInboxRow),
    });
  });

  router.get("/telegram/remote-media", async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url || !isAllowedRemoteMediaUrl(url)) {
      return res.status(400).json({ error: "Недопустимый URL." });
    }
    try {
      const axios = require("axios");
      const upstream = await axios.get(url, {
        responseType: "stream",
        timeout: 90000,
        maxRedirects: 10,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: {
          ...TG_HEADERS,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
          Referer: "https://t.me/",
          Origin: "https://t.me",
        },
      });
      if (upstream.headers["content-type"]) res.setHeader("Content-Type", upstream.headers["content-type"]);
      res.setHeader("Cache-Control", "public, max-age=3600");
      upstream.data.pipe(res);
    } catch (e) {
      res.status(502).json({ error: e.message || String(e) });
    }
  });

  router.post("/users/me/telegram-inbox/import-preview", requireAuth, async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!row?.telegram_channel) {
      return res.status(400).json({ error: "Сначала привяжите канал." });
    }
    const html = req.body?.html;
    if (!html || typeof html !== "string" || html.length < 100) {
      return res.status(400).json({ error: "Нужна HTML-страница канала." });
    }
    const limit = Math.min(80, Math.max(5, Number(req.body?.limit) || 50));
    const stats = importFromPreviewHtml(db, req.user.id, row.telegram_channel, html, limit);
    res.json({
      ...respondInboxImport(db, req.user.id, limit, stats, "browser"),
      mediaEnriched: 0,
      mediaEnrichScheduled: true,
    });
    scheduleInboxMediaEnrich(req.user.id, row.telegram_channel, limit);
  });

  router.post("/users/me/telegram-inbox/:id/publish", requireAuth, (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM telegram_inbox WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: "Пост не найден." });
    if (row.status === "dismissed") {
      return res.status(400).json({ error: "Пост скрыт. Восстановите из Telegram заново." });
    }
    const editBody = req.body?.body != null ? String(req.body.body).trim() : null;
    if (editBody != null) {
      db.prepare("UPDATE telegram_inbox SET body = ? WHERE id = ?").run(editBody, row.id);
      row.body = editBody;
    }
    const result = publishInboxToWall(db, row, req.user.id);
    res.json({
      ok: true,
      duplicate: result.duplicate,
      postId: result.postId,
      item: mapInboxRow(db.prepare("SELECT * FROM telegram_inbox WHERE id = ?").get(row.id)),
    });
  });

  router.post("/users/me/telegram-inbox/:id/dismiss", requireAuth, (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM telegram_inbox WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: "Пост не найден." });
    db.prepare("UPDATE telegram_inbox SET status = 'dismissed' WHERE id = ?").run(row.id);
    res.json({ ok: true, item: mapInboxRow({ ...row, status: "dismissed" }) });
  });

  router.post("/users/me/telegram-channel/refresh", requireAuth, async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!row.telegram_channel) {
      return res.status(400).json({ error: "Сначала укажите канал." });
    }
    const info = await fetchTelegramChannelInfo(row.telegram_channel);
    if (!info.ok) return res.status(400).json({ error: info.error });
    db.prepare("UPDATE users SET telegram_channel_meta = ? WHERE id = ?").run(
      JSON.stringify(info.meta),
      req.user.id
    );
    const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(req.user.id).map((x) => x.role);
    res.json({
      channel: row.telegram_channel,
      meta: info.meta,
      user: publicUser(fresh, roles),
      ...telegramChannelStats(db, req.user.id),
    });
  });

  router.delete("/users/me/telegram-channel", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare("DELETE FROM telegram_inbox WHERE user_id = ?").run(req.user.id);
    db.prepare("UPDATE users SET telegram_channel = NULL, telegram_channel_meta = NULL WHERE id = ?").run(
      req.user.id
    );
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(req.user.id).map((x) => x.role);
    res.json({ user: publicUser(row, roles) });
  });

  router.get("/sync/streamer-config", requireSyncSecret, (req, res) => {
    const login = String(req.query.streamerUsername || STREAMER_USERNAME || "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
    if (!login) {
      return res.status(400).json({ error: "Укажи streamerUsername или STREAMER_USERNAME в .env." });
    }
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_banned = 0")
      .get(login);
    if (!row) return res.status(404).json({ error: "Стример не найден на платформе." });
    const meta = parseTelegramChannelMeta(row);
    res.json({
      streamerUsername: row.username,
      telegramChannel: row.telegram_channel || null,
      telegramChannelUsername: row.telegram_channel ? `@${row.telegram_channel}` : null,
      meta,
      wallPostSyncPath: "/api/sync/wall-post",
      channelInboxSyncPath: "/api/sync/channel-inbox",
      syncMode: row.telegram_sync_mode === "auto" ? "auto" : "manual",
    });
  });

  const {
    normalizeMediaInput,
    resolveMediaList,
    copyMediaToWallAttachments,
    isAllowedRemoteMediaUrl,
    TG_HEADERS,
  } = require("./telegramMedia");

  const handleSyncChannelInbox = async (req, res) => {
    try {
      const db = getDb();
      const streamerLogin = String(
        req.body?.streamerUsername || req.body?.username || STREAMER_USERNAME || ""
      )
        .trim()
        .replace(/^@/, "");
      if (!streamerLogin) {
        return res.status(400).json({ error: "Укажи streamerUsername или STREAMER_USERNAME в .env." });
      }
      const streamer = db
        .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_banned = 0")
        .get(streamerLogin);
      if (!streamer) return res.status(404).json({ error: "Стример не найден на платформе." });

      const body = String(req.body?.body || req.body?.text || "").trim();
      const tgMsgId = req.body?.telegramMessageId != null ? String(req.body.telegramMessageId) : null;
      const hasMedia = Boolean(req.body?.hasMedia);
      let media = normalizeMediaInput(req.body?.media);
      if (media.some((m) => m.telegramFileId)) {
        media = await resolveMediaList(media);
      }
      const hasMediaResolved = hasMedia || media.length > 0;
      if (!body && !hasMediaResolved) return res.status(400).json({ error: "Пустой пост." });
      if (!tgMsgId) return res.status(400).json({ error: "Нужен telegramMessageId." });

      const channelUsername = streamer.telegram_channel || streamerLogin;
      const syncMode = streamer.telegram_sync_mode === "auto" ? "auto" : "manual";

      if (syncMode === "auto") {
        const existing = db
          .prepare("SELECT id FROM wall_posts WHERE telegram_message_id = ? AND user_id = ?")
          .get(tgMsgId, streamer.id);
        if (existing) {
          return res.json({ ok: true, duplicate: true, postId: existing.id, mode: "auto" });
        }
        const now = Date.now();
        const id = newId();
        const editUntil = now + 24 * 60 * 60 * 1000;
        db.prepare(
          `INSERT INTO wall_posts (id, user_id, body, source, telegram_message_id, repost_of_id, repost_comment, status, created_at, updated_at, edit_until)
           VALUES (?, ?, ?, 'telegram', ?, NULL, NULL, 'published', ?, ?, ?)`
        ).run(id, streamer.id, body, tgMsgId, now, now, editUntil);
        copyMediaToWallAttachments(db, id, media);
        notifySubscribersNewPost(streamer.id, id);
        return res.status(201).json({ ok: true, postId: id, duplicate: false, mode: "auto" });
      }

      const inbox = insertTelegramInbox(db, streamer.id, {
        telegramMessageId: tgMsgId,
        body: body || "",
        hasMedia: hasMediaResolved,
        media,
        channelUsername,
      });
      return res.status(inbox.duplicate ? 200 : 201).json({
        ok: true,
        mode: "manual",
        inboxId: inbox.id,
        duplicate: inbox.duplicate,
        status: inbox.status,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  };

  router.post("/sync/channel-inbox", requireSyncSecret, handleSyncChannelInbox);

  router.post(
    "/telegram/import-wall",
    requireAuth,
    multerWrap(uploadWallFiles),
    (req, res) => {
      try {
        if (!req.user.isStreamer) {
          return res.status(403).json({ error: "Импорт доступен только стримеру." });
        }
        const body = String(req.body?.body || "").trim();
        const tgMsgId = req.body?.telegramMessageId ? String(req.body.telegramMessageId).trim() : null;
        if (!body && (!req.files || !req.files.length)) {
          return res.status(400).json({ error: "Нужен текст или вложение." });
        }
        const db = getDb();
        const now = Date.now();
        const id = newId();
        const editUntil = now + 24 * 60 * 60 * 1000;
        db.prepare(
          `INSERT INTO wall_posts (id, user_id, body, source, telegram_message_id, repost_of_id, repost_comment, status, created_at, updated_at, edit_until)
           VALUES (?, ?, ?, 'telegram', ?, NULL, NULL, 'published', ?, ?, ?)`
        ).run(id, req.user.id, body, tgMsgId, now, now, editUntil);

        if (req.files?.length) {
          const ins = db.prepare(
            `INSERT INTO wall_attachments (id, post_id, kind, file_path, url, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
          );
          req.files.forEach((f, i) => {
            const kind = /^image\//.test(f.mimetype) ? "image" : /^video\//.test(f.mimetype) ? "video" : "file";
            ins.run(newId(), id, kind, relPath(f.path), null, i);
          });
        }

        notifySubscribersNewPost(req.user.id, id);
        createNotification(req.user.id, "tg_import", { postId: id });
        const row = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(id);
        res.status(201).json({ post: mapPost(row, db, req.user.id) });
      } catch (e) {
        res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  router.get("/users/search", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ users: [] });
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, display_name, avatar_path FROM users
         WHERE username LIKE ? AND is_banned = 0
         ORDER BY username LIMIT 15`
      )
      .all(`${q}%`);
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_path ? `/uploads/${u.avatar_path}` : null,
      })),
    });
  });

  router.get("/users/:username", (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(req.params.username);
    if (!row || row.is_banned) return res.status(404).json({ error: "Не найден." });
    const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(row.id).map((x) => x.role);
    const followerCount = db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE following_id = ?").get(row.id).c;
    const followingCount = db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE follower_id = ?").get(row.id).c;
    let subscribed = false;
    if (req.user && req.user.id !== row.id) {
      subscribed = Boolean(
        db.prepare("SELECT 1 FROM subscriptions WHERE follower_id = ? AND following_id = ?").get(req.user.id, row.id)
      );
    }
    res.json({
      user: publicUser(row, roles),
      followerCount,
      followingCount,
      subscribed,
    });
  });

  router.patch("/users/me", requireAuth, async (req, res) => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const now = Date.now();

      if (req.body?.username != null) {
        const vu = validateUsername(req.body.username);
        if (vu.error) return res.status(400).json({ error: vu.error });
        if (vu.username.toLowerCase() !== row.username.toLowerCase()) {
          if (row.login_changed_at && now - row.login_changed_at < LOGIN_CHANGE_MS) {
            return res.status(429).json({ error: "Логин можно менять не чаще раза в 7 дней." });
          }
          if (db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(vu.username)) {
            return res.status(409).json({ error: "Логин занят." });
          }
          db.prepare("UPDATE users SET username = ?, login_changed_at = ? WHERE id = ?").run(
            vu.username,
            now,
            req.user.id
          );
        }
      }
      if (req.body?.displayName != null) {
        db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(String(req.body.displayName).trim(), req.user.id);
      }
      if (req.body?.bio != null) {
        db.prepare("UPDATE users SET bio = ? WHERE id = ?").run(String(req.body.bio).slice(0, 500), req.user.id);
      }
      if (Array.isArray(req.body?.roles)) {
        const vr = validateRoles(req.body.roles);
        if (vr.error) return res.status(400).json({ error: vr.error });
        db.prepare("DELETE FROM user_roles WHERE user_id = ? AND role != 'streamer'").run(req.user.id);
        const ins = db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, ?)");
        for (const r of vr.roles) {
          try {
            ins.run(req.user.id, r);
          } catch {
            /* */
          }
        }
      }
      const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(req.user.id).map((x) => x.role);
      res.json({ user: publicUser(updated, roles) });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/users/me/link-password", requireAuth, async (req, res) => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const next = String(req.body?.newPassword || "");
      if (next.length < 8) return res.status(400).json({ error: "Пароль: минимум 8 символов." });
      const hash = await hashPassword(next);
      const now = Date.now();
      db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(
        hash,
        now,
        req.user.id
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/users/me/password", requireAuth, async (req, res) => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
      const now = Date.now();
      if (row.password_changed_at && now - row.password_changed_at < LOGIN_CHANGE_MS) {
        return res.status(429).json({ error: "Пароль можно менять не чаще раза в 7 дней." });
      }
      const cur = String(req.body?.currentPassword || "");
      const next = String(req.body?.newPassword || "");
      if (next.length < 8) return res.status(400).json({ error: "Новый пароль: минимум 8 символов." });
      if (!(await verifyPassword(cur, row.password_hash))) {
        return res.status(401).json({ error: "Неверный текущий пароль." });
      }
      const hash = await hashPassword(next);
      db.prepare("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(hash, now, req.user.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/users/me/avatar", requireAuth, multerWrap(uploadAvatar), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Нет файла." });
    const db = getDb();
    const rel = relPath(req.file.path);
    db.prepare("UPDATE users SET avatar_path = ? WHERE id = ?").run(rel, req.user.id);
    res.json({ avatarUrl: `/uploads/${rel}` });
  });

  router.post("/users/me/banner", requireAuth, multerWrap(uploadBanner), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Нет файла." });
    const db = getDb();
    const rel = relPath(req.file.path);
    db.prepare("UPDATE users SET banner_path = ? WHERE id = ?").run(rel, req.user.id);
    res.json({ bannerUrl: `/uploads/${rel}` });
  });

  router.post("/subscriptions/:username", requireAuth, (req, res) => {
    const db = getDb();
    const target = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(req.params.username);
    if (!target) return res.status(404).json({ error: "Не найден." });
    if (target.id === req.user.id) return res.status(400).json({ error: "Нельзя подписаться на себя." });
    try {
      db.prepare("INSERT INTO subscriptions (follower_id, following_id, created_at) VALUES (?, ?, ?)").run(
        req.user.id,
        target.id,
        Date.now()
      );
    } catch {
      /* already */
    }
    res.json({ ok: true, subscribed: true });
  });

  router.delete("/subscriptions/:username", requireAuth, (req, res) => {
    const db = getDb();
    const target = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(req.params.username);
    if (!target) return res.status(404).json({ error: "Не найден." });
    db.prepare("DELETE FROM subscriptions WHERE follower_id = ? AND following_id = ?").run(req.user.id, target.id);
    res.json({ ok: true, subscribed: false });
  });

  function releaseStats(db, releaseId) {
    const playRow = db.prepare("SELECT play_count FROM user_releases WHERE id = ?").get(releaseId);
    const agg = db
      .prepare(
        `SELECT
          COUNT(CASE WHEN skipped = 0 AND score IS NOT NULL THEN 1 END) AS rating_count,
          AVG(CASE WHEN skipped = 0 AND score IS NOT NULL THEN score END) AS avg_score,
          SUM(CASE WHEN skipped = 0 AND score >= 7 THEN 1 ELSE 0 END) AS like_count,
          SUM(CASE WHEN skipped = 0 AND score IS NOT NULL AND score <= 4 THEN 1 ELSE 0 END) AS dislike_count,
          SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END) AS skip_count
         FROM release_ratings WHERE release_id = ?`
      )
      .get(releaseId);
    const kingRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM king_sessions
         WHERE champion_release_id = ? AND status = 'completed'`
      )
      .get(releaseId);
    return {
      playCount: playRow?.play_count || 0,
      ratingCount: agg?.rating_count || 0,
      avgScore: agg?.avg_score != null ? Math.round(Number(agg.avg_score) * 100) / 100 : null,
      likeCount: agg?.like_count || 0,
      dislikeCount: agg?.dislike_count || 0,
      skipCount: agg?.skip_count || 0,
      kingWinCount: kingRow?.c || 0,
    };
  }

  function mapReleaseWithStats(db, row, extra = {}) {
    return { ...mapAudioRow(row, "release"), ...releaseStats(db, row.id), ...extra };
  }

  function beatStats(db, beatId) {
    const playRow = db.prepare("SELECT play_count FROM beats WHERE id = ?").get(beatId);
    const agg = db
      .prepare(
        `SELECT
          COUNT(CASE WHEN skipped = 0 AND score IS NOT NULL THEN 1 END) AS rating_count,
          AVG(CASE WHEN skipped = 0 AND score IS NOT NULL THEN score END) AS avg_score,
          SUM(CASE WHEN skipped = 0 AND score >= 7 THEN 1 ELSE 0 END) AS like_count,
          SUM(CASE WHEN skipped = 0 AND score IS NOT NULL AND score <= 4 THEN 1 ELSE 0 END) AS dislike_count,
          SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END) AS skip_count
         FROM beat_ratings WHERE beat_id = ?`
      )
      .get(beatId);
    return {
      playCount: playRow?.play_count || 0,
      ratingCount: agg?.rating_count || 0,
      avgScore: agg?.avg_score != null ? Math.round(Number(agg.avg_score) * 100) / 100 : null,
      likeCount: agg?.like_count || 0,
      dislikeCount: agg?.dislike_count || 0,
      skipCount: agg?.skip_count || 0,
    };
  }

  function mapBeatWithStats(db, row, extra = {}) {
    return { ...mapAudioRow(row, "beat"), ...beatStats(db, row.id), ...extra };
  }

  function openverStats(db, openverId, viewerId) {
    const playRow = db.prepare("SELECT play_count FROM openvers WHERE id = ?").get(openverId);
    const likeCount = db.prepare("SELECT COUNT(*) AS c FROM openver_likes WHERE openver_id = ?").get(openverId).c;
    const liked = viewerId
      ? Boolean(
          db.prepare("SELECT 1 FROM openver_likes WHERE openver_id = ? AND user_id = ?").get(openverId, viewerId)
        )
      : false;
    return {
      playCount: playRow?.play_count || 0,
      likeCount,
      liked,
    };
  }

  function mapOpenverWithStats(db, row, extra = {}) {
    const viewerId = extra.viewerId;
    const { viewerId: _drop, ...rest } = extra;
    return { ...mapAudioRow(row, "openver"), ...openverStats(db, row.id, viewerId), ...rest };
  }

  function createAudioRelease(table, uploadMw) {
    return [
      requireAuth,
      multerWrap(uploadMw),
      (req, res) => {
        try {
          const title = String(req.body?.title || "").trim();
          let artist = String(req.body?.artistDisplay || req.body?.artist || "").trim();
          if (!title) return res.status(400).json({ error: "Укажи название." });

          let audioKind = null;
          let filePath = null;
          let url = null;
          if (req.file) {
            audioKind = "file";
            filePath = relPath(req.file.path);
          } else if (req.body?.yandexUrl || req.body?.audioUrl) {
            audioKind = "yandex";
            url = String(req.body.yandexUrl || req.body.audioUrl).trim();
          } else {
            return res.status(400).json({ error: "Загрузи mp3/wav или укажи ссылку Яндекс.Диск." });
          }

          const id = newId();
          const now = Date.now();
          const db = getDb();
          const isDemo =
            table === "user_releases" &&
            (req.body?.isDemo === "1" ||
              req.body?.isDemo === "true" ||
              req.body?.isDemo === true ||
              req.body?.isDemo === "on");
          if (table === "user_releases") {
            const owner = db
              .prepare("SELECT display_name, username FROM users WHERE id = ?")
              .get(req.user.id);
            artist = String(owner?.display_name || owner?.username || "").trim();
            if (!artist) return res.status(400).json({ error: "Заполни ник в профиле." });
            const dup = db
              .prepare(
                `SELECT id FROM user_releases
                 WHERE user_id = ? AND status = 'published' AND lower(trim(title)) = lower(trim(?))`
              )
              .get(req.user.id, title);
            if (dup) {
              return res.status(400).json({ error: "У вас уже есть трек с таким названием." });
            }
            db.prepare(
              `INSERT INTO user_releases (id, user_id, title, artist_display, audio_kind, audio_file_path, audio_url, status, is_demo, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`
            ).run(id, req.user.id, title, artist, audioKind, filePath, url, isDemo ? 1 : 0, now);
          } else if (table === "beats") {
            const owner = db
              .prepare("SELECT display_name, username FROM users WHERE id = ?")
              .get(req.user.id);
            artist = String(owner?.display_name || owner?.username || "").trim();
            if (!artist) return res.status(400).json({ error: "Заполни ник в профиле." });
            const bpm = Number(req.body?.bpm);
            const beatKey = String(req.body?.beatKey || req.body?.key || "").trim();
            const tonality = String(req.body?.tonality || req.body?.beatScale || "").trim();
            const tags = String(req.body?.tags || "")
              .trim()
              .slice(0, 240);
            if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) {
              return res.status(400).json({ error: "Укажи BPM (40–300)." });
            }
            if (!beatKey) return res.status(400).json({ error: "Укажи key (тональность)." });
            if (!tonality) return res.status(400).json({ error: "Укажи лад (мажор или минор)." });
            db.prepare(
              `INSERT INTO beats (id, user_id, title, artist_display, audio_kind, audio_file_path, audio_url, status, beat_bpm, beat_key, beat_scale, beat_tags, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`
            ).run(
              id,
              req.user.id,
              title,
              artist,
              audioKind,
              filePath,
              url,
              Math.round(bpm),
              beatKey,
              tonality,
              tags || null,
              now
            );
          } else {
            if (!artist) return res.status(400).json({ error: "Укажи исполнителя." });
            db.prepare(
              `INSERT INTO ${table} (id, user_id, title, artist_display, audio_kind, audio_file_path, audio_url, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)`
            ).run(id, req.user.id, title, artist, audioKind, filePath, url, now);
          }
          const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
          const uploadKind =
            table === "user_releases" ? "release" : table === "openvers" ? "openver" : "beat";
          broadcastAll({ type: "discover_changed", uploadKind });
          res.status(201).json({ item: mapAudioRow(row, table === "user_releases" ? "release" : table.slice(0, -1)) });
        } catch (e) {
          res.status(500).json({ error: e.message || String(e) });
        }
      },
    ];
  }

  router.get("/releases/mine", requireAuth, (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.* FROM user_releases r WHERE r.user_id = ? AND r.status = 'published' ORDER BY r.created_at DESC`
      )
      .all(req.user.id);
    const items = rows.map((r) => mapReleaseWithStats(db, r, { ownerUsername: req.user.username }));
    res.json({ items });
  });

  router.get("/users/:username/releases", (req, res) => {
    const db = getDb();
    const user = db
      .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
      .get(req.params.username);
    if (!user) return res.status(404).json({ error: "Не найден." });
    const rows = db
      .prepare(
        `SELECT r.* FROM user_releases r
         WHERE r.user_id = ? AND r.status = 'published' ORDER BY r.created_at DESC`
      )
      .all(user.id);
    const items = rows.map((r) => mapReleaseWithStats(db, r, { ownerUsername: user.username }));
    res.json({ items });
  });

  router.get("/users/:username/openvers", (req, res) => {
    const db = getDb();
    const user = db
      .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
      .get(req.params.username);
    if (!user) return res.status(404).json({ error: "Не найден." });
    const rows = db
      .prepare(
        `SELECT o.* FROM openvers o
         WHERE o.user_id = ? AND o.status = 'published' ORDER BY o.created_at DESC`
      )
      .all(user.id);
    const items = rows.map((r) => mapOpenverWithStats(db, r, { ownerUsername: user.username }));
    res.json({ items });
  });

  router.get("/users/:username/beats", (req, res) => {
    const db = getDb();
    const user = db
      .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
      .get(req.params.username);
    if (!user) return res.status(404).json({ error: "Не найден." });
    const rows = db
      .prepare(
        `SELECT b.* FROM beats b
         WHERE b.user_id = ? AND b.status = 'published' ORDER BY b.created_at DESC`
      )
      .all(user.id);
    const items = rows.map((r) => mapBeatWithStats(db, r, { ownerUsername: user.username }));
    res.json({ items });
  });

  router.post("/releases/:id/play", optionalAuth, (req, res) => {
    const db = getDb();
    const rel = db
      .prepare("SELECT id FROM user_releases WHERE id = ? AND status = 'published'")
      .get(req.params.id);
    if (!rel) return res.status(404).json({ error: "Не найден." });
    db.prepare("UPDATE user_releases SET play_count = play_count + 1 WHERE id = ?").run(req.params.id);
    const playCount = db.prepare("SELECT play_count FROM user_releases WHERE id = ?").get(req.params.id).play_count;
    res.json({ playCount });
  });

  router.get("/releases", (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.*, u.username FROM user_releases r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'published' ORDER BY r.created_at DESC LIMIT 100`
      )
      .all();
    res.json({ items: rows.map((r) => ({ ...mapAudioRow(r, "release"), ownerUsername: r.username })) });
  });

  router.post("/releases", ...createAudioRelease("user_releases", uploadReleaseAudio));

  router.get("/openvers", (req, res) => {
    const db = getDb();
    const q = String(req.query.q || "").trim().toLowerCase();
    const viewerId = req.user?.id || null;
    let sql = `SELECT o.*, u.username FROM openvers o JOIN users u ON u.id = o.user_id WHERE o.status = 'published'`;
    const params = [];
    if (q) {
      const like = `%${q}%`;
      sql += ` AND (lower(o.title) LIKE ? OR lower(o.artist_display) LIKE ? OR lower(u.username) LIKE ?)`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY o.created_at DESC LIMIT 120`;
    const rows = db.prepare(sql).all(...params);
    res.json({
      items: rows.map((r) =>
        mapOpenverWithStats(db, r, { ownerUsername: r.username, viewerId })
      ),
    });
  });

  router.post("/openvers", ...createAudioRelease("openvers", uploadOpenverAudio));

  router.get("/openvers/mine", requireAuth, (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT o.* FROM openvers o WHERE o.user_id = ? AND o.status = 'published' ORDER BY o.created_at DESC`
      )
      .all(req.user.id);
    const items = rows.map((r) =>
      mapOpenverWithStats(db, r, { ownerUsername: req.user.username, viewerId: req.user.id })
    );
    res.json({ items });
  });

  router.post("/openvers/:id/play", optionalAuth, (req, res) => {
    const db = getDb();
    const rel = db.prepare("SELECT id FROM openvers WHERE id = ? AND status = 'published'").get(req.params.id);
    if (!rel) return res.status(404).json({ error: "Не найден." });
    db.prepare("UPDATE openvers SET play_count = play_count + 1 WHERE id = ?").run(req.params.id);
    const playCount = db.prepare("SELECT play_count FROM openvers WHERE id = ?").get(req.params.id).play_count;
    res.json({ playCount });
  });

  router.post("/openvers/:id/like", requireAuth, (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT id, user_id FROM openvers WHERE id = ? AND status = 'published'")
      .get(req.params.id);
    if (!row) return res.status(404).json({ error: "Не найден." });
    try {
      db.prepare("INSERT INTO openver_likes (openver_id, user_id, created_at) VALUES (?, ?, ?)").run(
        req.params.id,
        req.user.id,
        Date.now()
      );
      if (row.user_id !== req.user.id) {
        createNotification(row.user_id, "openver_like", {
          openverId: req.params.id,
          fromUserId: req.user.id,
          fromUsername: req.user.username,
        });
      }
    } catch {
      /* already liked */
    }
    res.json({ ok: true, ...openverStats(db, req.params.id, req.user.id) });
  });

  router.delete("/openvers/:id/like", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare("DELETE FROM openver_likes WHERE openver_id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ ok: true, ...openverStats(db, req.params.id, req.user.id) });
  });

  router.get("/beats/tags", (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(`SELECT beat_tags FROM beats WHERE status = 'published' AND beat_tags IS NOT NULL AND trim(beat_tags) != ''`)
      .all();
    const set = new Set();
    for (const r of rows) {
      String(r.beat_tags)
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .forEach((t) => set.add(t));
    }
    res.json({ tags: [...set].sort((a, b) => a.localeCompare(b, "ru")) });
  });

  router.get("/beats", (req, res) => {
    const db = getDb();
    const q = String(req.query.q || "").trim().toLowerCase();
    const tag = String(req.query.tag || "").trim().toLowerCase();
    const key = String(req.query.key || "").trim();
    const tonality = String(req.query.tonality || "").trim();
    const bpmMin = req.query.bpmMin != null && req.query.bpmMin !== "" ? Number(req.query.bpmMin) : null;
    const bpmMax = req.query.bpmMax != null && req.query.bpmMax !== "" ? Number(req.query.bpmMax) : null;

    let sql = `SELECT b.*, u.username FROM beats b JOIN users u ON u.id = b.user_id WHERE b.status = 'published'`;
    const params = [];
    if (q) {
      const like = `%${q}%`;
      sql += ` AND (lower(b.title) LIKE ? OR lower(b.artist_display) LIKE ? OR lower(COALESCE(b.beat_tags,'')) LIKE ?)`;
      params.push(like, like, like);
    }
    if (tag) {
      sql += ` AND lower(',' || COALESCE(b.beat_tags,'') || ',') LIKE ?`;
      params.push(`%,${tag},%`);
    }
    if (key) {
      sql += ` AND b.beat_key = ?`;
      params.push(key);
    }
    if (tonality) {
      sql += ` AND b.beat_scale = ?`;
      params.push(tonality);
    }
    if (bpmMin != null && Number.isFinite(bpmMin)) {
      sql += ` AND b.beat_bpm >= ?`;
      params.push(Math.round(bpmMin));
    }
    if (bpmMax != null && Number.isFinite(bpmMax)) {
      sql += ` AND b.beat_bpm <= ?`;
      params.push(Math.round(bpmMax));
    }
    sql += ` ORDER BY b.created_at DESC LIMIT 120`;
    const rows = db.prepare(sql).all(...params);
    res.json({ items: rows.map((r) => ({ ...mapAudioRow(r, "beat"), ownerUsername: r.username })) });
  });

  router.post("/beats", ...createAudioRelease("beats", uploadBeatAudio));

  router.get("/beats/mine", requireAuth, (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT b.* FROM beats b WHERE b.user_id = ? AND b.status = 'published' ORDER BY b.created_at DESC`
      )
      .all(req.user.id);
    const items = rows.map((r) => mapBeatWithStats(db, r, { ownerUsername: req.user.username }));
    res.json({ items });
  });

  router.post("/beats/:id/play", optionalAuth, (req, res) => {
    const db = getDb();
    const rel = db.prepare("SELECT id FROM beats WHERE id = ? AND status = 'published'").get(req.params.id);
    if (!rel) return res.status(404).json({ error: "Не найден." });
    db.prepare("UPDATE beats SET play_count = play_count + 1 WHERE id = ?").run(req.params.id);
    const playCount = db.prepare("SELECT play_count FROM beats WHERE id = ?").get(req.params.id).play_count;
    res.json({ playCount });
  });

  router.get("/releases/top", (req, res) => {
    const minRaw = Number(req.query.minRatings);
    const minRatings = Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : 1;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10) : 10;
    const db = getDb();
    let rows = db
      .prepare(
        `SELECT r.*, u.username,
          AVG(CASE WHEN rr.skipped = 0 AND rr.score IS NOT NULL THEN rr.score END) AS avg_score,
          COUNT(CASE WHEN rr.skipped = 0 AND rr.score IS NOT NULL THEN 1 END) AS rating_count,
          SUM(CASE WHEN rr.skipped = 0 AND rr.score >= 7 THEN 1 ELSE 0 END) AS like_count,
          SUM(CASE WHEN rr.skipped = 0 AND rr.score IS NOT NULL AND rr.score <= 4 THEN 1 ELSE 0 END) AS dislike_count,
          (
            SELECT score FROM release_ratings lr
            WHERE lr.release_id = r.id AND lr.skipped = 0 AND lr.score IS NOT NULL
            ORDER BY lr.created_at DESC LIMIT 1
          ) AS last_score
         FROM user_releases r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN release_ratings rr ON rr.release_id = r.id
         WHERE r.status = 'published'
         GROUP BY r.id
         HAVING rating_count >= ?
         ORDER BY avg_score DESC, rating_count DESC
         LIMIT ?`
      )
      .all(minRatings, limit);
    let mode = "rated";
    if (rows.length === 0) {
      mode = "recent";
      rows = db
        .prepare(
          `SELECT r.*, u.username, NULL AS avg_score, 0 AS rating_count,
            0 AS like_count, 0 AS dislike_count, NULL AS last_score
           FROM user_releases r
           JOIN users u ON u.id = r.user_id
           WHERE r.status = 'published'
           ORDER BY r.created_at DESC
           LIMIT ?`
        )
        .all(limit);
    }
    res.json({
      mode,
      items: rows.map((r, i) => ({
        rank: i + 1,
        ...mapAudioRow(r, "release"),
        ownerUsername: r.username,
        avgScore: r.avg_score != null ? Math.round(r.avg_score * 100) / 100 : null,
        ratingCount: r.rating_count || 0,
        likeCount: r.like_count || 0,
        dislikeCount: r.dislike_count || 0,
        lastScore: r.last_score != null ? r.last_score : null,
      })),
    });
  });

  router.get("/top/artists", (req, res) => {
    const minRaw = Number(req.query.minRatings);
    const minRatings = Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : 2;
    const db = getDb();
    let rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_path,
          AVG(rr.score) AS avg_score,
          COUNT(DISTINCT r.id) AS rated_tracks_count,
          COUNT(rr.id) AS total_ratings
         FROM users u
         JOIN user_releases r ON r.user_id = u.id AND r.status = 'published'
         JOIN release_ratings rr ON rr.release_id = r.id AND rr.skipped = 0 AND rr.score IS NOT NULL
         WHERE u.is_banned = 0
         GROUP BY u.id
         HAVING total_ratings >= ?
         ORDER BY avg_score DESC, total_ratings DESC
         LIMIT 50`
      )
      .all(minRatings);
    let mode = "rated";
    if (rows.length === 0) {
      mode = "releases";
      rows = db
        .prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_path,
            NULL AS avg_score,
            COUNT(r.id) AS rated_tracks_count,
            0 AS total_ratings
           FROM users u
           JOIN user_releases r ON r.user_id = u.id AND r.status = 'published'
           WHERE u.is_banned = 0
           GROUP BY u.id
           HAVING rated_tracks_count >= 1
           ORDER BY rated_tracks_count DESC, u.created_at DESC
           LIMIT 50`
        )
        .all();
    }
    res.json({
      mode,
      items: rows.map((r, i) => ({
        rank: i + 1,
        userId: r.id,
        username: r.username,
        displayName: r.display_name || r.username,
        avatarUrl: r.avatar_path ? `/uploads/${r.avatar_path}` : null,
        avgScore: r.avg_score != null ? Math.round(r.avg_score * 100) / 100 : null,
        ratedTracksCount: r.rated_tracks_count || 0,
        totalRatings: r.total_ratings || 0,
      })),
    });
  });

  router.get("/rate-tracks/next", requireAuth, (req, res) => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT r.* FROM user_releases r
         WHERE r.status = 'published' AND r.user_id != ?
         AND r.id NOT IN (SELECT release_id FROM release_ratings WHERE user_id = ?)
         AND (r.audio_kind = 'file' AND r.audio_file_path IS NOT NULL OR r.audio_kind = 'yandex' AND r.audio_url IS NOT NULL)
         ORDER BY RANDOM() LIMIT 1`
      )
      .get(req.user.id, req.user.id);
    if (!row) return res.json({ item: null });
    const owner = db.prepare("SELECT username FROM users WHERE id = ?").get(row.user_id);
    res.json({ item: { ...mapAudioRow(row, "release"), ownerUsername: owner?.username } });
  });

  router.post("/rate-tracks/rate", requireAuth, (req, res) => {
    const releaseId = String(req.body?.releaseId || "").trim();
    const skip = Boolean(req.body?.skip);
    const score = req.body?.score != null ? Number(req.body.score) : null;
    const commentRaw = req.body?.comment != null ? String(req.body.comment).trim() : "";
    const comment = commentRaw ? commentRaw.slice(0, 500) : null;
    if (!releaseId) return res.status(400).json({ error: "Нужен releaseId." });
    const db = getDb();
    const rel = db.prepare("SELECT * FROM user_releases WHERE id = ?").get(releaseId);
    if (!rel) return res.status(404).json({ error: "Трек не найден." });
    if (!skip) {
      if (!Number.isInteger(score) || score < 0 || score > 10) {
        return res.status(400).json({ error: "Оценка 0–10." });
      }
    }
    if (skip && comment) return res.status(400).json({ error: "Комментарий только с оценкой." });
    try {
      db.prepare(
        `INSERT INTO release_ratings (id, release_id, user_id, score, skipped, comment_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newId(), releaseId, req.user.id, skip ? null : score, skip ? 1 : 0, comment, Date.now());
    } catch {
      return res.status(409).json({ error: "Уже оценён." });
    }
    if (!skip && rel.user_id !== req.user.id) {
      createNotification(rel.user_id, "track_rating", {
        releaseId,
        fromUserId: req.user.id,
        fromUsername: req.user.username,
        score,
      });
    }
    res.json({ ok: true });
  });

  router.get("/releases/:id/ratings", (req, res) => {
    const db = getDb();
    const rel = db.prepare("SELECT user_id FROM user_releases WHERE id = ?").get(req.params.id);
    if (!rel) return res.status(404).json({ error: "Не найден." });
    if (!req.user || req.user.id !== rel.user_id) {
      return res.status(403).json({ error: "Только автор видит оценки." });
    }
    const rows = db
      .prepare(
        `SELECT rr.*, u.username, u.display_name FROM release_ratings rr
         JOIN users u ON u.id = rr.user_id
         WHERE rr.release_id = ?
         ORDER BY rr.created_at DESC`
      )
      .all(req.params.id);
    res.json({
      ratings: rows.map((r) => {
        const skipped = !!r.skipped;
        const score = skipped ? null : r.score;
        let kind = "skip";
        if (!skipped) {
          if (score >= 7) kind = "like";
          else if (score <= 4) kind = "dislike";
          else kind = "score";
        }
        return {
          score,
          skipped,
          kind,
          at: r.created_at,
          user: { id: r.user_id, username: r.username, displayName: r.display_name || r.username },
        };
      }),
    });
  });

  router.get("/feed", (req, res) => {
    const cursor = Number(req.query.cursor) || 0;
    const limit = Math.min(30, Number(req.query.limit) || 20);
    const mode = String(req.query.mode || "all");
    const db = getDb();
    const before = cursor || Date.now() + 1;
    let rows;
    if (mode === "following") {
      if (!req.user) {
        return res.json({ posts: [], nextCursor: null, requiresAuth: true });
      }
      rows = db
        .prepare(
          `SELECT p.* FROM wall_posts p
           INNER JOIN subscriptions s ON s.following_id = p.user_id AND s.follower_id = ?
           WHERE p.status = 'published' AND p.created_at < ?
           ORDER BY p.created_at DESC LIMIT ?`
        )
        .all(req.user.id, before, limit);
    } else {
      rows = db
        .prepare(
          `SELECT * FROM wall_posts WHERE status = 'published' AND created_at < ?
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(before, limit);
    }
    const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
    res.json({
      posts: rows.map((p) => mapPost(p, db, req.user?.id)),
      nextCursor,
    });
  });

  router.post("/sync/wall-post", requireSyncSecret, handleSyncChannelInbox);

  router.get("/users/:username/followers", (req, res) => {
    const db = getDb();
    const u = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(req.params.username);
    if (!u) return res.status(404).json({ error: "Не найден." });
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_path, s.created_at
         FROM subscriptions s JOIN users u ON u.id = s.follower_id
         WHERE s.following_id = ? ORDER BY s.created_at DESC LIMIT 100`
      )
      .all(u.id);
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name || r.username,
        avatarUrl: r.avatar_path ? `/uploads/${r.avatar_path}` : null,
        since: r.created_at,
      })),
    });
  });

  router.get("/users/:username/following", (req, res) => {
    const db = getDb();
    const u = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(req.params.username);
    if (!u) return res.status(404).json({ error: "Не найден." });
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_path, s.created_at
         FROM subscriptions s JOIN users u ON u.id = s.following_id
         WHERE s.follower_id = ? ORDER BY s.created_at DESC LIMIT 100`
      )
      .all(u.id);
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name || r.username,
        avatarUrl: r.avatar_path ? `/uploads/${r.avatar_path}` : null,
        since: r.created_at,
      })),
    });
  });

  router.get("/users/:username/wall", (req, res) => {
    const db = getDb();
    const u = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(req.params.username);
    if (!u) return res.status(404).json({ error: "Не найден." });
    const rows = db
      .prepare(
        `SELECT * FROM wall_posts WHERE user_id = ? AND status = 'published'
         ORDER BY CASE WHEN pinned_at IS NOT NULL THEN 0 ELSE 1 END, pinned_at DESC, created_at DESC LIMIT 50`
      )
      .all(u.id);
    res.json({ posts: rows.map((p) => mapPost(p, db, req.user?.id)) });
  });

  router.post("/wall/posts", requireAuth, multerWrap(uploadWallFiles), (req, res) => {
    try {
      const body = String(req.body?.body || "").trim();
      const repostOfId = req.body?.repostOfId ? String(req.body.repostOfId).trim() : null;
      const repostComment = String(req.body?.repostComment || "").trim();
      if (!body && !repostOfId && (!req.files || !req.files.length)) {
        return res.status(400).json({ error: "Пустой пост." });
      }
      const db = getDb();
      const now = Date.now();
      const id = newId();
      const editUntil = now + 24 * 60 * 60 * 1000;
      db.prepare(
        `INSERT INTO wall_posts (id, user_id, body, source, telegram_message_id, repost_of_id, repost_comment, status, created_at, updated_at, edit_until)
         VALUES (?, ?, ?, 'site', NULL, ?, ?, 'published', ?, ?, ?)`
      ).run(id, req.user.id, body, repostOfId, repostComment || null, now, now, editUntil);

      if (req.files?.length) {
        const ins = db.prepare(
          `INSERT INTO wall_attachments (id, post_id, kind, file_path, url, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
        );
        req.files.forEach((f, i) => {
          const kind = /^image\//.test(f.mimetype) ? "image" : /^video\//.test(f.mimetype) ? "video" : "file";
          ins.run(newId(), id, kind, relPath(f.path), null, i);
        });
      }

      notifySubscribersNewPost(req.user.id, id);
      const row = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(id);
      res.status(201).json({ post: mapPost(row, db, req.user.id) });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.patch("/wall/posts/:id", requireAuth, (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Не найден." });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: "Нет прав." });
    if (Date.now() > row.edit_until) return res.status(403).json({ error: "Редактирование только в течение суток." });
    db.prepare("UPDATE wall_posts SET body = ?, updated_at = ? WHERE id = ?").run(
      String(req.body?.body || row.body).slice(0, 10000),
      Date.now(),
      req.params.id
    );
    const updated = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(req.params.id);
    res.json({ post: mapPost(updated, db, req.user.id) });
  });

  router.delete("/wall/posts/:id", requireAuth, (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Не найден." });
    if (row.user_id !== req.user.id && req.user.staffRole !== "admin" && req.user.staffRole !== "moderator") {
      return res.status(403).json({ error: "Нет прав." });
    }
    db.prepare("UPDATE wall_posts SET status = 'removed' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  /** Закрепить один пост на стене (остальные открепляются). Открепить: pinned: false */
  router.post("/wall/posts/:id/pin", requireAuth, (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Не найден." });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: "Нет прав." });
    if (row.status !== "published") return res.status(400).json({ error: "Пост недоступен." });
    const pinned = Boolean(req.body?.pinned);
    const now = Date.now();
    if (pinned) {
      db.prepare("UPDATE wall_posts SET pinned_at = NULL WHERE user_id = ? AND id != ?").run(req.user.id, req.params.id);
      db.prepare("UPDATE wall_posts SET pinned_at = ?, updated_at = ? WHERE id = ?").run(now, now, req.params.id);
    } else {
      db.prepare("UPDATE wall_posts SET pinned_at = NULL, updated_at = ? WHERE id = ?").run(now, req.params.id);
    }
    const updated = db.prepare("SELECT * FROM wall_posts WHERE id = ?").get(req.params.id);
    res.json({ post: mapPost(updated, db, req.user.id) });
  });

  router.post("/wall/posts/:id/view", optionalAuth, (req, res) => {
    const db = getDb();
    const result = recordPostView(db, req.params.id, req.user?.id || null);
    if (result === null) return res.status(404).json({ error: "Не найден." });
    res.json({ viewCount: result.viewCount, recorded: result.recorded });
  });

  router.post("/wall/posts/:id/like", requireAuth, (req, res) => {
    const db = getDb();
    const post = db.prepare("SELECT user_id FROM wall_posts WHERE id = ?").get(req.params.id);
    if (!post) return res.status(404).json({ error: "Не найден." });
    try {
      db.prepare("INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)").run(
        req.params.id,
        req.user.id,
        Date.now()
      );
      if (post.user_id !== req.user.id) {
        createNotification(post.user_id, "post_like", {
          postId: req.params.id,
          fromUserId: req.user.id,
          fromUsername: req.user.username,
        });
      }
    } catch {
      /* */
    }
    res.json({ ok: true, ...postLikeStats(db, req.params.id, req.user.id) });
  });

  router.delete("/wall/posts/:id/like", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ ok: true, ...postLikeStats(db, req.params.id, req.user.id) });
  });

  router.get("/wall/posts/:id/comments", (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.*, u.username, u.display_name, u.avatar_path FROM post_comments c
         JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at`
      )
      .all(req.params.id);
    res.json({ comments: rows.map(mapCommentRow) });
  });

  router.post("/wall/posts/:id/comments", requireAuth, (req, res) => {
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Пустой комментарий." });
    const db = getDb();
    const post = db.prepare("SELECT user_id FROM wall_posts WHERE id = ?").get(req.params.id);
    if (!post) return res.status(404).json({ error: "Не найден." });
    const id = newId();
    const now = Date.now();
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    db.prepare(
      `INSERT INTO post_comments (id, post_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.id, req.user.id, parentId, body, now);
    if (post.user_id !== req.user.id) {
      createNotification(post.user_id, "post_comment", {
        postId: req.params.id,
        fromUserId: req.user.id,
        fromUsername: req.user.username,
        parentId,
      });
    }
    if (parentId) {
      const parent = db.prepare("SELECT user_id FROM post_comments WHERE id = ?").get(parentId);
      if (parent && parent.user_id !== req.user.id && parent.user_id !== post.user_id) {
        createNotification(parent.user_id, "post_comment", {
          postId: req.params.id,
          fromUserId: req.user.id,
          fromUsername: req.user.username,
          parentId,
        });
      }
    }
    const row = db
      .prepare(
        `SELECT c.*, u.username, u.display_name, u.avatar_path FROM post_comments c
         JOIN users u ON u.id = c.user_id WHERE c.id = ?`
      )
      .get(id);
    const commentCount = db.prepare("SELECT COUNT(*) AS c FROM post_comments WHERE post_id = ?").get(req.params.id).c;
    res.status(201).json({ ok: true, comment: mapCommentRow(row), commentCount });
  });

  router.get("/dm/conversations", requireAuth, (req, res) => {
    const db = getDb();
    const ids = db
      .prepare(
        `SELECT c.id FROM dm_conversations c
         INNER JOIN dm_members dm ON dm.conversation_id = c.id AND dm.user_id = ?
         ORDER BY c.updated_at DESC`
      )
      .all(req.user.id)
      .map((r) => r.id);
    const conversations = ids.map((id) => mapDmConversation(db, id, req.user.id)).filter(Boolean);
    res.json({ conversations });
  });

  router.post("/dm/conversations", requireAuth, (req, res) => {
    const username = String(req.body?.username || "").trim();
    if (!username) return res.status(400).json({ error: "Укажи логин." });
    const db = getDb();
    const other = db
      .prepare("SELECT id, username, is_banned FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
    if (!other) return res.status(404).json({ error: "Пользователь не найден." });
    if (other.id === req.user.id) return res.status(400).json({ error: "Нельзя написать себе." });
    if (other.is_banned) return res.status(403).json({ error: "Пользователь недоступен." });

    let convId = findDmBetween(db, req.user.id, other.id)?.id;
    if (!convId) {
      const now = Date.now();
      convId = newId();
      db.prepare("INSERT INTO dm_conversations (id, created_at, updated_at) VALUES (?, ?, ?)").run(convId, now, now);
      const ins = db.prepare(
        "INSERT INTO dm_members (conversation_id, user_id, last_read_at) VALUES (?, ?, ?)"
      );
      ins.run(convId, req.user.id, now);
      ins.run(convId, other.id, null);
    }
    res.json({ conversation: mapDmConversation(db, convId, req.user.id) });
  });

  router.get("/dm/conversations/:id/messages", requireAuth, (req, res) => {
    const db = getDb();
    const convId = req.params.id;
    if (!isDmMember(db, convId, req.user.id)) return res.status(403).json({ error: "Нет доступа." });
    const before = Number(req.query.before) || Date.now() + 1;
    const limit = Math.min(50, Number(req.query.limit) || 40);
    const rows = db
      .prepare(
        `SELECT * FROM dm_messages WHERE conversation_id = ? AND created_at < ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(convId, before, limit)
      .reverse();
    res.json({
      messages: rows.map((r) => mapDmMessage(db, r, req.user.id)),
      hasMore: rows.length === limit,
    });
  });

  router.post("/dm/conversations/:id/messages", requireAuth, multerWrap(uploadDmFiles), (req, res) => {
    try {
      const db = getDb();
      const convId = req.params.id;
      if (!isDmMember(db, convId, req.user.id)) return res.status(403).json({ error: "Нет доступа." });
      const body = String(req.body?.body || "").trim();
      if (!body && (!req.files || !req.files.length)) {
        return res.status(400).json({ error: "Пустое сообщение." });
      }
      const now = Date.now();
      const msgId = newId();
      db.prepare(
        `INSERT INTO dm_messages (id, conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(msgId, convId, req.user.id, body, now);
      db.prepare("UPDATE dm_conversations SET updated_at = ? WHERE id = ?").run(now, convId);

      if (req.files?.length) {
        const ins = db.prepare(
          `INSERT INTO dm_attachments (id, message_id, kind, file_path, url, mime, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        req.files.forEach((f, i) => {
          const kind = /^image\//.test(f.mimetype) ? "image" : /^video\//.test(f.mimetype) ? "video" : "file";
          ins.run(newId(), msgId, kind, relPath(f.path), null, f.mimetype || null, i);
        });
      }

      const members = db.prepare("SELECT user_id FROM dm_members WHERE conversation_id = ?").all(convId);
      const row = db.prepare("SELECT * FROM dm_messages WHERE id = ?").get(msgId);
      for (const m of members) {
        const convSummary = mapDmConversation(db, convId, m.user_id);
        if (convSummary) pushToUser(m.user_id, { type: "dm_conversation", conversation: convSummary });
        /* Отправителю сообщение уже в ответе POST — без повторного push (иначе дубль в UI). */
        if (m.user_id === req.user.id) continue;
        const mapped = mapDmMessage(db, row, m.user_id);
        pushToUser(m.user_id, { type: "dm_message", conversationId: convId, message: mapped });
        if (m.user_id !== req.user.id) {
          createNotification(m.user_id, "dm_message", {
            conversationId: convId,
            messageId: msgId,
            fromUserId: req.user.id,
            fromUsername: req.user.username,
          });
        }
      }

      res.status(201).json({ message: mapDmMessage(db, row, req.user.id) });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/dm/conversations/:id/read", requireAuth, (req, res) => {
    const db = getDb();
    const convId = req.params.id;
    if (!isDmMember(db, convId, req.user.id)) return res.status(403).json({ error: "Нет доступа." });
    const now = Date.now();
    db.prepare("UPDATE dm_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?").run(
      now,
      convId,
      req.user.id
    );
    res.json({ ok: true });
  });

  router.get("/notifications", requireAuth, (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
      )
      .all(req.user.id);
    res.json({
      items: rows.map((n) => {
        const payload = JSON.parse(n.payload || "{}");
        return {
          id: n.id,
          type: n.type,
          payload,
          text: formatNotificationText(db, n.type, payload),
          action: getNotificationAction(n.type, payload, db),
          readAt: n.read_at,
          createdAt: n.created_at,
        };
      }),
      unread: rows.filter((n) => !n.read_at).length,
    });
  });

  router.post("/notifications/:id/read", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").run(
      Date.now(),
      req.params.id,
      req.user.id
    );
    res.json({ ok: true });
  });

  router.post("/notifications/read-all", requireAuth, (req, res) => {
    getDb()
      .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
      .run(Date.now(), req.user.id);
    res.json({ ok: true });
  });

  router.post("/king/sessions", requireAuth, (req, res) => {
    const r = king.startSession(req.user.id);
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json(king.getSessionState(r.sessionId));
  });

  router.get("/king/sessions/:id", requireAuth, (req, res) => {
    const st = king.getSessionState(req.params.id);
    if (!st) return res.status(404).json({ error: "Не найдена." });
    res.json(st);
  });

  router.post("/king/sessions/:id/pick", requireAuth, (req, res) => {
    const r = king.pickWinner(req.params.id, req.user.id, String(req.body?.winnerReleaseId || "").trim());
    if (r.error) return res.status(400).json({ error: r.error });
    const st = king.getSessionState(req.params.id);
    res.json({ ...r, state: st });
  });

  router.get("/king/leaderboard", (_req, res) => {
    res.json({
      artists: king.leaderboardArtists(),
      releases: king.leaderboardReleases(),
    });
  });

  router.get("/admin/reports", requireStaff, (req, res) => {
    const db = getDb();
    const status = String(req.query.status || "open");
    const rows = db
      .prepare(
        `SELECT r.*, u.username AS reporter_username FROM reports r
         JOIN users u ON u.id = r.reporter_id
         WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 50`
      )
      .all(status);
    res.json({ reports: rows });
  });

  router.patch("/admin/reports/:id", requireStaff, (req, res) => {
    const st = String(req.body?.status || "closed");
    getDb().prepare("UPDATE reports SET status = ? WHERE id = ?").run(st, req.params.id);
    res.json({ ok: true });
  });

  router.get("/admin/users/search", requireStaff, (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ users: [] });
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, display_name, is_banned, is_frozen, staff_role FROM users
         WHERE username LIKE ? ORDER BY username LIMIT 20`
      )
      .all(`${q}%`);
    res.json({ users: rows });
  });

  router.post("/reports", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`
    ).run(
      newId(),
      req.user.id,
      String(req.body?.targetType || ""),
      String(req.body?.targetId || ""),
      String(req.body?.reason || "").slice(0, 500),
      Date.now()
    );
    res.status(201).json({ ok: true });
  });

  router.post("/admin/users/:id/staff", requireAdmin, (req, res) => {
    const role = req.body?.staffRole === "moderator" ? "moderator" : req.body?.staffRole === "admin" ? "admin" : null;
    getDb().prepare("UPDATE users SET staff_role = ? WHERE id = ?").run(role, req.params.id);
    res.json({ ok: true });
  });

  router.post("/admin/users/:id/freeze", requireStaff, (req, res) => {
    const v = req.body?.frozen ? 1 : 0;
    getDb().prepare("UPDATE users SET is_frozen = ? WHERE id = ?").run(v, req.params.id);
    res.json({ ok: true });
  });

  router.post("/admin/users/:id/ban", requireAdmin, (req, res) => {
    getDb().prepare("UPDATE users SET is_banned = 1 WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  router.get("/media/:table/:id/download", optionalAuth, (req, res) => {
    const table = req.params.table;
    const allowed = { releases: "user_releases", openvers: "openvers", beats: "beats" };
    const t = allowed[table];
    if (!t) return res.status(404).end();
    if (!req.user) return res.status(401).json({ error: "Скачивание после регистрации." });
    const db = getDb();
    const row = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(req.params.id);
    if (!row || row.audio_kind !== "file" || !row.audio_file_path) {
      return res.status(404).json({ error: "Нет файла." });
    }
    const abs = path.join(__dirname, "..", "..", "data", "uploads", row.audio_file_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Файл не найден." });
    const ext = path.extname(row.audio_file_path) || ".mp3";
    const safe = String(row.title || "audio")
      .replace(/[<>:"/\\|?*]+/g, "")
      .trim()
      .slice(0, 120);
    res.download(abs, `${safe || "audio"}${ext}`);
  });

  app.use("/api/platform", router);
  app.use("/api", router);
}

module.exports = { mountPlatformRoutes };
