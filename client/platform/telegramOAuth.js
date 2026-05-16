import {
  getTelegramCallbackData,
  normalizeTelegramPayload,
  parseTelegramHash,
} from "./telegramCallback.js";

function buildOAuthUrl(botId, origin) {
  const q = new URLSearchParams({
    bot_id: String(botId),
    origin: origin || window.location.origin,
    request_access: "write",
  });
  q.set("_", String(Date.now()));
  return `https://oauth.telegram.org/auth?${q.toString()}`;
}

function parsePostMessageData(data) {
  if (!data) return null;
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (parsed?.event === "auth_result" && parsed.result) {
      return normalizeTelegramPayload(parsed.result);
    }
    return normalizeTelegramPayload(parsed);
  } catch {
    return null;
  }
}

function preferRedirectFlow() {
  try {
    return window.matchMedia("(max-width: 900px)").matches;
  } catch {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
  }
}

/** На телефоне — редирект вкладки (popup часто ломается); на ПК — popup. */
export function openTelegramOAuth(botId, { onSuccess, onError, origin }) {
  const url = buildOAuthUrl(botId, origin);

  if (preferRedirectFlow()) {
    window.location.assign(url);
    return () => {};
  }

  const popup = window.open(
    url,
    "telegram_oauth",
    "width=560,height=640,scrollbars=yes,resizable=yes"
  );

  if (!popup) {
    onError?.("Разрешите всплывающие окна для входа через Telegram.");
    return () => {};
  }

  let done = false;
  const finish = (payload, err) => {
    if (done) return;
    done = true;
    cleanup();
    try {
      popup.close();
    } catch {
      /* */
    }
    if (payload) onSuccess?.(payload);
    else onError?.(err || "Вход через Telegram отменён.");
  };

  const onMessage = (event) => {
    if (event.origin !== "https://oauth.telegram.org") return;
    const payload = parsePostMessageData(event.data);
    if (payload) finish(payload);
  };

  const poll = setInterval(() => {
    if (done) return;

    if (popup.closed) {
      if (done) return;
      const fromParent = getTelegramCallbackData();
      if (fromParent) {
        finish(fromParent);
        return;
      }
      finish(null, "Окно Telegram закрыто. Попробуйте ещё раз.");
      return;
    }

    try {
      if (popup.location.origin === window.location.origin) {
        const payload = parseTelegramHash(popup.location.hash);
        if (payload) finish(payload);
      }
    } catch {
      /* cross-origin, ждём редирект */
    }
  }, 250);

  const cleanup = () => {
    clearInterval(poll);
    window.removeEventListener("message", onMessage);
  };

  window.addEventListener("message", onMessage);

  return cleanup;
}
