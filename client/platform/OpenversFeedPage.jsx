import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { DISCOVER_CHANGED } from "./platformEvents.js";

export function OpenversFeedPage({ onViewProfile, onMessageUser, onNeedAuth }) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [likeBusy, setLikeBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    const params = new URLSearchParams();
    if (appliedQ.trim()) params.set("q", appliedQ.trim());
    const qs = params.toString();
    api(`/api/openvers${qs ? `?${qs}` : ""}`)
      .then((j) => setItems(j.items || []))
      .catch((e) => {
        setErr(e.message);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [appliedQ]);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener(DISCOVER_CHANGED, onRefresh);
    return () => window.removeEventListener(DISCOVER_CHANGED, onRefresh);
  }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQ((prev) => (prev === query ? prev : query));
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const toggleLike = async (item) => {
    if (!user) {
      onNeedAuth?.();
      return;
    }
    setLikeBusy(item.id);
    setErr("");
    try {
      const j = item.liked
        ? await api(`/api/openvers/${item.id}/like`, { method: "DELETE" })
        : await api(`/api/openvers/${item.id}/like`, { method: "POST", body: "{}" });
      setItems((list) =>
        list.map((x) =>
          x.id === item.id ? { ...x, liked: j.liked, likeCount: j.likeCount } : x
        )
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setLikeBusy(null);
    }
  };

  return (
    <div className="platformStack openversFeedPage">
      <header className="openversFeedHero">
        <span className="openversFeedHero__orb openversFeedHero__orb--a" aria-hidden />
        <span className="openversFeedHero__orb openversFeedHero__orb--b" aria-hidden />
        <div className="openversFeedHero__inner">
          <span className="openversFeedHero__eyebrow">Каталог</span>
          <h2 className="openversFeedHero__title">Оупены</h2>
          <p className="openversFeedHero__sub">
            Все опены платформы — слушайте, скачивайте, ставьте лайк и пишите исполнителю в личку.
          </p>
          {!loading && (
            <span className="openversFeedHero__count">
              {items.length}{" "}
              {items.length === 1 ? "опен" : items.length >= 2 && items.length <= 4 ? "опена" : "опенов"}
            </span>
          )}
        </div>
      </header>

      <label className="openversFeedSearch">
        <span className="sr-only">Поиск</span>
        <input
          type="search"
          className="openversFeedSearch__input"
          placeholder="Название, исполнитель, @ник…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {err && <p className="formErr">{err}</p>}
      {loading && <p className="muted openversFeedPage__loading">Загрузка опенов…</p>}

      <div className="openversFeedList">
        {!loading &&
          items.map((it, index) => (
            <article
              key={it.id}
              className="openversFeedCard"
              style={{ animationDelay: `${Math.min(index, 10) * 0.05}s` }}
            >
              <AudioCard
                item={it}
                mediaType="openvers"
                openverId={it.id}
                countPlay
                showDownload
                showLike
                liked={it.liked}
                likeCount={it.likeCount ?? 0}
                playCount={it.playCount ?? 0}
                likeBusy={likeBusy === it.id}
                onToggleLike={() => toggleLike(it)}
                onNeedAuth={onNeedAuth}
                onViewProfile={onViewProfile}
                onMessageUser={onMessageUser}
                currentUsername={user?.username}
                actionsLayout="row"
              />
            </article>
          ))}
      </div>

      {!loading && items.length === 0 && !err && (
        <div className="myTracksEmpty openversFeedEmpty">
          <span className="myTracksEmpty__icon openversFeedEmpty__icon" aria-hidden>
            ◎
          </span>
          <h3 className="myTracksEmpty__title">Пока нет опенов</h3>
          <p className="myTracksEmpty__text">
            Загрузите первый опен в «Мои треки/демо/оупены» или измените поиск.
          </p>
        </div>
      )}
    </div>
  );
}
