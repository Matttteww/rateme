const { getDb } = require("./db");

const USER_COLUMNS = [
  ["telegram_id", "TEXT"],
  ["telegram_channel", "TEXT"],
  ["telegram_linked_at", "INTEGER"],
  ["telegram_channel_meta", "TEXT"],
  ["telegram_sync_mode", "TEXT DEFAULT 'manual'"],
  ["banner_path", "TEXT"],
];

function migratePlatformDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_inbox (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      telegram_message_id TEXT NOT NULL,
      body TEXT DEFAULT '',
      has_media INTEGER NOT NULL DEFAULT 0,
      channel_message_link TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      wall_post_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, telegram_message_id)
    );
  `);
  try {
    db.exec(`ALTER TABLE telegram_inbox ADD COLUMN media_json TEXT DEFAULT '[]'`);
  } catch {
    /* already exists */
  }
  for (const [col, type] of USER_COLUMNS) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
    } catch {
      /* already exists */
    }
  }
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL");
  } catch {
    /* */
  }
  try {
    db.exec("UPDATE users SET telegram_sync_mode = 'manual' WHERE telegram_sync_mode IS NULL OR telegram_sync_mode = ''");
  } catch {
    /* */
  }

  try {
    db.exec("ALTER TABLE wall_posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* already exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_views (
      post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_post_views_post ON post_views(post_id);
  `);

  try {
    db.exec("ALTER TABLE user_releases ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* already exists */
  }
  try {
    db.exec("ALTER TABLE user_releases ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* already exists */
  }
  for (const col of [
    ["beat_bpm", "INTEGER"],
    ["beat_key", "TEXT"],
    ["beat_scale", "TEXT"],
    ["beat_tags", "TEXT"],
    ["play_count", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    try {
      db.exec(`ALTER TABLE beats ADD COLUMN ${col[0]} ${col[1]}`);
    } catch {
      /* already exists */
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS beat_ratings (
      id TEXT PRIMARY KEY,
      beat_id TEXT NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score INTEGER,
      skipped INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(beat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_beat_ratings_beat ON beat_ratings(beat_id);
  `);

  try {
    db.exec("ALTER TABLE openvers ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* already exists */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS openver_likes (
      openver_id TEXT NOT NULL REFERENCES openvers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (openver_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_openver_likes_openver ON openver_likes(openver_id);
  `);

  try {
    db.exec("ALTER TABLE release_ratings ADD COLUMN comment_text TEXT");
  } catch {
    /* already exists */
  }

  try {
    db.exec("ALTER TABLE wall_posts ADD COLUMN pinned_at INTEGER");
  } catch {
    /* already exists */
  }

  try {
    db.exec(`
      UPDATE wall_posts
      SET view_count = (
        SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = wall_posts.id
      )
      WHERE view_count = 0
        AND EXISTS (SELECT 1 FROM post_views pv WHERE pv.post_id = wall_posts.id)
    `);
  } catch {
    /* */
  }
}

module.exports = { migratePlatformDb };
