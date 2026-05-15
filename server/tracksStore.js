const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "data", "tracks.json");
const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");
/** Сколько последних копий tracks-*.json держать (перенос/редактирование — откат возможен). */
const MAX_BACKUPS = 30;

/** Цепочка записей: два одновременных PATCH не перезапишут друг друга. */
let writeChain = Promise.resolve();

function serializeWrites(fn) {
  const p = writeChain.then(() => fn());
  writeChain = p.catch(() => {});
  return p;
}

function normalizeDb(j) {
  if (!j || typeof j !== "object") return { tracks: [] };
  if (!Array.isArray(j.tracks)) return { tracks: [] };
  return j;
}

function validateDbShape(db) {
  const d = normalizeDb(db);
  if (!Array.isArray(d.tracks)) throw new Error("Некорректная структура БД: нужен массив tracks.");
  for (let i = 0; i < d.tracks.length; i += 1) {
    const t = d.tracks[i];
    if (!t || typeof t !== "object") throw new Error(`Трек #${i}: не объект — запись отклонена.`);
    const id = t.id != null ? String(t.id).trim() : "";
    if (!id) throw new Error(`Трек #${i}: нет id — запись отклонена, чтобы не повредить данные.`);
  }
}

async function tryReadBackupNewest() {
  let names = [];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return null;
  }
  const dated = names.filter((n) => /^tracks-\d+\.json$/.test(n)).sort((a, b) => {
    const ta = Number(a.slice(7, -5)) || 0;
    const tb = Number(b.slice(7, -5)) || 0;
    return tb - ta;
  });
  for (const n of dated) {
    try {
      const raw = await fs.readFile(path.join(BACKUP_DIR, n), "utf8");
      const j = JSON.parse(raw);
      const db = normalizeDb(j);
      // eslint-disable-next-line no-console
      console.warn(`[tracksStore] основной файл бит или пуст — поднята копия ${n}`);
      return db;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Атомарно: пишем во временный файл в той же папке, затем rename поверх цели. */
async function atomicWriteJson(filePath, jsonString) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(
    dir,
    `.${base}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  await fs.writeFile(tmp, jsonString, "utf8");
  try {
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

async function pruneOldBackups() {
  let names = [];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return;
  }
  const dated = names
    .filter((n) => /^tracks-\d+\.json$/.test(n))
    .map((n) => ({ n, t: Number(n.slice(7, -5)) || 0 }))
    .sort((a, b) => a.t - b.t);
  while (dated.length > MAX_BACKUPS) {
    const { n } = dated.shift();
    await fs.unlink(path.join(BACKUP_DIR, n)).catch(() => {});
  }
}

async function backupCurrentMainIfExists() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  try {
    await fs.access(FILE);
  } catch {
    return;
  }
  try {
    const dest = path.join(BACKUP_DIR, `tracks-${Date.now()}.json`);
    await fs.copyFile(FILE, dest);
    await pruneOldBackups();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[tracksStore] не удалось сделать резервную копию перед записью:", e.message || e);
  }
}

const CRITERIA_KEYS = ["vibe", "svod", "text", "beat", "realization", "relevance"];

function parseScore(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function validateCriteria(c) {
  const src = c && typeof c === "object" ? c : {};
  const out = {};
  for (const k of CRITERIA_KEYS) {
    const n = parseScore(src[k]);
    if (n === null) {
      return { error: "Заполни все шесть критериев (0–10)." };
    }
    if (n < 0 || n > 10) {
      return { error: `Оценка «${k}» должна быть от 0 до 10.` };
    }
    out[k] = n;
  }
  return { criteria: out };
}

const MAX_CHAT_RATINGS_LOG = 500;

/** Снимок голосов чата 0–10 при сохранении трека. */
function validateChatRatingsLog(arr) {
  if (arr == null) return { value: null };
  if (!Array.isArray(arr)) return { error: "chatRatingsLog должен быть массивом или null." };
  const out = [];
  for (const row of arr.slice(0, MAX_CHAT_RATINGS_LOG)) {
    if (!row || typeof row !== "object") continue;
    const user = String(row.user || "").trim().slice(0, 120);
    const score = Number(row.score);
    const at = Number(row.at);
    if (!user) continue;
    if (!Number.isFinite(score) || score < 0 || score > 10) continue;
    if (!Number.isFinite(at) || at < 0) continue;
    out.push({ user, score: Math.round(score), at: Math.floor(at) });
  }
  return { value: out };
}

function averageSix(criteria) {
  const vals = CRITERIA_KEYS.map((k) => criteria[k]);
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

async function readDb() {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const j = JSON.parse(raw);
    return normalizeDb(j);
  } catch (e) {
    const recovered = await tryReadBackupNewest();
    if (recovered) return recovered;
    // eslint-disable-next-line no-console
    if (e && e.code !== "ENOENT") console.warn("[tracksStore] readDb:", e.message || e);
    return { tracks: [] };
  }
}

async function writeDb(db) {
  return serializeWrites(async () => {
    validateDbShape(db);
    const json = JSON.stringify(db, null, 2);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await backupCurrentMainIfExists();
    await atomicWriteJson(FILE, json);
  });
}

async function getAll() {
  const db = await readDb();
  return [...db.tracks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getById(id) {
  const raw = id == null ? "" : String(id).trim();
  if (!raw) return null;
  const needle = raw.toLowerCase();
  const db = await readDb();
  return db.tracks.find((t) => String(t.id).trim().toLowerCase() === needle) || null;
}

function findByTelegramId(db, tgId) {
  const n = Number(tgId);
  if (!Number.isFinite(n)) return null;
  return db.tracks.find((t) => Number(t.telegramTrackId) === n) || null;
}

/** file_id из тела POST (camelCase / PascalCase / snake_case). */
function pickTelegramFileMeta(body) {
  const src = body && typeof body === "object" ? body : {};
  const rawId =
    src.telegramFileId ?? src.TelegramFileId ?? src.telegram_file_id ?? null;
  const rawType =
    src.telegramFileType ?? src.TelegramFileType ?? src.telegram_file_type ?? null;
  const fileId = rawId != null && String(rawId).trim() !== "" ? String(rawId).trim() : null;
  const fileType = rawType != null && String(rawType).trim() !== "" ? String(rawType).trim() : null;
  return { fileId, fileType };
}

async function create(body) {
  const title = String(body.title || "").trim();
  const artist = String(body.artist || "").trim();
  if (!title) throw new Error("Укажи название трека.");
  if (!artist) throw new Error("Укажи исполнителя.");
  const v = validateCriteria(body.criteria || {});
  if (v.error) throw new Error(v.error);
  const { criteria } = v;
  const personalAverage = averageSix(criteria);

  let chatAverage = null;
  if (body.chatAverage !== undefined && body.chatAverage !== null && String(body.chatAverage).trim() !== "") {
    const ca = Number(body.chatAverage);
    if (!Number.isFinite(ca)) throw new Error("Средняя чата — число.");
    if (ca < 0 || ca > 10) throw new Error("Средняя чата от 0 до 10.");
    chatAverage = Math.round(ca * 100) / 100;
  }

  const track = {
    id: crypto.randomUUID(),
    title,
    artist,
    criteria,
    personalAverage,
    chatAverage,
    telegramTrackId: null,
    telegramLink: null,
    telegramCaption: null,
    source: "manual",
    createdAt: Date.now(),
  };
  const db = await readDb();
  db.tracks.push(track);
  await writeDb(db);
  return track;
}

async function createFromTelegram(body) {
  const telegramTrackId = Number(body.telegramTrackId ?? body.TelegramTrackId);
  if (!Number.isFinite(telegramTrackId) || telegramTrackId <= 0) {
    throw new Error("Нужен положительный telegramTrackId.");
  }
  const title = String(body.title || "").trim() || "без названия";
  const artist = String(body.artist || "").trim() || "неизвестно";
  const { fileId, fileType } = pickTelegramFileMeta(body);
  const link = body.link != null && String(body.link).trim() !== "" ? String(body.link).trim() : null;
  const caption = body.caption != null && String(body.caption).trim() !== "" ? String(body.caption).trim() : null;

  const db = await readDb();
  const existing = findByTelegramId(db, telegramTrackId);
  if (existing) {
    let changed = false;
    if (fileId && existing.telegramFileId !== fileId) {
      existing.telegramFileId = fileId;
      changed = true;
    }
    if (fileType && existing.telegramFileType !== fileType) {
      existing.telegramFileType = fileType;
      changed = true;
    }
    if (link && existing.telegramLink !== link) {
      existing.telegramLink = link;
      changed = true;
    }
    if (caption != null && existing.telegramCaption !== caption) {
      existing.telegramCaption = caption;
      changed = true;
    }
    if (title && existing.title !== title) {
      existing.title = title;
      changed = true;
    }
    if (artist && existing.artist !== artist) {
      existing.artist = artist;
      changed = true;
    }
    if (changed) {
      await writeDb(db);
      // eslint-disable-next-line no-console
      console.log(`[from-telegram] merge tgId=${telegramTrackId} hasFileId=${Boolean(fileId)}`);
    }
    return { track: existing, duplicate: true };
  }
  const track = {
    id: crypto.randomUUID(),
    title,
    artist,
    criteria: null,
    personalAverage: null,
    chatAverage: null,
    telegramTrackId,
    telegramLink: link,
    telegramCaption: caption,
    telegramFileId: fileId,
    telegramFileType: fileType,
    source: "telegram",
    createdAt: Date.now(),
  };
  db.tracks.push(track);
  await writeDb(db);
  return { track, duplicate: false };
}

async function update(id, body) {
  const db = await readDb();
  const i = db.tracks.findIndex((t) => t.id === id);
  if (i === -1) throw new Error("Трек не найден.");
  const t = { ...db.tracks[i] };
  if (body.criteria != null) {
    const v = validateCriteria(body.criteria);
    if (v.error) throw new Error(v.error);
    t.criteria = v.criteria;
    t.personalAverage = averageSix(v.criteria);
  }
  if (body.chatAverage !== undefined) {
    if (body.chatAverage === null || String(body.chatAverage).trim() === "") {
      t.chatAverage = null;
    } else {
      const ca = Number(body.chatAverage);
      if (!Number.isFinite(ca)) throw new Error("Средняя чата — число.");
      if (ca < 0 || ca > 10) throw new Error("Средняя чата от 0 до 10.");
      t.chatAverage = Math.round(ca * 100) / 100;
    }
  }
  if (body.chatRatingsLog !== undefined) {
    if (body.chatRatingsLog === null) {
      t.chatRatingsLog = null;
    } else {
      const v = validateChatRatingsLog(body.chatRatingsLog);
      if (v.error) throw new Error(v.error);
      t.chatRatingsLog = v.value;
    }
  }
  db.tracks[i] = t;
  await writeDb(db);
  return t;
}

async function remove(id) {
  const db = await readDb();
  const idx = db.tracks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  db.tracks.splice(idx, 1);
  await writeDb(db);
  return true;
}

module.exports = {
  getAll,
  getById,
  create,
  createFromTelegram,
  update,
  remove,
  CRITERIA_KEYS,
  /** Путь к основному JSON (для бэкапа вручную / переноса). */
  getDbFilePath: () => FILE,
  getBackupDir: () => BACKUP_DIR,
};
