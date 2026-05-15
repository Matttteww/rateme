import React, { useMemo } from "react";

function formatUptimeMs(iso) {
  if (!iso) return null;
  const start = new Date(iso).getTime();
  const sec = Math.floor((Date.now() - start) / 1000);
  if (!Number.isFinite(sec) || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s} с`;
  return `${s} с`;
}

function formatSessionDuration(startedAt) {
  if (!startedAt) return "—";
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} ч ${m % 60} мин`;
  return `${m} мин`;
}

function RatingHistogram({ hist, maxH = 72 }) {
  if (!hist || !hist.length) return null;
  const max = Math.max(1, ...hist);
  return (
    <div className="histWrap" aria-label="Распределение оценок 0–10">
      <div className="histBars">
        {hist.map((count, score) => (
          <div key={score} className="histCol">
            <div
              className="histBar"
              style={{ height: `${Math.max(4, (count / max) * maxH)}px` }}
              title={`${score}: ${count}`}
            />
            <span className="histLab mono">{score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StreamPanel({ state }) {
  const sm = state?.streamMeta;
  const rs = state?.ratingStats;

  const displayTitle = useMemo(() => {
    if (!sm) return null;
    if (sm.isLive) return sm.title;
    return sm.offlineTitle || sm.title || null;
  }, [sm]);

  const displayGame = useMemo(() => {
    if (!sm) return null;
    if (sm.isLive) return sm.gameName;
    return sm.offlineGameName || sm.gameName || null;
  }, [sm]);

  const viewers = state?.viewerCount ?? sm?.viewerCount ?? null;
  const chatters = state?.chatterCount ?? 0;
  const chatShare =
    viewers && viewers > 0 ? Math.min(100, Math.round((chatters / viewers) * 1000) / 10) : null;

  const uptime = sm?.isLive && sm?.startedAt ? formatUptimeMs(sm.startedAt) : null;

  return (
    <section className="streamPanel" aria-label="Информация о стриме">
      <div className="streamPanelGrid">
        <div className="streamHero card">
          {sm?.thumbnailUrl && sm?.isLive && (
            <div className="streamThumbWrap">
              <img className="streamThumb" src={sm.thumbnailUrl} alt="" width={320} height={180} loading="lazy" />
              <span className="streamLiveBadge">LIVE</span>
            </div>
          )}
          <div className="streamHeroText">
            <div className="streamHeroTop">
              <span className={`streamStatePill ${sm?.isLive ? "streamStatePill--live" : "streamStatePill--off"}`}>
                {sm?.isLive ? "В эфире" : "Офлайн"}
              </span>
              {uptime && <span className="streamUptime mono">онлайн: {uptime}</span>}
            </div>
            <h2 className="streamTitle">{displayTitle || "—"}</h2>
            <p className="streamGame">{displayGame ? `Категория: ${displayGame}` : "Категория не указана"}</p>
            {sm?.language && <p className="streamLang mono">язык эфира: {sm.language}</p>}
            <p className="streamChan mono">
              {state?.channelDisplayName || state?.channel || "—"}
              {state?.channel ? <span className="muted"> · {state.channel}</span> : null}
            </p>
          </div>
        </div>

        <div className="streamMetrics card">
          <h3 className="streamPanelH3">Прямо сейчас</h3>
          <div className="metricTiles">
            <div className="metricTile">
              <span className="metricVal mono">{viewers ?? "—"}</span>
              <span className="metricLab">зрителей (Twitch)</span>
            </div>
            <div className="metricTile">
              <span className="metricVal mono">{chatters}</span>
              <span className="metricLab">в списке чата</span>
            </div>
            <div className="metricTile">
              <span className="metricVal mono">{chatShare != null ? `${chatShare}%` : "—"}</span>
              <span className="metricLab">чат / зрители</span>
            </div>
            <div className="metricTile">
              <span className="metricVal mono">{state?.pollTrackId ? (state?.average != null ? Number(state.average).toFixed(2) : "—") : "—"}</span>
              <span className="metricLab">средняя (опрос в каталоге)</span>
            </div>
          </div>
          <p className="streamHint muted">
            «В чате» — люди из API чата канала (не все зрители). Числа 0–10 принимаются, когда в каталоге открыта панель «оценки» по этому треку; опрос заканчивается по «сохранить» в панели.
          </p>
        </div>
      </div>

      <div className="streamPanelRow">
        <div className="card streamSessionCard">
          <h3 className="streamPanelH3">Сессия (с запуска бота)</h3>
          <div className="metricTiles metricTiles--sm">
            <div className="metricTile">
              <span className="metricVal mono">{formatSessionDuration(state?.sessionStartedAt)}</span>
              <span className="metricLab">длительность</span>
            </div>
            <div className="metricTile">
              <span className="metricVal mono">{state?.sessionMessageCount ?? 0}</span>
              <span className="metricLab">сообщений учтено</span>
            </div>
            <div className="metricTile">
              <span className="metricVal mono">{state?.sessionRatingVoteCount ?? 0}</span>
              <span className="metricLab">голосов за сессию</span>
            </div>
            <div className="metricTile">
              <span className="metricVal mono">{state?.pollTrackId ? state?.ratings?.length ?? 0 : "—"}</span>
              <span className="metricLab">голосов в активном опросе</span>
            </div>
          </div>
        </div>

        <div className="card streamVotesCard">
          <h3 className="streamPanelH3">Анализ голосов за опрос</h3>
          {!state?.pollTrackId ? (
            <p className="muted">
              Гистограмма и разброс появятся, когда в «Каталоге треков» откроешь «оценки» у трека — опрос включится сразу, чат голосует за этот трек до «сохранить».
            </p>
          ) : !rs ? (
            <p className="muted">Пока никто не написал в чат число 0–10.</p>
          ) : (
            <>
              <div className="voteSummary mono">
                <span>
                  <strong>{rs.count}</strong> голосов
                </span>
                <span>
                  min <strong>{rs.min}</strong>
                </span>
                <span>
                  max <strong>{rs.max}</strong>
                </span>
                <span>
                  avg <strong>{rs.avg.toFixed(2)}</strong>
                </span>
                <span>
                  медиана <strong>{Number.isInteger(rs.median) ? rs.median : rs.median.toFixed(1)}</strong>
                </span>
              </div>
              <RatingHistogram hist={rs.hist} />
            </>
          )}
        </div>
      </div>

      <div className="streamFooter muted mono">
        Обновление данных Twitch и списка чата: каждые {(state?.pollIntervalMs ?? 20000) / 1000} с · чат в реальном
        времени · {state?.serverTime ? new Date(state.serverTime).toLocaleTimeString() : ""}
      </div>
    </section>
  );
}
