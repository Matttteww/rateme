import React from "react";

export function BeatMetaStrip({ item, compact = false }) {
  const tags = item?.tags || [];
  if (!item?.bpm && !item?.musicalKey && !item?.tonality && tags.length === 0) return null;

  return (
    <section className={`beatMeta ${compact ? "beatMeta--compact" : ""}`} aria-label="Параметры бита">
      <div className="beatMeta__grid">
        {item.bpm != null && (
          <div className="beatMeta__cell beatMeta__cell--bpm">
            <span className="beatMeta__label">BPM</span>
            <span className="beatMeta__value">{item.bpm}</span>
          </div>
        )}
        {item.musicalKey && (
          <div className="beatMeta__cell beatMeta__cell--key">
            <span className="beatMeta__label">Key</span>
            <span className="beatMeta__value">{item.musicalKey}</span>
          </div>
        )}
        {item.tonality && (
          <div className="beatMeta__cell beatMeta__cell--scale">
            <span className="beatMeta__label">Лад</span>
            <span className="beatMeta__value">{item.tonality}</span>
          </div>
        )}
      </div>
      {tags.length > 0 && (
        <div className="beatMeta__tags">
          {tags.map((tag) => (
            <span key={tag} className="beatMeta__tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
