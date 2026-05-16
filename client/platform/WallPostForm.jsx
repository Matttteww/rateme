import React, { useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { IconAttach } from "./PlatformIcons.jsx";

export function WallPostForm({ onPosted, compact }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !files.length) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      if (text.trim()) fd.append("body", text.trim());
      for (const f of files) fd.append("files", f);
      const j = await api("/api/wall/posts", { method: "POST", body: fd });
      setText("");
      setFiles([]);
      onPosted?.(j.post);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const avatar = user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className="composeAvatarImg" />
  ) : (
    <div className="composeAvatar composeAvatar--empty">@</div>
  );

  return (
    <form className={`composeCard ${compact ? "composeCard--compact" : ""}`} onSubmit={submit}>
      <div className="composeCardRow">
        {avatar}
        <textarea
          className="composeInput"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что нового?"
          rows={compact ? 2 : 3}
        />
      </div>
      <div className="composeToolbar">
        <div className="composeTools">
          <label className="composeToolBtn composeToolBtn--file" title="Вложение">
            <IconAttach />
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,image/*,video/*"
              className="composeFileHidden"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          {files.length > 0 && <span className="muted composeFileCount">{files.length} файл(ов)</span>}
        </div>
        <button type="submit" className="composePublish" disabled={busy || (!text.trim() && !files.length)}>
          {busy ? "…" : "Опубликовать"}
        </button>
      </div>
      {err && <p className="formErr">{err}</p>}
    </form>
  );
}
