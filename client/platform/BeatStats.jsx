import React from "react";

const STAT_CELLS = [
  { key: "playCount", label: "Прослушивания", icon: "play", tone: "neutral" },
  { key: "likeCount", label: "Лайки", icon: "like", tone: "good" },
  { key: "dislikeCount", label: "Дизлайки", icon: "dislike", tone: "bad" },
  { key: "skipCount", label: "Пропуски", icon: "skip", tone: "muted" },
  { key: "ratingCount", label: "Оценок", icon: "star", tone: "accent" },
];

const COMPACT_LABELS = {
  playCount: "Слуш.",
  likeCount: "Лайки",
  dislikeCount: "Дизл.",
  skipCount: "Скип",
  ratingCount: "Оцен.",
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
  return (
    <svg className="myTrackStats__iconSvg" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2l2.4 7.4H22l-6 4.6 2.3 7-6.3-4.6L5.7 21l2.3-7-6-4.6h7.6L12 2z"
        fill="currentColor"
      />
    </svg>
  );
}

export function BeatStats({ item, compact = false }) {
  const hasRatings = item.ratingCount > 0 && item.avgScore != null;
  const avgDisplay = hasRatings ? Number(item.avgScore).toFixed(1) : "—";
  const avgTone = hasRatings && item.avgScore >= 7 ? "hot" : hasRatings && item.avgScore <= 4 ? "cold" : "neutral";

  if (compact) {
    return (
      <section className="myBeatStats myBeatStats--compact" aria-label="Статистика бита">
        <ul className="myBeatStats__row">
          {STAT_CELLS.map((cell) => (
            <li key={cell.key} className={`myBeatStats__chip myBeatStats__chip--${cell.tone}`}>
              <span className="myBeatStats__chipIcon" aria-hidden>
                <StatIcon name={cell.icon} />
              </span>
              <span className="myBeatStats__chipVal">{item[cell.key] ?? 0}</span>
              <span className="myBeatStats__chipLbl">{COMPACT_LABELS[cell.key]}</span>
            </li>
          ))}
          <li className={`myBeatStats__chip myBeatStats__chip--avg myBeatStats__chip--${avgTone}`}>
            <span className="myBeatStats__avgNum">{avgDisplay}</span>
            <span className="myBeatStats__chipLbl">Ср. балл</span>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="myTrackStats myBeatStats" aria-label="Статистика бита">
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
