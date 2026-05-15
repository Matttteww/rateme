import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { usePlatformWs } from "./usePlatformWs.js";
import { IconMessage } from "./PlatformIcons.jsx";
import { SectionHero } from "./SectionHero.jsx";

function formatMsgTime(ts) {
  return new Date(ts).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessagesPage({ initialConversationId, onConversationOpened }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [newUser, setNewUser] = useState("");
  const [searchHits, setSearchHits] = useState([]);
  const [err, setErr] = useState("");
  const bottomRef = useRef(null);

  const loadConversations = useCallback(() => {
    api("/api/dm/conversations")
      .then((j) => setConversations(j.conversations || []))
      .catch(() => setConversations([]));
  }, []);

  const loadMessages = useCallback(
    async (convId) => {
      const j = await api(`/api/dm/conversations/${convId}/messages`);
      setMessages(j.messages || []);
      await api(`/api/dm/conversations/${convId}/read`, { method: "POST", body: "{}" });
      loadConversations();
    },
    [loadConversations]
  );

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user, loadConversations]);

  useEffect(() => {
    if (!initialConversationId) return;
    setActiveId(initialConversationId);
    onConversationOpened?.();
  }, [initialConversationId, onConversationOpened]);

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId).catch((e) => setErr(e.message));
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onWs = useCallback(
    (msg) => {
      if (msg.type === "dm_message" && msg.conversationId === activeId && msg.message) {
        setMessages((prev) => (prev.some((m) => m.id === msg.message.id) ? prev : [...prev, msg.message]));
        loadConversations();
      } else if (msg.type === "dm_conversation") {
        loadConversations();
      }
    },
    [activeId, loadConversations]
  );
  usePlatformWs(onWs);

  useEffect(() => {
    const q = newUser.trim();
    if (q.length < 2) {
      setSearchHits([]);
      return;
    }
    const t = setTimeout(() => {
      api(`/api/users/search?q=${encodeURIComponent(q)}`)
        .then((j) => setSearchHits(j.users || []))
        .catch(() => setSearchHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [newUser]);

  const openWith = async (username) => {
    setErr("");
    try {
      const j = await api("/api/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      const conv = j.conversation;
      setConversations((list) => {
        const rest = list.filter((c) => c.id !== conv.id);
        return [conv, ...rest];
      });
      setActiveId(conv.id);
      setNewUser("");
      setSearchHits([]);
    } catch (e) {
      setErr(e.message);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!activeId || (!text.trim() && !files.length)) return;
    const fd = new FormData();
    if (text.trim()) fd.append("body", text.trim());
    for (const f of files) fd.append("files", f);
    try {
      const j = await api(`/api/dm/conversations/${activeId}/messages`, { method: "POST", body: fd });
      setMessages((m) => [...m, j.message]);
      setText("");
      setFiles([]);
      loadConversations();
    } catch (ex) {
      setErr(ex.message);
    }
  };

  if (!user) {
    return (
      <div className="platformStack messagesPage">
        <SectionHero
          eyebrow="Общение"
          title="Личные сообщения"
          sub="Переписка с артистами и слушателями платформы"
          tone="violet"
        />
        <p className="muted dmGuestHint sectionPanel" style={{ animationDelay: "0.1s" }}>
          Войдите, чтобы писать в ЛС.
        </p>
      </div>
    );
  }

  const active = conversations.find((c) => c.id === activeId);
  const other = active?.otherUser;

  return (
    <div className="platformStack messagesPage">
      <SectionHero
        eyebrow="Общение"
        title="Личные сообщения"
        sub="Диалоги, вложения и уведомления в реальном времени"
        tone="violet"
      />
      <div className="dmPage sectionPanel" style={{ animationDelay: "0.1s" }}>
      <aside className="dmSidebar">
        <header className="dmSidebarHead">
          <span className="dmSidebarHeadIcon" aria-hidden>
            <IconMessage />
          </span>
          <h2 className="dmPageTitle">Сообщения</h2>
        </header>

        <form
          className="dmNewForm"
          onSubmit={(e) => {
            e.preventDefault();
            if (newUser.trim()) openWith(newUser.trim());
          }}
        >
          <div className="dmNewForm__row">
            <input
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              placeholder="Логин собеседника…"
              className="dmNewForm__input"
              autoComplete="off"
            />
            <button type="submit" className="dmNewForm__submit">
              Написать
            </button>
          </div>
        </form>

        {searchHits.length > 0 && (
          <ul className="dmSearchHits">
            {searchHits.map((u) => (
              <li key={u.id}>
                <button type="button" className="dmSearchHit" onClick={() => openWith(u.username)}>
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="dmSearchHit__avatar" />
                  ) : (
                    <span className="dmSearchHit__avatar dmSearchHit__avatar--empty">
                      {(u.displayName || u.username || "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="dmSearchHit__meta">
                    <span className="dmSearchHit__name">{u.displayName || u.username}</span>
                    <span className="dmSearchHit__handle">@{u.username}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dmConvScroll" aria-label="Список диалогов">
          <ul className="dmConvList">
          {conversations.map((c) => {
            const ou = c.otherUser;
            const nick = ou?.displayName || ou?.username || "?";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`dmConvBtn ${c.id === activeId ? "dmConvBtn--active" : ""}`}
                  onClick={() => setActiveId(c.id)}
                >
                  {ou?.avatarUrl ? (
                    <img src={ou.avatarUrl} alt="" className="dmConvBtn__avatar" />
                  ) : (
                    <span className="dmConvBtn__avatar dmConvBtn__avatar--empty">
                      {nick.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="dmConvBtn__body">
                    <span className="dmConvBtn__top">
                      <span className="dmConvName">{nick}</span>
                      {c.unread > 0 && <span className="dmUnread">{c.unread}</span>}
                    </span>
                    {c.preview && (
                      <span className="dmConvPreview">
                        {c.preview.isMine ? "Вы: " : ""}
                        {(c.preview.body || "вложение").slice(0, 48)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          {conversations.length === 0 && (
            <li className="dmConvEmpty muted">Нет диалогов — начните переписку выше</li>
          )}
          </ul>
        </div>
      </aside>

      <section className="dmChat">
        {err && <p className="formErr dmChatErr">{err}</p>}

        {!activeId && (
          <div className="dmChatEmpty">
            <span className="dmChatEmptyIcon" aria-hidden>
              <IconMessage />
            </span>
            <p className="dmChatEmptyTitle">Выберите диалог</p>
            <p className="dmChatEmptySub muted">или напишите пользователю по логину слева</p>
          </div>
        )}

        {active && (
          <>
            <header className="dmChatHead">
              {other?.avatarUrl ? (
                <img src={other.avatarUrl} alt="" className="dmChatHead__avatar" />
              ) : (
                <span className="dmChatHead__avatar dmChatHead__avatar--empty">
                  {(other?.displayName || other?.username || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="dmChatHead__meta">
                <strong className="dmChatHead__name">{other?.displayName || other?.username}</strong>
                <span className="dmChatHead__handle muted">@{other?.username}</span>
              </div>
            </header>

            <div className="dmMessages">
              {messages.length === 0 && (
                <p className="dmMessagesEmpty muted">Напишите первое сообщение</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`dmMsg ${m.isMine ? "dmMsg--mine" : "dmMsg--their"}`}>
                  {!m.isMine && (
                    <span className="dmMsgAuthor">{m.sender?.displayName || m.sender?.username}</span>
                  )}
                  {m.body && <p className="dmMsg__text">{m.body}</p>}
                  {m.attachments?.map((a) =>
                    a.kind === "image" ? (
                      <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
                        <img src={a.url} alt="" className="dmMsg__img" />
                      </a>
                    ) : (
                      <a key={a.id} className="dmMsg__file" href={a.url} target="_blank" rel="noopener noreferrer">
                        Файл
                      </a>
                    )
                  )}
                  <time className="dmMsg__time">{formatMsgTime(m.createdAt)}</time>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <form className="dmSendForm" onSubmit={send}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Сообщение…"
                rows={2}
                className="dmSendForm__input"
              />
              <div className="dmSendForm__actions">
                <label className="dmSendForm__attach">
                  <input
                    type="file"
                    multiple
                    className="dmSendForm__file"
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  />
                  {files.length ? `Файлов: ${files.length}` : "Вложить"}
                </label>
                <button type="submit" className="dmSendForm__send">
                  Отправить
                </button>
              </div>
            </form>
          </>
        )}
      </section>
      </div>
    </div>
  );
}
