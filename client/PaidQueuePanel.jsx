import React from "react";
import { TrackPlayCell } from "./TrackPlayCell.jsx";

function formatAmount(amount, currency) {
  const n = Number(amount);
  const cur = String(currency || "RUB").toUpperCase();
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: cur }).format(n);
  } catch {
    return `${n} ${cur}`;
  }
}

export function PaidQueuePanel({ state }) {
  const queue = Array.isArray(state?.paidQueue) ? state.paidQueue : [];
  const da = state?.donationAlerts || {};
  const enabled = Boolean(da.enabled);

  return (
    <section className="paidQueuePage" aria-label="Платная очередь">
      <div className="card paidQueueCard">
        <h2 className="paidQueueTitle">Платная очередь</h2>
        <p className="hint paidQueueHint">
          Сюда попадают донаты с DonationAlerts: из поля сообщения берётся текст, по нему ищутся похожие треки в каталоге.
          Первый запуск сервера помечает уже существующие донаты как просмотренные — в очередь попадают только новые.
        </p>
        {!enabled && (
          <div className="formErr paidQueueWarn">
            Включение: создай приложение на{" "}
            <a href="https://www.donationalerts.com/application/clients" target="_blank" rel="noopener noreferrer">
              donationalerts.com/application/clients
            </a>
            , выдай scope <span className="mono">oauth-donation-index</span>, получи access token и добавь в{" "}
            <span className="mono">.env</span>: <span className="mono">DONATIONALERTS_ACCESS_TOKEN=...</span> (опционально{" "}
            <span className="mono">DONATIONALERTS_POLL_MS=25000</span>). Перезапусти сервер.
          </div>
        )}
        {enabled && da.lastError && <div className="formErr paidQueueWarn">DonationAlerts: {da.lastError}</div>}
        {queue.length === 0 ? (
          <p className="muted paidQueueEmpty">{enabled ? "Пока нет новых донатов с момента последнего запуска." : "—"}</p>
        ) : (
          <ul className="paidQueueList">
            {queue.map((row) => (
              <li key={row.donationId} className="paidQueueItem">
                <div className="paidQueueItemHead">
                  <span className="paidQueueUser">{row.username}</span>
                  <span className="paidQueueAmt mono">{formatAmount(row.amount, row.currency)}</span>
                </div>
                <p className="paidQueueMsg mono">{row.message}</p>
                <p className="hint paidQueueMeta">
                  донат: {row.donationCreatedAt || "—"} · id {row.donationId}
                </p>
                <div className="paidQueueMatches">
                  <span className="paidQueueMatchesLab">Подбор из каталога</span>
                  {(!row.matchedTracks || row.matchedTracks.length === 0) && (
                    <p className="muted paidQueueNoMatch">Совпадений не найдено — добавь трек в каталог или уточни название в донате.</p>
                  )}
                  {(row.matchedTracks || []).map((m, i) => (
                    <div key={`${row.donationId}-${m.track?.id}-${i}`} className="paidQueueMatchRow">
                      <div className="paidQueueMatchText">
                        <span className="paidQueueMatchTitle">{m.track?.title || "—"}</span>
                        <span className="paidQueueMatchSep">—</span>
                        <span className="paidQueueMatchArtist mono">{m.track?.artist || "—"}</span>
                        <span className="paidQueueScore mono" title="Оценка совпадения (внутренняя)">
                          {m.matchScore}
                        </span>
                      </div>
                      <div className="paidQueueMatchPlay">
                        <TrackPlayCell track={m.track} />
                      </div>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
