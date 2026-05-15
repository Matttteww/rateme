import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { BeatMetaStrip } from "./BeatMetaStrip.jsx";
import { DISCOVER_CHANGED } from "./platformEvents.js";

const BEAT_KEYS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
];

const TONALITIES = ["Мажор", "Минор"];

const EMPTY_FILTERS = {
  q: "",
  tag: "",
  key: "",
  tonality: "",
  bpmMin: "",
  bpmMax: "",
};

export function BeatsFeedPage({ onViewProfile, onMessageUser }) {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [items, setItems] = useState([]);
  const [tagOptions, setTagOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/beats/tags")
      .then((j) => setTagOptions(j.tags || []))
      .catch(() => setTagOptions([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    const params = new URLSearchParams();
    if (applied.q.trim()) params.set("q", applied.q.trim());
    if (applied.tag) params.set("tag", applied.tag);
    if (applied.key) params.set("key", applied.key);
    if (applied.tonality) params.set("tonality", applied.tonality);
    if (applied.bpmMin !== "") params.set("bpmMin", applied.bpmMin);
    if (applied.bpmMax !== "") params.set("bpmMax", applied.bpmMax);
    const qs = params.toString();
    api(`/api/beats${qs ? `?${qs}` : ""}`)
      .then((j) => setItems(j.items || []))
      .catch((e) => {
        setErr(e.message);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [applied]);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener(DISCOVER_CHANGED, onRefresh);
    return () => window.removeEventListener(DISCOVER_CHANGED, onRefresh);
  }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setApplied((prev) => (prev.q === filters.q ? prev : { ...prev, q: filters.q }));
    }, 350);
    return () => window.clearTimeout(t);
  }, [filters.q]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (applied.q.trim()) n += 1;
    if (applied.tag) n += 1;
    if (applied.key) n += 1;
    if (applied.tonality) n += 1;
    if (applied.bpmMin !== "") n += 1;
    if (applied.bpmMax !== "") n += 1;
    return n;
  }, [applied]);

  const applyFilters = (e) => {
    e?.preventDefault?.();
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const setField = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="platformStack beatsFeedPage">
      <header className="beatsFeedHero">
        <span className="beatsFeedHero__orb beatsFeedHero__orb--a" aria-hidden />
        <span className="beatsFeedHero__orb beatsFeedHero__orb--b" aria-hidden />
        <div className="beatsFeedHero__inner">
          <span className="beatsFeedHero__eyebrow">Каталог</span>
          <h2 className="beatsFeedHero__title">Биты</h2>
          <p className="beatsFeedHero__sub">
            Все биты платформы — ищите по названию, жанру, BPM, key и тональности. Напишите битмейкеру в личку в один клик.
          </p>
          {!loading && (
            <span className="beatsFeedHero__count">
              {items.length} {items.length === 1 ? "бит" : items.length < 5 ? "бита" : "битов"}
              {activeFilterCount > 0 ? ` · фильтров: ${activeFilterCount}` : ""}
            </span>
          )}
        </div>
      </header>

      <form className="beatsFeedToolbar" onSubmit={applyFilters}>
        <label className="beatsFeedToolbar__search">
          <span className="sr-only">Поиск</span>
          <input
            type="search"
            className="beatsFeedToolbar__input beatsFeedToolbar__input--search"
            placeholder="Название, исполнитель, тег…"
            value={filters.q}
            onChange={(e) => setField("q", e.target.value)}
          />
        </label>

        <div className="beatsFeedToolbar__row">
          <label className="beatsFeedToolbar__field">
            <span className="beatsFeedToolbar__label">Жанр / тег</span>
            <select
              className="beatsFeedToolbar__input"
              value={filters.tag}
              onChange={(e) => setField("tag", e.target.value)}
            >
              <option value="">Все</option>
              {tagOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="beatsFeedToolbar__field">
            <span className="beatsFeedToolbar__label">Key</span>
            <select
              className="beatsFeedToolbar__input"
              value={filters.key}
              onChange={(e) => setField("key", e.target.value)}
            >
              <option value="">Любой</option>
              {BEAT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <label className="beatsFeedToolbar__field">
            <span className="beatsFeedToolbar__label">Тональность</span>
            <select
              className="beatsFeedToolbar__input"
              value={filters.tonality}
              onChange={(e) => setField("tonality", e.target.value)}
            >
              <option value="">Любая</option>
              {TONALITIES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="beatsFeedToolbar__field beatsFeedToolbar__field--bpm">
            <span className="beatsFeedToolbar__label">BPM от</span>
            <input
              type="number"
              min={40}
              max={300}
              className="beatsFeedToolbar__input"
              placeholder="—"
              value={filters.bpmMin}
              onChange={(e) => setField("bpmMin", e.target.value)}
            />
          </label>

          <label className="beatsFeedToolbar__field beatsFeedToolbar__field--bpm">
            <span className="beatsFeedToolbar__label">до</span>
            <input
              type="number"
              min={40}
              max={300}
              className="beatsFeedToolbar__input"
              placeholder="—"
              value={filters.bpmMax}
              onChange={(e) => setField("bpmMax", e.target.value)}
            />
          </label>
        </div>

        <div className="beatsFeedToolbar__actions">
          <button type="submit" className="btn btnPrimary">
            Применить
          </button>
          {activeFilterCount > 0 && (
            <button type="button" className="btn btnGhost" onClick={resetFilters}>
              Сбросить
            </button>
          )}
        </div>
      </form>

      {err && <p className="formErr">{err}</p>}
      {loading && <p className="muted beatsFeedPage__loading">Загрузка битов…</p>}

      <div className="beatsFeedList">
        {!loading &&
          items.map((it, index) => (
            <article
              key={it.id}
              className="beatsFeedCard"
              style={{ animationDelay: `${Math.min(index, 10) * 0.05}s` }}
            >
              <AudioCard
                item={it}
                mediaType="beats"
                beatId={it.id}
                countPlay
                showDownload
                onViewProfile={onViewProfile}
                onMessageUser={onMessageUser}
                currentUsername={user?.username}
                actionsLayout="row"
              />
              <BeatMetaStrip item={it} compact />
            </article>
          ))}
      </div>

      {!loading && items.length === 0 && !err && (
        <div className="myTracksEmpty beatsFeedEmpty">
          <span className="myTracksEmpty__icon myBeatsEmpty__icon" aria-hidden>
            ♩
          </span>
          <h3 className="myTracksEmpty__title">Ничего не найдено</h3>
          <p className="myTracksEmpty__text">Смените фильтры или сбросьте поиск.</p>
        </div>
      )}
    </div>
  );
}
