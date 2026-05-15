import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { TrackArchive } from "./TrackArchive.jsx";
import { TrackFormPanel } from "./TrackFormPanel.jsx";
import { StreamPanel } from "./StreamPanel.jsx";
import { PaidQueuePanel } from "./PaidQueuePanel.jsx";
import { AuthProvider, useAuth } from "./platform/AuthContext.jsx";
import { PlatformApp } from "./platform/PlatformApp.jsx";
import { writeAppHash } from "./platform/hashRouter.js";
import "./styles.css";
import "./platform/platform-ui.css";

function useWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.DEV ? `${window.location.hostname}:3847` : window.location.host;
  return `${proto}//${host}/ws`;
}

const PLATFORM_DEFAULT = "feed";

const STREAMER_TABS = [
  { id: "stream", label: "Стрим" },
  { id: "catalog", label: "Каталог TG" },
  { id: "paidQueue", label: "Платная очередь" },
  { id: "addTrack", label: "Новый трек" },
];

/** Список ников из state.activeChatters (уже отфильтровано на сервере по окну ~60 с). */
function buildActiveChatNickCloud(state) {
  const rows = Array.isArray(state?.activeChatters) ? state.activeChatters : [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const raw = row.user != null && String(row.user).trim() !== "" ? row.user : row.displayName;
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const lk = s.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(s);
  }
  return { nicks: out, count: out.length };
}

function AppInner() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [streamView, setStreamView] = useState(null);
  const wsUrl = useMemo(() => useWsUrl(), []);
  const activeChatCloud = useMemo(() => buildActiveChatNickCloud(state), [state?.activeChatters]);
  const isStreamer = Boolean(user?.isStreamer);
  const showPlatform = streamView === null;

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state" && msg.payload) {
          setState(msg.payload);
        }
      } catch {
        /* ignore */
      }
    };
    fetch("/api/state")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
    return () => ws.close();
  }, [wsUrl]);

  return (
    <div className={`shell ${showPlatform && !streamView ? "shell--platform" : ""}`}>
      {(!showPlatform || streamView || (showPlatform && isStreamer)) && (
      <header className={`head ${showPlatform && !streamView ? "head--compact" : ""}`}>
        <div className="headLeft">
          {!(showPlatform && !streamView) && <h1>РЭЙТМИ</h1>}
          <nav className="mainTabs" aria-label="Раздел приложения">
            {(!showPlatform || streamView) && (
            <button
              type="button"
              className={`mainTab ${showPlatform && !streamView ? "" : "mainTab--active"}`}
              onClick={() => {
                setStreamView(null);
                writeAppHash({ section: PLATFORM_DEFAULT });
              }}
            >
              Соцсеть
            </button>
            )}
            {isStreamer &&
              STREAMER_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`mainTab ${streamView === t.id ? "mainTab--active" : ""}`}
                  onClick={() => setStreamView(t.id)}
                >
                  {t.label}
                </button>
              ))}
          </nav>
          {streamView === "stream" && (
            <p className="sub">
              Канал: <span className="mono">{state?.channel || "…"}</span>
              {state?.chatConnected ? (
                <span className="pill ok">чат</span>
              ) : (
                <span className="pill bad">чат</span>
              )}
            </p>
          )}
          {streamView === "addTrack" && (
            <p className="sub subMuted">
              Форма сохраняет трек в каталог. Среднюю чата в каталоге при опросе подставляется автоматически.
            </p>
          )}
          {streamView === "catalog" && (
            <p className="sub subMuted">
              Список и топы. «Оценки» у трека из TG сразу запускают опрос в чате; «сохранить» в панели сохраняет среднюю чата и завершает опрос.
            </p>
          )}
          {streamView === "paidQueue" && (
            <p className="sub subMuted">
              DonationAlerts: новые донаты с текстом подбираются к трекам из каталога. Токен — в .env на сервере.
            </p>
          )}
        </div>
      </header>
      )}

      {showPlatform && <PlatformApp />}

      {streamView === "stream" && (state?.chatError || state?.lastPollError) && (
        <div className="banner">
          {state?.chatError && <div>Чат: {state.chatError}</div>}
          {state?.lastPollError && <div>Опрос API: {state.lastPollError}</div>}
        </div>
      )}

      {streamView === "stream" && <StreamPanel state={state} />}

      {streamView === "stream" && (
        <section className="grid streamStackGrid">
          <div className="streamAudienceCard">
            <header className="streamAudienceCardHead">
              <h2 className="streamAudienceCardTitle">Зрители и чат</h2>
            </header>

            <div className="streamViewersTile" aria-label="Зрители по Twitch">
              <div className="streamViewersTileText">
                <span className="streamViewersTileLab">Зрителей</span>
                <span className="streamViewersTileHint">данные Twitch для текущего стрима</span>
              </div>
              <span className="streamViewersTileVal mono">{state?.viewerCount ?? "—"}</span>
            </div>

            <section className="streamChattersBlock" aria-labelledby="stream-chatters-heading">
              <div className="streamChattersHead">
                <div className="streamChattersHeadText">
                  <h3 className="streamChattersTitle" id="stream-chatters-heading">
                    Активные в чате
                  </h3>
                </div>
                <div className="streamChattersBadge mono" title="Сколько человек сейчас в «минутном» окне">
                  {activeChatCloud.count}
                </div>
              </div>
              <div className="streamNickCloud">
                {activeChatCloud.nicks.map((n, i) => (
                  <span key={`ac-${n}-${i}`} className="nick">
                    {n}
                  </span>
                ))}
                {activeChatCloud.count === 0 && (
                  <span className="streamNickCloudEmpty muted">никто не писал последнюю минуту (или чат не подключён)</span>
                )}
              </div>
            </section>

            <div className="streamTopsDual">
              <div className="streamTopCard">
                <div className="streamTopCardHead">
                  <h4 className="streamTopCardTitle">Топ в чате</h4>
                  <span className="streamTopCardTag">сессия</span>
                </div>
                <p className="streamTopCardSub">Сообщений за сессию</p>
                <ol className="streamTopList">
                  {(state?.topMessagers || []).map((row, i) => (
                    <li key={`m-${row.user}-${i}`}>
                      <span className="streamTopName">{row.user}</span>
                      <span className="streamTopNum mono">{row.count}</span>
                    </li>
                  ))}
                  {(!state?.topMessagers || state.topMessagers.length === 0) && (
                    <li className="streamTopListEmpty muted">ещё нет сообщений</li>
                  )}
                </ol>
              </div>

              <div className="streamTopCard">
                <div className="streamTopCardHead">
                  <h4 className="streamTopCardTitle">Топ оценок</h4>
                  <span className="streamTopCardTag">сессия</span>
                </div>
                <p className="streamTopCardSub">Сколько раз написали оценку 0–10 в чат</p>
                <ol className="streamTopList">
                  {(state?.topRaters || []).map((row, i) => (
                    <li key={`r-${row.user}-${i}`}>
                      <span className="streamTopName">{row.user}</span>
                      <span className="streamTopNum mono">{row.count}</span>
                    </li>
                  ))}
                  {(!state?.topRaters || state.topRaters.length === 0) && (
                    <li className="streamTopListEmpty muted">ещё нет оценок</li>
                  )}
                </ol>
              </div>
            </div>
          </div>
        </section>
      )}

      {streamView === "addTrack" && (
        <div className="catalogPage">
          <TrackFormPanel liveAverage={state?.average} />
        </div>
      )}

      {streamView === "catalog" && (
        <div className="catalogPage">
          <TrackArchive state={state} />
        </div>
      )}

      {streamView === "paidQueue" && (
        <div className="catalogPage">
          <PaidQueuePanel state={state} />
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
