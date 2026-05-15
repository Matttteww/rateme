import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ratingKind(r) {
  if (r.skipped) return "skip";
  if (r.score >= 7) return "like";
  if (r.score <= 4) return "dislike";
  return "score";
}

const KIND_META = {
  skip: { label: "Пропуск", emoji: "⏭" },
  like: { label: "Лайк", emoji: "♥" },
  dislike: { label: "Дизлайк", emoji: "👎" },
  score: { label: "Оценка", emoji: "★" },
};

function formatRatingLine(r) {
  const kind = ratingKind(r);
  const meta = KIND_META[kind];
  if (kind === "skip") return meta.label;
  return `${meta.label} · ${r.score}/10`;
}

function computePosition(cardEl, popoverEl) {
  const cardRect = cardEl.getBoundingClientRect();
  const btn = cardEl.querySelector(".myTrackCard__ratingsBtn");
  const anchor = btn?.getBoundingClientRect() || cardRect;
  const margin = 10;
  const popW = popoverEl?.offsetWidth || Math.min(360, window.innerWidth - margin * 2);
  const popH = popoverEl?.offsetHeight || 260;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = anchor.left;
  let top = anchor.bottom + margin;
  let placement = "below";

  if (left + popW > vw - margin) left = vw - popW - margin;
  if (left < margin) left = margin;

  if (top + popH > vh - margin) {
    top = anchor.top - popH - margin;
    placement = "above";
  }
  if (top < margin) top = margin;

  const roomRight = cardRect.right + popW + margin <= vw - margin;
  if (roomRight && vw >= 900) {
    left = cardRect.right + margin;
    top = Math.min(cardRect.top, vh - popH - margin);
    top = Math.max(margin, top);
    placement = "right";
  }

  return { top, left, placement };
}

export function TrackRatingsPopover({ cardId, item, ratings, loading, onClose, onViewProfile }) {
  const popoverRef = useRef(null);
  const [pos, setPos] = useState(null);

  const updatePosition = useCallback(() => {
    const card = document.getElementById(cardId);
    const pop = popoverRef.current;
    if (!card) return;
    setPos(computePosition(card, pop));
  }, [cardId]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, ratings, loading]);

  useEffect(() => {
    updatePosition();
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [updatePosition]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!item) return null;

  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px` }
    : { top: "40vh", left: "50%", transform: "translateX(-50%)" };

  return createPortal(
    <>
      <button type="button" className="myTracksPopover__backdrop" onClick={onClose} aria-label="Закрыть" />
      <div
        ref={popoverRef}
        className={`myTracksPopover myTracksPopover--${pos?.placement || "right"}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`ratings-popover-${item.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="myTracksPopover__arrow" aria-hidden />
        <header className="myTracksPopover__head">
          <div className="myTracksPopover__headText">
            <span className="myTracksPopover__eyebrow">Оценки слушателей</span>
            <h3 id={`ratings-popover-${item.id}`} className="myTracksPopover__title">
              {item.title}
            </h3>
          </div>
          <button type="button" className="myTracksPopover__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        {loading && <p className="myTracksPopover__loading muted">Загрузка…</p>}

        {!loading && ratings?.length === 0 && (
          <p className="myTracksPopover__empty muted">Пока никто не оценил и не пропустил</p>
        )}

        {!loading && ratings?.length > 0 && (
          <ul className="myTracksPopover__list">
            {ratings.map((r) => {
              const kind = r.kind || ratingKind(r);
              const meta = KIND_META[kind];
              const name = r.user?.displayName || r.user?.username;
              return (
                <li key={`${r.user?.id}-${r.at}`} className="myTracksPopover__row">
                  <span className="myTracksPopover__avatar" aria-hidden>
                    {(name || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="myTracksPopover__main">
                    {onViewProfile && r.user?.username ? (
                      <button
                        type="button"
                        className="myTracksPopover__user"
                        onClick={() => onViewProfile(r.user.username)}
                      >
                        @{r.user.username}
                      </button>
                    ) : (
                      <span className="myTracksPopover__user">@{r.user?.username}</span>
                    )}
                    <span className="myTracksPopover__date muted">
                      {new Date(r.at).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <span className={`myTracksPopover__badge myTracksPopover__badge--${kind}`} title={formatRatingLine(r)}>
                    <span className="myTracksPopover__badgeIcon" aria-hidden>
                      {meta.emoji}
                    </span>
                    {kind === "skip" ? meta.label : `${meta.label} ${r.score}/10`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>,
    document.body
  );
}
