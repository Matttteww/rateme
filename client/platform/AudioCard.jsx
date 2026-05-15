import React, { useState } from "react";
import { TrackAudioPlayer } from "./TrackAudioPlayer.jsx";
import { downloadMediaItem } from "./audioDownload.js";

export function AudioCard({
  item,
  mediaType = "releases",
  onViewProfile,
  onMessageUser,
  currentUsername,
  releaseId,
  beatId,
  countPlay = false,
  showDownload = false,
  showLike = false,
  liked = false,
  likeCount = 0,
  playCount,
  likeBusy = false,
  onToggleLike,
  actionsLayout = "stack",
}) {
  const [dlBusy, setDlBusy] = useState(false);
  const [dlErr, setDlErr] = useState("");
  if (!item) return null;
  const src = item.audio?.kind === "file" ? item.audio.url : null;
  const isRelease = mediaType === "releases";
  const isBeat = mediaType === "beats";
  const isOpenver = mediaType === "openvers";
  const badgeLabel = isRelease
    ? item.isDemo
      ? "демо"
      : "трек"
    : isBeat
      ? "бит"
      : isOpenver
        ? "open"
        : null;
  const username = item.ownerUsername;
  const showMessage = Boolean(
    onMessageUser && username && (!currentUsername || username.toLowerCase() !== currentUsername.toLowerCase())
  );

  const openProfile = (e) => {
    if (!username || !onViewProfile) return;
    e.stopPropagation();
    onViewProfile(username);
  };

  const canDownload = showDownload && (item.audio?.kind === "file" || item.audio?.openExternal);
  const downloadLabel =
    item.audio?.openExternal ? "Открыть на Диске" : dlBusy ? "Скачивание…" : "Скачать";

  const onMessage = (e) => {
    e.stopPropagation();
    if (!username) return;
    onMessageUser?.(username);
  };

  const onDownload = async () => {
    setDlErr("");
    setDlBusy(true);
    try {
      await downloadMediaItem(item, mediaType);
    } catch (e) {
      setDlErr(e.message);
    } finally {
      setDlBusy(false);
    }
  };

  return (
    <article className="audioCard">
      <span className="audioCard__shine" aria-hidden />

      <header className="audioCard__head">
        {badgeLabel ? (
          <span
            className={`audioCard__cover audioCard__cover--${
              isBeat ? "beat" : isOpenver ? "openver" : item.isDemo ? "demo" : "track"
            }`}
            aria-label={isBeat ? "Бит" : isOpenver ? "Опен" : item.isDemo ? "Демо" : "Трек"}
          >
            {badgeLabel}
          </span>
        ) : (
          <span className="audioCard__cover" aria-hidden>
            {(item.title || "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="audioCard__meta">
          <h3 className="audioCard__title">{item.title}</h3>
          <p className="audioCard__artistRow">
            <span className="audioCard__artist">{item.artistDisplay}</span>
            {username &&
              (onViewProfile ? (
                <button type="button" className="audioCard__handle audioCard__handle--link" onClick={openProfile}>
                  @{username}
                </button>
              ) : (
                <span className="audioCard__handle">@{username}</span>
              ))}
          </p>
        </div>
      </header>

      <div className="audioCard__playerWrap">
        {src ? (
          <TrackAudioPlayer
            src={src}
            releaseId={isRelease ? releaseId || item.id : undefined}
            beatId={isBeat ? beatId || item.id : undefined}
            openverId={isOpenver ? item.id : undefined}
            countPlay={countPlay}
          />
        ) : item.audio?.openExternal ? (
          <a
            className="audioCard__external"
            href={item.audio.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть на Яндекс.Диске
          </a>
        ) : (
          <span className="audioCard__noAudio muted">Нет аудио</span>
        )}
        {(canDownload || showMessage || showLike) && (
          <div
            className={`audioCard__actions${actionsLayout === "row" ? " audioCard__actions--row" : ""}`}
          >
            {showLike && (
              <button
                type="button"
                className={`audioCard__likeBtn ${liked ? "audioCard__likeBtn--active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLike?.();
                }}
                disabled={likeBusy}
                aria-pressed={liked}
              >
                <span className="audioCard__likeIcon" aria-hidden>
                  {liked ? "♥" : "♡"}
                </span>
                <span>{likeCount}</span>
              </button>
            )}
            {showMessage && (
              <button type="button" className="audioCard__messageBtn" onClick={onMessage}>
                Написать в ЛС
              </button>
            )}
            {canDownload && (
              <button
                type="button"
                className="audioCard__downloadBtn"
                onClick={onDownload}
                disabled={dlBusy}
              >
                <span className="audioCard__downloadIcon" aria-hidden>
                  ↓
                </span>
                {downloadLabel}
              </button>
            )}
            {dlErr && <p className="audioCard__downloadErr">{dlErr}</p>}
          </div>
        )}
        {isOpenver && playCount != null && (
          <p className="audioCard__plays muted">
            {playCount}{" "}
            {playCount % 10 === 1 && playCount % 100 !== 11
              ? "прослушивание"
              : playCount % 10 >= 2 && playCount % 10 <= 4 && (playCount % 100 < 10 || playCount % 100 >= 20)
                ? "прослушивания"
                : "прослушиваний"}
          </p>
        )}
      </div>
    </article>
  );
}
