import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { DISCOVER_CHANGED } from "./platformEvents.js";
import { usePlatformWs } from "./usePlatformWs.js";

function formatJoined(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function freshBadge(it) {
  const kind = it.uploadKind || it.type || "release";
  if (kind === "beat") return { tone: "beat", label: "бит" };
  if (kind === "openver") return { tone: "openver", label: "open" };
  if (it.isDemo) return { tone: "demo", label: "демо" };
  return { tone: "track", label: "трек" };
}

export function PlatformAside({ onViewProfile, onNavigate }) {
  const [data, setData] = useState(null);

  const loadDiscover = useCallback(() => {
    api("/api/discover")
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const onWs = useCallback(
    (msg) => {
      if (msg.type === "discover_changed") loadDiscover();
    },
    [loadDiscover]
  );
  usePlatformWs(onWs);

  useEffect(() => {
    loadDiscover();
    const onRefresh = () => loadDiscover();
    window.addEventListener(DISCOVER_CHANGED, onRefresh);
    const poll = window.setInterval(loadDiscover, 45000);
    return () => {
      window.removeEventListener(DISCOVER_CHANGED, onRefresh);
      window.clearInterval(poll);
    };
  }, [loadDiscover]);

  const users = (data?.newUsers || []).slice(0, 3);
  const fresh = (data?.latestUploads?.length ? data.latestUploads : data?.latestReleases || []).slice(0, 8);

  return (
    <aside className="platRail" aria-label="Подборка">
      <section className="platRailCard platRailCard--newUsers">
        <h2 className="platRailTitle">Новые</h2>
        <p className="platRailHint">Последние 3 регистрации</p>
        {users.length > 0 ? (
          <ul className="platRailList platRailList--newUsers">
            {users.map((u, index) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="platRailNewUser"
                  onClick={() => onViewProfile?.(u.username)}
                >
                  <span className="platRailNewUser__rank" aria-hidden>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="platRailNewUser__avatar" />
                  ) : (
                    <span className="platRailNewUser__avatar platRailNewUser__avatar--empty">
                      {(u.displayName || u.username || "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="platRailNewUser__text">
                    <span className="platRailNewUser__name">{u.displayName || u.username}</span>
                    <span className="platRailNewUser__handle">@{u.username}</span>
                    {u.createdAt != null && (
                      <span className="platRailNewUser__when">{formatJoined(u.createdAt)}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="platRailEmpty">Пока никого нового</p>
        )}
      </section>

      <section className="platRailCard platRailCard--tracks">
        <h2 className="platRailTitle">Свежее</h2>
        <p className="platRailHint">Последние треки, биты и openvers</p>
        {fresh.length > 0 ? (
          <ul className="platRailList platRailList--tracks">
            {fresh.map((it) => {
              const badge = freshBadge(it);
              const kind = it.uploadKind || it.type || "release";
              return (
                <li key={`${kind}-${it.id}`}>
                  <div className="platRailTrackItem">
                    <span className={`platRailTrackBadge platRailTrackBadge--${badge.tone}`} aria-hidden>
                      {badge.label}
                    </span>
                    <span className="platRailTrackText">
                      <span className="platRailTrackTitle" title={it.title}>
                        {it.title}
                      </span>
                      <span className="platRailTrackArt">{it.artistDisplay}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="platRailEmpty">
            Пока пусто.{" "}
            <button type="button" className="platRailLinkBtn" onClick={() => onNavigate?.("rate")}>
              Зацен треков →
            </button>
          </p>
        )}
      </section>
    </aside>
  );
}
