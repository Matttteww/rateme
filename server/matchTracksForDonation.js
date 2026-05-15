/**
 * Подбор треков из каталога по тексту из доната (название / исполнитель, без внешних библиотек).
 * @param {string} query
 * @param {object[]} tracks
 * @param {number} [limit=10]
 * @returns {{ track: object; matchScore: number }[]}
 */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length >= 2);
}

function matchTracksForDonation(query, tracks, limit = 10) {
  const qn = normalize(query);
  if (!qn || !Array.isArray(tracks)) return [];
  const qtokens = tokenize(qn);
  const scored = [];
  for (const t of tracks) {
    const title = String(t.title || "");
    const artist = String(t.artist || "");
    const hay = normalize(`${title} ${artist}`);
    if (!hay) continue;
    let score = 0;
    if (hay.includes(qn)) score += 80;
    const nt = normalize(title);
    const na = normalize(artist);
    if (nt && (nt === qn || qn.includes(nt) || nt.includes(qn))) score += 40;
    if (na && (na === qn || qn.includes(na) || na.includes(qn))) score += 35;
    for (const tok of qtokens) {
      if (tok.length >= 2 && hay.includes(tok)) score += 14;
    }
    if (score > 0) scored.push({ track: t, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.track.title || "").localeCompare(String(b.track.title || ""), "ru"));
  return scored.slice(0, limit).map(({ track, score }) => ({ track, matchScore: score }));
}

module.exports = { matchTracksForDonation, normalize };
