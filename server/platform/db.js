const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "..", "..", "data", "platform.db");

let db;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  bio TEXT DEFAULT '',
  avatar_path TEXT,
  is_banned INTEGER NOT NULL DEFAULT 0,
  is_frozen INTEGER NOT NULL DEFAULT 0,
  staff_role TEXT,
  is_streamer INTEGER NOT NULL DEFAULT 0,
  king_wins INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  login_changed_at INTEGER,
  password_changed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_releases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist_display TEXT NOT NULL,
  audio_kind TEXT NOT NULL,
  audio_file_path TEXT,
  audio_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS openvers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist_display TEXT NOT NULL,
  audio_kind TEXT NOT NULL,
  audio_file_path TEXT,
  audio_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS beats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist_display TEXT NOT NULL,
  audio_kind TEXT NOT NULL,
  audio_file_path TEXT,
  audio_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS release_ratings (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES user_releases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(release_id, user_id)
);

CREATE TABLE IF NOT EXISTS wall_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'site',
  telegram_message_id TEXT,
  repost_of_id TEXT REFERENCES wall_posts(id) ON DELETE SET NULL,
  repost_comment TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  edit_until INTEGER NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  pinned_at INTEGER
);

CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_views_post ON post_views(post_id);

CREATE TABLE IF NOT EXISTS wall_attachments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_path TEXT,
  url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES post_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS king_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  champion_release_id TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS king_matches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES king_sessions(id) ON DELETE CASCADE,
  round_num INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  release_a_id TEXT NOT NULL,
  release_b_id TEXT,
  winner_release_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_releases_user ON user_releases(user_id);
CREATE INDEX IF NOT EXISTS idx_openvers_user ON openvers(user_id);
CREATE INDEX IF NOT EXISTS idx_beats_user ON beats(user_id);
CREATE INDEX IF NOT EXISTS idx_wall_created ON wall_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dm_conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dm_members (
  conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at INTEGER,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dm_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_path TEXT,
  url TEXT,
  mime TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dm_updated ON dm_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_msg ON dm_messages(conversation_id, created_at);
`;

function getDb() {
  if (!db) throw new Error("platform DB not initialized");
  return db;
}

function initPlatformDb() {
  const fs = require("fs");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  require("./migrate").migratePlatformDb();
  return db;
}

module.exports = { initPlatformDb, getDb, DB_PATH };
