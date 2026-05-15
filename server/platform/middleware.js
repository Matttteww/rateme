const { getDb } = require("./db");
const { parseCookies, SESSION_COOKIE, publicUser } = require("./authUtil");

function loadSessionUser(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.is_banned = 0`
    )
    .get(sessionId, Date.now());
  if (!row) return null;
  const roles = db.prepare("SELECT role FROM user_roles WHERE user_id = ?").all(row.id).map((r) => r.role);
  if (row.is_streamer && !roles.includes("streamer")) roles.push("streamer");
  return { row, roles };
}

function optionalAuth(req, res, next) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  const hit = loadSessionUser(sid);
  req.user = hit ? publicUser(hit.row, hit.roles) : null;
  req.userRow = hit?.row || null;
  next();
}

function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      res.status(401).json({ error: "Нужна авторизация." });
      return;
    }
    if (req.userRow?.is_frozen) {
      res.status(403).json({ error: "Аккаунт ограничен." });
      return;
    }
    next();
  });
}

function requireStaff(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.staffRole) {
      res.status(403).json({ error: "Нет прав." });
      return;
    }
    next();
  });
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.staffRole !== "admin") {
      res.status(403).json({ error: "Только администратор." });
      return;
    }
    next();
  });
}

module.exports = { optionalAuth, requireAuth, requireStaff, requireAdmin, loadSessionUser };
