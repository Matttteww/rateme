import React, { useCallback, useEffect, useRef, useState } from "react";
import { GuestGateCard } from "./GuestGateCard.jsx";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { TrackAudioPlayer } from "./TrackAudioPlayer.jsx";

const SWIPE_SKIP_PX = 90;
const LIKE_SCORE = 8;

function RateCommentModal({ score, onClose, onSubmit, busy }) {
  const [text, setText] = useState("");
  const [localScore, setLocalScore] = useState(score);

  return (
    <div className="rateModalBackdrop" role="presentation" onClick={onClose}>
      <div
        className="rateModal"
        role="dialog"
        aria-labelledby="rate-comment-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="rate-comment-title" className="rateModal__title">
          Комментарий к треку
        </h3>
        <p className="rateModal__hint muted">Оценка и текст уйдут автору вместе с заценом</p>
        <div className="rateModal__scores">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              className={`rateScoreBtn rateScoreBtn--sm${localScore === n ? " rateScoreBtn--on" : ""}`}
              onClick={() => setLocalScore(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <textarea
          className="rateModal__input"
          rows={4}
          maxLength={500}
          placeholder="Что зацепило? Честный фидбек…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="rateModal__actions">
          <button type="button" className="btn btnGhost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !text.trim()}
            onClick={() => onSubmit(localScore, text.trim())}
          >
            Отправить {localScore}/10
          </button>
        </div>
      </div>
    </div>
  );
}

function RateFeedHero({ sub }) {
  return (
    <header className="rateFeedHero">
      <span className="rateFeedHero__orb rateFeedHero__orb--a" aria-hidden />
      <span className="rateFeedHero__orb rateFeedHero__orb--b" aria-hidden />
      <div className="rateFeedHero__inner">
        <span className="rateFeedHero__eyebrow">Режим</span>
        <h2 className="rateFeedHero__title">Зацен треков</h2>
        <p className="rateFeedHero__sub">{sub}</p>
      </div>
    </header>
  );
}

function RateEmpty({ message }) {
  return (
    <div className="rateEmpty">
      <div className="rateEmpty__glow" aria-hidden />
      <div className="rateEmpty__card rateFeedPanel">
        <div className="rateEmpty__iconWrap" aria-hidden>
          <span className="rateEmpty__ring rateEmpty__ring--outer" />
          <span className="rateEmpty__ring rateEmpty__ring--inner" />
          <span className="rateEmpty__icon">★</span>
        </div>
        <p className="rateEmpty__title">{message || "Больше нет треков"}</p>
        <p className="rateEmpty__hint">Загляни позже — появятся новые релизы для зацена</p>
        <ul className="rateEmpty__tips">
          <li>
            <span className="rateEmpty__tipIcon">0–10</span>
            <span>Ставь оценку после прослушивания</span>
          </li>
          <li>
            <span className="rateEmpty__tipIcon">♥</span>
            <span>Быстрый лайк — 8 баллов</span>
          </li>
          <li>
            <span className="rateEmpty__tipIcon">←</span>
            <span>Свайп влево — пропустить трек</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export function RatePage({ onViewProfile, onNeedAuth }) {
  const { user } = useAuth();
  const [item, setItem] = useState(null);
  const [done, setDone] = useState("");
  const [score, setScore] = useState(7);
  const [dragX, setDragX] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [toast, setToast] = useState("");
  const touchStart = useRef(null);

  const load = useCallback(() => {
    setExiting(false);
    setDragX(0);
    setCommentOpen(false);
    return api("/api/rate-tracks/next")
      .then((j) => {
        setItem(j.item || null);
        setDone(j.item ? "" : "Больше нет треков для оценки");
        if (j.item) setScore(7);
      })
      .catch((e) => {
        setItem(null);
        setDone(e.message);
      });
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const submit = async (payload) => {
    if (!item || exiting) return;
    setExiting(true);
    try {
      await api("/api/rate-tracks/rate", {
        method: "POST",
        body: JSON.stringify({ releaseId: item.id, ...payload }),
      });
      await load();
    } catch (e) {
      setDone(e.message);
      setExiting(false);
    }
  };

  const reportTrack = async () => {
    const reason = window.prompt("Причина жалобы на трек") || "";
    if (!reason.trim()) return;
    try {
      await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "release", targetId: item.id, reason: reason.trim() }),
      });
      setToast("Жалоба отправлена");
    } catch (e) {
      setToast(e.message);
    }
  };

  const onTouchStart = (e) => {
    touchStart.current = e.touches[0].clientX;
  };

  const onTouchMove = (e) => {
    if (touchStart.current == null) return;
    setDragX(e.touches[0].clientX - touchStart.current);
  };

  const onTouchEnd = () => {
    if (dragX < -SWIPE_SKIP_PX) submit({ skip: true });
    else if (dragX > SWIPE_SKIP_PX) submit({ score });
    touchStart.current = null;
    setDragX(0);
  };

  if (!user) {
    return (
      <div className="platformStack rateFeedPage rateFeedPage--idle">
        <RateFeedHero sub="Войди и слушай релизы других — ставь честные оценки" />
        <GuestGateCard
          icon="star"
          title="Зацен треков — для своих"
          subtitle="Войдите или зарегистрируйтесь, чтобы слушать релизы и ставить оценки."
          onAction={onNeedAuth}
        />
      </div>
    );
  }

  if (done && !item) {
    return (
      <div className="platformStack rateFeedPage rateFeedPage--idle">
        <RateFeedHero sub="Один трек за раз — как в дейтинге, только для музыки" />
        <RateEmpty message={done} />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="platformStack rateFeedPage rateFeedPage--idle">
        <RateFeedHero sub="Слушай · ставь 0–10 · свайп влево — пропуск" />
        <p className="rateFeedPage__loading rateFeedPanel">
          <span className="rateFeedPage__loadingDot" aria-hidden />
          Загрузка следующего трека…
        </p>
      </div>
    );
  }

  const src = item.audio?.kind === "file" ? item.audio.url : null;
  const username = item.ownerUsername;
  const dragRotate = dragX * 0.045;
  const skipOverlay = dragX < -30;
  const likeOverlay = dragX > 30;
  const badge = item.isDemo ? "демо" : "трек";

  return (
    <div className="platformStack rateFeedPage">
      <RateFeedHero sub="Слушай · ставь 0–10 · свайп влево — пропуск" />

      {toast && <p className="rateToast" role="status">{toast}</p>}

      <div key={item.id} className="rateDeck rateDeck--enter">
        <div
          className={`rateCard rateFeedPanel ${exiting ? "rateCard--out" : ""}`}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragRotate}deg)`,
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {skipOverlay && <span className="rateCard__stamp rateCard__stamp--skip">Пропуск</span>}
          {likeOverlay && <span className="rateCard__stamp rateCard__stamp--like">{score}/10</span>}

          <div className="rateCard__coverWrap">
            <span
              className={`rateCard__cover rateCard__cover--${item.isDemo ? "demo" : "track"}`}
              aria-hidden
            >
              {(item.title || "?").charAt(0).toUpperCase()}
            </span>
            <span className="rateCard__badge">{badge}</span>
          </div>

          <div className="rateCard__meta">
            <h2 className="rateCard__title">{item.title}</h2>
            <p className="rateCard__artist">{item.artistDisplay}</p>
            {username && (
              <button
                type="button"
                className="rateCard__author"
                onClick={() => onViewProfile?.(username)}
              >
                @{username}
              </button>
            )}
          </div>

          <div className="rateCard__player">
            {src ? (
              <TrackAudioPlayer src={src} releaseId={item.id} countPlay />
            ) : item.audio?.openExternal ? (
              <a className="rateCard__external" href={item.audio.url} target="_blank" rel="noreferrer">
                Открыть на Яндекс.Диске
              </a>
            ) : (
              <p className="muted">Нет аудио для прослушивания</p>
            )}
          </div>
        </div>

        <div className="rateScorePick rateFeedPanel" role="group" aria-label="Оценка от 0 до 10">
          <p className="rateScorePick__label">
            Оценка: <strong>{score}</strong>
            <span className="muted"> / 10</span>
          </p>
          <div className="rateScorePick__row">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                className={`rateScoreBtn${score === n ? " rateScoreBtn--on" : ""}`}
                aria-pressed={score === n}
                disabled={exiting}
                onClick={() => {
                  setScore(n);
                  submit({ score: n });
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            type="range"
            className="rateScoreSlider"
            min={0}
            max={10}
            step={1}
            value={score}
            disabled={exiting}
            onChange={(e) => setScore(Number(e.target.value))}
            aria-label="Ползунок оценки"
          />
        </div>

        <div className="rateActions rateFeedPanel" role="toolbar" aria-label="Действия">
          <button
            type="button"
            className="rateAction rateAction--report"
            title="Пожаловаться"
            disabled={exiting}
            onClick={reportTrack}
          >
            <span className="rateAction__icon" aria-hidden>
              ⚠
            </span>
            <span className="rateAction__lab">Жалоба</span>
          </button>
          <button
            type="button"
            className="rateAction rateAction--comment"
            title="Комментарий"
            disabled={exiting}
            onClick={() => setCommentOpen(true)}
          >
            <span className="rateAction__icon" aria-hidden>
              💬
            </span>
            <span className="rateAction__lab">Коммент</span>
          </button>
          <button
            type="button"
            className="rateAction rateAction--like"
            title={`Лайк — оценка ${LIKE_SCORE}`}
            disabled={exiting}
            onClick={() => submit({ score: LIKE_SCORE })}
          >
            <span className="rateAction__icon" aria-hidden>
              ♥
            </span>
          </button>
          <button
            type="button"
            className="rateAction rateAction--skip"
            title="Пропустить"
            disabled={exiting}
            onClick={() => submit({ skip: true })}
          >
            <span className="rateAction__icon" aria-hidden>
              ✕
            </span>
            <span className="rateAction__lab">Пропуск</span>
          </button>
        </div>

        <button
          type="button"
          className="rateSubmitBtn rateFeedPanel btn"
          disabled={exiting}
          onClick={() => submit({ score })}
        >
          Заценить {score}/10
        </button>
      </div>

      {commentOpen && (
        <RateCommentModal
          score={score}
          busy={exiting}
          onClose={() => setCommentOpen(false)}
          onSubmit={(s, comment) => {
            setCommentOpen(false);
            submit({ score: s, comment });
          }}
        />
      )}
    </div>
  );
}
