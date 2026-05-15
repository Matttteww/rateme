import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { SectionHero } from "./SectionHero.jsx";

function RankBadge({ rank, variant = "track" }) {
  const r = Number(rank);
  if (r >= 1 && r <= 3) {
    return (
      <span className={`topsRank topsRank--podium topsRank--podium${r} topsRank--${variant}`} aria-label={`Место ${r}`}>
        {r}
      </span>
    );
  }
  return (
    <span className={`topsRank topsRank--plain topsRank--${variant}`} aria-hidden>
      #{r}
    </span>
  );
}

function TopArtistRow({ row, onViewProfile }) {
  const nick = row.displayName || row.username;
  return (
    <article className="topsArtistCard">
      <RankBadge rank={row.rank} />
      <button type="button" className="topsArtistCard__main" onClick={() => onViewProfile?.(row.username)}>
        {row.avatarUrl ? (
          <img src={row.avatarUrl} alt="" className="topsArtistCard__avatar" />
        ) : (
          <span className="topsArtistCard__avatar topsArtistCard__avatar--empty">
            {nick.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="topsArtistCard__meta">
          <span className="topsArtistCard__name">{nick}</span>
          <span className="topsArtistCard__handle">@{row.username}</span>
        </span>
      </button>
      <div className="topsArtistCard__stats">
        {row.avgScore != null ? (
          <span className="topsArtistCard__score">
            <strong>{row.avgScore.toFixed(1)}</strong>
            <span className="muted"> / 10</span>
          </span>
        ) : (
          <span className="topsArtistCard__score muted">—</span>
        )}
        <span className="topsArtistCard__sub muted">
          {row.totalRatings > 0
            ? `${row.totalRatings} оценок · ${row.ratedTracksCount} треков`
            : `${row.ratedTracksCount} треков`}
        </span>
      </div>
    </article>
  );
}

export function TopPage({ onViewProfile }) {
  const [tab, setTab] = useState("tracks");
  const [tracks, setTracks] = useState([]);
  const [artists, setArtists] = useState([]);
  const [tracksMode, setTracksMode] = useState("rated");
  const [artistsMode, setArtistsMode] = useState("rated");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    setErr("");
    Promise.all([
      api("/api/releases/top?minRatings=1&limit=10"),
      api("/api/top/artists?minRatings=2"),
    ])
      .then(([tr, ar]) => {
        setTracks(tr.items || []);
        setTracksMode(tr.mode || "rated");
        setArtists(ar.items || []);
        setArtistsMode(ar.mode || "rated");
      })
      .catch((e) => {
        setErr(e.message);
        setTracks([]);
        setArtists([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const modeHint =
    tab === "tracks"
      ? tracksMode === "rated"
        ? "Топ‑10 по средней оценке · лайки (7+) · дизлайки (0–4) · последний зацен"
        : "Пока мало оценок — 10 свежих релизов"
      : artistsMode === "rated"
        ? "По средней оценке всех заценов по трекам артиста"
        : "Пока мало оценок — по числу опубликованных треков";

  return (
    <div className="platformStack topsPage">
      <SectionHero
        eyebrow="Рейтинг"
        title="Топы"
        sub="Лучшие треки и исполнители платформы по оценкам сообщества"
        tone="gold"
      />

      <div className="topsTabs sectionPanel" style={{ animationDelay: "0.08s" }} role="tablist" aria-label="Разделы топа">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "tracks"}
          className={`topsTab${tab === "tracks" ? " topsTab--active" : ""}`}
          onClick={() => setTab("tracks")}
        >
          Топ треков
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "artists"}
          className={`topsTab${tab === "artists" ? " topsTab--active" : ""}`}
          onClick={() => setTab("artists")}
        >
          Топ исполнителей
        </button>
      </div>

      <p className="topsModeHint muted sectionPanel" style={{ animationDelay: "0.12s" }}>
        {modeHint}
      </p>

      {err && <p className="formErr sectionPanel">{err}</p>}
      {loading && <p className="muted topsPage__loading sectionPanel">Загрузка топов…</p>}

      {!loading && tab === "tracks" && (
        <div className="topsList">
          {tracks.length === 0 && !err && (
            <p className="muted topsEmpty sectionPanel">Пока нет треков в топе</p>
          )}
          {tracks.slice(0, 10).map((it, index) => {
            const rank = it.rank ?? index + 1;
            return (
              <article
                key={it.id}
                className={`topsTrackCard topsTrackCard--rank${rank <= 3 ? rank : 0} sectionPanel`}
                style={{ animationDelay: `${0.16 + Math.min(index, 9) * 0.05}s` }}
              >
                <header className="topsTrackCard__head">
                  <RankBadge rank={rank} variant="track" />
                  <div className="topsTrackCard__metrics">
                    {it.avgScore != null && (
                      <span className="topsTrackCard__score">
                        <span className="topsTrackCard__scoreLab muted">Средняя</span>
                        <strong>{it.avgScore.toFixed(1)}</strong>
                        <span className="muted">/10</span>
                      </span>
                    )}
                    <span className="topsTrackStat topsTrackStat--like" title="Лайки (оценка 7+)">
                      <span className="topsTrackStat__icon">♥</span>
                      <span>{it.likeCount ?? 0}</span>
                    </span>
                    <span className="topsTrackStat topsTrackStat--dislike" title="Дизлайки (оценка 0–4)">
                      <span className="topsTrackStat__icon">👎</span>
                      <span>{it.dislikeCount ?? 0}</span>
                    </span>
                    <span className="topsTrackStat topsTrackStat--last" title="Последний зацен">
                      <span className="topsTrackStat__icon">★</span>
                      <span>
                        <span className="muted">Посл. </span>
                        {it.lastScore != null ? <strong>{it.lastScore}</strong> : "—"}
                      </span>
                    </span>
                  </div>
                </header>
                <AudioCard item={it} mediaType="releases" releaseId={it.id} onViewProfile={onViewProfile} />
              </article>
            );
          })}
        </div>
      )}

      {!loading && tab === "artists" && (
        <div className="topsList topsList--artists">
          {artists.length === 0 && !err && (
            <p className="muted topsEmpty sectionPanel">Пока нет исполнителей в топе</p>
          )}
          {artists.map((row, index) => (
            <div
              key={row.userId || row.username}
              className="sectionPanel"
              style={{ animationDelay: `${0.16 + Math.min(index, 10) * 0.05}s` }}
            >
              <TopArtistRow row={row} onViewProfile={onViewProfile} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
