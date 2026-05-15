import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TrackAudioPlayer({ src, releaseId, beatId, openverId, countPlay = false }) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const playSentRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const syncDuration = useCallback(() => {
    const el = audioRef.current;
    if (el && Number.isFinite(el.duration)) setDuration(el.duration);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => {
      if (!seeking) setCurrent(el.currentTime);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", syncDuration);
    el.addEventListener("durationchange", syncDuration);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", syncDuration);
      el.removeEventListener("durationchange", syncDuration);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src, seeking, syncDuration]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    playSentRef.current = false;
  }, [src, releaseId, beatId, openverId]);

  const registerPlay = useCallback(() => {
    const mediaId = beatId || releaseId || openverId;
    if (!countPlay || !mediaId || playSentRef.current) return;
    playSentRef.current = true;
    const path = beatId
      ? `/api/beats/${beatId}/play`
      : openverId
        ? `/api/openvers/${openverId}/play`
        : `/api/releases/${releaseId}/play`;
    api(path, { method: "POST", body: "{}" }).catch(() => {});
  }, [countPlay, releaseId, beatId, openverId]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => registerPlay())
        .catch(() => {});
    } else el.pause();
  };

  const seekFromClientX = (clientX) => {
    const bar = barRef.current;
    const el = audioRef.current;
    if (!bar || !el || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * duration;
    el.currentTime = t;
    setCurrent(t);
  };

  const onBarPointerDown = (e) => {
    setSeeking(true);
    seekFromClientX(e.clientX);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onBarPointerMove = (e) => {
    if (!seeking) return;
    seekFromClientX(e.clientX);
  };

  const onBarPointerUp = () => setSeeking(false);

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="trackPlayer" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata" className="trackPlayer__audio" />

      <button
        type="button"
        className={`trackPlayer__play ${playing ? "trackPlayer__play--active" : ""}`}
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        {playing ? (
          <span className="trackPlayer__pauseIcon" aria-hidden />
        ) : (
          <span className="trackPlayer__playIcon" aria-hidden />
        )}
      </button>

      <div className="trackPlayer__main">
        <div
          ref={barRef}
          className="trackPlayer__bar"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={current}
          tabIndex={0}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerCancel={onBarPointerUp}
          onKeyDown={(e) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (e.key === "ArrowRight") {
              el.currentTime = Math.min(duration, el.currentTime + 5);
            } else if (e.key === "ArrowLeft") {
              el.currentTime = Math.max(0, el.currentTime - 5);
            }
          }}
        >
          <div className="trackPlayer__barTrack">
            <div className="trackPlayer__barFill" style={{ width: `${progress}%` }} />
            <span className="trackPlayer__barThumb" style={{ left: `${progress}%` }} />
          </div>
        </div>
        <div className="trackPlayer__times">
          <span>{formatTime(current)}</span>
          <span className="trackPlayer__timesSep">/</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
