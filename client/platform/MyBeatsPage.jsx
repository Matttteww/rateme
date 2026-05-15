import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { UploadBeatFormModal } from "./UploadBeatModal.jsx";
import { DISCOVER_CHANGED } from "./platformEvents.js";
import { BeatMetaStrip } from "./BeatMetaStrip.jsx";
import { BeatStats } from "./BeatStats.jsx";

function formatBeatCount(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} битов`;
  if (mod10 === 1) return `${n} бит`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} бита`;
  return `${n} битов`;
}

export function MyBeatsPage({ onViewProfile }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    if (!user) return;
    api("/api/beats/mine")
      .then((j) => setItems(j.items || []))
      .catch((e) => setErr(e.message));
  }, [user]);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener(DISCOVER_CHANGED, onRefresh);
    return () => window.removeEventListener(DISCOVER_CHANGED, onRefresh);
  }, [load]);

  if (!user) return <p className="muted myTracksPage__gate">Войдите, чтобы видеть свои биты.</p>;

  return (
    <div className="platformStack myTracksPage myBeatsPage">
      <header className="myTracksHero myBeatsHero myBeatsHero--compact">
        <span className="myTracksHero__orb myTracksHero__orb--a" aria-hidden />
        <span className="myTracksHero__orb myTracksHero__orb--b myBeatsHero__orb--violet" aria-hidden />
        <div className="myBeatsHero__inner">
          <div className="myBeatsHero__head">
            <span className="myTracksHero__eyebrow myBeatsHero__eyebrow">Личный кабинет</span>
            <div className="myBeatsHero__titleRow">
              <h2 className="myTracksHero__title myBeatsHero__title">
                Мои биты
                <span className="myBeatsHero__count">{formatBeatCount(items.length)}</span>
              </h2>
              <div className="myBeatsHero__action">
                <UploadBeatFormModal buttonLabel="＋ Загрузить" onSuccess={load} />
              </div>
            </div>
          </div>
        </div>
      </header>

      {err && <p className="formErr myTracksPage__err">{err}</p>}

      <div className="myTracksList myBeatsList">
        {items.map((it, index) => (
          <article
            key={it.id}
            id={`my-beat-${it.id}`}
            className="myTrackCard trackCard myBeatCard myBeatCard--compact"
            style={{ animationDelay: `${Math.min(index, 8) * 0.07}s` }}
          >
            <span className="myTrackCard__glow myBeatCard__glow" aria-hidden />
            <div className="myTrackCard__body myBeatCard__body">
              <AudioCard item={it} mediaType="beats" onViewProfile={onViewProfile} />
              <div className="myBeatCard__extras">
                <BeatMetaStrip item={it} compact />
                <BeatStats item={it} compact />
              </div>
            </div>
          </article>
        ))}
      </div>

      {items.length === 0 && (
        <div className="myTracksEmpty myBeatsEmpty">
          <span className="myTracksEmpty__icon myBeatsEmpty__icon" aria-hidden>
            ♩
          </span>
          <h3 className="myTracksEmpty__title">Пока нет битов</h3>
          <p className="myTracksEmpty__text">Загрузите первый бит — BPM, key и лад появятся на карточке.</p>
        </div>
      )}
    </div>
  );
}
