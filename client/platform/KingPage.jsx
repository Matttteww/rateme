import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { SectionHero } from "./SectionHero.jsx";
import { TrackAudioPlayer } from "./TrackAudioPlayer.jsx";
import { AudioCard } from "./AudioCard.jsx";

const ROUND_LABELS = {
  1: "1-й раунд",
  2: "Четвертьфинал",
  3: "Полуфинал",
  4: "Финал",
};

function roundLabel(round) {
  return ROUND_LABELS[round] || `Раунд ${round}`;
}

const PICK_POP_MS = 300;
const PAIR_EXIT_MS = 320;
const PAIR_ENTER_MS = 360;

function nextPaint() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function waitPairTransition(ref, ms = PAIR_EXIT_MS) {
  return new Promise((resolve) => {
    const el = ref.current;
    if (!el) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, ms + 32);
    const onEnd = (e) => {
      if (e.target !== el || e.propertyName !== "transform") return;
      clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      finish();
    };
    el.addEventListener("transitionend", onEnd);
  });
}

function waitPairEnter(ref, ms = PAIR_ENTER_MS) {
  return new Promise((resolve) => {
    const el = ref.current;
    if (!el) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, ms + 32);
    const onEnd = (e) => {
      if (e.target !== el) return;
      clearTimeout(timer);
      el.removeEventListener("animationend", onEnd);
      finish();
    };
    el.addEventListener("animationend", onEnd);
  });
}

function KingBattleCard({ track, side, onPick, disabled, picked }) {
  if (!track) return null;
  const src = track.audio?.kind === "file" ? track.audio.url : null;
  const username = track.ownerUsername;
  const badge = track.isDemo ? "демо" : "трек";

  return (
    <article
      className={`kingBattleCard kingBattleCard--${side}${picked ? " kingBattleCard--picked" : ""}`}
      role="group"
      aria-label={track.title}
    >
      <button
        type="button"
        className="kingBattleCard__hit"
        disabled={disabled}
        onClick={() => onPick(track.id, side)}
        aria-label={`Выбрать: ${track.title}`}
      >
        <div className="kingBattleCard__coverWrap">
          <span
            className={`kingBattleCard__cover kingBattleCard__cover--${track.isDemo ? "demo" : "track"}`}
            aria-hidden
          >
            {(track.title || "?").charAt(0).toUpperCase()}
          </span>
          <span className="kingBattleCard__badge">{badge}</span>
          {picked && <span className="kingBattleCard__crown" aria-hidden>♛</span>}
        </div>

        <div className="kingBattleCard__meta">
          <h3 className="kingBattleCard__title">{track.title}</h3>
          <p className="kingBattleCard__artist">{track.artistDisplay}</p>
          {username && <span className="kingBattleCard__user">@{username}</span>}
        </div>

        <span className="kingBattleCard__cta">Нажми — этот трек сильнее</span>
      </button>

      <div className="kingBattleCard__player" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {src ? (
          <TrackAudioPlayer src={src} releaseId={track.id} countPlay />
        ) : track.audio?.openExternal ? (
          <a className="kingBattleCard__external" href={track.audio.url} target="_blank" rel="noreferrer">
            Открыть на Яндекс.Диске
          </a>
        ) : (
          <p className="muted kingBattleCard__noAudio">Нет аудио</p>
        )}
      </div>
    </article>
  );
}

function KingChampion({ champion, onViewProfile, onPlayAgain }) {
  return (
    <div className="kingChampion sectionPanel">
      <div className="kingChampion__glow" aria-hidden />
      <span className="kingChampion__crown" aria-hidden>♛</span>
      <h3 className="kingChampion__title">Царь SoundCloud</h3>
      <p className="kingChampion__sub muted">Победитель битвы из 10 треков</p>
      {champion && (
        <div className="kingChampion__card">
          <AudioCard item={champion} mediaType="releases" releaseId={champion.id} onViewProfile={onViewProfile} />
        </div>
      )}
      <p className="kingChampion__hint okText">
        Исполнителю начислена победа и отправлено уведомление
      </p>
      <button type="button" className="kingBtn kingBtn--primary" onClick={onPlayAgain}>
        Новая битва
      </button>
    </div>
  );
}

function KingLeaderboard({ artists, onViewProfile }) {
  if (!artists?.length) {
    return (
      <div className="kingLb__empty">
        <span className="kingLb__emptyIcon" aria-hidden>♛</span>
        <p className="kingLb__emptyTitle">Пока пусто</p>
        <p className="kingLb__emptySub muted">Сыграй первым — имя попадёт в рейтинг царей</p>
      </div>
    );
  }
  return (
    <ol className="kingLb">
      {artists.slice(0, 10).map((u, i) => {
        const nick = u.displayName || u.username;
        const rank = i + 1;
        return (
          <li key={u.userId || u.id || u.username} className={`kingLb__row kingLb__row--${rank <= 3 ? rank : "n"}`}>
            <span className="kingLb__rank" aria-hidden>
              {rank === 1 ? "♛" : rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : rank}
            </span>
            <button type="button" className="kingLb__main" onClick={() => onViewProfile?.(u.username)}>
              {u.avatarUrl ? (
                <img src={u.avatarUrl} alt="" className="kingLb__avatar" />
              ) : (
                <span className="kingLb__avatar kingLb__avatar--empty">{nick.charAt(0).toUpperCase()}</span>
              )}
              <span className="kingLb__meta">
                <span className="kingLb__name">{nick}</span>
                <span className="kingLb__handle muted">@{u.username}</span>
              </span>
            </button>
            <span className="kingLb__wins">
              <strong>{u.kingWins ?? u.king_wins ?? 0}</strong>
              <span className="muted"> побед</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function KingPage({ onViewProfile }) {
  const { user } = useAuth();
  const [lb, setLb] = useState(null);
  const [session, setSession] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairSlide, setPairSlide] = useState("idle");
  const [pickedSide, setPickedSide] = useState(null);
  const [matchKey, setMatchKey] = useState(0);
  const pairRef = useRef(null);
  const lastMatchRef = useRef(null);

  const loadLb = useCallback(() => {
    api("/api/king/leaderboard")
      .then(setLb)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLb();
  }, [loadLb]);

  const start = async () => {
    setErr("");
    setSession(null);
    setPairSlide("idle");
    setPickedSide(null);
    try {
      const st = await api("/api/king/sessions", { method: "POST", body: "{}" });
      setSession(st);
      setMatchKey((k) => k + 1);
      setPairSlide("enter");
      await nextPaint();
      await waitPairEnter(pairRef);
      setPairSlide("idle");
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const resetGame = () => {
    setSession(null);
    setPairSlide("idle");
    setPickedSide(null);
    setErr("");
  };

  const pick = async (winnerReleaseId, side) => {
    if (!session?.sessionId || busy) return;
    setBusy(true);
    setPickedSide(side);
    setPairSlide("pop");
    await nextPaint();
    await new Promise((r) => setTimeout(r, PICK_POP_MS));

    const apiPromise = api(`/api/king/sessions/${session.sessionId}/pick`, {
      method: "POST",
      body: JSON.stringify({ winnerReleaseId }),
    });

    setPairSlide("exit");
    await nextPaint();

    try {
      const [j] = await Promise.all([apiPromise, waitPairTransition(pairRef)]);
      const nextSession = j.state || j;

      if (nextSession.status === "completed") {
        setSession(nextSession);
        setPairSlide("idle");
        setPickedSide(null);
        lastMatchRef.current = null;
        loadLb();
        return;
      }

      if (nextSession.currentMatch) lastMatchRef.current = nextSession.currentMatch;
      setSession(nextSession);
      setPickedSide(null);
      setMatchKey((k) => k + 1);
      setPairSlide("enter");
      await nextPaint();
      await waitPairEnter(pairRef);
      setPairSlide("idle");
    } catch (ex) {
      setErr(ex.message);
      setPairSlide("idle");
      setPickedSide(null);
    } finally {
      setBusy(false);
    }
  };

  const match = session?.currentMatch;
  if (match) lastMatchRef.current = match;
  const inTransition = busy || pairSlide !== "idle";
  const displayMatch = match || (inTransition ? lastMatchRef.current : null);
  const completed = session?.status === "completed";
  const champion = session?.champion;
  const hasTwoTracks = Boolean(displayMatch?.a && displayMatch?.b);

  const pairClass = [
    hasTwoTracks ? "" : "kingArena__pair--solo",
    pairSlide === "pop" && "kingArena__pair--pop",
    pairSlide === "exit" && "kingArena__pair--exit",
    pairSlide === "enter" && "kingArena__pair--enter",
    pairSlide === "idle" && "kingArena__pair--idle",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="platformStack kingPage">
      <div className="kingPage__heroWrap">
        <SectionHero
          eyebrow="Турнир"
          title="Царь SoundCloud"
          sub="10 случайных треков · слушай пару · нажми на победителя · до одного царя"
          tone="gold"
        />
      </div>

      <div className="kingIntro sectionPanel" style={{ animationDelay: "0.08s" }}>
        <span className="kingIntro__crown" aria-hidden>♛</span>
        <ul className="kingIntro__steps" aria-label="Как проходит битва">
          <li><span className="kingIntro__stepNum">1</span>10 треков</li>
          <li><span className="kingIntro__stepNum">2</span>Пары · выбор</li>
          <li><span className="kingIntro__stepNum">3</span>Один царь</li>
        </ul>
        {!user && <p className="kingIntro__guest muted">Войдите, чтобы начать битву</p>}
        {user && !session && (
          <button type="button" className="kingBtn kingBtn--primary" onClick={start}>
            <span className="kingBtn__label">Новая игра</span>
            <span className="kingBtn__sub">10 треков · турнир</span>
          </button>
        )}
        {user && session && !completed && (
          <button type="button" className="kingBtn kingBtn--ghost" onClick={resetGame} disabled={busy}>
            Выйти из битвы
          </button>
        )}
        {err && <p className="formErr kingIntro__err">{err}</p>}
      </div>

      {session && !completed && displayMatch && (
        <section className="kingArena sectionPanel" style={{ animationDelay: "0.12s" }}>
          <header className="kingArena__head">
            <span className="kingArena__round">{roundLabel(displayMatch.round)}</span>
            {hasTwoTracks && <span className="kingArena__vs" aria-hidden>VS</span>}
            <p className="kingArena__hint muted">Слушай оба трека · нажми на карточку победителя</p>
          </header>

          <div className="kingArena__stage">
            <div
              ref={pairRef}
              key={matchKey}
              className={`kingArena__pair ${pairClass}`.trim()}
            >
              <KingBattleCard
                track={displayMatch.a}
                side="left"
                picked={pickedSide === "left"}
                onPick={pick}
                disabled={busy}
              />
              {hasTwoTracks && (
                <>
                  <span className="kingArena__divider" aria-hidden>
                    <span className="kingArena__dividerLine" />
                    <span className="kingArena__dividerText">или</span>
                    <span className="kingArena__dividerLine" />
                  </span>
                  <KingBattleCard
                    track={displayMatch.b}
                    side="right"
                    picked={pickedSide === "right"}
                    onPick={pick}
                    disabled={busy}
                  />
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {session && completed && (
        <KingChampion champion={champion} onViewProfile={onViewProfile} onPlayAgain={start} />
      )}

      <section className="kingLbPanel sectionPanel" style={{ animationDelay: "0.16s" }}>
        <header className="kingLbPanel__head">
          <span className="kingLbPanel__icon" aria-hidden>♛</span>
          <h3 className="kingLbPanel__title">Рейтинг царей</h3>
          <p className="kingLbPanel__sub muted">Исполнители с победами в «Царь SC»</p>
        </header>
        {lb ? (
          <KingLeaderboard artists={lb.artists} onViewProfile={onViewProfile} />
        ) : (
          <p className="muted kingLbPanel__loading">Загрузка рейтинга…</p>
        )}
      </section>
    </div>
  );
}
