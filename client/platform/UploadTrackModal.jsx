import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { notifyDiscoverChanged } from "./platformEvents.js";

function titleFromFileName(fileName) {
  if (!fileName) return "";
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base.replace(/[_]+/g, " ").replace(/-+/g, " - ").trim() || fileName;
}

const UPLOAD_KINDS = [
  { id: "track", label: "Трек", hint: "полноценный релиз" },
  { id: "demo", label: "Демо", hint: "отметка «демо»" },
  { id: "openver", label: "Опен", hint: "вкладка «Опены»" },
];

export function UploadAudioForm({ endpoint, label, onSuccess, variant = "default" }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [artistDisplay, setArtistDisplay] = useState("");
  const [yandexUrl, setYandexUrl] = useState("");
  const [file, setFile] = useState(null);
  const [uploadKind, setUploadKind] = useState("track");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isTrack = variant === "track";
  const fileInputId = "upload-track-file-input";

  const applyAudioFile = (f) => {
    if (!f) {
      setFile(null);
      return;
    }
    setFile(f);
    if (isTrack) setTitle(titleFromFileName(f.name));
  };

  useEffect(() => {
    if (!isTrack || !user) return;
    setArtistDisplay(user.displayName || user.username || "");
  }, [isTrack, user]);

  if (!user) return <p className="muted">Войдите, чтобы загружать.</p>;

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    setErr("");
    setSubmitting(true);
    const fd = new FormData();
    fd.append("title", title);
    const postEndpoint =
      isTrack && uploadKind === "openver" ? "/api/openvers" : endpoint || "/api/releases";
    if (!isTrack || uploadKind === "openver") {
      fd.append("artistDisplay", artistDisplay || user.displayName || user.username || "");
    }
    if (yandexUrl.trim()) fd.append("audioUrl", yandexUrl.trim());
    if (file) fd.append("audio", file);
    if (isTrack && uploadKind !== "openver") fd.append("isDemo", uploadKind === "demo" ? "1" : "0");
    try {
      await api(postEndpoint, { method: "POST", body: fd });
      const kind = isTrack ? uploadKind : "track";
      setMsg(
        kind === "openver" ? "Опен опубликован" : kind === "demo" ? "Демо опубликовано" : "Трек опубликован"
      );
      setTitle("");
      setArtistDisplay(user.displayName || user.username || "");
      setYandexUrl("");
      setFile(null);
      setUploadKind("track");
      notifyDiscoverChanged();
      onSuccess?.(kind);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isTrack) {
    return (
      <form className="platformForm" onSubmit={submit}>
        <h3>{label}</h3>
        <label>
          Название
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Исполнитель (подпись)
          <input value={artistDisplay} onChange={(e) => setArtistDisplay(e.target.value)} required />
        </label>
        <label>
          Файл mp3/wav
          <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <label>
          Или ссылка Яндекс.Диск
          <input value={yandexUrl} onChange={(e) => setYandexUrl(e.target.value)} placeholder="https://disk.yandex.ru/..." />
        </label>
        {msg && <p className="okText">{msg}</p>}
        {err && <p className="formErr">{err}</p>}
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Загрузка…" : "Загрузить"}
        </button>
      </form>
    );
  }

  const submitLabel =
    uploadKind === "openver"
      ? "Опубликовать опен"
      : uploadKind === "demo"
        ? "Опубликовать демо"
        : "Опубликовать трек";

  return (
    <form className="uploadTrackForm" onSubmit={submit}>
      <header className="uploadTrackForm__head">
        <span className="uploadTrackForm__badge" aria-hidden>
          ♫
        </span>
        <div className="uploadTrackForm__headText">
          <h3 id="upload-modal-title" className="uploadTrackForm__title">
            {label}
          </h3>
          <p className="uploadTrackForm__sub">mp3, wav или ссылка с Яндекс.Диска</p>
        </div>
      </header>

      <div className="uploadTrackForm__kindPicker" role="radiogroup" aria-label="Тип загрузки">
        {UPLOAD_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={uploadKind === k.id}
            className={`uploadTrackForm__kindBtn ${uploadKind === k.id ? "uploadTrackForm__kindBtn--active" : ""}`}
            onClick={() => setUploadKind(k.id)}
          >
            <span className="uploadTrackForm__kindLabel">{k.label}</span>
            <span className="uploadTrackForm__kindHint">{k.hint}</span>
          </button>
        ))}
      </div>

      <div className="uploadTrackForm__grid">
        <label className="uploadTrackForm__field">
          <span className="uploadTrackForm__label">Название</span>
          <input
            className="uploadTrackForm__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Как назвать"
            required
          />
        </label>
        <label className="uploadTrackForm__field uploadTrackForm__field--readonly">
          <span className="uploadTrackForm__label">Исполнитель</span>
          <input
            className="uploadTrackForm__input uploadTrackForm__input--readonly"
            value={artistDisplay}
            readOnly
            tabIndex={-1}
            aria-readonly="true"
          />
          <span className="uploadTrackForm__fieldHint">из профиля · @{user.username}</span>
        </label>
      </div>

      <div
        className={`uploadTrackForm__drop ${file ? "uploadTrackForm__drop--filled" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) applyAudioFile(f);
        }}
      >
        <input
          id={fileInputId}
          type="file"
          accept="audio/*"
          className="uploadTrackForm__fileInput"
          onChange={(e) => applyAudioFile(e.target.files?.[0] || null)}
        />
        <label htmlFor={fileInputId} className="uploadTrackForm__dropInner">
          <span className="uploadTrackForm__dropIcon" aria-hidden>
            ↑
          </span>
          <span className="uploadTrackForm__dropTitle">{file ? file.name : "Выберите аудиофайл"}</span>
          <span className="uploadTrackForm__dropHint">mp3 / wav · нажмите или перетащите</span>
        </label>
      </div>

      <div className="uploadTrackForm__or">
        <span>или</span>
      </div>

      <label className="uploadTrackForm__field">
        <span className="uploadTrackForm__label">Ссылка Яндекс.Диск</span>
        <input
          className="uploadTrackForm__input"
          value={yandexUrl}
          onChange={(e) => setYandexUrl(e.target.value)}
          placeholder="https://disk.yandex.ru/..."
        />
      </label>

      {msg && <p className="uploadTrackForm__ok">{msg}</p>}
      {err && <p className="uploadTrackForm__err">{err}</p>}

      <button type="submit" className="uploadTrackForm__submit" disabled={submitting}>
        {submitting ? "Загрузка…" : submitLabel}
      </button>
    </form>
  );
}

export function UploadAudioFormModal({ endpoint, label, buttonLabel, onSuccess }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);
  const handleSuccess = (kind) => {
    close();
    onSuccess?.(kind);
  };

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <>
      <button type="button" className="btn tracksUploadBtn" onClick={() => setOpen(true)}>
        {buttonLabel || label}
      </button>
      {open &&
        createPortal(
          <div className="modalBackdrop uploadModalBackdrop" onClick={close} role="presentation">
            <div
              className="uploadModal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="upload-modal-title"
            >
              <span className="uploadModal__glow" aria-hidden />
              <button type="button" className="uploadModal__close" onClick={close} aria-label="Закрыть">
                ×
              </button>
              <UploadAudioForm endpoint={endpoint} label={label} onSuccess={handleSuccess} variant="track" />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
