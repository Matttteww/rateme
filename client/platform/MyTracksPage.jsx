import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { UploadAudioFormModal } from "./UploadTrackModal.jsx";
import { DISCOVER_CHANGED } from "./platformEvents.js";
import { TrackRatingsPopover } from "./TrackRatingsPopover.jsx";

const STAT_CELLS = [
  { key: "playCount", label: "Прослушивания", icon: "play", tone: "neutral" },
  { key: "likeCount", label: "Лайки", icon: "like", tone: "good" },
  { key: "dislikeCount", label: "Дизлайки", icon: "dislike", tone: "bad" },
  { key: "skipCount", label: "Пропуски", icon: "skip", tone: "muted" },
  { key: "ratingCount", label: "Оценок", icon: "star", tone: "accent" },
  { key: "kingWinCount", label: "Победы Царь SC", icon: "crown", tone: "king" },
];

const TABS = [
  { id: "tracks", label: "Треки" },
  { id: "demos", label: "Демо" },
  { id: "openvers", label: "Оупены" },
];

const EMPTY_COPY = {
  tracks: {
    title: "Пока нет треков",
    text: "Загрузите трек — он появится в этой вкладке.",
  },
  demos: {
    title: "Пока нет демо",
    text: "При загрузке выберите тип «Демо».",
  },
  openvers: {
    title: "Пока нет опенов",
    text: "При загрузке выберите тип «Опен».",
  },
};

function StatIcon({ name }) {
  if (name === "play")
    return (
      <svg className="myTrackStats__iconSvg" viewBox="0 0 24 24" aria-hidden>
        <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
      </svg>
    );
  if (name === "like")
    return (
      <svg className="myTrackStats__iconSvg" viewBox="0 0 24 24" aria-hidden>
        <path
          d="M12 21s-6.7-4.35-9.2-8.1C.9 9.9 2.4 6.5 5.8 5.4c1.9-.6 3.8.1 5 1.5 1.2-1.4 3.1-2.1 5-1.5 3.4 1.1 4.9 4.5 2.9 7.5C18.7 16.65 12 21 12 21z"
          fill="currentColor"
        />
      </svg>
    );
  if (name === "dislike")
    return (
      <svg className="myTrackStats__iconSvg" viewBox="0 0 24 24" aria-hidden>
        <path
          d="M15 3H6c-.8 0-1.5.5-1.8 1.2L2 12.2V21h3.5l1.2-5.5L9 21h2.2l1.3-6.2 2.1 6.2H18l-3.2-9.5C15.4 9.8 15 8.4 15 7V3z"
          fill="currentColor"
        />
      </svg>
    );
  if (name === "skip")
    return (
      <svg className="myTrackStats__iconSvg" viewBox="0 0 24 24" aria-hidden>
        <path d="M7 6v12l10-6-10-6zm11 0v12h2V6h-2z" fill="currentColor" />
      </svg>
    );
  if (name === "crown")
    return <span className="myTrackStats__iconCrown" aria-hidden>♛</span>;
  return (
    <svg className="myTrackStats__iconSvg" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2l2.4 7.4H22l-6 4.6 2.3 7-6.3-4.6L5.7 21l2.3-7-6-4.6h7.6L12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function MyTrackStats({ item }) {
  const hasRatings = item.ratingCount > 0 && item.avgScore != null;
  const avgDisplay = hasRatings ? Number(item.avgScore).toFixed(1) : "—";
  const avgTone = hasRatings && item.avgScore >= 7 ? "hot" : hasRatings && item.avgScore <= 4 ? "cold" : "neutral";

  return (
    <section className="myTrackStats" aria-label="Статистика трека">
      <div className="myTrackStats__grid">
        {STAT_CELLS.map((cell) => (
          <div key={cell.key} className={`myTrackStats__cell myTrackStats__cell--${cell.tone}`}>
            <span className="myTrackStats__icon" aria-hidden>
              <StatIcon name={cell.icon} />
            </span>
            <div className="myTrackStats__text">
              <span className="myTrackStats__label">{cell.label}</span>
              <span className="myTrackStats__value">{item[cell.key] ?? 0}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={`myTrackStats__score myTrackStats__score--${avgTone}`}>
        <div className="myTrackStats__scoreRing" aria-hidden>
          <svg viewBox="0 0 100 100">
            <circle className="myTrackStats__scoreTrack" cx="50" cy="50" r="42" />
            <circle
              className="myTrackStats__scoreFill"
              cx="50"
              cy="50"
              r="42"
              style={{
                strokeDasharray: `${hasRatings ? Math.min(264, (item.avgScore / 10) * 264) : 0} 264`,
              }}
            />
          </svg>
          <span className="myTrackStats__scoreNum">{avgDisplay}</span>
        </div>
        <div className="myTrackStats__scoreMeta">
          <span className="myTrackStats__scoreLabel">Средний балл</span>
          <span className="myTrackStats__scoreHint">
            {hasRatings ? `из ${item.ratingCount} оценок` : "пока без оценок"}
          </span>
        </div>
      </div>
    </section>
  );
}

export function MyTracksPage({ onViewProfile, highlightReleaseId, onNeedAuth }) {
  const { user } = useAuth();
  const [releases, setReleases] = useState([]);
  const [openvers, setOpenvers] = useState([]);
  const [tab, setTab] = useState("tracks");
  const [ratings, setRatings] = useState(null);
  const [ratingsFor, setRatingsFor] = useState(null);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    if (!user) return;
    Promise.all([api("/api/releases/mine"), api("/api/openvers/mine")])
      .then(([rel, op]) => {
        setReleases(rel.items || []);
        setOpenvers(op.items || []);
      })
      .catch((e) => setErr(e.message));
  }, [user]);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener(DISCOVER_CHANGED, onRefresh);
    return () => window.removeEventListener(DISCOVER_CHANGED, onRefresh);
  }, [load]);

  const tracks = useMemo(() => releases.filter((i) => !i.isDemo), [releases]);
  const demos = useMemo(() => releases.filter((i) => i.isDemo), [releases]);

  const counts = useMemo(
    () => ({ tracks: tracks.length, demos: demos.length, openvers: openvers.length }),
    [tracks, demos, openvers]
  );

  const tabItems = useMemo(() => {
    if (tab === "demos") return demos;
    if (tab === "openvers") return openvers;
    return tracks;
  }, [tab, tracks, demos, openvers]);

  const isOpenverTab = tab === "openvers";

  useEffect(() => {
    if (!highlightReleaseId || releases.length === 0) return;
    const hit = releases.find((r) => r.id === highlightReleaseId);
    if (hit) setTab(hit.isDemo ? "demos" : "tracks");
    const t = window.setTimeout(() => {
      document.getElementById(`my-track-${highlightReleaseId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [highlightReleaseId, releases]);

  const closeRatings = useCallback(() => {
    setRatingsFor(null);
    setRatings(null);
    setRatingsLoading(false);
  }, []);

  useEffect(() => {
    closeRatings();
  }, [tab, closeRatings]);

  const handleUploadSuccess = (kind) => {
    load();
    if (kind === "openver") setTab("openvers");
    else if (kind === "demo") setTab("demos");
    else setTab("tracks");
  };

  if (!user) return <p className="muted myTracksPage__gate">Войдите, чтобы видеть свои треки.</p>;

  const openRatings = async (item) => {
    if (ratingsFor?.id === item.id) {
      closeRatings();
      return;
    }
    setRatingsFor(item);
    setRatings(null);
    setRatingsLoading(true);
    try {
      const j = await api(`/api/releases/${item.id}/ratings`);
      setRatings(j.ratings || []);
    } catch (e) {
      setErr(e.message);
      closeRatings();
    } finally {
      setRatingsLoading(false);
    }
  };

  const empty = EMPTY_COPY[tab];

  return (
    <div className="platformStack myTracksPage">
      <header className="myTracksHero myTracksHero--compact">
        <span className="myTracksHero__orb myTracksHero__orb--a" aria-hidden />
        <span className="myTracksHero__orb myTracksHero__orb--b" aria-hidden />
        <div className="myTracksHero__inner myTracksHero__inner--compact">
          <div className="myTracksHero__headRow">
            <div>
              <span className="myTracksHero__eyebrow">Личный кабинет</span>
              <h2 className="myTracksHero__title myTracksHero__title--compact">Мои треки/демо/оупены</h2>
            </div>
            <UploadAudioFormModal
              endpoint="/api/releases"
              label="Добавить"
              buttonLabel="＋ Добавить"
              onSuccess={handleUploadSuccess}
              onNeedAuth={onNeedAuth}
            />
          </div>
          <div className="myTracksTabs" role="tablist" aria-label="Разделы">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`myTracksTab ${tab === t.id ? "myTracksTab--active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                <span className="myTracksTab__count">{counts[t.id]}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {err && <p className="formErr myTracksPage__err">{err}</p>}

      <div className="myTracksList" role="tabpanel">
        {tabItems.map((it, index) => (
          <article
            key={it.id}
            id={`my-track-${it.id}`}
            className={`myTrackCard trackCard ${highlightReleaseId === it.id ? "myTrackCard--focus trackCard--focus" : ""} ${ratingsFor?.id === it.id ? "myTrackCard--ratingsOpen" : ""}`}
            style={{ animationDelay: `${Math.min(index, 8) * 0.07}s` }}
          >
            <span className="myTrackCard__glow" aria-hidden />
            <span className="myTrackCard__index" aria-hidden>
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="myTrackCard__body">
              <AudioCard
                item={it}
                mediaType={isOpenverTab ? "openvers" : "releases"}
                onViewProfile={onViewProfile}
                releaseId={!isOpenverTab ? it.id : undefined}
                countPlay={!isOpenverTab}
                showDownload
              />
              {!isOpenverTab && (
                <>
                  <div className="myTrackCard__divider" aria-hidden />
                  <MyTrackStats item={it} />
                  <footer className="myTrackCard__footer">
                    <button
                      type="button"
                      className={`myTrackCard__ratingsBtn ${ratingsFor?.id === it.id ? "myTrackCard__ratingsBtn--active" : ""}`}
                      onClick={() => openRatings(it)}
                      aria-expanded={ratingsFor?.id === it.id}
                    >
                      <span className="myTrackCard__ratingsIcon" aria-hidden>
                        ★
                      </span>
                      Кто оценил
                    </button>
                  </footer>
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      {tabItems.length === 0 && (
        <div className="myTracksEmpty">
          <span className="myTracksEmpty__icon" aria-hidden>
            ♫
          </span>
          <h3 className="myTracksEmpty__title">{empty.title}</h3>
          <p className="myTracksEmpty__text">{empty.text}</p>
        </div>
      )}

      {ratingsFor && !isOpenverTab && (
        <TrackRatingsPopover
          cardId={`my-track-${ratingsFor.id}`}
          item={ratingsFor}
          ratings={ratings}
          loading={ratingsLoading}
          onClose={closeRatings}
          onViewProfile={onViewProfile}
        />
      )}
    </div>
  );
}
