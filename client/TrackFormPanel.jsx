import React, { useState } from "react";
import { CRITERIA, CriteriaSliders, CriteriaTotals, emptyCriteria } from "./trackCriteria.jsx";

export function TrackFormPanel({ liveAverage }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [criteria, setCriteria] = useState(emptyCriteria);
  const [chatAvg, setChatAvg] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  function setCrit(key, val) {
    setCriteria((c) => ({ ...c, [key]: val }));
  }

  function fillChatFromLive() {
    if (liveAverage == null || Number.isNaN(Number(liveAverage))) {
      setFormError("Сейчас нет средней оценки чата (дождись голосов или введи вручную).");
      return;
    }
    setFormError("");
    setChatAvg(Number(liveAverage).toFixed(2));
  }

  async function saveTrack(e) {
    e.preventDefault();
    setFormError("");
    setSavedOk(false);
    setLoading(true);
    try {
      const body = {
        title,
        artist,
        criteria: Object.fromEntries(CRITERIA.map(({ key }) => [key, criteria[key]])),
        chatAverage: String(chatAvg).trim() === "" ? null : chatAvg,
      };
      const r = await fetch("/api/tracks", {
        method: "POST",
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
      if (!r.ok) throw new Error(j.error || "Ошибка сохранения");
      setTitle("");
      setArtist("");
      setCriteria(emptyCriteria());
      setChatAvg("");
      setSavedOk(true);
      window.setTimeout(() => setSavedOk(false), 4000);
    } catch (err) {
      setFormError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="catalog">
      <div className="card catalogCard">
        <h2 className="catalogTitle">Новый трек</h2>
        <p className="hint catalogHint">
          Ручная запись в каталог: шесть критериев и по желанию средняя чата. Список сохранённых — на вкладке «Каталог
          треков».
        </p>

        <form className="trackForm" onSubmit={saveTrack}>
          <div className="manualTrackHero">
            <div className="fillCover fillCoverSm" aria-hidden>
              ♪
            </div>
            <div className="manualTrackFields">
              <div className="trackFormRow">
                <label className="tfLab">
                  Название трека
                  <input
                    className="tfIn"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="например, Lost demo"
                    required
                  />
                </label>
                <label className="tfLab">
                  Исполнитель
                  <input
                    className="tfIn"
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="ник / артист"
                    required
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="ratingDeck">
            <div className="ratingDeckCap">Оценки (0–10)</div>
            <CriteriaSliders values={criteria} onSet={setCrit} idPrefix="new" />
            <CriteriaTotals values={criteria} />
          </div>

          <div className="trackFormRow chatRow">
            <label className="tfLab grow">
              Средняя оценка чата (0–10, по желанию)
              <input
                className="tfIn"
                type="number"
                min={0}
                max={10}
                step={0.01}
                value={chatAvg}
                onChange={(e) => setChatAvg(e.target.value)}
                placeholder="например 7.5"
              />
            </label>
            <button type="button" className="btn" onClick={fillChatFromLive}>
              как сейчас в чате
            </button>
            <button type="submit" className="btn btnPrimary" disabled={loading}>
              {loading ? "…" : "сохранить трек"}
            </button>
          </div>
          {formError && <div className="formErr">{formError}</div>}
          {savedOk && <div className="formOk">Трек сохранён — открой «Каталог треков», чтобы увидеть в списке.</div>}
        </form>
      </div>
    </section>
  );
}
