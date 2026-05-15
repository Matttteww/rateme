const { getDb } = require("./db");
const { newId } = require("./authUtil");
const { createNotification } = require("./notify");
const { mapAudioRow } = require("./upload");

/** Сетка на 10: 5 пар → 5; 2 пары + bye → 3; 1 пара + bye → 2; финал → 1. */
const BRACKET_ROUNDS = [
  { round: 1, pairs: 5, hasBye: false },
  { round: 2, pairs: 2, hasBye: true },
  { round: 3, pairs: 1, hasBye: true },
  { round: 4, pairs: 1, hasBye: false },
];

function pickRandomReleases(limit = 10) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM user_releases WHERE status = 'published'
       AND (audio_kind = 'file' AND audio_file_path IS NOT NULL OR audio_kind = 'yandex' AND audio_url IS NOT NULL)
       ORDER BY RANDOM() LIMIT ?`
    )
    .all(limit);
}

function buildRound1Matches(sessionId, releases) {
  const db = getDb();
  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO king_matches (id, session_id, round_num, slot, release_a_id, release_b_id, winner_release_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  );
  for (let i = 0; i < 5; i += 1) {
    ins.run(newId(), sessionId, 1, i, releases[i * 2].id, releases[i * 2 + 1].id, now);
  }
}

function getActiveMatch(sessionId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM king_matches WHERE session_id = ? AND winner_release_id IS NULL
       ORDER BY round_num, slot LIMIT 1`
    )
    .get(sessionId);
}

function advanceWinners(sessionId, roundNum) {
  const db = getDb();
  const winners = db
    .prepare(
      `SELECT winner_release_id AS id FROM king_matches
       WHERE session_id = ? AND round_num = ? AND winner_release_id IS NOT NULL
       ORDER BY slot`
    )
    .all(sessionId, roundNum)
    .map((r) => r.id);

  if (roundNum === 4) return winners[0] || null;

  const nextRound = roundNum + 1;
  const cfg = BRACKET_ROUNDS.find((r) => r.round === nextRound);
  if (!cfg) return null;

  const now = Date.now();
  const ins = db.prepare(
    `INSERT INTO king_matches (id, session_id, round_num, slot, release_a_id, release_b_id, winner_release_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  );

  let idx = 0;
  const list = [...winners];
  if (cfg.hasBye && list.length % 2 === 1) {
    const byeId = list.pop();
    for (let slot = 0; slot < cfg.pairs; slot += 1) {
      const a = list[slot * 2];
      const b = list[slot * 2 + 1];
      if (b) {
        ins.run(newId(), sessionId, nextRound, slot, a, b, null, now);
      } else if (a) {
        db.prepare(
          `INSERT INTO king_matches (id, session_id, round_num, slot, release_a_id, release_b_id, winner_release_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
        ).run(newId(), sessionId, nextRound, slot, a, byeId, byeId, now);
      }
    }
    return null;
  }

  for (let slot = 0; slot < cfg.pairs; slot += 1) {
    const a = list[slot * 2];
    const b = list[slot * 2 + 1];
    if (a && b) ins.run(newId(), sessionId, nextRound, slot, a, b, null, now);
  }
  return null;
}

function completeSession(sessionId, championReleaseId, playerId) {
  const db = getDb();
  const rel = db
    .prepare("SELECT user_id, title, artist_display FROM user_releases WHERE id = ?")
    .get(championReleaseId);
  const now = Date.now();
  db.prepare(
    `UPDATE king_sessions SET status = 'completed', champion_release_id = ?, completed_at = ? WHERE id = ?`
  ).run(championReleaseId, now, sessionId);
  db.prepare("UPDATE users SET games_played = games_played + 1 WHERE id = ?").run(playerId);
  if (rel?.user_id) {
    db.prepare("UPDATE users SET king_wins = king_wins + 1 WHERE id = ?").run(rel.user_id);
    const player = db.prepare("SELECT username, display_name FROM users WHERE id = ?").get(playerId);
    createNotification(rel.user_id, "king_win", {
      sessionId,
      releaseId: championReleaseId,
      releaseTitle: rel.title || "Трек",
      releaseArtist: rel.artist_display || null,
      playerId,
      playerUsername: player?.username,
      playerDisplayName: player?.display_name || player?.username,
    });
  }
}

function startSession(playerId) {
  const releases = pickRandomReleases(10);
  if (releases.length < 10) {
    return { error: `Нужно минимум 10 треков в каталоге (сейчас ${releases.length}).` };
  }
  const db = getDb();
  const sessionId = newId();
  db.prepare(
    `INSERT INTO king_sessions (id, player_id, status, champion_release_id, created_at, completed_at)
     VALUES (?, ?, 'in_progress', NULL, ?, NULL)`
  ).run(sessionId, playerId, Date.now());
  buildRound1Matches(sessionId, releases);
  return { sessionId };
}

function pickWinner(sessionId, playerId, winnerReleaseId) {
  const db = getDb();
  const session = db.prepare("SELECT * FROM king_sessions WHERE id = ? AND player_id = ?").get(sessionId, playerId);
  if (!session || session.status !== "in_progress") return { error: "Сессия не найдена." };

  const match = getActiveMatch(sessionId);
  if (!match) return { error: "Нет активной пары." };
  if (winnerReleaseId !== match.release_a_id && winnerReleaseId !== match.release_b_id) {
    return { error: "Неверный трек." };
  }

  db.prepare("UPDATE king_matches SET winner_release_id = ? WHERE id = ?").run(winnerReleaseId, match.id);

  const openInRound = db
    .prepare(
      `SELECT COUNT(*) AS c FROM king_matches WHERE session_id = ? AND round_num = ? AND winner_release_id IS NULL`
    )
    .get(sessionId, match.round_num).c;

  if (openInRound === 0) {
    advanceWinners(sessionId, match.round_num);
    const champMatch = db
      .prepare(
        `SELECT * FROM king_matches WHERE session_id = ? AND round_num = 4 AND winner_release_id IS NOT NULL`
      )
      .get(sessionId);
    if (champMatch?.winner_release_id) {
      completeSession(sessionId, champMatch.winner_release_id, playerId);
      return { completed: true, championReleaseId: champMatch.winner_release_id };
    }
    const autoWin = db
      .prepare(
        `SELECT winner_release_id FROM king_matches WHERE session_id = ? AND winner_release_id IS NOT NULL ORDER BY round_num DESC, slot DESC LIMIT 1`
      )
      .get(sessionId);
    if (match.round_num >= 3) {
      const finalMatch = getActiveMatch(sessionId);
      if (!finalMatch) {
        const lastWinner = db
          .prepare(
            `SELECT winner_release_id AS id FROM king_matches WHERE session_id = ? AND winner_release_id IS NOT NULL ORDER BY round_num DESC LIMIT 1`
          )
          .get(sessionId);
        if (lastWinner && match.round_num === 4) {
          /* wait for final pick */
        }
      }
    }
  }

  const done = db.prepare("SELECT status FROM king_sessions WHERE id = ?").get(sessionId);
  if (done?.status === "completed") {
    return { completed: true, championReleaseId: done.champion_release_id };
  }

  const onlyOneLeft = db
    .prepare(
      `SELECT winner_release_id FROM king_matches WHERE session_id = ? AND round_num = (SELECT MAX(round_num) FROM king_matches WHERE session_id = ?) AND winner_release_id IS NOT NULL`
    )
    .all(sessionId, sessionId);
  if (onlyOneLeft.length === 1 && match.round_num >= 3) {
    const pending = getActiveMatch(sessionId);
    if (!pending) {
      completeSession(sessionId, onlyOneLeft[0].winner_release_id, playerId);
      return { completed: true, championReleaseId: onlyOneLeft[0].winner_release_id };
    }
  }

  return { ok: true };
}

/** Упрощённое завершение раунда после последнего pick в финале. */
function pickWinnerSimple(sessionId, playerId, winnerReleaseId) {
  const db = getDb();
  const session = db.prepare("SELECT * FROM king_sessions WHERE id = ? AND player_id = ?").get(sessionId, playerId);
  if (!session || session.status !== "in_progress") return { error: "Сессия не найдена." };

  let match = getActiveMatch(sessionId);
  if (!match) {
    if (session.status === "completed") return { completed: true, championReleaseId: session.champion_release_id };
    return { error: "Нет активной пары." };
  }
  if (winnerReleaseId !== match.release_a_id && winnerReleaseId !== match.release_b_id) {
    return { error: "Неверный трек." };
  }

  db.prepare("UPDATE king_matches SET winner_release_id = ? WHERE id = ?").run(winnerReleaseId, match.id);

  while (true) {
    const open = db
      .prepare(
        `SELECT COUNT(*) AS c FROM king_matches WHERE session_id = ? AND round_num = ? AND winner_release_id IS NULL`
      )
      .get(sessionId, match.round_num).c;
    if (open > 0) break;

    const winners = db
      .prepare(
        `SELECT winner_release_id AS id FROM king_matches WHERE session_id = ? AND round_num = ? AND winner_release_id IS NOT NULL ORDER BY slot`
      )
      .all(sessionId, match.round_num)
      .map((w) => w.id);

    if (match.round_num === 4 && winners.length >= 1) {
      completeSession(sessionId, winners[0], playerId);
      return { completed: true, championReleaseId: winners[0] };
    }

    if (winners.length === 1 && match.round_num < 4) {
      const nextRound = match.round_num + 1;
      db.prepare(
        `INSERT INTO king_matches (id, session_id, round_num, slot, release_a_id, release_b_id, winner_release_id, created_at)
         VALUES (?, ?, ?, 0, ?, NULL, ?, ?)`
      ).run(newId(), sessionId, nextRound, 0, winners[0], winners[0], Date.now());
      match = getActiveMatch(sessionId);
      if (!match) continue;
      break;
    }

    if (winners.length < 2) break;

    const nextRound = match.round_num + 1;
    const now = Date.now();
    for (let slot = 0, i = 0; i < winners.length; slot += 1, i += 2) {
      const a = winners[i];
      const b = winners[i + 1];
      if (!b) {
        db.prepare(
          `INSERT INTO king_matches (id, session_id, round_num, slot, release_a_id, release_b_id, winner_release_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
        ).run(newId(), sessionId, nextRound, slot, a, a, now);
      } else {
        db.prepare(
          `INSERT INTO king_matches (id, session_id, round_num, slot, release_a_id, release_b_id, winner_release_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
        ).run(newId(), sessionId, nextRound, slot, a, b, now);
      }
    }
    match = getActiveMatch(sessionId);
    if (!match) {
      const sess = db.prepare("SELECT * FROM king_sessions WHERE id = ?").get(sessionId);
      if (sess?.status === "completed") {
        return { completed: true, championReleaseId: sess.champion_release_id };
      }
      break;
    }
    break;
  }

  const sess = db.prepare("SELECT * FROM king_sessions WHERE id = ?").get(sessionId);
  if (sess?.status === "completed") {
    return { completed: true, championReleaseId: sess.champion_release_id };
  }
  return { ok: true };
}

function getSessionState(sessionId) {
  const db = getDb();
  const session = db.prepare("SELECT * FROM king_sessions WHERE id = ?").get(sessionId);
  if (!session) return null;
  const match = getActiveMatch(sessionId);
  const mapRel = (id) => {
    const r = db.prepare("SELECT * FROM user_releases WHERE id = ?").get(id);
    if (!r) return null;
    const u = db.prepare("SELECT username FROM users WHERE id = ?").get(r.user_id);
    return { ...mapAudioRow(r, "release"), ownerUsername: u?.username };
  };
  const champion = session.champion_release_id ? mapRel(session.champion_release_id) : null;
  return {
    sessionId: session.id,
    status: session.status,
    championReleaseId: session.champion_release_id,
    champion,
    currentMatch: match
      ? {
          matchId: match.id,
          round: match.round_num,
          slot: match.slot,
          a: mapRel(match.release_a_id),
          b: match.release_b_id ? mapRel(match.release_b_id) : null,
        }
      : null,
  };
}

function leaderboardArtists(limit = 20) {
  const db = getDb();
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_path, u.king_wins
       FROM users u WHERE u.king_wins > 0 ORDER BY u.king_wins DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => ({
      userId: r.id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar_path ? `/uploads/${r.avatar_path}` : null,
      kingWins: r.king_wins,
    }));
}

function leaderboardReleases(limit = 20) {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.id, r.title, r.artist_display, u.username, COUNT(ks.id) AS wins
       FROM king_sessions ks
       JOIN user_releases r ON r.id = ks.champion_release_id
       JOIN users u ON u.id = r.user_id
       WHERE ks.status = 'completed'
       GROUP BY r.id ORDER BY wins DESC LIMIT ?`
    )
    .all(limit);
}

module.exports = {
  startSession,
  pickWinner: pickWinnerSimple,
  getSessionState,
  leaderboardArtists,
  leaderboardReleases,
};
