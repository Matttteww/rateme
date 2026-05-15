import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CRITERIA, CriteriaSliders, CriteriaTotals, emptyCriteria } from "./trackCriteria.jsx";
import { TrackPlayCell } from "./TrackPlayCell.jsx";

function canOpenRatingsPanel(t) {
  const tgId = Number(t.telegramTrackId);
  if (!Number.isFinite(tgId) || tgId <= 0) return false;
  return t.source === "telegram";
}

function hasPersonalRating(t) {
  return t.personalAverage != null && Number.isFinite(Number(t.personalAverage));
}

function canViewTrackSnapshot(t) {
  return hasPersonalRating(t) || (Array.isArray(t.chatRatingsLog) && t.chatRatingsLog.length > 0);
}

/** Вернуть состояние слайдеров из сохранённых критериев трека или пустой шаблон. */
function criteriaStateFromTrack(t) {
  const base = emptyCriteria();
  if (!t.criteria || typeof t.criteria !== "object") return base;
  for (const { key } of CRITERIA) {
    const v = t.criteria[key];
    if (v != null && Number.isFinite(Number(v))) base[key] = String(Number(v));
  }
  return base;
}

const TOP_N = 5;

/** Ключ исполнителя (как в топе): без учёта регистра, пустое имя — один служебный ключ. */
function artistNormKey(artist) {
  const raw = String(artist ?? "").trim();
  return raw.toLowerCase() || "\u0000empty";
}

/** Компактная строка шести критериев для таблицы. */
function critSixCell(t) {
  if (!t.criteria || typeof t.criteria !== "object") return "—";
  return CRITERIA.map(({ key }) => {
    const v = t.criteria[key];
    return v != null && Number.isFinite(Number(v)) ? String(Number(v)) : "—";
  }).join(" · ");
}

/** Место в глобальном топе: золото / серебро / бронза / номер. */
function TrackRankMedal({ rank }) {
  if (rank == null || !Number.isFinite(Number(rank))) {
    return (
      <span className="trackRankMedal trackRankMedal--empty" title="Нет в топе оценённых">
        —
      </span>
    );
  }
  const n = Math.max(1, Math.floor(Number(rank)));
  const tier = n <= 3 ? n : "n";
  return (
    <span className={`trackRankMedal trackRankMedal--${tier}`} title={`${n} место`}>
      <span className="trackRankMedalNum">{n}</span>
    </span>
  );
}

/** Личный балл выше — выше в списке; без оценки — внизу. */
function sortTracksByPersonalDesc(list) {
  return [...list].sort((a, b) => {
    const pa = a.personalAverage == null || !Number.isFinite(Number(a.personalAverage)) ? -1 : Number(a.personalAverage);
    const pb = b.personalAverage == null || !Number.isFinite(Number(b.personalAverage)) ? -1 : Number(b.personalAverage);
    if (pb !== pa) return pb - pa;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

/**
 * Рейтинг исполнителей: сумма личных баллов по всем трекам (чат не влияет),
 * при равной сумме — больше треков выше, затем среднее личное.
 */
function buildArtistLeaderboard(tracks) {
  const m = new Map();
  for (const t of tracks) {
    const raw = String(t.artist ?? "").trim();
    const key = artistNormKey(t.artist);
    let row = m.get(key);
    if (!row) {
      row = {
        key,
        displayName: raw || "—",
        trackCount: 0,
        sumPersonal: 0,
        ratedCount: 0,
        chatSum: 0,
        chatCount: 0,
      };
      m.set(key, row);
    }
    row.trackCount += 1;
    if (t.personalAverage != null && Number.isFinite(Number(t.personalAverage))) {
      row.sumPersonal += Number(t.personalAverage);
      row.ratedCount += 1;
    }
    if (t.chatAverage != null && Number.isFinite(Number(t.chatAverage))) {
      row.chatSum += Number(t.chatAverage);
      row.chatCount += 1;
    }
  }
  const list = [...m.values()].map((r) => ({
    ...r,
    avgPersonal:
      r.ratedCount > 0 ? Math.round((r.sumPersonal / r.ratedCount) * 100) / 100 : null,
    avgChat: r.chatCount > 0 ? Math.round((r.chatSum / r.chatCount) * 100) / 100 : null,
  }));
  list.sort((a, b) => {
    if (b.sumPersonal !== a.sumPersonal) return b.sumPersonal - a.sumPersonal;
    if (b.trackCount !== a.trackCount) return b.trackCount - a.trackCount;
    return (b.avgPersonal || 0) - (a.avgPersonal || 0);
  });
  return list;
}

function TrackViewModal({ track, onClose }) {
  if (!track) return null;
  const critValues = criteriaStateFromTrack(track);
  const log = Array.isArray(track.chatRatingsLog) ? track.chatRatingsLog : [];
  return (
    <div className="trackViewBackdrop" role="presentation" onClick={onClose}>
      <div
        className="trackViewModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-view-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="trackViewHead">
          <h3 id="track-view-title" className="trackViewTitle">
            {track.title}
          </h3>
          <button type="button" className="btn btnSm" onClick={onClose}>
            закрыть
          </button>
        </header>
        <p className="trackViewArtist mono">{track.artist}</p>
        {track.criteria && typeof track.criteria === "object" ? (
          <div className="ratingDeck ratingDeck--tight trackViewCrit">
            <CriteriaTotals values={critValues} />
            <p className="hint muted">Шесть критериев — как при сохранении (только просмотр).</p>
          </div>
        ) : (
          <p className="muted">Личные критерии в записи нет.</p>
        )}
        <p className="trackViewChatAvgLab">Средняя чата в каталоге</p>
        <p className="mono trackViewChatAvgVal">{track.chatAverage == null ? "—" : track.chatAverage}</p>
        <h4 className="h4 trackViewVotesCap">Кто из чата на что оценил</h4>
        <p className="hint trackViewVotesHint">
          Снимок голосов 0–10 сохраняется вместе с треком, когда опрос чата был активен и ты нажал «сохранить».
        </p>
        <ul className="ratingList catalogChatPollList trackViewVoteList">
          {log.map((r, i) => (
            <li key={`${r.at}-${r.user}-${i}`} className="ratingRow">
              <span className="rUser">{r.user}</span>
              <span className="rScore">{r.score}</span>
              <span className="rTime">{new Date(r.at).toLocaleString()}</span>
            </li>
          ))}
          {log.length === 0 && (
            <li className="muted">
              Список пуст: либо опрос не шёл при сохранении, либо никто не написал 0–10. Запусти «оценки», дождись голосов и
              снова «сохранить».
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function TrackRowActions({ t, openFill, delTrack, onViewTrack }) {
  return (
    <div className="trackBtnRow">
      {canOpenRatingsPanel(t) && (
        <button type="button" className="btn btnSm" onClick={() => openFill(t)} title="Личная оценка и опрос чата">
          оценки
        </button>
      )}
      {hasPersonalRating(t) && (
        <button
          type="button"
          className="btn btnSm"
          onClick={() => openFill(t, { editOnly: true })}
          title="Поменять критерии и среднюю чата без нового опроса"
        >
          редактировать
        </button>
      )}
      {canViewTrackSnapshot(t) && (
        <button type="button" className="btn btnSm" onClick={() => onViewTrack(t)} title="Критерии и голоса чата">
          просмотр
        </button>
      )}
      <button type="button" className="btn btnSm" onClick={() => delTrack(t.id)}>
        удалить
      </button>
    </div>
  );
}

function CatalogChatRatings({ ratings, liveAverage }) {
  const avgText =
    liveAverage != null && !Number.isNaN(Number(liveAverage)) ? Number(liveAverage).toFixed(2) : "—";
  return (
    <div className="catalogChatPoll">
      <h2 className="catalogChatPollTitle">Оценки 0–10</h2>
      <div className="catalogChatLiveBlock" aria-live="polite">
        <span className="catalogChatLiveAvgLab">Средняя чата</span>
        <span className="catalogChatLiveAvg mono">{avgText}</span>
      </div>
      <p className="hint catalogChatPollHint">
        Пиши в чат только число 0–10. Один голос с человека за трек. Опрос заканчивается, когда нажмёшь «сохранить».
      </p>
      <ul className="ratingList catalogChatPollList">
        {(ratings || []).map((r, i) => (
          <li key={`${r.at}-${r.user}-${i}`} className="ratingRow">
            <span className="rUser">{r.user}</span>
            <span className="rScore">{r.score}</span>
            <span className="rTime">{new Date(r.at).toLocaleTimeString()}</span>
          </li>
        ))}
        {(!ratings || ratings.length === 0) && <li className="muted">Пока никто не оценил этот трек</li>}
      </ul>
    </div>
  );
}

function TrackTableBody({ tracks: list, openFill, delTrack, onArtistClick, showRank, rankByTrackId, onViewTrack }) {
  return (
    <>
      {list.map((t) => (
        <tr key={t.id}>
          {showRank && (
            <td className="trackRankCell">
              <TrackRankMedal rank={rankByTrackId?.get(t.id)} />
            </td>
          )}
          <td>
            {t.title}
            {t.source === "telegram" && <span className="tgBadge">TG</span>}
          </td>
          <td className="mono">
            {onArtistClick ? (
              <button type="button" className="artistLinkBtn" onClick={() => onArtistClick(artistNormKey(t.artist))}>
                {t.artist}
              </button>
            ) : (
              t.artist
            )}
          </td>
          <td className="mono accent">{t.personalAverage == null ? "—" : t.personalAverage}</td>
          <td className="mono">{t.chatAverage == null ? "—" : t.chatAverage}</td>
          <td className="trackPlayTd">
            <TrackPlayCell track={t} />
          </td>
          <td className="trackActionsCell">
            <TrackRowActions t={t} openFill={openFill} delTrack={delTrack} onViewTrack={onViewTrack} />
          </td>
        </tr>
      ))}
    </>
  );
}

const CATALOG_LIST_TABS = [
  { id: "all", label: "Все треки" },
  { id: "topTracks", label: "Топ треков" },
  { id: "artists", label: "Топ исполнителей" },
];

export function TrackArchive({ state }) {
  const liveAverage = state?.average;
  const pollRatings = state?.ratings;
  const pollTrackId = state?.pollTrackId;
  const [tracks, setTracks] = useState([]);

  const [fillForId, setFillForId] = useState(null);
  const [fillCrit, setFillCrit] = useState(() => emptyCriteria());
  const [fillChat, setFillChat] = useState("");
  const [fillErr, setFillErr] = useState("");
  const [syncHint, setSyncHint] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogListTab, setCatalogListTab] = useState("all");
  const [profileArtistKey, setProfileArtistKey] = useState(null);
  const [pollUiTrackId, setPollUiTrackId] = useState(null);
  const [pollStartBusy, setPollStartBusy] = useState(false);
  const [viewTrack, setViewTrack] = useState(null);
  const pollStartLockRef = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/tracks");
    if (!r.ok) return;
    const j = await r.json().catch(() => ({}));
    setTracks(Array.isArray(j.tracks) ? j.tracks : []);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      load().catch(() => {});
    }, 6000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    fetch("/api/tracks/sync-status")
      .then((r) => r.json())
      .then((j) => {
        const parts = [];
        if (j && j.syncSecretConfigured === false) {
          parts.push(
            "Синхронизация с ботом выключена: в .env нет BOTTWICH_SYNC_SECRET (совпадающего с BottwichSyncSecret в боте). Треки из TG не попадут в каталог."
          );
        }
        if (j && j.telegramAudio === false) {
          parts.push(
            "Прослушивание файлов из Telegram на сайте: добавь в .env TELEGRAM_BOT_TOKEN (тот же токен, что у бота в BotFather), перезапусти сервер."
          );
        }
        setSyncHint(parts.join(" "));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!viewTrack) return;
    const onKey = (e) => {
      if (e.key === "Escape") setViewTrack(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewTrack]);

  function setFillCritOne(key, val) {
    setFillCrit((c) => ({ ...c, [key]: val }));
  }

  async function stopPollRemote() {
    await fetch("/api/poll/stop", { method: "POST" }).catch(() => {});
  }

  /** Опрос в чате только пока открыт каталог; при уходе на «Стрим»/«Новый трек» или закрытии вкладки — снимаем poll на сервере. */
  useEffect(() => {
    const onBeforeUnload = () => {
      void fetch("/api/poll/stop", { method: "POST", keepalive: true }).catch(() => {});
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void fetch("/api/poll/stop", { method: "POST" }).catch(() => {});
    };
  }, []);

  function openFill(t, opts = {}) {
    const editOnly = Boolean(opts && opts.editOnly);
    setProfileArtistKey(null);
    setFillErr("");
    if (editOnly) {
      void stopPollRemote();
      setPollUiTrackId(null);
      setFillForId(t.id);
      setFillCrit(criteriaStateFromTrack(t));
      setFillChat(t.chatAverage != null ? String(t.chatAverage) : "");
      return;
    }
    setPollUiTrackId(null);
    setFillForId(t.id);
    setFillCrit(criteriaStateFromTrack(t));
    setFillChat(t.chatAverage != null ? String(t.chatAverage) : "");
    const pid = String(pollTrackId || "").trim();
    const tid = String(t.id || "").trim();
    if (pid && pid === tid) {
      setPollUiTrackId(t.id);
      return;
    }
    if (pid && pid !== tid) {
      return;
    }
    void startChatPollForTrack(t.id);
  }

  async function startChatPollForTrack(tid) {
    if (!tid || pollStartLockRef.current) return;
    pollStartLockRef.current = true;
    setFillErr("");
    setPollStartBusy(true);
    try {
      await stopPollRemote();
      const r = await fetch(`/api/tracks/${encodeURIComponent(tid)}/poll/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const rawText = await r.text();
      let j = {};
      try {
        j = rawText ? JSON.parse(rawText) : {};
      } catch {
        j = { error: rawText ? rawText.slice(0, 200) : "" };
      }
      if (!r.ok) {
        const raw = (rawText || "").toLowerCase();
        const noRoute =
          raw.includes("cannot post") ||
          (r.status === 404 && !j.error && raw.includes("<!doctype"));
        const hint404 =
          noRoute || (r.status === 404 && !j.error)
            ? "Сервер без маршрута опроса: останови все процессы Node и снова запусти из папки bottwich «npm run dev» или «npm run start» (нужен актуальный server/index.js, порт 3847)."
            : "";
        throw new Error(j.error || hint404 || `Ошибка ${r.status}`);
      }
      setPollUiTrackId(String(tid).trim());
    } catch (err) {
      setFillErr(err.message || String(err));
    } finally {
      pollStartLockRef.current = false;
      setPollStartBusy(false);
    }
  }

  function cancelFill() {
    void stopPollRemote();
    setPollUiTrackId(null);
    setFillForId(null);
    setFillErr("");
    setPollStartBusy(false);
  }

  async function saveFill(e) {
    e.preventDefault();
    setFillErr("");
    try {
      let chatVal = String(fillChat).trim();
      if (
        chatVal === "" &&
        fillForId &&
        String(pollTrackId || "").trim() === String(fillForId || "").trim() &&
        liveAverage != null &&
        !Number.isNaN(Number(liveAverage))
      ) {
        chatVal = Number(liveAverage).toFixed(2);
      }
      const sameTrackPoll = String(pollTrackId || "").trim() === String(fillForId || "").trim();
      const fillTForSave = fillForId ? tracks.find((x) => x.id === fillForId) : null;
      const fillTidForSave = fillTForSave ? String(fillTForSave.id || "").trim() : "";
      const activePs = String(pollTrackId || "").trim();
      const pollUiPs = String(pollUiTrackId || "").trim();
      const pollUiActiveForSave = Boolean(
        fillTForSave &&
          canOpenRatingsPanel(fillTForSave) &&
          (activePs === fillTidForSave || pollUiPs === fillTidForSave)
      );
      const ratingsSnapshot =
        pollUiActiveForSave &&
        sameTrackPoll &&
        Array.isArray(pollRatings) &&
        pollRatings.length > 0
          ? pollRatings.map((r) => ({
              user: String(r.user || "").trim().slice(0, 120),
              score: Math.round(Number(r.score)),
              at: Number.isFinite(Number(r.at)) ? Math.floor(Number(r.at)) : Date.now(),
            }))
          : null;
      const body = {
        criteria: Object.fromEntries(CRITERIA.map(({ key }) => [key, fillCrit[key]])),
        chatAverage: chatVal === "" ? null : chatVal,
      };
      if (ratingsSnapshot && ratingsSnapshot.length) body.chatRatingsLog = ratingsSnapshot;
      const r = await fetch(`/api/tracks/${encodeURIComponent(fillForId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await r.text();
      let j = {};
      try {
        j = raw ? JSON.parse(raw) : {};
      } catch {
        j = { error: raw ? raw.slice(0, 200) : "" };
      }
      if (!r.ok) throw new Error(j.error || `Ошибка ${r.status}`);
      await stopPollRemote();
      setPollUiTrackId(null);
      setFillForId(null);
      await load();
    } catch (err) {
      setFillErr(err.message || String(err));
    }
  }

  async function delTrack(id) {
    if (!confirm("Удалить запись?")) return;
    const r = await fetch(`/api/tracks/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      let msg = `Ошибка ${r.status}`;
      try {
        const j = await r.json();
        if (j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      window.alert(msg);
      return;
    }
    if (fillForId === id) {
      await stopPollRemote();
      setPollUiTrackId(null);
      setFillForId(null);
    }
    await load();
  }

  const fillTrack = fillForId ? tracks.find((x) => x.id === fillForId) : null;
  const fillTrackIdStr = fillTrack ? String(fillTrack.id || "").trim() : "";
  const activePollStr = String(pollTrackId || "").trim();
  const pollUiStr = String(pollUiTrackId || "").trim();
  const catalogPollConflict = Boolean(
    fillTrack && canOpenRatingsPanel(fillTrack) && activePollStr && activePollStr !== fillTrackIdStr
  );
  const catalogPollActiveHere = Boolean(
    fillTrack &&
      canOpenRatingsPanel(fillTrack) &&
      (activePollStr === fillTrackIdStr || pollUiStr === fillTrackIdStr)
  );

  const sortedTracks = useMemo(() => sortTracksByPersonalDesc(tracks), [tracks]);

  /** Ранги и список оценённых за один проход по отсортированному каталогу. */
  const { globalTrackRankMap, topTracksRated } = useMemo(() => {
    const m = new Map();
    const rated = [];
    let r = 0;
    for (const t of sortedTracks) {
      if (t.personalAverage != null && Number.isFinite(Number(t.personalAverage))) {
        r += 1;
        m.set(t.id, r);
        rated.push(t);
      }
    }
    return { globalTrackRankMap: m, topTracksRated: rated };
  }, [sortedTracks]);

  const artistRows = useMemo(() => buildArtistLeaderboard(tracks), [tracks]);

  const profileArtistRow = useMemo(
    () => (profileArtistKey == null ? null : artistRows.find((row) => row.key === profileArtistKey) ?? null),
    [artistRows, profileArtistKey]
  );

  const profileArtistRank = useMemo(() => {
    if (profileArtistKey == null) return null;
    const i = artistRows.findIndex((row) => row.key === profileArtistKey);
    return i >= 0 ? i + 1 : null;
  }, [artistRows, profileArtistKey]);

  const profileArtistTracks = useMemo(() => {
    if (profileArtistKey == null) return [];
    return sortedTracks.filter((t) => artistNormKey(t.artist) === profileArtistKey);
  }, [sortedTracks, profileArtistKey]);

  const searchTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedTracks;
    return sortedTracks.filter((t) => {
      const title = String(t.title || "").toLowerCase();
      const art = String(t.artist || "").toLowerCase();
      return title.includes(q) || art.includes(q);
    });
  }, [sortedTracks, searchQuery]);

  useEffect(() => {
    if (!fillForId) return;
    if (String(pollTrackId || "").trim() === String(fillForId || "").trim()) {
      setPollUiTrackId(fillForId);
    }
  }, [fillForId, pollTrackId]);

  /** Пока открыт опрос по этому треку — подставляем среднюю чата в поле сохранения. */
  useEffect(() => {
    if (!fillForId) return;
    const fid = String(fillForId).trim();
    const active = String(pollTrackId || "").trim();
    const ui = String(pollUiTrackId || "").trim();
    if (active !== fid && ui !== fid) return;
    if (liveAverage != null && !Number.isNaN(Number(liveAverage))) {
      setFillChat(Number(liveAverage).toFixed(2));
    } else {
      setFillChat("");
    }
  }, [fillForId, pollTrackId, pollUiTrackId, liveAverage]);

  return (
    <section className="catalog">
      <div className="card catalogCard">
        <h2 className="catalogTitle">Каталог треков</h2>
        <p className="hint catalogHint">
          Список сохранённых, поиск, топ треков и исполнителей. По нику исполнителя можно открыть карточку: все треки, оценки и
          места в топах.           У трека из Telegram «оценки» запускают опрос в чате (0–10); «сохранить» пишет среднюю чата в трек и
          завершает опрос; вместе с сохранением пишется список голосов зрителей для «просмотр». «Редактировать» — поменять
          оценки без нового опроса. Переход на «Стрим» или «Новый трек» (уход из каталога) сразу выключает приём голосов из чата на
          сервере. Добавить трек вручную — вкладка «Новый трек».
        </p>

        <nav className="catalogTabs" aria-label="Вид каталога">
          {CATALOG_LIST_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`catalogTab ${catalogListTab === t.id ? "catalogTab--active" : ""}`}
              onClick={() => {
                setProfileArtistKey(null);
                setCatalogListTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {fillTrack && (
          <div className="fillPanel">
            <div className="fillHero">
              <div className="fillCover" aria-hidden>
                ♪
              </div>
              <div className="fillHeroText">
                <h3 className="fillHeroTitle">{fillTrack.title}</h3>
                <div className="fillHeroTags">
                  <span className="artistTag">{fillTrack.artist}</span>
                </div>
              </div>
            </div>
            {fillTrack.telegramLink && (
              <p className="hint fillHeroLink mono">{fillTrack.telegramLink}</p>
            )}
            {fillTrack.telegramCaption && <p className="hint tgCap">TG: {fillTrack.telegramCaption}</p>}
            <div className="fillPlayerWrap">
              <p className="hint fillPlayerCap">Прослушать</p>
              <TrackPlayCell track={fillTrack} variant="panel" />
            </div>
            {canOpenRatingsPanel(fillTrack) ? (
              catalogPollConflict ? (
                <div className="catalogChatPoll catalogChatPoll--setup">
                  <h2 className="catalogChatPollTitle">Оценки 0–10</h2>
                  <p className="formErr catalogChatPollWarn">
                    Сейчас уже идёт опрос по другому треку. Нажми «отмена» в той панели или дождись «сохранить», затем открой
                    «оценки» здесь снова.
                  </p>
                </div>
              ) : catalogPollActiveHere ? (
                <CatalogChatRatings ratings={pollRatings} liveAverage={liveAverage} />
              ) : pollStartBusy ? (
                <div className="catalogChatPoll catalogChatPoll--setup">
                  <h2 className="catalogChatPollTitle">Оценки 0–10</h2>
                  <p className="muted">Запуск опроса…</p>
                </div>
              ) : null
            ) : null}
            <form onSubmit={saveFill}>
              <div className="ratingDeck ratingDeck--tight">
                <CriteriaSliders values={fillCrit} onSet={setFillCritOne} idPrefix="fill" />
                <CriteriaTotals values={fillCrit} />
              </div>
              <div className="trackFormRow chatRow">
                {catalogPollActiveHere ? (
                  <p className="tfLab grow muted chatAutoHint">
                    Средняя чата обновляется сама в блоке «Оценки 0–10» и уйдёт в трек по «сохранить».
                  </p>
                ) : (
                  <label className="tfLab grow">
                    Средняя чата
                    <input
                      className="tfIn"
                      type="number"
                      min={0}
                      max={10}
                      step={0.01}
                      value={fillChat}
                      onChange={(e) => setFillChat(e.target.value)}
                    />
                  </label>
                )}
                <button type="submit" className="btn btnPrimary">
                  сохранить
                </button>
                <button type="button" className="btn" onClick={cancelFill}>
                  отмена
                </button>
              </div>
              {fillErr && <div className="formErr">{fillErr}</div>}
            </form>
          </div>
        )}

        <div className="trackTableWrap">
          {profileArtistKey ? (
            <div className="catalogArtistProfile">
              <div className="catalogArtistProfileBar">
                <button type="button" className="btn" onClick={() => setProfileArtistKey(null)}>
                  ← К каталогу
                </button>
              </div>
              {!profileArtistRow ? (
                <p className="muted">Исполнитель не найден в текущем каталоге.</p>
              ) : (
                <>
                  <h3 className="h3 catalogArtistProfileTitle">{profileArtistRow.displayName}</h3>
                  <div className="catalogArtistProfileStats mono">
                    <div className="catalogArtistStat">
                      <span className="catalogArtistStatLab">Топ исполнителей</span>
                      <span className="catalogArtistStatVal accent">
                        {profileArtistRank} / {artistRows.length}
                      </span>
                    </div>
                    <div className="catalogArtistStat">
                      <span className="catalogArtistStatLab">Треков</span>
                      <span className="catalogArtistStatVal">{profileArtistRow.trackCount}</span>
                    </div>
                    <div className="catalogArtistStat">
                      <span className="catalogArtistStatLab">С личной оценкой</span>
                      <span className="catalogArtistStatVal">{profileArtistRow.ratedCount}</span>
                    </div>
                    <div className="catalogArtistStat">
                      <span className="catalogArtistStatLab">Σ личн.</span>
                      <span className="catalogArtistStatVal accent">
                        {profileArtistRow.ratedCount ? profileArtistRow.sumPersonal.toFixed(2) : "—"}
                      </span>
                    </div>
                    <div className="catalogArtistStat">
                      <span className="catalogArtistStatLab">Средн. личн.</span>
                      <span className="catalogArtistStatVal">
                        {profileArtistRow.avgPersonal == null ? "—" : profileArtistRow.avgPersonal}
                      </span>
                    </div>
                    <div className="catalogArtistStat">
                      <span className="catalogArtistStatLab">Средн. чата</span>
                      <span className="catalogArtistStatVal muted">
                        {profileArtistRow.avgChat == null ? "—" : profileArtistRow.avgChat}
                      </span>
                    </div>
                  </div>
                  <p className="hint tableSortHint">
                    Критерии: вайбик · свод · текстуля · битос · реализашон · актуалка (0–10). Место в глобальном топе оценённых
                    — как на вкладке «Топ треков».
                  </p>
                  <h4 className="h4 tableCap">Все треки исполнителя</h4>
                  {profileArtistTracks.length === 0 ? (
                    <p className="muted">Нет треков.</p>
                  ) : (
                    <div className="trackTableScroll">
                      <table className="trackTable trackTableArtistProfile">
                        <thead>
                          <tr>
                            <th>Место</th>
                            <th>Трек</th>
                            <th>Твоё Ø</th>
                            <th>Чат Ø</th>
                            <th>Критерии</th>
                            <th>Прослушать</th>
                            <th>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profileArtistTracks.map((t) => (
                            <tr key={t.id}>
                              <td className="trackRankCell">
                                <TrackRankMedal rank={globalTrackRankMap.get(t.id)} />
                              </td>
                              <td>
                                {t.title}
                                {t.source === "telegram" && <span className="tgBadge">TG</span>}
                              </td>
                              <td className="mono accent">{t.personalAverage == null ? "—" : t.personalAverage}</td>
                              <td className="mono">{t.chatAverage == null ? "—" : t.chatAverage}</td>
                              <td className="mono critCell">{critSixCell(t)}</td>
                              <td className="trackPlayTd">
                                <TrackPlayCell track={t} />
                              </td>
                              <td className="trackActionsCell">
                                <TrackRowActions t={t} openFill={openFill} delTrack={delTrack} onViewTrack={(x) => setViewTrack(x)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
          {catalogListTab === "all" && (
            <>
              <h3 className="h3 tableCap">Сохранённые</h3>
              <div className="searchTrackRow">
                <label className="tfLab grow">
                  Поиск по названию или исполнителю
                  <input
                    className="tfIn"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="фильтр списка ниже"
                    autoComplete="off"
                  />
                </label>
              </div>
              <p className="hint tableSortHint">
                Сортировка: от большего личного балла к меньшему; без оценки — в конце.
                {searchQuery.trim() ? " Показаны только совпадения." : ""}
              </p>
              {syncHint && <p className="formErr">{syncHint}</p>}
              {tracks.length === 0 ? (
                <p className="muted">Пока пусто.</p>
              ) : (
                <>
                  {searchTracks.length === 0 ? (
                    <p className="muted">Ничего не найдено.</p>
                  ) : (
                    <table className="trackTable">
                      <thead>
                        <tr>
                          <th>Трек</th>
                          <th>Исполнитель</th>
                          <th>Твоё Ø</th>
                          <th>Чат Ø</th>
                          <th>Прослушать</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        <TrackTableBody
                          tracks={searchTracks}
                          openFill={openFill}
                          delTrack={delTrack}
                          onArtistClick={(k) => setProfileArtistKey(k)}
                          onViewTrack={(t) => setViewTrack(t)}
                        />
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </>
          )}

          {catalogListTab === "topTracks" && (
            <>
              <h3 className="h3 tableCap">Топ треков</h3>
              <p className="hint tableSortHint">
                Только треки с личной оценкой: выше балл — выше в списке. 1–3 место — медали, дальше номер. Ник исполнителя
                открывает карточку.
              </p>
              {syncHint && <p className="formErr">{syncHint}</p>}
              {topTracksRated.length === 0 ? (
                <p className="muted">Пока нет треков с личной оценкой.</p>
              ) : (
                <div className="trackTableScroll">
                  <table className="trackTable">
                    <thead>
                        <tr>
                          <th>Место</th>
                          <th>Трек</th>
                          <th>Исполнитель</th>
                          <th>Твоё Ø</th>
                          <th>Чат Ø</th>
                          <th>Прослушать</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                    <tbody>
                      <TrackTableBody
                        tracks={topTracksRated}
                        openFill={openFill}
                        delTrack={delTrack}
                        onArtistClick={(k) => setProfileArtistKey(k)}
                        showRank
                        rankByTrackId={globalTrackRankMap}
                        onViewTrack={(t) => setViewTrack(t)}
                      />
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {catalogListTab === "artists" && (
            <>
              <h3 className="h3 tableCap">Топ исполнителей</h3>
              <p className="hint tableSortHint">
                Сортировка: сумма личных баллов по всем трекам, затем число треков, затем среднее личное. Чат Ø — среднее
                по трекам, где чат указан (в ранг не входит). 1–3 место — медали. Нажми на ник — карточка исполнителя: все
                треки, оценки, места в топах.
              </p>
              {syncHint && <p className="formErr">{syncHint}</p>}
              {artistRows.length === 0 ? (
                <p className="muted">Пока нет исполнителей.</p>
              ) : (
                <table className="trackTable trackTableArtists">
                  <thead>
                    <tr>
                      <th>Место</th>
                      <th></th>
                      <th>Исполнитель</th>
                      <th>Треков</th>
                      <th>Σ личн.</th>
                      <th>Средн. личн.</th>
                      <th>Чат Ø</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artistRows.map((row, idx) => (
                      <tr key={row.key} className={idx < TOP_N ? "artistRowTop" : ""}>
                        <td className="trackRankCell">
                          <TrackRankMedal rank={idx + 1} />
                        </td>
                        <td>
                          {idx < TOP_N && <span className="topArtistBadge">топ</span>}
                        </td>
                        <td className="mono">
                          <button type="button" className="artistLinkBtn" onClick={() => setProfileArtistKey(row.key)}>
                            {row.displayName}
                          </button>
                        </td>
                        <td className="mono">{row.trackCount}</td>
                        <td className="mono accent">{row.ratedCount ? row.sumPersonal.toFixed(2) : "—"}</td>
                        <td className="mono">{row.avgPersonal == null ? "—" : row.avgPersonal}</td>
                        <td className="mono muted">{row.avgChat == null ? "—" : row.avgChat}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
            </>
          )}
        </div>
      </div>
      {viewTrack && <TrackViewModal track={viewTrack} onClose={() => setViewTrack(null)} />}
    </section>
  );
}
