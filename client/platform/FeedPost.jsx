import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { GuestGateCard } from "./GuestGateCard.jsx";

const SMALL_MEDIA_PX = 320;

function WallPostMedia({ kind, url }) {
  const [enlarge, setEnlarge] = useState(false);

  const onMediaLoad = (e) => {
    const el = e.currentTarget;
    const w = el.naturalWidth || el.videoWidth || 0;
    const h = el.naturalHeight || el.videoHeight || 0;
    if (w > 0 && h > 0 && w < SMALL_MEDIA_PX && h < SMALL_MEDIA_PX) setEnlarge(true);
  };

  const cls = `wallImg ${enlarge ? "wallImg--enlarge" : ""}`;

  return (
    <div className="wallPost__media">
      {kind === "image" && <img src={url} alt="" className={cls} onLoad={onMediaLoad} />}
      {kind === "video" && <video src={url} controls className={cls} onLoadedMetadata={onMediaLoad} />}
    </div>
  );
}

function buildCommentTree(flat) {
  const byId = new Map();
  const roots = [];
  for (const c of flat) {
    byId.set(c.id, { ...c, replies: [] });
  }
  for (const c of flat) {
    const node = byId.get(c.id);
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function WallAuthor({ author, onViewProfile, variant = "post" }) {
  const cls = variant === "comment" ? "wallCommentAuthor" : "wallPostAuthor";
  const username = author?.username;
  const nick = author?.displayName || username;
  if (!nick) return <span className={cls}>?</span>;
  const inner = (
    <>
      <span className={`${cls}__nick`}>{nick}</span>
      {author?.displayName && username && (
        <span className={`${cls}__handle`}>@{username}</span>
      )}
    </>
  );
  if (username && onViewProfile) {
    return (
      <button type="button" className={`${cls} ${cls}--btn`} onClick={() => onViewProfile(username)}>
        {inner}
      </button>
    );
  }
  return <span className={`${cls} ${cls}--static`}>{inner}</span>;
}

function formatPostDate(ts) {
  return new Date(ts).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatViews(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${Math.floor(v / 100_000) / 10}M`.replace(/\.0$/, "");
  if (v >= 1000) return `${Math.floor(v / 100) / 10}K`.replace(/\.0$/, "");
  return String(v);
}

function CommentNode({ node, user, replyTo, setReplyTo, onReplySent, postId, onViewProfile }) {
  const [replyText, setReplyText] = useState("");
  const isReplying = replyTo === node.id;

  const submitReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !user) return;
    const j = await api(`/api/wall/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: replyText.trim(), parentId: node.id }),
    });
    setReplyText("");
    setReplyTo(null);
    onReplySent(j);
  };

  return (
    <li className={`wallComment ${node.parentId ? "wallComment--reply" : ""}`}>
      <div className="wallComment__inner">
        <div className="wallComment__head">
          <WallAuthor author={node.author} onViewProfile={onViewProfile} variant="comment" />
          <time className="wallComment__time">{formatPostDate(node.createdAt)}</time>
        </div>
        <p className="wallComment__text">{node.body}</p>
      {user && (
        <button type="button" className="wallReplyBtn" onClick={() => setReplyTo(isReplying ? null : node.id)}>
          Ответить
        </button>
      )}
      {isReplying && user && (
        <form className="wallCommentForm wallCommentForm--reply" onSubmit={submitReply}>
          <input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={`Ответ @${node.author?.username}…`}
            autoFocus
          />
          <button type="submit" className="wallCommentSubmit wallCommentSubmit--sm">
            Отправить
          </button>
        </form>
      )}
      {node.replies?.length > 0 && (
        <ol className="wallCommentList wallCommentList--nested">
          {node.replies.map((r) => (
            <CommentNode
              key={r.id}
              node={r}
              user={user}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              onReplySent={onReplySent}
              postId={postId}
              onViewProfile={onViewProfile}
            />
          ))}
        </ol>
      )}
      </div>
    </li>
  );
}

export function FeedPost({ post: initial, onUpdate, onViewProfile, onRemove, onReposted, allowPin = false, onNeedAuth }) {
  const { user } = useAuth();
  const [post, setPost] = useState(initial);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [guestActionHint, setGuestActionHint] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(initial.body || "");
  const articleRef = useRef(null);
  const viewRecorded = useRef(false);

  useEffect(() => {
    setPost(initial);
    viewRecorded.current = false;
  }, [initial]);

  useEffect(() => {
    const el = articleRef.current;
    if (!el || viewRecorded.current) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || viewRecorded.current) return;
        viewRecorded.current = true;
        observer.disconnect();
        api(`/api/wall/posts/${initial.id}/view`, { method: "POST" })
          .then((j) => {
            if (typeof j.viewCount !== "number") return;
            setPost((p) => {
              const next = { ...p, viewCount: j.viewCount };
              onUpdate?.(next);
              return next;
            });
          })
          .catch(() => {});
      },
      { threshold: 0.4, rootMargin: "0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [initial.id, onUpdate]);

  const tree = useMemo(() => buildCommentTree(comments), [comments]);

  const isMine = Boolean(user?.id && post.userId === user.id);

  const patch = (next) => {
    setPost(next);
    onUpdate?.(next);
  };

  const toggleLike = async () => {
    if (!user) {
      setGuestActionHint("like");
      onNeedAuth?.();
      return;
    }
    setGuestActionHint(null);
    setBusy(true);
    try {
      const j = post.liked
        ? await api(`/api/wall/posts/${post.id}/like`, { method: "DELETE" })
        : await api(`/api/wall/posts/${post.id}/like`, { method: "POST" });
      patch({ ...post, liked: j.liked, likeCount: j.likeCount });
    } catch {
      /* */
    } finally {
      setBusy(false);
    }
  };

  const loadComments = async () => {
    const j = await api(`/api/wall/posts/${post.id}/comments`);
    setComments(j.comments || []);
  };

  const openComments = async () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (!user && next) {
      setGuestActionHint("comment");
      onNeedAuth?.();
      return;
    }
    if (next && comments.length === 0) await loadComments().catch(() => {});
  };

  const onCommentAdded = (j) => {
    if (j.comment) setComments((c) => [...c, j.comment]);
    patch({ ...post, commentCount: j.commentCount ?? post.commentCount + 1 });
  };

  const saveEdit = async () => {
    if (!isMine) return;
    try {
      const j = await api(`/api/wall/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: editBody.trim() }),
      });
      patch(j.post);
      setEditing(false);
    } catch (e) {
      alert(e?.message || "Не удалось сохранить.");
    }
  };

  const deletePost = async () => {
    if (!isMine || !window.confirm("Удалить пост?")) return;
    try {
      await api(`/api/wall/posts/${post.id}`, { method: "DELETE" });
      onRemove?.(post.id);
    } catch (e) {
      alert(e?.message || "Не удалось удалить пост.");
    }
  };

  const togglePin = async () => {
    if (!allowPin || !isMine || pinBusy) return;
    const nextPinned = !post.pinnedAt;
    setPinBusy(true);
    try {
      const j = await api(`/api/wall/posts/${post.id}/pin`, {
        method: "POST",
        body: JSON.stringify({ pinned: nextPinned }),
      });
      patch(j.post);
    } catch {
      /* */
    } finally {
      setPinBusy(false);
    }
  };

  const repost = async () => {
    const comment = window.prompt("Комментарий к репосту (необязательно)") ?? "";
    const fd = new FormData();
    fd.append("repostOfId", post.id);
    if (comment.trim()) fd.append("repostComment", comment.trim());
    await api("/api/wall/posts", { method: "POST", body: fd });
    onReposted?.();
  };

  const reportPost = async () => {
    const reason = window.prompt("Причина жалобы") || "";
    await api("/api/reports", {
      method: "POST",
      body: JSON.stringify({ targetType: "wall_post", targetId: post.id, reason }),
    });
    alert("Жалоба отправлена");
  };

  const sendComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !user) return;
    const j = await api(`/api/wall/posts/${post.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: commentText.trim(), parentId: replyTo || undefined }),
    });
    setCommentText("");
    setReplyTo(null);
    onCommentAdded(j);
  };

  return (
    <article ref={articleRef} className={`platformCard wallPost${post.pinnedAt ? " wallPost--pinned" : ""}`}>
      <header className="wallPost__head">
        <WallAuthor author={post.author} onViewProfile={onViewProfile} />
        <div className="wallPost__meta">
          {post.pinnedAt != null && (
            <span className="wallPost__badge wallPost__badge--pin" title="Закреплённый пост">
              📌 Закреплён
            </span>
          )}
          <time className="wallPost__time">{formatPostDate(post.createdAt)}</time>
          {(post.viewCount ?? 0) > 0 && (
            <span className="wallPost__views" title="Просмотры">
              <span className="wallPost__viewsIcon" aria-hidden>
                ◉
              </span>
              {formatViews(post.viewCount)}
            </span>
          )}
          {post.source === "telegram" && <span className="wallPost__badge">TG</span>}
        </div>
      </header>
      {post.repostComment && <p className="repostComment">{post.repostComment}</p>}
      {post.repostOf && (
        <blockquote className="repostEmbed">
          <strong>{post.repostOf.author?.displayName || post.repostOf.author?.username}</strong>
          <p>{post.repostOf.body}</p>
        </blockquote>
      )}
      {editing ? (
        <div className="platformForm">
          <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} />
          <button type="button" className="btn btnSm" onClick={saveEdit}>
            Сохранить
          </button>
          <button type="button" className="btn btnSm btnGhost" onClick={() => setEditing(false)}>
            Отмена
          </button>
        </div>
      ) : (
        post.body && <p className="wallPost__body">{post.body}</p>
      )}
      {post.attachments?.map((a) => {
        if (a.kind === "image" || a.kind === "video") {
          return <WallPostMedia key={a.id} kind={a.kind} url={a.url} />;
        }
        if (a.kind === "audio") {
          return (
            <div key={a.id} className="wallPost__media wallPost__media--audio">
              <audio src={a.url} controls className="wallAud" />
            </div>
          );
        }
        return (
          <a key={a.id} className="btn btnSm" href={a.url} target="_blank" rel="noopener noreferrer">
            Вложение
          </a>
        );
      })}
      <div className="wallActions">
        <span className="wallActionBtn wallActionBtn--stat" title="Просмотры">
          <span className="wallActionBtn__icon">👁</span>
          <span>{formatViews(post.viewCount ?? 0)}</span>
        </span>
        <button
          type="button"
          className={`wallActionBtn ${post.liked ? "wallActionBtn--liked" : ""} ${!user ? "wallActionBtn--guest" : ""}`}
          disabled={busy}
          onClick={toggleLike}
          title={!user ? "Войдите, чтобы ставить лайки" : undefined}
        >
          <span className="wallActionBtn__icon">{post.liked ? "♥" : "♡"}</span>
          <span>{post.likeCount}</span>
        </button>
        <button
          type="button"
          className={`wallActionBtn ${commentsOpen ? "wallActionBtn--active" : ""}`}
          onClick={openComments}
        >
          <span className="wallActionBtn__icon">💬</span>
          <span>{post.commentCount}</span>
        </button>
        {user && (
          <button type="button" className="wallActionBtn" onClick={repost}>
            <span className="wallActionBtn__icon">↗</span>
            <span>Репост</span>
          </button>
        )}
        {user && post.userId !== user.id && (
          <button type="button" className="wallActionBtn wallActionBtn--icon" onClick={reportPost} title="Пожаловаться">
            ⚠
          </button>
        )}
        {isMine && post.canEdit && !editing && (
          <button type="button" className="wallActionBtn wallActionBtn--icon" onClick={() => setEditing(true)} title="Редактировать">
            ✎
          </button>
        )}
        {allowPin && isMine && (
          <button
            type="button"
            className={`wallActionBtn wallActionBtn--icon ${post.pinnedAt ? "wallActionBtn--active" : ""}`}
            onClick={togglePin}
            disabled={pinBusy}
            title={post.pinnedAt ? "Открепить от профиля" : "Закрепить в профиле"}
          >
            📌
          </button>
        )}
        {isMine && (
          <button type="button" className="wallActionBtn wallActionBtn--icon" onClick={deletePost} title="Удалить">
            🗑
          </button>
        )}
      </div>
      {guestActionHint && !user && (
        <div className="wallGuestHint">
          <GuestGateCard
            compact
            icon={guestActionHint === "comment" ? "message" : "heart"}
            title={guestActionHint === "comment" ? "Комментарии — для своих" : "Лайки — только для своих"}
            subtitle="Войдите или зарегистрируйтесь, чтобы участвовать в обсуждении."
            onAction={onNeedAuth}
          />
        </div>
      )}
      {commentsOpen && (
        <div className="wallComments wallComments--open">
          <ol className="wallCommentList">
            {tree.map((c) => (
              <CommentNode
                key={c.id}
                node={c}
                user={user}
                replyTo={replyTo}
                setReplyTo={setReplyTo}
                onReplySent={onCommentAdded}
                postId={post.id}
                onViewProfile={onViewProfile}
              />
            ))}
            {tree.length === 0 && <li className="wallCommentEmpty muted">Пока нет комментариев</li>}
          </ol>
          {user ? (
            <form className="wallCommentForm wallCommentForm--main" onSubmit={sendComment}>
              {replyTo && (
                <p className="wallReplyHint">
                  Ответ на комментарий ·{" "}
                  <button type="button" className="wallReplyCancel" onClick={() => setReplyTo(null)}>
                    отмена
                  </button>
                </p>
              )}
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={replyTo ? "Ваш ответ…" : "Комментарий…"}
              />
              <button type="submit" className="wallCommentSubmit">
                Отправить
              </button>
            </form>
          ) : (
            <GuestGateCard
              compact
              icon="message"
              title="Комментарии — для своих"
              subtitle="Войдите, чтобы обсуждать пост."
              onAction={onNeedAuth}
            />
          )}
        </div>
      )}
    </article>
  );
}
