const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
const { matchTracksForDonation } = require("./matchTracksForDonation");

const QUEUE_PATH = path.join(__dirname, "..", "data", "paidQueue.json");
const SEEN_PATH = path.join(__dirname, "..", "data", "donationAlertsSeen.json");
const MAX_QUEUE_ENTRIES = 100;
const MAX_SEEN_IDS = 5000;

/** @type {object[]} */
let entries = [];
let seenPrimed = false;
/** @type {Set<number>} */
let seenIds = new Set();
let lastError = null;

function pickPlayFields(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    telegramLink: t.telegramLink ?? null,
    telegramFileId: t.telegramFileId ?? null,
    telegramFileType: t.telegramFileType ?? null,
    telegramTrackId: t.telegramTrackId ?? null,
    source: t.source ?? null,
  };
}

async function loadDisk() {
  try {
    const q = JSON.parse(await fs.readFile(QUEUE_PATH, "utf8"));
    entries = Array.isArray(q.entries) ? q.entries : [];
  } catch {
    entries = [];
  }
  try {
    const s = JSON.parse(await fs.readFile(SEEN_PATH, "utf8"));
    seenPrimed = Boolean(s.primed);
    const ids = Array.isArray(s.ids) ? s.ids : [];
    seenIds = new Set(ids.map(Number).filter(Number.isFinite));
  } catch {
    seenPrimed = false;
    seenIds = new Set();
  }
}

async function saveQueue() {
  await fs.mkdir(path.dirname(QUEUE_PATH), { recursive: true });
  await fs.writeFile(QUEUE_PATH, JSON.stringify({ entries }, null, 2), "utf8");
}

async function saveSeen() {
  await fs.mkdir(path.dirname(SEEN_PATH), { recursive: true });
  const ids = [...seenIds].filter(Number.isFinite);
  while (ids.length > MAX_SEEN_IDS) ids.shift();
  await fs.writeFile(SEEN_PATH, JSON.stringify({ primed: seenPrimed, ids }, null, 2), "utf8");
}

async function init() {
  await loadDisk();
}

function getQueueForClient() {
  return [...entries].reverse();
}

function getLastError() {
  return lastError;
}

/**
 * Опрос DonationAlerts (первая страница). Первый успешный ответ помечает текущие донаты как «уже видели» без очереди.
 * @returns {Promise<boolean>} true если добавились новые записи в очередь
 */
async function pollDonations(accessToken, getTracks) {
  const token = String(accessToken || "").trim();
  if (!token) {
    lastError = null;
    return false;
  }
  try {
    const { data, status } = await axios.get("https://www.donationalerts.com/api/v1/alerts/donations", {
      headers: { Authorization: `Bearer ${token}` },
      params: { page: 1 },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (status === 401 || status === 403) {
      lastError = "DonationAlerts: неверный или просроченный токен (нужен scope oauth-donation-index).";
      return false;
    }
    if (status >= 400) {
      const msg =
        (data && (data.message || data.error)) ||
        (Array.isArray(data?.errors) && data.errors[0]?.message) ||
        `HTTP ${status}`;
      lastError = String(msg);
      return false;
    }
    const items = Array.isArray(data?.data) ? data.data : [];
    lastError = null;

    if (!seenPrimed) {
      for (const d of items) {
        const id = Number(d.id);
        if (Number.isFinite(id)) seenIds.add(id);
      }
      seenPrimed = true;
      await saveSeen();
      return false;
    }

    const tracks = await getTracks();
    let changed = false;
    /** API обычно отдаёт от новых к старым: обрабатываем с конца массива, чтобы в очереди порядок был по времени. */
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const d = items[i];
      const id = Number(d.id);
      if (!Number.isFinite(id) || seenIds.has(id)) continue;
      seenIds.add(id);

      const message =
        d.message_type === "text" ? String(d.message || "").trim() : "";
      const matchedRaw = message ? matchTracksForDonation(message, tracks, 10) : [];
      const matchedTracks = matchedRaw.map((m) => ({
        matchScore: m.matchScore,
        track: pickPlayFields(m.track),
      }));

      entries.push({
        donationId: id,
        username: String(d.username || "—"),
        amount: Number(d.amount) || 0,
        currency: String(d.currency || "RUB"),
        message: message || (d.message_type === "audio" ? "(голосовое сообщение)" : "(без текста)"),
        donationCreatedAt: String(d.created_at || ""),
        matchedTracks,
        receivedAt: Date.now(),
      });
      if (entries.length > MAX_QUEUE_ENTRIES) entries.splice(0, entries.length - MAX_QUEUE_ENTRIES);
      changed = true;
    }
    if (changed) await saveQueue();
    await saveSeen();
    return changed;
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      (Array.isArray(e?.response?.data?.errors) && e.response.data.errors[0]?.message) ||
      e.message ||
      String(e);
    lastError = String(msg);
    return false;
  }
}

module.exports = {
  init,
  pollDonations,
  getQueueForClient,
  getLastError,
};
