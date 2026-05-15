const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { newId } = require("./authUtil");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "data", "uploads");

function ensureUploadDirs() {
  for (const sub of ["avatars", "banners", "releases", "openvers", "beats", "wall", "dm", "tg-inbox"]) {
    fs.mkdirSync(path.join(UPLOAD_ROOT, sub), { recursive: true });
  }
}

function diskStorage(subdir) {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      const d = path.join(UPLOAD_ROOT, subdir);
      fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
      cb(null, `${newId()}${ext}`);
    },
  });
}

const audioFilter = (_req, file, cb) => {
  const ok =
    /\.(mp3|wav)$/i.test(file.originalname || "") ||
    file.mimetype === "audio/mpeg" ||
    file.mimetype === "audio/wav" ||
    file.mimetype === "audio/wave";
  cb(ok ? null : new Error("Только mp3 или wav."), ok);
};

const uploadReleaseAudio = multer({
  storage: diskStorage("releases"),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: audioFilter,
}).single("audio");

const uploadOpenverAudio = multer({
  storage: diskStorage("openvers"),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: audioFilter,
}).single("audio");

const uploadBeatAudio = multer({
  storage: diskStorage("beats"),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: audioFilter,
}).single("audio");

const uploadAvatar = multer({
  storage: diskStorage("avatars"),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype || "");
    cb(ok ? null : new Error("Только изображение."), ok);
  },
}).single("avatar");

const uploadBanner = multer({
  storage: diskStorage("banners"),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype || "");
    cb(ok ? null : new Error("Только изображение."), ok);
  },
}).single("banner");

const uploadWallFiles = multer({
  storage: diskStorage("wall"),
  limits: { fileSize: 50 * 1024 * 1024 },
}).array("files", 10);

const uploadDmFiles = multer({
  storage: diskStorage("dm"),
  limits: { fileSize: 50 * 1024 * 1024 },
}).array("files", 10);

function relPath(absPath) {
  return path.relative(UPLOAD_ROOT, absPath).replace(/\\/g, "/");
}

function mapAudioRow(row, table) {
  if (!row) return null;
  const audio =
    row.audio_kind === "file" && row.audio_file_path
      ? { kind: "file", url: `/uploads/${row.audio_file_path}` }
      : row.audio_kind === "yandex" && row.audio_url
        ? { kind: "yandex", url: row.audio_url, openExternal: true }
        : null;
  const base = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    artistDisplay: row.artist_display,
    audio,
    createdAt: row.created_at,
    type: table,
  };
  if (table === "release") {
    base.isDemo = !!row.is_demo;
    base.playCount = row.play_count || 0;
  }
  if (table === "openver") {
    base.playCount = row.play_count || 0;
  }
  if (table === "beat") {
    base.bpm = row.beat_bpm != null ? row.beat_bpm : null;
    base.musicalKey = row.beat_key || null;
    base.tonality = row.beat_scale || null;
    base.tags = row.beat_tags
      ? String(row.beat_tags)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    base.playCount = row.play_count || 0;
  }
  return base;
}

module.exports = {
  UPLOAD_ROOT,
  ensureUploadDirs,
  uploadReleaseAudio,
  uploadOpenverAudio,
  uploadBeatAudio,
  uploadAvatar,
  uploadBanner,
  uploadWallFiles,
  uploadDmFiles,
  relPath,
  mapAudioRow,
};
