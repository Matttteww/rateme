import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { useAuth } from "./AuthContext.jsx";
import { openTelegramOAuth } from "./telegramOAuth.js";

function IconTelegram() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
    </svg>
  );
}

export function TelegramLogin({ onSuccess }) {
  const { completeTelegramAuth, setTgError } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const cleanupRef = useRef(null);

  useEffect(() => {
    api("/api/config/public")
      .then(setCfg)
      .catch((e) => setLoadErr(e.message || "Не удалось загрузить настройки Telegram."));
    return () => cleanupRef.current?.();
  }, []);

  if (!cfg && !loadErr) {
    return <p className="muted tgLoginStatus">Загрузка Telegram…</p>;
  }

  if (loadErr) {
    return <p className="formErr tgLoginHint">{loadErr}</p>;
  }

  if (!cfg.telegramLoginEnabled || !cfg.telegramBotId) {
    return (
      <p className="formErr tgLoginHint">
        {cfg.telegramLoginError || "Telegram-вход недоступен. Проверьте TELEGRAM_BOT_TOKEN и перезапустите сервер."}
      </p>
    );
  }

  const startLogin = (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setTgError("");
    setLoadErr("");

    cleanupRef.current?.();
    const oauthOrigin = cfg.telegramOAuthOrigin || window.location.origin;

    cleanupRef.current = openTelegramOAuth(cfg.telegramBotId, {
      origin: oauthOrigin,
      onSuccess: async (payload) => {
        try {
          await completeTelegramAuth(payload);
          onSuccess?.();
        } catch (ex) {
          setTgError(ex.message || "Ошибка входа через Telegram");
        } finally {
          setBusy(false);
        }
      },
      onError: (msg) => {
        setTgError(msg);
        setBusy(false);
      },
    });
  };

  return (
    <div className="tgLoginWrap">
      <button type="button" className="tgOAuthBtn" onClick={startLogin} disabled={busy}>
        <IconTelegram />
        <span>{busy ? "Ожидание Telegram…" : "Войти через Telegram"}</span>
      </button>
      <p className="muted tgLoginDomainHint">
        В @BotFather: <strong>/setdomain</strong> → укажите только{" "}
        <strong>{cfg.telegramDomainHint || "127.0.0.1"}</strong> (без http и без :3847).
        <br />
        Сайт сейчас: <code>{window.location.origin}</code>
        {cfg.telegramOAuthOrigin && cfg.telegramOAuthOrigin !== window.location.origin ? (
          <>
            <br />
            OAuth origin с сервера: <code>{cfg.telegramOAuthOrigin}</code>
          </>
        ) : null}
      </p>
    </div>
  );
}
