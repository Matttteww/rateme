import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { GuestGateCard } from "./GuestGateCard.jsx";
import { PlatformDialog, PlatformPromptDialog } from "./PlatformDialog.jsx";
import { showPlatformToast } from "./PlatformToast.jsx";

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
  const [replySending, setReplySending] = useState(false);
  const isReplying = replyTo === node.id;

  const submitReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !user || replySending) return;
    setReplySending(true);
    try {
      const j = await api(`/api/wall/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: replyText.trim(), parentId: node.id }),
      });
      setReplyText("");
      setReplyTo(null);
      onReplySent(j);
    } finally {
      setReplySending(false);
    }
  };

  return (
    <li className={`wallComment ${node.parentId ? "wallComment--reply" : ""} ${node._animate ? "wallComment--enter" : ""}`}>
      <div className={`wallComment__inner${node._pending ? " wallComment__inner--pending" : ""}`}>
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
            <button type="submit" className="wallCommentSubmit wallCommentSubmit--sm" disabled={replySending}>
              {replySending ? "…" : "Отправить"}
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

function FeedPostInner({ post: initial, onUpdate, onViewProfile, onRemove, onReposted, allowPin = false, onNeedAuth }) {
  const { user } = useAuth();
  const [post, setPost] = useState(initial);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsMounted, setCommentsMounted] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [guestActionHint, setGuestActionHint] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");
  const [commentSending, setCommentSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [likePulse, setLikePulse] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(initial.body || "");
  const [repostOpen, setRepostOpen] = useState(false);
  const [repostBusy, setRepostBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const articleRef = useRef(null);
  const viewRecorded = useRef(false);
  const likePulseTimer = useRef(null);

  useEffect(() => {
    setPost(initial);
    viewRecorded.current = false;
  }, [initial]);

  useEffect(() => {
    return () => {
      if (likePulseTimer.current) clearTimeout(likePulseTimer.current);
    };
  }, []);

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

  const pulseLike = () => {
    setLikePulse(true);
    if (likePulseTimer.current) clearTimeout(likePulseTimer.current);
    likePulseTimer.current = setTimeout(() => setLikePulse(false), 420);
  };

  const toggleLike = async () => {
    if (!user) {
      setGuestActionHint("like");
      onNeedAuth?.();
      return;
    }
    setGuestActionHint(null);
    const prev = { liked: post.liked, likeCount: post.likeCount };
    const nextLiked = !post.liked;
    patch({
      ...post,
      liked: nextLiked,
      likeCount: Math.max(0, (post.likeCount || 0) + (nextLiked ? 1 : -1)),
    });
    pulseLike();
    try {
      const j = nextLiked
        ? await api(`/api/wall/posts/${post.id}/like`, { method: "POST" })
        : await api(`/api/wall/posts/${post.id}/like`, { method: "DELETE" });
      patch({ ...post, liked: j.liked, likeCount: j.likeCount });
    } catch {
      patch({ ...post, ...prev });
    }
  };

  const loadComments = async () => {
    const j = await api(`/api/wall/posts/${post.id}/comments`);
    setComments(j.comments || []);
  };

  const openComments = () => {
    const next = !commentsOpen;
    if (next) {
      setCommentsMounted(true);
      setCommentsOpen(true);
      if (!user) {
        setGuestActionHint("comment");
        onNeedAuth?.();
        return;
      }
      setGuestActionHint(null);
      if (comments.length === 0 && !commentsLoading) {
        setCommentsLoading(true);
        loadComments()
          .catch(() => {})
          .finally(() => setCommentsLoading(false));
      }
    } else {
      setCommentsOpen(false);
    }
  };

  const onCommentAdded = (j) => {
    if (j.comment) {
      setComments((c) => [...c, { ...j.comment, _animate: true }]);
    }
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
      showPlatformToast("Пост обновлён");
    } catch (e) {
      showPlatformToast(e?.message || "Не удалось сохранить.", "error");
    }
  };

  const deletePost = async () => {
    if (!isMine) return;
    setDeleteBusy(true);
    try {
      await api(`/api/wall/posts/${post.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      onRemove?.(post.id);
      showPlatformToast("Пост удалён");
    } catch (e) {
      showPlatformToast(e?.message || "Не удалось удалить пост.", "error");
    } finally {
      setDeleteBusy(false);
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

  const submitRepost = async (comment) => {
    setRepostBusy(true);
    try {
      const fd = new FormData();
      fd.append("repostOfId", post.id);
      if (comment) fd.append("repostComment", comment);
      await api("/api/wall/posts", { method: "POST", body: fd });
      setRepostOpen(false);
      onReposted?.();
      showPlatformToast("Репост опубликован");
    } catch (e) {
      showPlatformToast(e?.message || "Не удалось сделать репост.", "error");
    } finally {
      setRepostBusy(false);
    }
  };

  const submitReport = async (reason) => {
    if (!reason.trim()) return;
    setReportBusy(true);
    try {
      await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({ targetType: "wall_post", targetId: post.id, reason: reason.trim() }),
      });
      setReportOpen(false);
      showPlatformToast("Жалоба отправлена");
    } catch (e) {
      showPlatformToast(e?.message || "Не удалось отправить жалобу.", "error");
    } finally {
      setReportBusy(false);
    }
  };

  const sendComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !user || commentSending) return;
    const body = commentText.trim();
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      body,
      parentId: replyTo || null,
      createdAt: Date.now(),
      author: user,
      _animate: true,
      _pending: true,
    };
    setComments((c) => [...c, optimistic]);
    setCommentText("");
    const savedReplyTo = replyTo;
    setReplyTo(null);
    setCommentSending(true);
    try {
      const j = await api(`/api/wall/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, parentId: savedReplyTo || undefined }),
      });
      setComments((c) =>
        c.map((x) => (x.id === tempId ? { ...j.comment, _animate: true } : x))
      );
      patch({ ...post, commentCount: j.commentCount ?? post.commentCount + 1 });
    } catch (ex) {
      setComments((c) => c.filter((x) => x.id !== tempId));
      setCommentText(body);
      if (savedReplyTo) setReplyTo(savedReplyTo);
      showPlatformToast(ex?.message || "Не удалось отправить комментарий.", "error");
    } finally {
      setCommentSending(false);
    }
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
          className={`wallActionBtn ${post.liked ? "wallActionBtn--liked" : ""} ${likePulse ? "wallActionBtn--pulse" : ""} ${!user ? "wallActionBtn--guest" : ""}`}
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
          <button type="button" className="wallActionBtn" onClick={() => setRepostOpen(true)}>
            <span className="wallActionBtn__icon">↗</span>
            <span>Репост</span>
          </button>
        )}
        {user && post.userId !== user.id && (
          <button
            type="button"
            className="wallActionBtn wallActionBtn--icon"
            onClick={() => setReportOpen(true)}
            title="Пожаловаться"
          >
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
          <button type="button" className="wallActionBtn wallActionBtn--icon" onClick={() => setDeleteOpen(true)} title="Удалить">
            🗑
          </button>
        )}
      </div>
      {guestActionHint && !user && (
        <div className="wallGuestHint wallGuestHint--enter">
          <GuestGateCard
            compact
            icon={guestActionHint === "comment" ? "message" : "heart"}
            title={guestActionHint === "comment" ? "Комментарии — для своих" : "Лайки — только для своих"}
            subtitle="Войдите или зарегистрируйтесь, чтобы участвовать в обсуждении."
            onAction={onNeedAuth}
          />
        </div>
      )}
      {commentsMounted && (
        <div className={`wallCommentsWrap ${commentsOpen ? "wallCommentsWrap--open" : ""}`}>
          <div className="wallComments">
            {commentsLoading && (
              <p className="wallCommentsLoading muted" aria-busy="true">
                Загрузка комментариев…
              </p>
            )}
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
              {!commentsLoading && tree.length === 0 && (
                <li className="wallCommentEmpty muted">Пока нет комментариев</li>
              )}
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
                  disabled={commentSending}
                />
                <button type="submit" className="wallCommentSubmit" disabled={commentSending}>
                  {commentSending ? "…" : "Отправить"}
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
        </div>
      )}

      <PlatformPromptDialog
        open={repostOpen}
        onClose={() => !repostBusy && setRepostOpen(false)}
        onSubmit={submitRepost}
        title="Репост"
        description="Добавьте свой комментарий к чужому посту или оставьте поле пустым."
        label="Комментарий (необязательно)"
        placeholder="Ваши мысли…"
        submitLabel="Опубликовать репост"
        optional
        multiline
        busy={repostBusy}
      />

      <PlatformDialog
        open={deleteOpen}
        onClose={() => !deleteBusy && setDeleteOpen(false)}
        title="Удалить пост?"
        description="Действие нельзя отменить."
        primaryLabel="Удалить"
        secondaryLabel="Отмена"
        onPrimary={deletePost}
        busy={deleteBusy}
        size="sm"
      />

      <PlatformPromptDialog
        open={reportOpen}
        onClose={() => !reportBusy && setReportOpen(false)}
        onSubmit={submitReport}
        title="Пожаловаться"
        description="Опишите, что не так с этим постом."
        label="Причина"
        placeholder="Спам, оскорбления…"
        submitLabel="Отправить"
        busy={reportBusy}
      />
    </article>
  );
}

export const FeedPost = React.memo(FeedPostInner);
