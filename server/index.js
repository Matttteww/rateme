require("dotenv").config();
const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const axios = require("axios");
const tmi = require("tmi.js");
const cookieParser = require("cookie-parser");
const tracksStore = require("./tracksStore");
const paidQueueService = require("./paidQueueService");
const { initPlatformDb } = require("./platform/db");
const { mountPlatformRoutes } = require("./platform/routes");
const { ensureTelegramBotInfo } = require("./platform/telegramBot");
const { ensureUploadDirs, uploadBanner, relPath } = require("./platform/upload");
const { getDb } = require("./platform/db");
const { requireAuth } = require("./platform/middleware");
const { parseCookies, SESSION_COOKIE } = require("./platform/authUtil");
const { loadSessionUser } = require("./platform/middleware");
const { setWss } = require("./platform/realtime");

const PORT = Number(process.env.PORT) || 3847;
const SYNC_SECRET = (process.env.BOTTWICH_SYNC_SECRET || "").trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHANNEL = (process.env.TWITCH_CHANNEL || "")
  .trim()
  .toLowerCase()
  .replace(/^#/, "");
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || "";
const USER_TOKEN_RAW = (process.env.TWITCH_USER_ACCESS_TOKEN || "").trim();
const USER_TOKEN = USER_TOKEN_RAW.replace(/^oauth:/i, "");
const TOKEN_OWNER = (process.env.TWITCH_TOKEN_OWNER_LOGIN || "")
  .trim()
  .toLowerCase();
/** Client-ID для запросов Helix с пользовательским токеном (должен совпадать с приложением, выдавшим токен). */
const USER_TOKEN_CLIENT_ID = (
  process.env.TWITCH_USER_TOKEN_CLIENT_ID ||
  process.env.TWITCH_CLIENT_ID ||
  ""
).trim();

const DONATIONALERTS_ACCESS_TOKEN = (process.env.DONATIONALERTS_ACCESS_TOKEN || "").trim();
const DONATIONALERTS_POLL_MS = Math.max(10_000, Number(process.env.DONATIONALERTS_POLL_MS) || 25_000);
const DONATIONALERTS_CLIENT_ID = (process.env.DONATIONALERTS_CLIENT_ID || "").trim();
const DONATIONALERTS_CLIENT_SECRET = (process.env.DONATIONALERTS_CLIENT_SECRET || "").trim();
const DONATIONALERTS_REDIRECT_URI = (process.env.DONATIONALERTS_REDIRECT_URI || "").trim();

const RATING_RE = /^(10|[0-9])$/;
const MAX_RATINGS = 200;
const POLL_MS = 20000;
/** Не писал столько — не в списке «активных»; новое сообщение — снова в списке. */
const ACTIVE_CHATTER_WINDOW_MS = 60_000;

let appAccessToken = null;
let appTokenExpiresAt = 0;
let broadcasterId = null;
/** @type {string|null} */
let channelDisplayName = null;

const SERVER_STARTED_AT = Date.now();

/** @type {Set<string>} user-id (или login), кто уже поставил оценку на текущий трек */
const ratedUserKeys = new Set();

/** Кто писал в чат за сессию (ключ как у ratingUserKey → последний display name). */
const sessionChatterMap = new Map();
const MAX_SESSION_CHATTER_KEYS = 500;

/** @type {ReturnType<typeof setTimeout> | null} */
let sessionStateBroadcastTimer = null;

function noteSessionChatter(mapKey, displayName) {
  if (!mapKey || !displayName) return;
  sessionChatterMap.set(mapKey, {
    displayName: String(displayName).trim() || "unknown",
    at: Date.now(),
  });
  while (sessionChatterMap.size > MAX_SESSION_CHATTER_KEYS) {
    let oldestK = null;
    let oldestT = Infinity;
    for (const [k, v] of sessionChatterMap) {
      if (v.at < oldestT) {
        oldestT = v.at;
        oldestK = k;
      }
    }
    if (oldestK == null) break;
    sessionChatterMap.delete(oldestK);
  }
}

function scheduleSessionStateBroadcast(wss) {
  if (!wss) return;
  if (sessionStateBroadcastTimer) return;
  sessionStateBroadcastTimer = setTimeout(() => {
    sessionStateBroadcastTimer = null;
    broadcast(wss, { type: "state", payload: publicState() });
  }, 200);
}

const state = {
  viewerCount: null,
  chatters: [],
  ratings: [],
  /** Пока открыт опрос в каталоге — id трека; иначе null (чат не принимает 0–10). */
  pollTrackId: null,
  chatConnected: false,
  chatError: null,
  lastPollError: null,
  /** @type {null | object} */
  streamMeta: null,
  /** @type {Record<string, { user: string, count: number }>} */
  statMessages: {},
  /** @type {Record<string, { user: string, count: number }>} */
  statRatings: {},
};

function statBump(statObj, key, displayName) {
  if (!key) return;
  const cur = statObj[key] || { user: displayName, count: 0 };
  cur.user = displayName;
  cur.count += 1;
  statObj[key] = cur;
}

function statTopList(statObj, limit = 12) {
  return Object.values(statObj)
    .sort((a, b) => b.count - a.count || a.user.localeCompare(b.user, "ru"))
    .slice(0, limit);
}

function broadcast(wss, payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(data);
  });
}

async function getAppToken() {
  if (appAccessToken && Date.now() < appTokenExpiresAt - 60_000) return appAccessToken;
  const { data } = await axios.post(
    "https://id.twitch.tv/oauth2/token",
    null,
    {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
      },
    }
  );
  appAccessToken = data.access_token;
  appTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return appAccessToken;
}

async function helixApp(pathname, params) {
  const token = await getAppToken();
  const { data } = await axios.get(`https://api.twitch.tv/helix${pathname}`, {
    headers: {
      "Client-ID": CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
    params,
  });
  return data;
}

async function helixUser(pathname, params) {
  if (!USER_TOKEN) throw new Error("Нет TWITCH_USER_ACCESS_TOKEN");
  const cid = USER_TOKEN_CLIENT_ID || CLIENT_ID;
  const { data } = await axios.get(`https://api.twitch.tv/helix${pathname}`, {
    headers: {
      "Client-ID": cid,
      Authorization: `Bearer ${USER_TOKEN}`,
    },
    params,
  });
  return data;
}

async function resolveBroadcasterId() {
  if (broadcasterId) return broadcasterId;
  const data = await helixApp("/users", { login: CHANNEL });
  const u = data.data?.[0];
  if (!u) throw new Error(`Канал «${CHANNEL}» не найден`);
  broadcasterId = u.id;
  channelDisplayName = u.display_name || u.login || CHANNEL;
  return broadcasterId;
}

/** Снимок эфира из Helix streams (0 зрителей, если офлайн). */
async function fetchStreamMeta() {
  const bid = await resolveBroadcasterId();
  const data = await helixApp("/streams", { user_id: bid });
  const s = data.data?.[0];
  if (!s) {
    return {
      isLive: false,
      viewerCount: 0,
      title: null,
      gameName: null,
      startedAt: null,
      language: null,
      thumbnailUrl: null,
      tagIds: [],
    };
  }
  const thumb = s.thumbnail_url
    ? String(s.thumbnail_url).replace("{width}", "320").replace("{height}", "180")
    : null;
  return {
    isLive: true,
    viewerCount: Number(s.viewer_count) || 0,
    title: s.title || null,
    gameName: s.game_name || null,
    startedAt: s.started_at || null,
    language: s.language || null,
    thumbnailUrl: thumb,
    tagIds: Array.isArray(s.tag_ids) ? s.tag_ids.slice(0, 12) : [],
  };
}

/** Заголовок категории с панели канала (актуально в офлайне; при ошибке scope — пусто). */
async function fetchChannelOfflineMeta() {
  if (!USER_TOKEN) return {};
  try {
    const bid = await resolveBroadcasterId();
    const { data } = await axios.get("https://api.twitch.tv/helix/channels", {
      headers: {
        "Client-ID": USER_TOKEN_CLIENT_ID || CLIENT_ID,
        Authorization: `Bearer ${USER_TOKEN}`,
      },
      params: { broadcaster_id: bid },
    });
    const c = data.data?.[0];
    if (!c) return {};
    return {
      offlineTitle: c.title || null,
      offlineGameName: c.game_name || null,
    };
  } catch {
    return {};
  }
}

async function fetchAllChatters() {
  const bid = await resolveBroadcasterId();
  const mid = bid;
  const out = [];
  let cursor = undefined;
  do {
    const data = await helixUser("/chat/chatters", {
      broadcaster_id: bid,
      moderator_id: mid,
      first: 1000,
      after: cursor,
    });
    for (const row of data.data || []) {
      if (row.user_login) out.push(row.user_login);
    }
    cursor = data.pagination?.cursor;
  } while (cursor);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function pushRating(displayName, score) {
  const entry = {
    user: displayName,
    score,
    at: Date.now(),
  };
  state.ratings.unshift(entry);
  if (state.ratings.length > MAX_RATINGS) state.ratings.length = MAX_RATINGS;
}

function ratingUserKey(tags) {
  const id = tags["user-id"];
  if (id) return `id:${id}`;
  const login = tags.username && String(tags.username).toLowerCase();
  if (login) return `login:${login}`;
  return null;
}

/** Ключ для карты «кто писал» (шире ratingUserKey — если нет user-id, всё равно учитываем). */
function chatterSessionKey(tags, displayName) {
  const rk = ratingUserKey(tags);
  if (rk) return rk;
  const login = tags.username && String(tags.username).trim().toLowerCase();
  if (login) return `login:${login}`;
  const dn = String(displayName || "").trim().toLowerCase();
  if (dn && dn !== "unknown") return `dn:${dn}`;
  return null;
}

function startNextTrack() {
  state.ratings = [];
  ratedUserKeys.clear();
}

function averageRating() {
  if (!state.ratings.length) return null;
  const sum = state.ratings.reduce((a, r) => a + r.score, 0);
  return sum / state.ratings.length;
}

function sumStatCounts(statObj) {
  return Object.values(statObj).reduce((a, x) => a + (x?.count || 0), 0);
}

/** Гистограмма 0–10 и min/max по текущему треку. */
function buildRatingStats(ratings) {
  if (!ratings.length) return null;
  const scores = ratings.map((r) => r.score);
  const sum = scores.reduce((a, b) => a + b, 0);
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const hist = Array(11).fill(0);
  for (const sc of scores) {
    if (sc >= 0 && sc <= 10) hist[sc] += 1;
  }
  return {
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores),
    avg: sum / scores.length,
    median,
    hist,
  };
}

function setupChat(wss) {
  if (!CHANNEL || !USER_TOKEN || !TOKEN_OWNER) {
    state.chatError =
      "Укажите TWITCH_CHANNEL, TWITCH_USER_ACCESS_TOKEN и TWITCH_TOKEN_OWNER_LOGIN в .env";
    return null;
  }

  const client = new tmi.Client({
    options: { debug: false },
    identity: {
      username: TOKEN_OWNER,
      password: `oauth:${USER_TOKEN}`,
    },
    channels: [CHANNEL],
  });

  client.on("connected", () => {
    state.chatConnected = true;
    state.chatError = null;
    broadcast(wss, { type: "state", payload: publicState() });
  });

  client.on("disconnected", () => {
    state.chatConnected = false;
    broadcast(wss, { type: "state", payload: publicState() });
  });

  client.on("notice", (_channel, _type, message) => {
    state.chatError = String(message || "notice");
    broadcast(wss, { type: "state", payload: publicState() });
  });

  client.on("message", (chan, tags, message, self) => {
    if (self) return;
    const displayName =
      (tags["display-name"] && String(tags["display-name"]).trim()) ||
      (tags.username && String(tags.username)) ||
      "unknown";
    const key = ratingUserKey(tags);
    const sessionKey = chatterSessionKey(tags, displayName);
    if (key) statBump(state.statMessages, key, displayName);
    if (sessionKey) noteSessionChatter(sessionKey, displayName);

    const trimmed = String(message || "").trim();
    if (RATING_RE.test(trimmed) && state.pollTrackId && key && !ratedUserKeys.has(key)) {
      const score = Number(trimmed);
      ratedUserKeys.add(key);
      statBump(state.statRatings, key, displayName);
      pushRating(displayName, score);
      broadcast(wss, { type: "state", payload: publicState() });
      return;
    }
    if (key || sessionKey) scheduleSessionStateBroadcast(wss);
  });

  client.connect().catch((e) => {
    state.chatError = e?.message || String(e);
    broadcast(wss, { type: "state", payload: publicState() });
  });

  return client;
}

/** Активные в чате за последние ACTIVE_CHATTER_WINDOW_MS (серверное время = то же, что у lastAt). */
function activeChattersPayload() {
  const now = Date.now();
  return [...sessionChatterMap.values()]
    .filter((v) => now - v.at < ACTIVE_CHATTER_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .map((v) => ({ user: v.displayName, lastAt: v.at }));
}

function publicState() {
  return {
    viewerCount: state.viewerCount,
    chatterCount: state.chatters.length,
    chatters: state.chatters,
    activeChatters: activeChattersPayload(),
    pollTrackId: state.pollTrackId,
    average: averageRating(),
    ratings: state.ratings,
    chatConnected: state.chatConnected,
    chatError: state.chatError,
    lastPollError: state.lastPollError,
    channel: CHANNEL,
    channelDisplayName: channelDisplayName || CHANNEL,
    topMessagers: statTopList(state.statMessages, 12),
    topRaters: statTopList(state.statRatings, 12),
    streamMeta: state.streamMeta,
    pollIntervalMs: POLL_MS,
    serverTime: Date.now(),
    sessionStartedAt: SERVER_STARTED_AT,
    sessionMessageCount: sumStatCounts(state.statMessages),
    sessionRatingVoteCount: sumStatCounts(state.statRatings),
    ratingStats: buildRatingStats(state.ratings),
    paidQueue: paidQueueService.getQueueForClient(),
    donationAlerts: {
      enabled: Boolean(DONATIONALERTS_ACCESS_TOKEN),
      lastError: paidQueueService.getLastError(),
    },
  };
}

async function pollTwitch(wss) {
  if (!CLIENT_ID || !CLIENT_SECRET || !CHANNEL) {
    state.lastPollError = "Заполните TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_CHANNEL";
    broadcast(wss, { type: "state", payload: publicState() });
    return;
  }
  try {
    const streamMeta = await fetchStreamMeta();
    if (!streamMeta.isLive && USER_TOKEN) {
      Object.assign(streamMeta, await fetchChannelOfflineMeta());
    }
    state.streamMeta = streamMeta;
    state.viewerCount = streamMeta.viewerCount;
    state.lastPollError = null;
    if (USER_TOKEN) {
      try {
        state.chatters = await fetchAllChatters();
      } catch (e) {
        state.lastPollError =
          (e?.response?.data?.message || e?.message || String(e)) +
          " (проверьте scope moderator:read:chatters и что токен от стримера канала)";
      }
    } else {
      state.chatters = [];
    }
  } catch (e) {
    state.lastPollError = e?.response?.data?.message || e?.message || String(e);
  }
  broadcast(wss, { type: "state", payload: publicState() });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Страница после редиректа DonationAlerts с ?code=… */
function donationAlertsOAuthLandingHtml(code) {
  const safe = escapeHtml(code);
  const codeJson = JSON.stringify(String(code));
  const hasClient = Boolean(
    DONATIONALERTS_CLIENT_ID && DONATIONALERTS_CLIENT_SECRET && DONATIONALERTS_REDIRECT_URI
  );
  const hasClientJson = JSON.stringify(hasClient);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DonationAlerts — код</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 1.5rem; max-width: 52rem; margin: 0 auto; line-height: 1.5; }
    h1 { font-size: 1.25rem; margin-top: 0; }
    textarea { width: 100%; min-height: 5rem; background: #1a1a1a; color: #ddd; border: 1px solid #444; border-radius: 8px; padding: 10px; font-size: 12px; box-sizing: border-box; }
    button { margin-top: 12px; padding: 10px 18px; background: #e25510; border: none; color: #fff; border-radius: 10px; cursor: pointer; font-weight: 600; }
    .err { color: #f88; margin-top: 10px; white-space: pre-wrap; }
    .ok { color: #ada; margin-top: 10px; }
    .hint { color: #999; font-size: 0.9rem; }
    pre { background: #0d0d0d; padding: 12px; border-radius: 8px; overflow: auto; font-size: 11px; word-break: break-all; }
  </style>
</head>
<body>
  <h1>DonationAlerts: код получен</h1>
  <p class="hint">Так и должно быть: раньше сервер не умел открывать корень. Код одноразовый и недолго живёт — не свети его в стриме.</p>
  <p><label for="c"><strong>Код (code)</strong></label></p>
  <textarea id="c" readonly>${safe}</textarea>
  ${
    hasClient
      ? `<p><button type="button" id="btn">Обменять на access token</button></p>
         <p class="hint">В ответе появится JSON — скопируй <code>access_token</code> в <code>.env</code> как <code>DONATIONALERTS_ACCESS_TOKEN=...</code> и перезапусти Node.</p>
         <pre id="out"></pre>`
      : `<p class="hint">Чтобы работала кнопка выше, в <code>.env</code> на сервере укажи те же значения, что в приложении DA: <code>DONATIONALERTS_CLIENT_ID</code>, <code>DONATIONALERTS_CLIENT_SECRET</code> (ключ API), <code>DONATIONALERTS_REDIRECT_URI</code> (строго как в настройках приложения, например <code>http://127.0.0.1:3847/</code>). Перезапусти сервер и снова пройди «Разрешить».</p>`
  }
  <script>
    (function () {
      var code = ${codeJson};
      var has = ${hasClientJson};
      var btn = document.getElementById("btn");
      var out = document.getElementById("out");
      if (!has || !btn || !out) return;
      btn.onclick = function () {
        out.textContent = "Запрос…";
        fetch("/api/donationalerts/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code }),
        })
          .then(function (r) {
            return r.text().then(function (t) {
              var j = {};
              try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { error: t }; }
              if (!r.ok) throw new Error(j.error || j.message || "HTTP " + r.status);
              return j;
            });
          })
          .then(function (j) {
            out.textContent = JSON.stringify(j, null, 2);
          })
          .catch(function (e) {
            out.textContent = "Ошибка: " + e.message;
          });
      };
    })();
  </script>
</body>
</html>`;
}

async function main() {
  await paidQueueService.init();
  initPlatformDb();
  ensureUploadDirs();
  await ensureTelegramBotInfo();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  app.get("/api/state", (_req, res) => {
    res.json(publicState());
  });

  /** Старт опроса 0–10 из чата для трека (id в URL или в JSON body). */
  async function pollStartHandler(req, res) {
    try {
      const fromParam = req.params && req.params.id != null ? String(req.params.id).trim() : "";
      const fromBody = req.body && req.body.trackId != null ? String(req.body.trackId).trim() : "";
      const trackId = fromParam || fromBody;
      if (!trackId) {
        res.status(400).json({ error: "Нужен id трека (в URL или поле trackId в JSON)." });
        return;
      }
      const track = await tracksStore.getById(trackId);
      if (!track) {
        res.status(404).json({
          error: `Трек не найден по id «${trackId}». Сохрани каталог и обнови страницу (F5), затем открой «оценки» снова.`,
        });
        return;
      }
      state.pollTrackId = String(track.id).trim();
      startNextTrack();
      broadcast(wss, { type: "state", payload: publicState() });
      res.json({ ok: true, pollTrackId: state.pollTrackId });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  }

  app.post("/api/tracks/:id/poll/start", pollStartHandler);
  app.post("/api/poll/start", pollStartHandler);

  /** Закрыть опрос: чат перестаёт принимать 0–10 до следующего start. */
  app.post("/api/poll/stop", (_req, res) => {
    state.pollTrackId = null;
    startNextTrack();
    broadcast(wss, { type: "state", payload: publicState() });
    res.json({ ok: true });
  });

  app.get("/api/tracks", async (_req, res) => {
    try {
      const tracks = await tracksStore.getAll();
      res.json({ tracks });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  /** Диагностика: видит ли сервер секрет синка (без раскрытия значения). */
  app.get("/api/tracks/sync-status", (_req, res) => {
    res.json({
      syncSecretConfigured: Boolean(SYNC_SECRET),
      wallPostSyncPath: "/api/sync/wall-post",
      port: PORT,
      telegramAudio: Boolean(TELEGRAM_BOT_TOKEN),
    });
  });

  /** Прокси аудио из Telegram по file_id; поддержка Range — для перемотки в браузере. */
  app.get("/api/tracks/:id/audio", async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN) {
      res.status(503).type("text/plain").send("TELEGRAM_BOT_TOKEN не задан в .env");
      return;
    }
    let upstreamStream = null;
    try {
      const track = await tracksStore.getById(req.params.id);
      if (!track?.telegramFileId) {
        res.status(404).type("text/plain").send("У трека нет telegramFileId (старые записи или только ссылка).");
        return;
      }
      const gf = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`, {
        params: { file_id: track.telegramFileId },
        validateStatus: () => true,
      });
      const ok = gf.data?.ok;
      const filePath = gf.data?.result?.file_path;
      if (!ok || !filePath) {
        res.status(502).type("text/plain").send(gf.data?.description || "getFile");
        return;
      }
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
      const range = req.headers.range;

      const upstream = await axios.get(fileUrl, {
        responseType: "stream",
        validateStatus: () => true,
        headers: range ? { Range: range } : {},
        maxRedirects: 5,
      });
      upstreamStream = upstream.data;

      if (upstream.status >= 400) {
        upstreamStream?.resume?.();
        res.status(upstream.status).send("Не удалось получить файл из Telegram");
        return;
      }

      const uh = upstream.headers;
      const forwardKeys = ["content-type", "content-length", "content-range", "accept-ranges", "etag"];
      for (const key of forwardKeys) {
        const v = uh[key];
        if (v) res.setHeader(key, v);
      }
      if (!uh["accept-ranges"]) {
        res.setHeader("Accept-Ranges", "bytes");
      }
      res.setHeader("Cache-Control", "private, max-age=300");

      res.status(upstream.status);

      req.on("close", () => {
        if (!res.writableEnded && upstreamStream?.destroy) {
          upstreamStream.destroy();
        }
      });

      upstreamStream.on("error", () => {
        if (!res.writableEnded) res.destroy();
      });

      upstreamStream.pipe(res);
    } catch (e) {
      if (upstreamStream?.destroy) upstreamStream.destroy();
      if (!res.headersSent) {
        res.status(500).type("text/plain").send(e?.message || String(e));
      } else if (!res.writableEnded) {
        res.destroy();
      }
    }
  });

  app.post("/api/tracks", async (req, res) => {
    try {
      const track = await tracksStore.create(req.body);
      res.json(track);
    } catch (e) {
      res.status(400).json({ error: e.message || String(e) });
    }
  });

  app.post("/api/tracks/from-telegram", async (req, res) => {
    const hdr = String(req.get("X-Bottwich-Sync-Secret") || "");
    if (!SYNC_SECRET || hdr !== SYNC_SECRET) {
      // eslint-disable-next-line no-console
      console.warn("[from-telegram] 401: BOTTWICH_SYNC_SECRET пустой или заголовок не совпадает");
      return res.status(401).json({ error: "Нужен заголовок X-Bottwich-Sync-Secret и BOTTWICH_SYNC_SECRET в .env" });
    }
    try {
      const body = req.body || {};
      const result = await tracksStore.createFromTelegram(body);
      const dup = Boolean(result.duplicate);
      // eslint-disable-next-line no-console
      console.log(
        `[from-telegram] ok tgId=${body.telegramTrackId} dup=${dup} trackId=${result.track?.id} hasFileId=${Boolean(result.track?.telegramFileId)}`
      );
      res.json(result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[from-telegram] 400:", e.message || e);
      res.status(400).json({ error: e.message || String(e) });
    }
  });

  app.patch("/api/tracks/:id", async (req, res) => {
    try {
      const track = await tracksStore.update(req.params.id, req.body || {});
      res.json(track);
    } catch (e) {
      const code = e.message === "Трек не найден." ? 404 : 400;
      res.status(code).json({ error: e.message || String(e) });
    }
  });

  app.delete("/api/tracks/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (state.pollTrackId === id) {
        state.pollTrackId = null;
        startNextTrack();
        broadcast(wss, { type: "state", payload: publicState() });
      }
      const ok = await tracksStore.remove(id);
      if (!ok) return res.status(404).json({ error: "Трек не найден" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  app.get("/", (req, res, next) => {
    const raw = req.query && req.query.code;
    const code = raw != null ? String(raw).trim() : "";
    if (!code) return next();
    res.type("html").send(donationAlertsOAuthLandingHtml(code));
  });

  app.post("/api/donationalerts/exchange", async (req, res) => {
    try {
      const code = req.body && req.body.code != null ? String(req.body.code).trim() : "";
      if (!code) {
        res.status(400).json({ error: 'Нужен JSON: { "code": "..." }' });
        return;
      }
      if (!DONATIONALERTS_CLIENT_ID || !DONATIONALERTS_CLIENT_SECRET || !DONATIONALERTS_REDIRECT_URI) {
        res.status(503).json({
          error:
            "Задай в .env DONATIONALERTS_CLIENT_ID, DONATIONALERTS_CLIENT_SECRET, DONATIONALERTS_REDIRECT_URI (как в приложении DonationAlerts).",
        });
        return;
      }
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: DONATIONALERTS_CLIENT_ID,
        client_secret: DONATIONALERTS_CLIENT_SECRET,
        redirect_uri: DONATIONALERTS_REDIRECT_URI,
        code,
      });
      const { data, status } = await axios.post("https://www.donationalerts.com/oauth/token", body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (status >= 400) {
        res.status(status).json({
          error: data?.error_description || data?.message || data?.error || `HTTP ${status}`,
          details: data,
        });
        return;
      }
      res.json({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
      });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  const { pipeChannelPreview } = require("./platform/telegramChannelHistory");

  /** Прокси превью канала (t.me → зеркало), стриминг без буфера в память. */
  const tgPreviewHandler = (req, res) => {
    pipeChannelPreview(req.params.channel, req.query, res).catch((e) => {
      if (!res.headersSent) res.status(502).json({ error: e.message || String(e) });
    });
  };
  app.get("/tg-s/:channel", tgPreviewHandler);
  app.get("/tg-mirror-s/:channel", tgPreviewHandler);

  mountPlatformRoutes(app);

  const multerWrapPlatform = (mw) => (req, res, next) => {
    mw(req, res, (err) => {
      if (err) res.status(400).json({ error: err.message || String(err) });
      else next();
    });
  };

  app.post("/api/users/me/banner", requireAuth, multerWrapPlatform(uploadBanner), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Нет файла." });
    const db = getDb();
    const rel = relPath(req.file.path);
    db.prepare("UPDATE users SET banner_path = ? WHERE id = ?").run(rel, req.user.id);
    res.json({ bannerUrl: `/uploads/${rel}` });
  });

  app.use("/uploads", express.static(path.join(__dirname, "..", "data", "uploads")));

  const clientDir = path.join(__dirname, "..", "dist", "client");
  app.use(express.static(clientDir));

  setWss(wss);

  wss.on("connection", (ws, req) => {
    ws.send(JSON.stringify({ type: "state", payload: publicState() }));
    try {
      const sid = parseCookies(req)[SESSION_COOKIE];
      const hit = loadSessionUser(sid);
      ws.platformUserId = hit?.row?.id || null;
    } catch {
      ws.platformUserId = null;
    }
  });

  setupChat(wss);

  await pollTwitch(wss);
  setInterval(() => pollTwitch(wss), POLL_MS);

  /** Пока в памяти есть авторы сообщений — периодически шлём state, чтобы «активные» обновлялись без новых сообщений. */
  setInterval(() => {
    if (sessionChatterMap.size === 0) return;
    broadcast(wss, { type: "state", payload: publicState() });
  }, 2500);

  async function pollDonationAlerts() {
    if (!DONATIONALERTS_ACCESS_TOKEN) return;
    const prevErr = paidQueueService.getLastError();
    const changed = await paidQueueService.pollDonations(DONATIONALERTS_ACCESS_TOKEN, () => tracksStore.getAll());
    if (changed || paidQueueService.getLastError() !== prevErr) {
      broadcast(wss, { type: "state", payload: publicState() });
    }
  }
  setInterval(() => void pollDonationAlerts(), DONATIONALERTS_POLL_MS);
  void pollDonationAlerts();

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`http://127.0.0.1:${PORT}  (WS /ws)`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
