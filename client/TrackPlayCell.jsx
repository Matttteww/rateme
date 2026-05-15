import React, { useCallback, useEffect, useRef, useState } from "react";

function youtubeEmbedUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const m = u.pathname.match(/^\/embed\/([^/?]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

function isDirectAudioUrl(url) {
  if (!url || typeof url !== "string") return false;
  const path = url.trim().split("?")[0].toLowerCase();
  return /\.(mp3|ogg|opus|wav|m4a|aac|flac)(\b|$)/i.test(path);
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Панель оценок: трек сначала качается целиком в память (blob), затем воспроизведение —
 * так перемотка не сбрасывается в начало (как на «обрезанном» стриме без буфера).
 */
function PanelAudioPlayer({ src }) {
  const audioRef = useRef(null);
  const blobUrlRef = useRef(null);
  const [playableSrc, setPlayableSrc] = useState(null);
  /** loading — ждём blob; blob — готов полный файл; fallback — не удалось скачать (внешняя ссылка / сеть), играем по URL */
  const [loadMode, setLoadMode] = useState("loading");
  const [loadPct, setLoadPct] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubT, setScrubT] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    const revoke = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    revoke();
    setPlayableSrc(null);
    setLoadMode("loading");
    setLoadPct(0);
    setPlaying(false);
    setT(0);
    setDur(0);

    (async () => {
      try {
        const res = await fetch(src, { signal: ac.signal, credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
        const lenHdr = res.headers.get("content-length");
        const total = lenHdr ? parseInt(lenHdr, 10) : 0;
        const body = res.body;

        let blob;
        if (!body) {
          blob = await res.blob();
        } else {
          const reader = body.getReader();
          const chunks = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total > 0 && !ac.signal.aborted) {
              setLoadPct(Math.min(100, Math.round((received / total) * 100)));
            }
          }
          blob = new Blob(chunks, { type: mime });
        }

        if (ac.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setLoadPct(100);
        setPlayableSrc(url);
        setLoadMode("blob");
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setPlayableSrc(src);
        setLoadMode("fallback");
      }
    })();

    return () => {
      ac.abort();
      revoke();
    };
  }, [src]);

  useEffect(() => {
    if (!scrubbing) return;
    const end = () => setScrubbing(false);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
    };
  }, [scrubbing]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !playableSrc) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      if (!scrubbing) setT(a.currentTime);
    };
    const setDurationFromEl = () => {
      const d = a.duration;
      if (Number.isFinite(d) && d > 0 && !Number.isNaN(d)) setDur(d);
    };
    const onEnded = () => {
      setPlaying(false);
      setT(0);
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", setDurationFromEl);
    a.addEventListener("durationchange", setDurationFromEl);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", setDurationFromEl);
      a.removeEventListener("durationchange", setDurationFromEl);
      a.removeEventListener("ended", onEnded);
    };
  }, [playableSrc, scrubbing]);

  useEffect(() => {
    const a = audioRef.current;
    if (a && Number.isFinite(vol)) a.volume = vol;
  }, [playableSrc, vol]);

  const duration = Number.isFinite(dur) && dur > 0 ? dur : 0;
  const seekMax = duration > 0 ? duration : 1;
  const seekValue = scrubbing ? scrubT : duration > 0 ? Math.min(t, duration) : 0;
  const ready = loadMode === "blob" || loadMode === "fallback";
  const locked = loadMode === "loading";

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || locked) return;
    if (a.paused) {
      pauseOtherAudios(a);
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }, [locked]);

  return (
    <div className="panelAudioPlayer">
      <audio ref={audioRef} className="panelAudioEl" src={playableSrc || undefined} preload={ready ? "auto" : "none"} />
      {locked ? (
        <div className="panelAudioLoad">
          <div className="panelAudioLoadRow">
            <span className="panelAudioLoadLabel">Загрузка трека…</span>
            <span className="mono panelAudioLoadPct">{loadPct}%</span>
          </div>
          <div className="panelAudioLoadTrack" aria-hidden>
            <div className="panelAudioLoadFill" style={{ width: `${loadPct}%` }} />
          </div>
          <p className="muted panelAudioLoadHint">После загрузки перемотка будет работать по всей длине.</p>
        </div>
      ) : null}
      {loadMode === "fallback" ? (
        <p className="muted panelAudioLoadHint">Файл не удалось сохранить целиком — идёт поток. Перемотка может работать нестабильно.</p>
      ) : null}
      <div className="panelAudioTop">
        <button
          type="button"
          className="trackPlayBtn panelPlayBtn"
          onClick={toggle}
          disabled={locked}
          aria-label={playing ? "Пауза" : "Играть"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="mono panelTime">
          {formatTime(scrubbing ? scrubT : t)} / {duration > 0 ? formatTime(duration) : ready ? "…" : "—"}
        </span>
      </div>
      <label className="panelSeekLab">
        <span className="srOnly">Перемотка</span>
        <input
          type="range"
          className="panelSeek"
          style={{
            "--seekPct": duration > 0 ? `${Math.min(100, Math.max(0, (seekValue / duration) * 100))}%` : "0%",
          }}
          min={0}
          max={seekMax}
          step={duration > 0 ? 0.01 : 0.001}
          value={seekValue}
          disabled={!playableSrc}
          onMouseDown={() => {
            if (locked) return;
            setScrubbing(true);
            setScrubT(audioRef.current?.currentTime ?? 0);
          }}
          onTouchStart={() => {
            if (locked) return;
            setScrubbing(true);
            setScrubT(audioRef.current?.currentTime ?? 0);
          }}
          onInput={(e) => {
            const v = Number(e.target.value);
            setScrubT(v);
            const a = audioRef.current;
            if (a) a.currentTime = v;
          }}
        />
      </label>
      <div className="panelVolRow">
        <span className="panelVolIcon" aria-hidden>
          🔊
        </span>
        <input
          type="range"
          className="panelVol"
          min={0}
          max={1}
          step={0.02}
          value={vol}
          disabled={locked}
          aria-label="Громкость"
          onChange={(e) => {
            const v = Number(e.target.value);
            setVol(v);
            const a = audioRef.current;
            if (a) a.volume = v;
          }}
        />
      </div>
    </div>
  );
}

function pauseOtherAudios(current) {
  if (typeof document === "undefined") return;
  document.querySelectorAll("audio.trackAudioHidden, audio.panelAudioEl").forEach((a) => {
    if (a !== current && !a.paused) a.pause();
  });
}

/** В таблице: только кнопка play/pause + скрытый <audio> */
function CompactAudioPlay({ src }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setPlaying(!el.paused);
    el.addEventListener("play", sync);
    el.addEventListener("pause", sync);
    el.addEventListener("ended", sync);
    return () => {
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", sync);
      el.removeEventListener("ended", sync);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      pauseOtherAudios(el);
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  return (
    <div className="trackPlayCompact">
      <audio ref={ref} className="trackAudioHidden" src={src} preload="metadata" />
      <button type="button" className="trackPlayBtn" onClick={toggle} aria-label={playing ? "Пауза" : "Играть"}>
        {playing ? "❚❚" : "▶"}
      </button>
    </div>
  );
}

/**
 * @param {{ track: object; variant?: "table" | "panel" }} props
 * variant "table" — только кнопка play; "panel" — полный плеер на всю ширину блока оценок
 */
export function TrackPlayCell({ track, variant = "table" }) {
  const link = track.telegramLink;
  const proxyAudio = track.telegramFileId ? `/api/tracks/${encodeURIComponent(track.id)}/audio` : null;
  const yt = link ? youtubeEmbedUrl(link) : null;
  const direct = link && isDirectAudioUrl(link) ? link : null;
  const isPanel = variant === "panel";

  if (proxyAudio) {
    if (isPanel) {
      return (
        <div className="trackPlayCell trackPlayCell--panel">
          <div className="trackAudioShell trackAudioShell--panel">
            <PanelAudioPlayer src={proxyAudio} />
          </div>
        </div>
      );
    }
    return (
      <div className="trackPlayCell">
        <CompactAudioPlay src={proxyAudio} />
      </div>
    );
  }
  if (yt) {
    if (isPanel) {
      return (
        <div className="trackPlayCell trackPlayCell--panel">
          <iframe
            className="ytEmbed ytEmbed--panel"
            title="YouTube"
            src={yt}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      );
    }
    return (
      <div className="trackPlayCell">
        <a className="trackPlayBtn trackPlayBtn--link" href={link} target="_blank" rel="noopener noreferrer" title="Открыть на YouTube">
          ▶
        </a>
      </div>
    );
  }
  if (direct) {
    if (isPanel) {
      return (
        <div className="trackPlayCell trackPlayCell--panel">
          <div className="trackAudioShell trackAudioShell--panel">
            <PanelAudioPlayer src={direct} />
          </div>
        </div>
      );
    }
    return (
      <div className="trackPlayCell">
        <CompactAudioPlay src={direct} />
      </div>
    );
  }
  if (link) {
    return (
      <div className="trackPlayCell trackPlayCell--link">
        <a className="mono linkOut" href={link} target="_blank" rel="noopener noreferrer">
          открыть
        </a>
      </div>
    );
  }
  const hasTgId =
    track.telegramTrackId != null &&
    Number.isFinite(Number(track.telegramTrackId)) &&
    Number(track.telegramTrackId) > 0;
  if (hasTgId) {
    return (
      <span
        className="muted trackPlayHint"
        title="Нужны telegramFileId от бота и TELEGRAM_BOT_TOKEN в .env на сервере. Перезапусти бота и Node; если трек уже был в каталоге — отправь трек в бота ещё раз или дождись обновления записи."
      >
        нет файла
      </span>
    );
  }
  return <span className="muted">—</span>;
}
