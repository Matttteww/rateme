const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const SESSION_DAYS = 30;
const SESSION_COOKIE = "bottwich_sid";
const LOGIN_CHANGE_MS = 7 * 24 * 60 * 60 * 1000;

const ROLES = ["rapper", "beatmaker", "mixer", "listener", "streamer"];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return scrypt(String(password), salt, 64).then((buf) => `${salt}:${buf.toString("hex")}`);
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const buf = await scrypt(String(password), salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), buf);
}

function newId() {
  return crypto.randomUUID();
}

function sessionExpiryMs(remember) {
  const days = remember ? 30 : 7;
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function validateUsername(username) {
  const u = String(username || "").trim();
  if (u.length < 3 || u.length > 32) return { error: "Логин: от 3 до 32 символов." };
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return { error: "Логин: только латиница, цифры и _." };
  return { username: u };
}

function validateRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return { error: "Выбери хотя бы одну роль." };
  const out = [...new Set(roles.map((r) => String(r).trim()).filter(Boolean))];
  for (const r of out) {
    if (!ROLES.includes(r)) return { error: `Неизвестная роль: ${r}` };
  }
  if (!out.includes("streamer")) {
    /* streamer only via env match on register */
  }
  return { roles: out.filter((r) => r !== "streamer") };
}

function parseTelegramChannelMeta(row) {
  if (!row?.telegram_channel_meta) return null;
  try {
    return JSON.parse(row.telegram_channel_meta);
  } catch {
    return null;
  }
}

function publicUser(row, roles) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    bio: row.bio || "",
    avatarUrl: row.avatar_path ? `/uploads/${row.avatar_path}` : null,
    bannerUrl: row.banner_path ? `/uploads/${row.banner_path}` : null,
    roles: roles || [],
    kingWins: row.king_wins || 0,
    gamesPlayed: row.games_played || 0,
    isStreamer: Boolean(row.is_streamer),
    staffRole: row.staff_role || null,
    telegramLinked: Boolean(row.telegram_id),
    telegramChannel: row.telegram_channel || null,
    telegramChannelMeta: parseTelegramChannelMeta(row),
    telegramSyncMode: row.telegram_sync_mode === "auto" ? "auto" : "manual",
    createdAt: row.created_at,
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  newId,
  sessionExpiryMs,
  SESSION_COOKIE,
  SESSION_DAYS,
  LOGIN_CHANGE_MS,
  ROLES,
  parseCookies,
  validateUsername,
  validateRoles,
  parseTelegramChannelMeta,
  publicUser,
};
