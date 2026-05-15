import React, { useEffect } from "react";
import { createPortal } from "react-dom";

export function PlatformAboutModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const root =
    typeof document !== "undefined" ? document.body : null;
  if (!root) return null;

  const bullets = [
    {
      t: "Релизы в одном ритме",
      d: "Лента, треки, биты и оупены — слышишь что выходит прямо сейчас, без бесконечных табов и мусора.",
    },
    {
      t: "Зацен, Царь и топы",
      d: "Голосуй по трекам, залезай в «Царь SC» и топы — честное сравнение и понятный результат, без скуки.",
    },
    {
      t: "Связь с артистами",
      d: "Профили со стеной, личка и подписки — договориться о коллабе или просто поболтать, если человек открыт к диалогу.",
    },
    {
      t: "Для тех, кто ведёт TG",
      d: "Каналы и импорт из Telegram помогают не дублировать историю руками — контент живёт там, где тебе удобнее.",
    },
  ];

  return createPortal(
    <div className="platAboutOverlay" role="dialog" aria-modal="true" aria-labelledby="platAbout-title">
      <button type="button" className="platAboutBackdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="platAboutPanel">
        <div className="platAboutGlow" aria-hidden />
        <header className="platAboutHead">
          <p className="platAboutEyebrow">РЭЙТМИ</p>          <h2 id="platAbout-title" className="platAboutTitle">
            Площадка для звука и людей вокруг него
          </h2>
          <p className="platAboutLead">
            Мы заточены под музыкантов и слушателей: выпускать, качать качество голосами комьюнити и не терять
            контакт ни с одним релизом.
          </p>
          <button type="button" className="platAboutClose" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <ul className="platAboutList">
          {bullets.map((b) => (
            <li key={b.t} className="platAboutItem">
              <span className="platAboutItem__bullet" aria-hidden />
              <div className="platAboutItem__body">
                <span className="platAboutItem__title">{b.t}</span>
                <span className="platAboutItem__desc">{b.d}</span>
              </div>
            </li>
          ))}
        </ul>

        <p className="platAboutFoot muted">
          Делай звук, ставь лайки, лезь в рейтинги — платформа просто держит бит в одном месте.
        </p>
      </div>
    </div>,
    root
  );
}
