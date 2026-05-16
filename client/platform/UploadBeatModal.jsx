import React, { useEffect, useId, useState } from "react";
import { AUDIO_FILE_ACCEPT } from "./mediaAccept.js";
import { GuestGateCard } from "./GuestGateCard.jsx";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthContext.jsx";
import { api } from "./api.js";
import { notifyDiscoverChanged } from "./platformEvents.js";

const BEAT_KEYS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
];

const TONALITIES = ["Мажор", "Минор"];

function titleFromFileName(fileName) {
  if (!fileName) return "";
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base.replace(/[_]+/g, " ").replace(/-+/g, " - ").trim() || fileName;
}

export function UploadBeatForm({ onSuccess, onNeedAuth }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [artistDisplay, setArtistDisplay] = useState("");
  const [bpm, setBpm] = useState("");
  const [musicalKey, setMusicalKey] = useState("Am");
  const [tonality, setTonality] = useState("Минор");
  const [tags, setTags] = useState("");
  const [yandexUrl, setYandexUrl] = useState("");
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!user) return;
    setArtistDisplay(user.displayName || user.username || "");
  }, [user]);

  if (!user) {
    return (
      <GuestGateCard
        icon="upload"
        compact
        title="Загрузка — для своих"
        subtitle="Войдите, чтобы публиковать биты."
        onAction={onNeedAuth}
      />
    );
  }

  const applyAudioFile = (f) => {
    if (!f) {
      setFile(null);
      return;
    }
    setFile(f);
    setTitle(titleFromFileName(f.name));
  };

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    setErr("");
    setSubmitting(true);
    const fd = new FormData();
    fd.append("title", title);
    fd.append("bpm", bpm);
    fd.append("beatKey", musicalKey);
    fd.append("tonality", tonality);
    if (tags.trim()) fd.append("tags", tags.trim());
    if (yandexUrl.trim()) fd.append("audioUrl", yandexUrl.trim());
    if (file) fd.append("audio", file);
    try {
      await api("/api/beats", { method: "POST", body: fd });
      setMsg("Бит опубликован");
      setTitle("");
      setBpm("");
      setMusicalKey("Am");
      setTonality("Минор");
      setTags("");
      setYandexUrl("");
      setFile(null);
      setArtistDisplay(user.displayName || user.username || "");
      notifyDiscoverChanged();
      onSuccess?.();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="uploadTrackForm uploadBeatForm" onSubmit={submit}>
      <header className="uploadTrackForm__head">
        <span className="uploadTrackForm__badge uploadBeatForm__badge" aria-hidden>
          ♩
        </span>
        <div className="uploadTrackForm__headText">
          <h3 id="upload-beat-modal-title" className="uploadTrackForm__title">
            Загрузить бит
          </h3>
          <p className="uploadTrackForm__sub">mp3, wav · укажите BPM, key и лад</p>
        </div>
      </header>

      <div className="uploadTrackForm__grid uploadBeatForm__grid">
        <label className="uploadTrackForm__field">
          <span className="uploadTrackForm__label">Название</span>
          <input
            className="uploadTrackForm__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название бита"
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
        <label className="uploadTrackForm__field">
          <span className="uploadTrackForm__label">BPM</span>
          <input
            className="uploadTrackForm__input"
            type="number"
            min={40}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            placeholder="140"
            required
          />
        </label>
        <label className="uploadTrackForm__field">
          <span className="uploadTrackForm__label">Key</span>
          <select
            className="uploadTrackForm__input uploadTrackForm__select"
            value={musicalKey}
            onChange={(e) => setMusicalKey(e.target.value)}
            required
          >
            {BEAT_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="uploadTrackForm__field">
          <span className="uploadTrackForm__label">Тональность (лад)</span>
          <select
            className="uploadTrackForm__input uploadTrackForm__select"
            value={tonality}
            onChange={(e) => setTonality(e.target.value)}
            required
          >
            {TONALITIES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="uploadTrackForm__field uploadBeatForm__field--wide">
          <span className="uploadTrackForm__label">Теги (необязательно)</span>
          <input
            className="uploadTrackForm__input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="trap, dark, drill"
          />
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
        <label htmlFor={fileInputId} className="uploadTrackForm__dropLabel">
          <input
            id={fileInputId}
            type="file"
            accept={AUDIO_FILE_ACCEPT}
            className="uploadTrackForm__fileInput"
            onChange={(e) => applyAudioFile(e.target.files?.[0] || null)}
          />
          <span className="uploadTrackForm__dropInner">
            <span className="uploadTrackForm__dropIcon" aria-hidden>
              ↑
            </span>
            <span className="uploadTrackForm__dropTitle">{file ? file.name : "Выберите аудиофайл"}</span>
            <span className="uploadTrackForm__dropHint">mp3 / wav / m4a · нажмите для выбора</span>
          </span>
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

      <button type="submit" className="uploadTrackForm__submit uploadBeatForm__submit" disabled={submitting}>
        {submitting ? "Загрузка…" : "Опубликовать бит"}
      </button>
    </form>
  );
}

export function UploadBeatFormModal({ buttonLabel, onSuccess, onNeedAuth }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);
  const handleSuccess = () => {
    close();
    onSuccess?.();
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
      <button type="button" className="btn tracksUploadBtn tracksUploadBtn--beat" onClick={() => setOpen(true)}>
        {buttonLabel || "＋ Загрузить бит"}
      </button>
      {open &&
        createPortal(
          <div className="modalBackdrop uploadModalBackdrop" onClick={close} role="presentation">
            <div
              className="uploadModal uploadModal--beat"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="upload-beat-modal-title"
            >
              <span className="uploadModal__glow uploadModal__glow--beat" aria-hidden />
              <button type="button" className="uploadModal__close" onClick={close} aria-label="Закрыть">
                ×
              </button>
              <UploadBeatForm onSuccess={handleSuccess} onNeedAuth={onNeedAuth} />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
