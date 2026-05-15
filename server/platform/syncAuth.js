const SYNC_SECRET = (process.env.BOTTWICH_SYNC_SECRET || "").trim();

function requireSyncSecret(req, res, next) {
  const header = String(req.headers["x-bottwich-sync-secret"] || "").trim();
  if (!SYNC_SECRET || header !== SYNC_SECRET) {
    return res.status(401).json({
      error: "Нужен заголовок X-Bottwich-Sync-Secret (как BOTTWICH_SYNC_SECRET в .env).",
    });
  }
  next();
}

module.exports = { requireSyncSecret, SYNC_SECRET };
