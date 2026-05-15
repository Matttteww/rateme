import React from "react";

export const CRITERIA = [
  { key: "vibe", label: "Вайбик", sub: "атмосфера / ощущение" },
  { key: "svod", label: "Свод", sub: "структура / картина" },
  { key: "text", label: "Текстуля", sub: "рифмы / образы" },
  { key: "beat", label: "Битос", sub: "ритм / звук" },
  { key: "realization", label: "Реализашон", sub: "подача / стиль" },
  { key: "relevance", label: "Актуалка тречка", sub: "тренд / жанр" },
];

export const emptyCriteria = () =>
  Object.fromEntries(CRITERIA.map(({ key }) => [key, "5"]));

export function parseCrit(v) {
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function previewPersonalAvg(criteriaState) {
  const nums = CRITERIA.map(({ key }) => parseCrit(criteriaState[key])).filter((n) => n !== null);
  if (nums.length !== 6) return null;
  if (nums.some((n) => n < 0 || n > 10)) return null;
  return (nums.reduce((a, b) => a + b, 0) / 6).toFixed(2);
}

export function sumCriteriaSix(criteriaState) {
  const nums = CRITERIA.map(({ key }) => parseCrit(criteriaState[key])).filter((n) => n !== null);
  if (nums.length !== 6) return null;
  if (nums.some((n) => n < 0 || n > 10)) return null;
  return nums.reduce((a, b) => a + b, 0);
}

function critSliderValue(str) {
  const n = parseCrit(str);
  return n !== null ? n : 5;
}

export function CriteriaSliders({ values, onSet, idPrefix }) {
  return (
    <div className="critSliderGrid">
      {CRITERIA.map(({ key, label, sub }, i) => {
        const v = critSliderValue(values[key]);
        const pct = (v / 10) * 100;
        return (
          <div key={key} className={`critSliderCard critSliderCard--${i}`}>
            <div className="critSliderTop">
              <span className="critSliderLab">{label}</span>
              <span className="critSliderNum mono">{v}</span>
            </div>
            {sub && <div className="critSliderSub">{sub}</div>}
            <input
              id={`${idPrefix}-${key}`}
              type="range"
              className={`critRange critRange--${i}`}
              style={{ "--trackPct": `${pct}%` }}
              min={0}
              max={10}
              step={1}
              value={v}
              onChange={(e) => onSet(key, e.target.value)}
              aria-label={`${label}: ${v} из 10`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CriteriaTotals({ values }) {
  const sum = sumCriteriaSix(values);
  const avg = previewPersonalAvg(values);
  const nums =
    sum != null ? CRITERIA.map(({ key }) => parseCrit(values[key])).filter((n) => n !== null) : null;
  const complete = sum != null;

  return (
    <div className="critTotals">
      <div className="critTotalsLeft">
        <div className={`critTotalsCheck ${complete ? "critTotalsCheck--ok" : ""}`} aria-hidden>
          {complete ? "✓" : ""}
        </div>
        <div>
          <div className="critTotalsSum">
            <span className="critTotalsSumBig mono">{complete ? sum : "—"}</span>
            <span className="critTotalsSumMax mono">/ 60</span>
          </div>
          <div className="critTotalsAvg">
            среднее: <strong className="mono">{avg ?? "—"}</strong> <span className="critTotalsAvgHint">из 10</span>
          </div>
        </div>
      </div>
      {nums && (
        <div className="critTotalsDots mono" aria-label="Шесть оценок">
          {nums.map((n, i) => (
            <span key={i} className={`critDot critDot--${i}`}>
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
