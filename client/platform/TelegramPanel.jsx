import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";

function formatCount(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(ts) {
  if (!ts) return "ещё не было";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildInfoFromUser(user) {
  const channel = user?.telegramChannel || null;
  return {
    channel,
    meta: user?.telegramChannelMeta || null,
    publicLink: channel ? `https://t.me/${channel.replace(/^@/, "")}` : null,
    syncedPostsCount: null,
    lastSyncedAt: null,
    botConfigured: null,
    botUsername: null,
    streamerUsername: null,
    isStreamer: Boolean(user?.isStreamer),
  };
}

const TG_INBOX_STATUS = {
  pending: { label: "Новый", tone: "pending" },
  published: { label: "В ленте", tone: "published" },
  dismissed: { label: "Скрыт", tone: "dismissed" },
};

function TgInboxCard({ item, busy, onPublish, onDismiss }) {
  const st = TG_INBOX_STATUS[item.status] || TG_INBOX_STATUS.pending;

  return (
    <li className={`tgInboxCard tgInboxCard--${st.tone}`}>
      <header className="tgInboxCard__head">
        <div className="tgInboxCard__headMain">
          <span className="tgInboxCard__tgMark" aria-hidden>
            TG
          </span>
          <span className={`tgInboxCard__status tgInboxCard__status--${st.tone}`}>{st.label}</span>
          <span className="tgInboxCard__id">#{item.telegramMessageId}</span>
          {item.hasMedia && (
            <span className="tgInboxCard__mediaTag" title="Есть вложения">
              медиа
            </span>
          )}
        </div>
        {item.channelMessageLink && (
          <a
            className="tgInboxCard__link"
            href={item.channelMessageLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть в TG
          </a>
        )}
      </header>

      <div className="tgInboxCard__content">
        {item.body ? <p className="tgInboxCard__text">{item.body}</p> : null}
        <TgInboxMedia
          media={item.media}
          hasAttachmentsHint={Boolean(item.hasMedia)}
          telegramLink={item.channelMessageLink}
        />
      </div>

      {item.status === "pending" && (
        <footer className="tgInboxCard__foot">
          <button
            type="button"
            className="tgInboxCard__btn tgInboxCard__btn--publish"
            disabled={busy}
            onClick={() => onPublish(item.id)}
          >
            В ленту
          </button>
          <button
            type="button"
            className="tgInboxCard__btn tgInboxCard__btn--hide"
            disabled={busy}
            onClick={() => onDismiss(item.id)}
          >
            Скрыть
          </button>
        </footer>
      )}
    </li>
  );
}

function TgInboxMedia({ media, hasAttachmentsHint = false, telegramLink }) {
  const list = Array.isArray(media) ? media : [];
  const nodes = [];

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.stickerPlaceholder) {
      nodes.push(
        <p key={i} className="tgInboxMediaPlaceholder muted">
          Стикер — превью не извлечено из t.me, откройте пост в приложении Telegram.
        </p>
      );
      continue;
    }
    if (m.kind === "audio" && (m.placeholder || !m.url)) {
      nodes.push(
        <p key={i} className="tgInboxMediaPlaceholder muted">
          Аудио / трек — в веб-превью Telegram часто не отдаёт прямую ссылку. Откройте пост в Telegram или
          публикуйте через бота.
        </p>
      );
      continue;
    }
    if ((m.placeholder || !m.url) && (m.kind === "image" || m.kind === "file")) {
      nodes.push(
        <p key={i} className="tgInboxMediaPlaceholder muted">
          Картинка / файл уточняется… Если не появится, откройте пост в Telegram.
        </p>
      );
      continue;
    }
    if (m.placeholder && !m.url) {
      nodes.push(
        <p key={i} className="tgInboxMediaPlaceholder muted">
          Вложение — откройте в Telegram.
        </p>
      );
      continue;
    }
    if (!m.url) continue;
    if (m.kind === "image") {
      nodes.push(
        <img
          key={i}
          src={m.url}
          alt=""
          className="tgInboxMediaImg"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget;
            if (m.originalUrl && !el.dataset.tgFallback) {
              el.dataset.tgFallback = "1";
              el.src = m.originalUrl;
            }
          }}
        />
      );
      continue;
    }
    if (m.kind === "video") {
      nodes.push(<video key={i} src={m.url} controls className="tgInboxMediaVid" preload="metadata" referrerPolicy="no-referrer" />);
      continue;
    }
    if (m.kind === "audio") {
      nodes.push(<audio key={i} src={m.url} controls className="tgInboxMediaAud" preload="metadata" referrerPolicy="no-referrer" />);
      continue;
    }
    nodes.push(
      <a key={i} className="tgInboxMediaLink" href={m.url} target="_blank" rel="noopener noreferrer">
        📎 Вложение
      </a>
    );
  }

  if (nodes.length === 0 && hasAttachmentsHint) {
    nodes.push(
      <div key="fb" className="tgInboxMediaFallback muted">
        <p className="tgInboxMediaPlaceholder">
          Превью вложений с t.me недоступно (пустой список в данных). Откройте пост в Telegram
          {telegramLink ? (
            <>
              :{" "}
              <a href={telegramLink} target="_blank" rel="noopener noreferrer">
                перейти
              </a>
            </>
          ) : (
            "."
          )}
        </p>
      </div>
    );
  }

  if (nodes.length === 0) return null;
  return <div className="tgInboxMedia">{nodes}</div>;
}

async function fetchTelegramChannelInfo() {
  try {
    return await api("/api/users/me/telegram-channel");
  } catch (e) {
    if (!String(e.message).includes("нет этого API") && !String(e.message).includes("Cannot GET")) {
      throw e;
    }
    return await api("/api/telegram/my-channel");
  }
}

export function TelegramPanel() {
  const { user, refresh } = useAuth();
  const [channel, setChannel] = useState(user?.telegramChannel || "");
  const [info, setInfo] = useState(() => buildInfoFromUser(user));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [needsServerRestart, setNeedsServerRestart] = useState(false);
  const [syncMode, setSyncMode] = useState(user?.telegramSyncMode || "manual");
  const [inbox, setInbox] = useState([]);
  const [inboxFilter, setInboxFilter] = useState("all");

  const loadInbox = useCallback(async (filter = inboxFilter) => {
    try {
      const j = await api(
        `/api/users/me/telegram-inbox?status=${encodeURIComponent(filter)}&limit=80`
      );
      setInbox(j.items || []);
    } catch {
      /* Не затираем список при сетевой ошибке — иначе посты «исчезают» после «Обновить» */
    }
  }, [inboxFilter]);

  const importViaBrowserPreview = useCallback(async (channelName, limit = 50, signal) => {
    const slug = String(channelName || "")
      .trim()
      .replace(/^@+/, "")
      .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
      .split("/")[0];
    if (!slug) throw new Error("Укажите @username канала.");
    const paths = [`/tg-s/${encodeURIComponent(slug)}`, `/tg-mirror-s/${encodeURIComponent(slug)}`];
    let lastErr = "Не удалось открыть канал";
    for (const path of paths) {
      try {
        const r = await fetch(path, { credentials: "include", signal });
        const html = await r.text();
        if (!r.ok) {
          try {
            const j = JSON.parse(html);
            lastErr = j.error || `HTTP ${r.status}`;
          } catch {
            lastErr = `HTTP ${r.status}`;
          }
          continue;
        }
        if (!html.includes("data-post=")) {
          lastErr = "Страница канала пуста или канал приватный.";
          continue;
        }
        return api("/api/users/me/telegram-inbox/import-preview", {
          method: "POST",
          body: JSON.stringify({ html, limit }),
          signal,
        });
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        lastErr = e.message || lastErr;
      }
    }
    throw new Error(lastErr);
  }, []);

  const importChannelHistory = useCallback(
    async (silent = false) => {
      if (!silent) {
        setBusy(true);
        setErr("");
      }
      const channelName = channel || user?.telegramChannel;

      const finish = async (j) => {
        if (j.items) setInbox(j.items);
        setInfo((prev) => ({ ...prev, pendingInboxCount: j.pendingInboxCount }));
        if (!silent) {
          const via =
            j.source === "browser"
              ? " (через браузер)"
              : j.source === "rss"
                ? " (через RSS)"
                : j.source === "mirror"
                  ? " (зеркало)"
                  : j.source && j.source !== "server"
                    ? ` (${j.source})`
                    : "";
          const mediaHint = j.mediaEnrichScheduled
            ? " Превью картинок/видео догружается на сервере 10–60 с — потом нажмите «Обновить»."
            : "";
          setMsg(
            j.imported > 0
              ? `Загружено постов: ${j.imported}${j.skipped ? `, уже были: ${j.skipped}` : ""}${via}.${mediaHint}`
              : `Новых постов не найдено — всё уже в списке${via}${mediaHint}`
          );
        }
        return j;
      };
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 95000);
      try {
        try {
          const j = await api("/api/users/me/telegram-inbox/import-history", {
            method: "POST",
            body: JSON.stringify({ limit: 50 }),
            signal: ctrl.signal,
          });
          return await finish(j);
        } catch (serverEx) {
          if (ctrl.signal.aborted) {
            throw new Error("Таймаут загрузки постов (~95 с). Попробуйте снова или включите VPN.");
          }
          if (!channelName) throw serverEx;
          const j = await importViaBrowserPreview(channelName, 50, ctrl.signal);
          return await finish(j);
        }
      } catch (ex) {
        if (!silent) {
          setErr(
            ex.name === "AbortError"
              ? "Таймаут загрузки. Проверьте интернет или VPN и попробуйте снова."
              : ex.message
          );
        }
        return null;
      } finally {
        clearTimeout(abortTimer);
        if (!silent) setBusy(false);
      }
    },
    [channel, user?.telegramChannel, importViaBrowserPreview]
  );

  const loadInfo = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr("");
    setNeedsServerRestart(false);
    setInfo(buildInfoFromUser(user));
    setChannel(user.telegramChannel || "");
    try {
      const j = await Promise.race([
        fetchTelegramChannelInfo(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Таймаут загрузки канала")), 20000)),
      ]);
      setInfo(j);
      setChannel(j.channel || "");
      setSyncMode(j.syncMode || user.telegramSyncMode || "manual");
      await Promise.race([
        loadInbox("all"),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (e) {
      const restart = String(e.message).includes("перезапуск") || String(e.message).includes("нет этого API");
      setNeedsServerRestart(restart);
      if (!restart) setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, loadInbox]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    if (!channel) return;
    const t = setInterval(() => loadInbox(inboxFilter), 20000);
    return () => clearInterval(t);
  }, [channel, loadInbox, inboxFilter]);

  useEffect(() => {
    if (channel) loadInbox(inboxFilter);
  }, [inboxFilter, channel, loadInbox]);

  useEffect(() => {
    if (!user) return;
    setChannel(user.telegramChannel || "");
    if (user.telegramChannelMeta) {
      setInfo((prev) => ({
        ...prev,
        channel: user.telegramChannel,
        meta: user.telegramChannelMeta,
        publicLink: user.telegramChannel ? `https://t.me/${user.telegramChannel}` : null,
      }));
    }
  }, [user?.telegramChannel, user?.telegramChannelMeta]);

  if (!user) return null;

  const meta = info?.meta || user.telegramChannelMeta;
  const publicLink =
    info?.publicLink || (channel ? `https://t.me/${String(channel).replace(/^@/, "")}` : null);

  const saveChannel = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    setWarnings([]);
    setNeedsServerRestart(false);
    try {
      const j = await api("/api/users/me/telegram-channel", {
        method: "PATCH",
        body: JSON.stringify({ channel }),
      });
      await refresh();
      setInfo((prev) => ({ ...prev, ...j }));
      setChannel(j.channel || channel);
      setWarnings(j.warnings || []);
      setSyncMode(j.syncMode || syncMode);
      await loadInbox();
      setMsg("Канал привязан и проверен");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshStats = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const j = await api("/api/users/me/telegram-channel/refresh", { method: "POST", body: "{}" });
      await refresh();
      setInfo((prev) => ({ ...prev, ...j }));
      setMsg("Данные канала обновлены");
      setNeedsServerRestart(false);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const setSyncModeAndSave = async (mode) => {
    setBusy(true);
    setErr("");
    try {
      let j;
      try {
        j = await api("/api/users/me/telegram-sync-mode", {
          method: "PATCH",
          body: JSON.stringify({ syncMode: mode }),
        });
      } catch {
        j = await api("/api/users/me/telegram-channel", {
          method: "PATCH",
          body: JSON.stringify({ channel, syncMode: mode }),
        });
      }
      await refresh();
      setSyncMode(j.syncMode || mode);
      setMsg(mode === "auto" ? "Включена автопубликация в ленту" : "Ручной выбор постов на сайте");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const publishInbox = async (id) => {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/users/me/telegram-inbox/${id}/publish`, { method: "POST", body: "{}" });
      await loadInbox(inboxFilter);
      await loadInfo();
      setMsg("Пост опубликован в ленте");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const dismissInbox = async (id) => {
    setBusy(true);
    try {
      await api(`/api/users/me/telegram-inbox/${id}/dismiss`, { method: "POST", body: "{}" });
      await loadInbox(inboxFilter);
      setMsg("Пост скрыт");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const unlinkChannel = async () => {
    if (!window.confirm("Отвязать канал? Автосинх постов остановится.")) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await api("/api/users/me/telegram-channel", { method: "DELETE" });
      await refresh();
      setChannel("");
      setInbox([]);
      setInfo((prev) => ({
        ...prev,
        channel: null,
        meta: null,
        publicLink: null,
        pendingInboxCount: 0,
      }));
      setWarnings([]);
      setMsg("Канал отвязан");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tgPanel">
      <section className="settingsCard tgPanelCard">
        <div className="tgPanelHead">
          <div className="tgPanelHeadIcon" aria-hidden>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
            </svg>
          </div>
          <div>
            <h2 className="settingsCardTitle">Telegram-канал</h2>
            <p className="settingsCardSub muted">
              Посты из канала попадают во «Входящие» — вы сами решаете, что опубликовать в ленте.
            </p>
          </div>
        </div>

        {needsServerRestart && (
          <p className="settingsToast settingsToast--err" role="alert">
            Перезапустите сервер: в терминале Ctrl+C, затем снова <strong>npm run dev</strong>. Сейчас
            работает старая версия API.
          </p>
        )}

        {user.telegramLinked ? (
          <p className="tgPanelStatus tgPanelStatus--ok">Аккаунт Telegram привязан</p>
        ) : (
          <p className="tgPanelStatus tgPanelStatus--warn">
            Сначала войдите через Telegram на странице входа
          </p>
        )}

        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {meta && channel && (
              <div className="tgChannelCard">
                <div className="tgChannelCardTop">
                  <div>
                    <h3 className="tgChannelTitle">{meta.title || channel}</h3>
                    {publicLink && (
                      <a
                        href={publicLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tgChannelLink"
                      >
                        @{meta.username || String(channel).replace(/^@/, "")}
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    className="tgRefreshBtn"
                    onClick={refreshStats}
                    disabled={busy || needsServerRestart}
                    title="Обновить статистику"
                  >
                    ↻
                  </button>
                </div>
                <div className="tgChannelStats">
                  <div className="tgStat">
                    <span className="tgStatVal">{formatCount(meta.memberCount)}</span>
                    <span className="tgStatLab muted">подписчиков</span>
                  </div>
                  <div className="tgStat">
                    <span className="tgStatVal">
                      {info?.syncedPostsCount != null ? info.syncedPostsCount : "—"}
                    </span>
                    <span className="tgStatLab muted">постов в ленте</span>
                  </div>
                  <div className="tgStat">
                    <span className="tgStatVal tgStatVal--sm">
                      {info?.lastSyncedAt != null ? formatDate(info.lastSyncedAt) : "—"}
                    </span>
                    <span className="tgStatLab muted">последний синк</span>
                  </div>
                </div>
                {meta.description && <p className="tgChannelDesc muted">{meta.description}</p>}
                {meta.botIsAdmin != null && (
                  <div className="tgBotFlags">
                    <span className={`tgFlag ${meta.botIsAdmin ? "tgFlag--ok" : "tgFlag--bad"}`}>
                      {meta.botIsAdmin ? "✓ Бот — админ канала" : "✗ Бот не админ канала"}
                    </span>
                    {info?.botUsername && (
                      <span className="tgFlag tgFlag--muted">@{info.botUsername}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            <form className="settingsForm" onSubmit={saveChannel}>
              <div className="settingsField">
                <label className="settingsLabel" htmlFor="tg-channel-input">
                  Username канала
                </label>
                <div className="tgChannelInputRow">
                  <span className="tgChannelPrefix">@</span>
                  <input
                    id="tg-channel-input"
                    className="settingsInput tgChannelInput"
                    value={String(channel).replace(/^@/, "")}
                    onChange={(e) => setChannel(e.target.value.replace(/^@/, ""))}
                    placeholder="my_channel"
                    disabled={!user.telegramLinked || busy}
                  />
                </div>
              </div>
              <div className="tgPanelActions">
                <button
                  type="submit"
                  className="settingsSubmit"
                  disabled={!user.telegramLinked || busy}
                >
                  {busy ? "…" : meta ? "Сохранить" : "Привязать канал"}
                </button>
                {channel && (
                  <button
                    type="button"
                    className="settingsSubmit settingsSubmit--ghost"
                    onClick={unlinkChannel}
                    disabled={busy}
                  >
                    Отвязать
                  </button>
                )}
              </div>
            </form>

            {channel && (
              <>
                <div className="tgSyncMode">
                  <button
                    type="button"
                    className={`tgSyncModeBtn ${syncMode === "manual" ? "tgSyncModeBtn--active" : ""}`}
                    disabled={busy}
                    onClick={() => setSyncModeAndSave("manual")}
                  >
                    Выбирать на сайте
                  </button>
                  <button
                    type="button"
                    className={`tgSyncModeBtn ${syncMode === "auto" ? "tgSyncModeBtn--active" : ""}`}
                    disabled={busy}
                    onClick={() => setSyncModeAndSave("auto")}
                  >
                    Сразу в ленту
                  </button>
                </div>

                {syncMode === "manual" && (
                  <section className="tgInboxSection">
                    <div className="tgInboxHead">
                      <h3>Входящие из Telegram</h3>
                      {(info?.pendingInboxCount > 0 || inbox.length > 0) && (
                        <span className="tgInboxBadge">{inbox.length || info.pendingInboxCount}</span>
                      )}
                    </div>
                    <p className="muted tgInboxHint">
                      Показываются и старые посты канала (до 50), и новые от бота. Выберите, что опубликовать в ленте.
                    </p>
                    <div className="tgInboxFilters">
                      {[
                        ["all", "Все"],
                        ["pending", "Новые"],
                        ["published", "В ленте"],
                        ["dismissed", "Скрытые"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          className={`tgInboxFilterBtn ${inboxFilter === key ? "tgInboxFilterBtn--active" : ""}`}
                          disabled={busy}
                          onClick={() => setInboxFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="tgInboxToolbar">
                      <button
                        type="button"
                        className="settingsSubmit settingsSubmit--ghost"
                        disabled={busy}
                        onClick={() => importChannelHistory(false)}
                      >
                        Загрузить из канала
                      </button>
                      <button
                        type="button"
                        className="settingsSubmit settingsSubmit--ghost"
                        disabled={busy}
                        onClick={() => loadInbox(inboxFilter)}
                      >
                        Обновить
                      </button>
                    </div>
                    {inbox.length === 0 ? (
                      <div className="tgInboxEmpty muted">
                        Список пуст. Нажмите «Загрузить из канала» — подтянутся последние посты с публичной страницы
                        @канала (текст и превью медиа подгружаются автоматически). Для новых постов бот должен быть
                        админом.
                      </div>
                    ) : (
                      <ul className="tgInboxList">
                        {inbox.map((item) => (
                          <TgInboxCard
                            key={item.id}
                            item={item}
                            busy={busy}
                            onPublish={publishInbox}
                            onDismiss={dismissInbox}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}

            <details className="tgPanelHelp">
              <summary>Как подключить бота</summary>
              <ol className="tgHelpList">
                <li>
                  Добавьте бота <strong>@{info?.botUsername || "ваш_бот"}</strong> администратором канала.
                </li>
                <li>
                  Запустите <code>ChannelFileBot</code> с тем же <code>BottwichStreamerUsername</code> (
                  {info?.streamerUsername || user.username}).
                </li>
                <li>
                  <code>BottwichUsePlatformChannel</code>: true — канал с сайта подставится в бота.
                </li>
                <li>Один секрет <code>BOTTWICH_SYNC_SECRET</code> в .env и appsettings.</li>
              </ol>
            </details>
          </>
        )}

        {msg && !err && <p className="settingsToast settingsToast--ok">{msg}</p>}
        {err && <p className="settingsToast settingsToast--err">{err}</p>}
        {warnings.length > 0 && (
          <ul className="tgWarnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
