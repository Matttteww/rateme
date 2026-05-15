import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { IconSearch } from "./PlatformIcons.jsx";

export function PlatformSearch({ onViewProfile, compact = false }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const term = q.trim();
  const active = term.length >= 2;

  useEffect(() => {
    if (!active) {
      setData(null);
      setBusy(false);
      return;
    }
    const t = setTimeout(() => {
      setBusy(true);
      api(`/api/search?q=${encodeURIComponent(term)}`)
        .then(setData)
        .catch(() => setData({ users: [], releases: [], openvers: [], beats: [] }))
        .finally(() => setBusy(false));
    }, 320);
    return () => clearTimeout(t);
  }, [term, active]);

  const hasResults =
    data &&
    (data.users?.length ||
      data.releases?.length ||
      data.openvers?.length ||
      data.beats?.length);

  const showPanel = active && (busy || data);

  return (
    <div className={`feedSearch ${compact ? "feedSearch--compact" : ""}`}>
      <label className="feedSearch__label" htmlFor="feed-search-input">
        <span className="sr-only">Поиск</span>
        <div className={`feedSearch__bar ${focused ? "feedSearch__bar--focus" : ""}`}>
          <span className="feedSearch__icon" aria-hidden>
            <IconSearch />
          </span>
          <input
            id="feed-search-input"
            type="search"
            className="feedSearch__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Логин, трек, исполнитель…"
            autoComplete="off"
            spellCheck={false}
          />
          {busy && <span className="feedSearch__spinner" aria-hidden />}
          {q && !busy && (
            <button
              type="button"
              className="feedSearch__clear"
              onClick={() => setQ("")}
              aria-label="Очистить"
            >
              ×
            </button>
          )}
        </div>
      </label>

      {showPanel && (
        <div className="feedSearch__panel">
          {busy && !data && <p className="feedSearch__hint muted">Ищем…</p>}
          {data && !busy && !hasResults && (
            <p className="feedSearch__hint muted">Ничего не найдено</p>
          )}
          {data?.users?.length > 0 && (
            <section className="feedSearch__section">
              <h4 className="feedSearch__sectionTitle">Люди</h4>
              <ul className="feedSearch__users">
                {data.users.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="feedSearch__user"
                      onClick={() => onViewProfile?.(u.username)}
                    >
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt="" className="feedSearch__userAvatar" />
                      ) : (
                        <span className="feedSearch__userAvatar feedSearch__userAvatar--empty">
                          {(u.displayName || u.username || "?").charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="feedSearch__userMeta">
                        <span className="feedSearch__userName">{u.displayName || u.username}</span>
                        <span className="feedSearch__userHandle">@{u.username}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data?.releases?.length > 0 && (
            <section className="feedSearch__section">
              <h4 className="feedSearch__sectionTitle">Треки</h4>
              {data.releases.map((it) => (
                <AudioCard key={it.id} item={it} mediaType="releases" onViewProfile={onViewProfile} />
              ))}
            </section>
          )}
          {data?.openvers?.length > 0 && (
            <section className="feedSearch__section">
              <h4 className="feedSearch__sectionTitle">Openvers</h4>
              {data.openvers.map((it) => (
                <AudioCard key={it.id} item={it} mediaType="openvers" />
              ))}
            </section>
          )}
          {data?.beats?.length > 0 && (
            <section className="feedSearch__section">
              <h4 className="feedSearch__sectionTitle">Биты</h4>
              {data.beats.map((it) => (
                <AudioCard key={it.id} item={it} mediaType="beats" />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
