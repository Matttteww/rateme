import React, { useEffect, useState } from "react";
import { api } from "./api.js";

function formatCount(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 10_000) return `${Math.round(num / 1000)}K`;
  if (num >= 1_000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(num);
}

export function FollowLists({
  username,
  onViewProfile,
  variant = "default",
  followerCount = 0,
  followingCount = 0,
}) {
  const chip = variant === "profile" ? "profileChip" : "btn btnSm";
  const chipGhost = variant === "profile" ? "profileChip profileChip--ghost" : "btn btnSm btnGhost";
  const [tab, setTab] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tab) {
      setUsers([]);
      return;
    }
    setLoading(true);
    api(`/api/users/${encodeURIComponent(username)}/${tab}`)
      .then((j) => setUsers(j.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [tab, username]);

  const toggleTab = (next) => setTab(tab === next ? null : next);

  if (variant === "profile") {
    return (
      <div className="followLists followLists--profile">
        <div className="profileStatGrid" role="group" aria-label="Подписки">
          <button
            type="button"
            className={`profileStatCard${tab === "followers" ? " profileStatCard--active" : ""}`}
            aria-pressed={tab === "followers"}
            onClick={() => toggleTab("followers")}
          >
            <span className="profileStatCard__num">{formatCount(followerCount)}</span>
            <span className="profileStatCard__lab">подписчиков</span>
          </button>
          <button
            type="button"
            className={`profileStatCard${tab === "following" ? " profileStatCard--active" : ""}`}
            aria-pressed={tab === "following"}
            onClick={() => toggleTab("following")}
          >
            <span className="profileStatCard__num">{formatCount(followingCount)}</span>
            <span className="profileStatCard__lab">подписок</span>
          </button>
        </div>

        {tab && (
          <div className="followListPanel">
            <p className="followListPanel__title">
              {tab === "followers" ? "Подписчики" : "Подписки"}
            </p>
            <ul className="followList">
              {loading && <li className="followList__empty">Загрузка…</li>}
              {!loading &&
                users.map((u) => (
                  <li key={u.id} className="followList__item">
                    <button type="button" className="followList__user" onClick={() => onViewProfile?.(u.username)}>
                      <span className="followList__nick">{u.displayName || u.username}</span>
                      <span className="followList__handle">@{u.username}</span>
                    </button>
                  </li>
                ))}
              {!loading && users.length === 0 && <li className="followList__empty">Пока пусто</li>}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="followLists">
      <div className="feedModeTabs">
        <button
          type="button"
          className={tab === "followers" ? chip : chipGhost}
          onClick={() => toggleTab("followers")}
        >
          Подписчики
        </button>
        <button
          type="button"
          className={tab === "following" ? chip : chipGhost}
          onClick={() => toggleTab("following")}
        >
          Подписки
        </button>
      </div>
      {tab && (
        <ul className="followList">
          {loading && <li className="muted">Загрузка…</li>}
          {!loading &&
            users.map((u) => (
              <li key={u.id}>
                <button type="button" className="linkBtn" onClick={() => onViewProfile?.(u.username)}>
                  @{u.username}
                </button>
                <span className="muted"> — {u.displayName}</span>
              </li>
            ))}
          {!loading && users.length === 0 && <li className="muted">Пусто</li>}
        </ul>
      )}
    </div>
  );
}
