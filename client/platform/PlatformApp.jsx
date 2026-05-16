import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { AudioCard } from "./AudioCard.jsx";
import { FeedPost } from "./FeedPost.jsx";
import { MessagesPage } from "./MessagesPage.jsx";
import { ProfilePage } from "./ProfilePage.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { MyTracksPage } from "./MyTracksPage.jsx";
import { MyBeatsPage } from "./MyBeatsPage.jsx";
import { BeatsFeedPage } from "./BeatsFeedPage.jsx";
import { OpenversFeedPage } from "./OpenversFeedPage.jsx";
import { AdminPage } from "./AdminPage.jsx";
import { TelegramPanel } from "./TelegramPanel.jsx";
import { useAppHash } from "./useAppHash.js";
import { PlatformSearch } from "./PlatformSearch.jsx";
import { usePlatformWs } from "./usePlatformWs.js";
import { WallPostForm } from "./WallPostForm.jsx";
import { RatePage } from "./RatePage.jsx";
import { TopPage } from "./TopPage.jsx";
import { KingPage } from "./KingPage.jsx";
import { AuthScreen } from "./AuthScreen.jsx";
import { PlatformShell } from "./PlatformShell.jsx";
import { SectionHero } from "./SectionHero.jsx";
import { IconBell } from "./PlatformIcons.jsx";

function FeedPage({ onViewProfile, onNeedAuth }) {
  const [posts, setPosts] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedMode, setFeedMode] = useState("all");
  const { user } = useAuth();

  const load = useCallback((cursor, append, mode) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", String(cursor));
    params.set("mode", mode || "all");
    const q = `?${params.toString()}`;
    return api(`/api/feed${q}`)
      .then((j) => {
        setPosts((prev) => (append ? [...prev, ...(j.posts || [])] : j.posts || []));
        setNextCursor(j.nextCursor || null);
      })
      .catch(() => {
        if (!append) setPosts([]);
      });
  }, []);

  useEffect(() => {
    load(null, false, feedMode);
  }, [load, feedMode]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextCursor, true, feedMode);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="platformStack feedPage">
      <SectionHero
        eyebrow="Главная"
        title="Лента"
        sub="Посты артистов, подписки и публикации — всё в одном месте"
        tone="orange"
      />
      <div className="sectionPanel" style={{ animationDelay: "0.08s" }}>
        <PlatformSearch compact onViewProfile={onViewProfile} />
      </div>
      <div className="feedPillTabs sectionPanel" style={{ animationDelay: "0.12s" }}>
        <button
          type="button"
          className={`feedPillTab ${feedMode === "all" ? "feedPillTab--active" : ""}`}
          onClick={() => setFeedMode("all")}
        >
          Для вас
        </button>
        <button
          type="button"
          className={`feedPillTab ${feedMode === "following" ? "feedPillTab--active" : ""}`}
          onClick={() => setFeedMode("following")}
          disabled={!user}
          title={!user ? "Войдите для ленты подписок" : ""}
        >
          Подписки
        </button>
      </div>
      {user && (
        <div className="sectionPanel" style={{ animationDelay: "0.16s" }}>
          <WallPostForm onPosted={() => load(null, false, feedMode)} />
        </div>
      )}
      {posts.map((p, index) => (
        <div
          key={p.id}
          className="sectionPanel"
          style={{ animationDelay: `${0.2 + Math.min(index, 10) * 0.05}s` }}
        >
          <FeedPost
            post={p}
            onViewProfile={onViewProfile}
            onNeedAuth={onNeedAuth}
            onUpdate={(u) => setPosts((list) => list.map((x) => (x.id === u.id ? u : x)))}
            onRemove={(id) => setPosts((list) => list.filter((x) => x.id !== id))}
            onReposted={() => load(null, false, feedMode)}
          />
        </div>
      ))}
      {posts.length === 0 && (
        <p className="muted feedPage__empty sectionPanel" style={{ animationDelay: "0.2s" }}>
          {feedMode === "following" && !user
            ? "Войдите, чтобы видеть ленту подписок"
            : feedMode === "following"
              ? "Подпишитесь на кого-нибудь — здесь появятся их посты"
              : "Лента пуста"}
        </p>
      )}
      {nextCursor && (
        <button
          type="button"
          className="btn btnGhost sectionPanel"
          style={{ animationDelay: "0.25s" }}
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "…" : "Ещё посты"}
        </button>
      )}
    </div>
  );
}

function ListPage({ path, mediaType, upload, onViewProfile, highlightReleaseId }) {
  const [items, setItems] = useState([]);
  const [reloadAt, setReloadAt] = useState(0);
  const { user } = useAuth();

  const refresh = useCallback(() => setReloadAt((t) => t + 1), []);

  useEffect(() => {
    api(path)
      .then((j) => setItems(j.items || []))
      .catch(() => setItems([]));
  }, [path, reloadAt]);

  useEffect(() => {
    if (!highlightReleaseId || items.length === 0) return;
    const t = window.setTimeout(() => {
      document.getElementById(`track-card-${highlightReleaseId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
    return () => window.clearTimeout(t);
  }, [highlightReleaseId, items]);

  const uploadSlot =
    upload && user ? (typeof upload === "function" ? upload({ onSuccess: refresh }) : upload) : null;

  return (
    <div className="platformStack">
      {uploadSlot && <div className="tracksPageHead">{uploadSlot}</div>}
      {items.map((it) => (
        <div
          key={it.id}
          id={`track-card-${it.id}`}
          className={`platformCard trackCard ${highlightReleaseId === it.id ? "trackCard--focus" : ""}`}
        >
          <AudioCard item={it} mediaType={mediaType} onViewProfile={onViewProfile} />
        </div>
      ))}
      {items.length === 0 && <p className="muted">Пока пусто</p>}
    </div>
  );
}

function formatNotifTime(ts) {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 50) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} д`;
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function notifTypeMeta(type) {
  switch (type) {
    case "post_like":
    case "openver_like":
      return { glyph: "♥", tone: "like" };
    case "post_comment":
      return { glyph: "◦", tone: "comment" };
    case "new_post":
      return { glyph: "✦", tone: "post" };
    case "dm_message":
      return { glyph: "✉", tone: "dm" };
    case "track_rating":
      return { glyph: "★", tone: "rate" };
    case "king_win":
      return { glyph: "♛", tone: "king" };
    case "tg_import":
      return { glyph: "↗", tone: "tg" };
    default:
      return { glyph: "•", tone: "default" };
  }
}

function NotificationsBell({ onNavigate }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);

  const reload = useCallback(() => {
    if (!user) return;
    api("/api/notifications")
      .then((j) => setList(j.items || []))
      .catch(() => setList([]));
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!user) return undefined;
    const onFocus = () => reload();
    const onVis = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reload, user]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!e.target.closest?.(".notifWrap--sidebar")) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onWsMessage = useCallback((msg) => {
    if (msg.type === "notification" && msg.item) {
      setList((prev) => {
        if (prev.some((n) => n.id === msg.item.id)) return prev;
        return [msg.item, ...prev];
      });
    }
  }, []);
  usePlatformWs(onWsMessage);

  const openItem = async (n) => {
    if (!n.readAt) {
      try {
        await api(`/api/notifications/${n.id}/read`, { method: "POST", body: "{}" });
      } catch {
        /* */
      }
    }
    const a = n.action || { section: "feed" };
    onNavigate?.(a.section, a);
    setOpen(false);
    reload();
  };

  if (!user) return null;
  const unread = list.filter((n) => !n.readAt).length;

  return (
    <div className={`notifWrap notifWrap--sidebar${open ? " notifWrap--open" : ""}`}>
      <button
        type="button"
        className={`platNavItem platNavItem--notif${open ? " platNavItem--active" : ""}`}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (!prev) reload();
            return next;
          });
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Уведомления"
      >
        <span className="platNavIcon">
          <IconBell />
          {unread > 0 && <span className="notifNavBadge">{unread > 9 ? "9+" : unread}</span>}
        </span>
        <span className="platNavLabel">Уведомления</span>
      </button>
      {open && (
        <div className="notifDrop" role="dialog" aria-label="Уведомления">
          <header className="notifDrop__head">
            <div className="notifDrop__headTop">
              <span className="notifDrop__headIcon" aria-hidden>
                <IconBell />
                {unread > 0 && (
                  <span className="notifDrop__iconBadge">{unread > 99 ? "99+" : unread}</span>
                )}
              </span>
              <div className="notifDrop__headText">
                <span className="notifDrop__title">Уведомления</span>
                {unread > 0 && (
                  <span className="notifDrop__count muted">
                    {unread} {unread === 1 ? "новое" : "новых"}
                  </span>
                )}
              </div>
            </div>
            {unread > 0 && (
              <button
                type="button"
                className="notifDrop__readAll"
                onClick={() => api("/api/notifications/read-all", { method: "POST", body: "{}" }).then(reload)}
              >
                Прочитать все
              </button>
            )}
          </header>

          {list.length === 0 ? (
            <div className="notifDrop__empty">
              <div className="notifDrop__emptyArt" aria-hidden>
                <IconBell />
              </div>
              <p className="notifDrop__emptyTitle">Пока тишина</p>
              <p className="notifDrop__emptyHint">Лайки, комментарии и сообщения появятся здесь</p>
            </div>
          ) : (
            <ul className="notifDrop__list">
              {list.slice(0, 20).map((n) => {
                const meta = notifTypeMeta(n.type);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`notifItem${n.readAt ? "" : " notifItem--unread"}`}
                      onClick={() => openItem(n)}
                    >
                      <span className={`notifItem__glyph notifItem__glyph--${meta.tone}`} aria-hidden>
                        {meta.glyph}
                      </span>
                      <span className="notifItem__body">
                        <span className="notifItem__text">{n.text || n.type}</span>
                        <time className="notifItem__time" dateTime={new Date(n.createdAt).toISOString()}>
                          {formatNotifTime(n.createdAt)}
                        </time>
                      </span>
                      {!n.readAt && <span className="notifItem__dot" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function PlatformApp() {
  const { user, loading, logout, tgError } = useAuth();
  const { route, navigate } = useAppHash();
  const section = route.section;
  const profileUsername = route.username;
  const highlightReleaseId = route.releaseId;
  const [pendingDmConvId, setPendingDmConvId] = useState(null);

  useEffect(() => {
    if (section === "auth" && user && !loading) {
      navigate({ section: "profile", username: user.username });
    }
  }, [section, user, loading, navigate]);

  const openProfile = (username) => {
    if (!username) return;
    navigate({ section: "profile", username });
  };

  const openDmWith = async (username) => {
    if (!username) return;
    if (!user) {
      navigate({ section: "auth" });
      return;
    }
    if (username === user.username) return;
    try {
      const j = await api("/api/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      if (j.conversation?.id) setPendingDmConvId(j.conversation.id);
      navigate({ section: "messages" });
    } catch {
      navigate({ section: "messages" });
    }
  };

  const handleNavigate = (targetSection, action) => {
    if (targetSection === "messages") {
      if (action?.conversationId) setPendingDmConvId(action.conversationId);
      navigate({ section: "messages" });
    } else if (targetSection === "profile" && action?.username) {
      openProfile(action.username);
    } else if (targetSection === "myTracks" && action?.releaseId) {
      navigate({ section: "myTracks", releaseId: action.releaseId });
    } else {
      navigate({ section: targetSection || "feed" });
    }
  };

  const goNav = (id, extra) => {
    if (id === "profile" && extra?.username) {
      navigate({ section: "profile", username: extra.username });
      return;
    }
    navigate({ section: id });
  };

  const goAuth = () => navigate({ section: "auth" });

  let body = null;
  if (section === "feed") body = <FeedPage onViewProfile={openProfile} onNeedAuth={goAuth} />;
  else if (section === "profile" && profileUsername)
    body = (
      <ProfilePage
        username={profileUsername}
        onBack={() => navigate({ section: "feed" })}
        onOpenMessages={() => navigate({ section: "messages" })}
        onViewProfile={openProfile}
        onOpenSettings={() => navigate({ section: "settings" })}
        onNeedAuth={goAuth}
      />
    );
  else if (section === "messages")
    body = (
      <MessagesPage
        initialConversationId={pendingDmConvId}
        onConversationOpened={() => setPendingDmConvId(null)}
        onNeedAuth={goAuth}
      />
    );
  else if (section === "myTracks")
    body = (
      <MyTracksPage
        onViewProfile={openProfile}
        highlightReleaseId={highlightReleaseId}
        onNeedAuth={goAuth}
      />
    );
  else if (section === "beats")
    body = (
      <BeatsFeedPage onViewProfile={openProfile} onMessageUser={openDmWith} />
    );
  else if (section === "myBeats")
    body = <MyBeatsPage onViewProfile={openProfile} />;
  else if (section === "settings")
    body = (
      <div className="settingsPageWrap">
        <SettingsPage />
        <TelegramPanel />
      </div>
    );
  else if (section === "telegram") body = <TelegramPanel />;
  else if (section === "admin") body = <AdminPage />;
  else if (section === "openvers")
    body = (
      <OpenversFeedPage
        onViewProfile={openProfile}
        onMessageUser={openDmWith}
        onNeedAuth={goAuth}
      />
    );
  else if (section === "top") body = <TopPage onViewProfile={openProfile} />;
  else if (section === "rate") body = <RatePage onViewProfile={openProfile} onNeedAuth={goAuth} />;
  else if (section === "king") body = <KingPage onViewProfile={openProfile} />;
  if (section === "auth" && !user && !loading) {
    return (
      <AuthScreen
        onDone={() => navigate({ section: "feed" })}
      />
    );
  }

  return (
    <PlatformShell
      section={section}
      user={user}
      onNavigate={goNav}
      onViewProfile={openProfile}
      onLogout={() => logout()}
      notifSlot={<NotificationsBell onNavigate={handleNavigate} />}
    >
      {tgError && !loading && (
        <p className="formErr platTgBanner" role="alert">
          {tgError}
        </p>
      )}
      {loading ? <p className="muted platLoading">Загрузка сессии…</p> : body}
    </PlatformShell>
  );
}
