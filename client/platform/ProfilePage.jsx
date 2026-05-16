import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { FeedPost } from "./FeedPost.jsx";
import { FollowLists } from "./FollowLists.jsx";
import { WallPostForm } from "./WallPostForm.jsx";
import { AudioCard } from "./AudioCard.jsx";

function formatRegDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 10_000) return `${Math.round(num / 1000)}K`;
  if (num >= 1_000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(num);
}

function formatTgSubscribers(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return null;
  const mod10 = num % 10;
  const mod100 = num % 100;
  let word = "подписчиков";
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = "подписчик";
    else if (mod10 >= 2 && mod10 <= 4) word = "подписчика";
  }
  return `${formatCount(num)} ${word}`;
}

function ProfileVerifiedBadge() {
  const tipId = useId();
  const hint = "Этот человек подтвердил свой Telegram-канал.";
  return (
    <span className="profileVerifiedWrap">
      <span
        className="profileVerified"
        tabIndex={0}
        aria-describedby={tipId}
        aria-label="Подтверждённый Telegram-канал"
      >
        <svg className="profileVerified__icon" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="12" fill="currentColor" />
          <path
            d="M7 12.2l2.8 2.8L17 8"
            fill="none"
            stroke="#1a0c04"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span id={tipId} role="tooltip" className="profileVerifiedTip">
        <span className="profileVerifiedTip__glow" aria-hidden />
        {hint}
      </span>
    </span>
  );
}

const PROFILE_TRACK_TABS = [
  { id: "tracks", label: "Треки", mediaType: "releases" },
  { id: "demos", label: "Демо", mediaType: "releases" },
  { id: "openvers", label: "Оупены", mediaType: "openvers" },
  { id: "beats", label: "Биты", mediaType: "beats" },
];

const PROFILE_TRACK_EMPTY = {
  tracks: { title: "Пока нет треков", sub: "Опубликованные треки появятся здесь" },
  demos: { title: "Пока нет демо", sub: "Демо-записи появятся здесь" },
  openvers: { title: "Пока нет оупенов", sub: "Опены появятся здесь" },
  beats: { title: "Пока нет битов", sub: "Биты появятся здесь" },
};

/** Порядок стены профиля: закреплённый пост сверху, остальные по дате */
function sortProfileWallPosts(list) {
  return [...list].sort((a, b) => {
    const ap = a.pinnedAt != null ? 0 : 1;
    const bp = b.pinnedAt != null ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const pa = a.pinnedAt || 0;
    const pb = b.pinnedAt || 0;
    if (pa !== pb) return pb - pa;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export function ProfilePage({ username, onBack, onOpenMessages, onViewProfile, onNeedAuth }) {
  const { user: me } = useAuth();
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [releases, setReleases] = useState([]);
  const [openvers, setOpenvers] = useState([]);
  const [beats, setBeats] = useState([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [trackTab, setTrackTab] = useState("tracks");
  const [tab, setTab] = useState("posts");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const j = await api(`/api/users/${encodeURIComponent(username)}`);
    setProfile(j);
    const wall = await api(`/api/users/${encodeURIComponent(username)}/wall`);
    setPosts(sortProfileWallPosts(wall.posts || []));
  }, [username]);

  useEffect(() => {
    load().catch((e) => {
      setErr(e.message);
      setProfile(null);
    });
  }, [load]);

  useEffect(() => {
    if (tab !== "tracks" || !username) return;
    setTracksLoading(true);
    const u = encodeURIComponent(username);
    Promise.all([
      api(`/api/users/${u}/releases`),
      api(`/api/users/${u}/openvers`),
      api(`/api/users/${u}/beats`),
    ])
      .then(([rel, op, bt]) => {
        setReleases(rel.items || []);
        setOpenvers(op.items || []);
        setBeats(bt.items || []);
      })
      .catch(() => {
        setReleases([]);
        setOpenvers([]);
        setBeats([]);
      })
      .finally(() => setTracksLoading(false));
  }, [tab, username]);

  const profileTracks = useMemo(() => releases.filter((i) => !i.isDemo), [releases]);
  const profileDemos = useMemo(() => releases.filter((i) => i.isDemo), [releases]);

  const trackCounts = useMemo(
    () => ({
      tracks: profileTracks.length,
      demos: profileDemos.length,
      openvers: openvers.length,
      beats: beats.length,
    }),
    [profileTracks, profileDemos, openvers, beats]
  );

  const trackTabItems = useMemo(() => {
    if (trackTab === "demos") return profileDemos;
    if (trackTab === "openvers") return openvers;
    if (trackTab === "beats") return beats;
    return profileTracks;
  }, [trackTab, profileTracks, profileDemos, openvers, beats]);

  const trackMediaType = PROFILE_TRACK_TABS.find((t) => t.id === trackTab)?.mediaType || "releases";

  const toggleSub = async () => {
    if (!me || !profile?.user) return;
    setBusy(true);
    try {
      const j = profile.subscribed
        ? await api(`/api/subscriptions/${encodeURIComponent(username)}`, { method: "DELETE" })
        : await api(`/api/subscriptions/${encodeURIComponent(username)}`, { method: "POST", body: "{}" });
      setProfile((p) => ({ ...p, subscribed: j.subscribed }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const writeMsg = async () => {
    try {
      await api("/api/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      onOpenMessages?.();
    } catch (e) {
      setErr(e.message);
    }
  };

  if (err && !profile) {
    return (
      <div className="platformStack profileV2">
        <p className="formErr profileErr">{err}</p>
      </div>
    );
  }

  if (!profile?.user) {
    return (
      <div className="platformStack profileV2 profileV2--loading" aria-busy="true">
        <div className="profileSkeleton">
          <div className="profileSkeleton__banner" />
          <div className="profileSkeleton__avatar" />
          <div className="profileSkeleton__line profileSkeleton__line--lg" />
          <div className="profileSkeleton__line profileSkeleton__line--sm" />
        </div>
        <p className="profileLoading muted">Загрузка профиля…</p>
      </div>
    );
  }

  const u = profile.user;
  const isSelf = me?.id === u.id;
  const nick = u.displayName || u.username;
  const tgChannel = u.telegramChannel || null;
  const tgMeta = u.telegramChannelMeta || null;
  const tgMemberCount = tgMeta?.memberCount;
  const tgSubsLabel = formatTgSubscribers(tgMemberCount);
  const tgLink = tgChannel ? `https://t.me/${tgChannel.replace(/^@+/, "")}` : null;

  return (
    <div className="platformStack profileV2">
      {onBack && (
        <button type="button" className="platBackBtn profileV2__back" onClick={onBack}>
          <span className="platBackBtn__chevron" aria-hidden>
            ‹
          </span>
          Назад
        </button>
      )}

      <section className="profileHero">
        <div
          className={`profileBanner ${u.bannerUrl ? "profileBanner--hasImage" : ""}`}
          style={u.bannerUrl ? { backgroundImage: `url(${u.bannerUrl})` } : undefined}
        >
          <span className="profileBanner__orb profileBanner__orb--a" aria-hidden />
          <span className="profileBanner__orb profileBanner__orb--b" aria-hidden />
        </div>

        <div className="profileHeroBody">
          <div className="profileHeroHead">
            <div className="profileHeroIdentity">
              <div className="profileNameRow">
                <h1 className="profileDisplayName">{nick}</h1>
                {tgChannel && <ProfileVerifiedBadge />}
              </div>
              <p className="profileHandle">@{u.username}</p>
            </div>

            {!isSelf && me && (
              <div className="profileHeroActions profileHeroActions--head">
                <button
                  type="button"
                  className={`profileBtn ${profile.subscribed ? "profileBtn--ghost" : "profileBtn--accent"}`}
                  disabled={busy}
                  onClick={toggleSub}
                >
                  {profile.subscribed ? "Отписаться" : "Подписаться"}
                </button>
                <button type="button" className="profileBtn profileBtn--ghost" onClick={writeMsg}>
                  Написать
                </button>
              </div>
            )}
          </div>

          <div className="profileHeroBar profileHeroBar--belowIdentity">
            <div className="profileAvatarWrap">
              {u.avatarUrl ? (
                <img src={u.avatarUrl} alt="" className="profileAvatar" />
              ) : (
                <div className="profileAvatar profileAvatar--empty">{nick.charAt(0).toUpperCase()}</div>
              )}
              {u.isStreamer && (
                <span className="profileAvatarBadge" title="Стример">
                  LIVE
                </span>
              )}
            </div>

            <div className="profileHeroMain">
              <div className="profileHeroTop">
                <div className="profileHeroInfo">
                  {tgChannel && (
                    <a
                      className="profileTgChip"
                      href={tgLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={
                        tgMeta?.title
                          ? `${tgMeta.title}${tgSubsLabel ? ` · ${tgSubsLabel}` : ""}`
                          : tgSubsLabel || "Открыть канал в Telegram"
                      }
                    >
                      <span className="profileTgChip__badge" aria-hidden>
                        TG
                      </span>
                      <span className="profileTgChip__row">
                        <span className="profileTgChip__handle">@{tgChannel.replace(/^@+/, "")}</span>
                        <span className="profileTgChip__sep" aria-hidden>
                          ·
                        </span>
                        <span className="profileTgChip__subs">
                          {tgSubsLabel || "канал в Telegram"}
                        </span>
                      </span>
                      <span className="profileTgChip__arrow" aria-hidden>
                        ↗
                      </span>
                    </a>
                  )}

                  <div className="profileSubRow">
                    {u.createdAt && (
                      <span className="profileSubItem">
                        <span className="profileSubItem__icon" aria-hidden>
                          ◷
                        </span>
                        с {formatRegDate(u.createdAt)}
                      </span>
                    )}
                    <span className="profileSubItem profileSubItem--king">
                      <span className="profileSubItem__icon" aria-hidden>
                        ♛
                      </span>
                      {u.kingWins} побед · {u.gamesPlayed} игр
                    </span>
                  </div>

                  <FollowLists
                    username={username}
                    onViewProfile={onViewProfile}
                    variant="profile"
                    followerCount={profile.followerCount}
                    followingCount={profile.followingCount}
                  />
                </div>
              </div>

              {u.bio && <p className="profileBio">{u.bio}</p>}
            </div>
          </div>
        </div>
      </section>

      {err && <p className="formErr profileErr">{err}</p>}

      <section className="profileFeed">
        <div className="profileTabs" role="tablist" aria-label="Разделы профиля">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "posts"}
            className={`profileTab ${tab === "posts" ? "profileTab--active" : ""}`}
            onClick={() => setTab("posts")}
          >
            Посты
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "tracks"}
            className={`profileTab ${tab === "tracks" ? "profileTab--active" : ""}`}
            onClick={() => setTab("tracks")}
          >
            Треки
          </button>
        </div>

        {isSelf && tab === "posts" && (
          <WallPostForm
            compact
            onPosted={(post) => {
              if (post) setPosts((list) => sortProfileWallPosts([post, ...list]));
            }}
          />
        )}

        {tab === "posts" &&
          (posts.length === 0 ? (
            <div className="profileEmpty">
              <span className="profileEmpty__icon" aria-hidden>
                ✎
              </span>
              <p className="profileEmpty__title">Пока нет постов</p>
              <p className="profileEmpty__sub muted">Здесь появятся записи на стене</p>
            </div>
          ) : (
            <div className="profilePostList">
              {posts.map((p) => (
                <FeedPost
                  key={p.id}
                  post={p}
                  onViewProfile={onViewProfile}
                  onNeedAuth={onNeedAuth}
                  allowPin={isSelf}
                  onRemove={(id) => setPosts((list) => list.filter((x) => x.id !== id))}
                  onUpdate={(updated) =>
                    setPosts((list) => {
                      let next = list.map((x) => (x.id === updated.id ? updated : x));
                      if (updated.pinnedAt != null) {
                        next = next.map((x) => (x.id === updated.id ? x : { ...x, pinnedAt: null }));
                      }
                      return sortProfileWallPosts(next);
                    })}
                />
              ))}
            </div>
          ))}

        {tab === "tracks" && (
          <div className="profileTracksPanel">
            <div className="myTracksTabs profileTracksTabs" role="tablist" aria-label="Типы треков">
              {PROFILE_TRACK_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={trackTab === t.id}
                  className={`myTracksTab ${trackTab === t.id ? "myTracksTab--active" : ""}`}
                  onClick={() => setTrackTab(t.id)}
                >
                  {t.label}
                  <span className="myTracksTab__count">{trackCounts[t.id]}</span>
                </button>
              ))}
            </div>

            <div className="profileTrackList myTracksList" role="tabpanel">
            {tracksLoading && <p className="muted profileEmpty">Загрузка…</p>}
            {!tracksLoading && trackTabItems.length === 0 && (
              <div className="profileEmpty">
                <span className="profileEmpty__icon" aria-hidden>
                  ♪
                </span>
                <p className="profileEmpty__title">{PROFILE_TRACK_EMPTY[trackTab].title}</p>
                <p className="profileEmpty__sub muted">{PROFILE_TRACK_EMPTY[trackTab].sub}</p>
              </div>
            )}
            {!tracksLoading &&
              trackTabItems.map((it, index) => (
                <article
                  key={it.id}
                  className="myTrackCard trackCard profileTrackCard"
                  style={{ animationDelay: `${Math.min(index, 8) * 0.07}s` }}
                >
                  <AudioCard item={it} mediaType={trackMediaType} onViewProfile={onViewProfile} />
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
