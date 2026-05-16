const axios = require("axios");

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
let username = (process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
let botId = null;
let initError = null;
let initDone = false;

async function ensureTelegramBotInfo() {
  if (initDone) {
    return {
      enabled: Boolean(TOKEN && username),
      username: username || null,
      error: initError,
    };
  }
  initDone = true;
  initError = null;

  if (!TOKEN) {
    initError = "TELEGRAM_BOT_TOKEN не задан в .env";
    return { enabled: false, username: null, error: initError };
  }

  if (username) {
    const idPart = TOKEN.split(":")[0];
    botId = /^\d+$/.test(idPart) ? Number(idPart) : botId;
    return { enabled: true, username, botId, error: null };
  }

  try {
    const { data } = await axios.get(`https://api.telegram.org/bot${TOKEN}/getMe`, { timeout: 12000 });
    if (data?.ok && data.result?.username) {
      username = String(data.result.username).trim();
      botId = data.result.id != null ? Number(data.result.id) : null;
      console.log(`[telegram] бот @${username} id=${botId} (getMe)`);
      return { enabled: true, username, botId, error: null };
    }
    initError = data?.description || "getMe вернул ошибку";
  } catch (e) {
    initError = e.message || String(e);
  }

  console.warn("[telegram] не удалось получить username:", initError);
  return { enabled: false, username: null, error: initError };
}

function resolveTelegramDomainHint() {
  const raw = (process.env.TELEGRAM_PUBLIC_DOMAIN || process.env.PUBLIC_HOST || "").trim();
  if (raw) {
    try {
      const u = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
      return u.hostname;
    } catch {
      return raw.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    }
  }
  const oauth = (process.env.TELEGRAM_OAUTH_ORIGIN || process.env.PUBLIC_URL || "").trim();
  if (oauth) {
    try {
      const u = new URL(oauth.includes("://") ? oauth : `http://${oauth}`);
      return u.hostname;
    } catch {
      /* */
    }
  }
  return "127.0.0.1";
}

function resolveTelegramOAuthOrigin() {
  const explicit = (process.env.TELEGRAM_OAUTH_ORIGIN || process.env.PUBLIC_URL || "").trim();
  if (!explicit) return null;
  try {
    const u = new URL(explicit.includes("://") ? explicit : `http://${explicit}`);
    return u.origin;
  } catch {
    return explicit.replace(/\/$/, "");
  }
}

function getTelegramPublicConfig() {
  const domainHint = resolveTelegramDomainHint();
  const oauthOrigin = resolveTelegramOAuthOrigin();
  return {
    telegramLoginEnabled: Boolean(TOKEN && username && botId),
    telegramBotUsername: username || null,
    telegramBotId: botId || null,
    telegramLoginError: initError,
    telegramDomainHint: domainHint,
    telegramOAuthOrigin: oauthOrigin,
  };
}

module.exports = { ensureTelegramBotInfo, getTelegramPublicConfig, TELEGRAM_BOT_TOKEN: TOKEN };
