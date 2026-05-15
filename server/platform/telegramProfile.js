const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { newId } = require("./authUtil");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "data", "uploads");

async function downloadTelegramAvatar(photoUrl) {
  if (!photoUrl || !/^https?:\/\//i.test(photoUrl)) return null;
  try {
    const res = await axios.get(photoUrl, { responseType: "arraybuffer", timeout: 15000 });
    const dir = path.join(UPLOAD_ROOT, "avatars");
    fs.mkdirSync(dir, { recursive: true });
    const rel = `avatars/${newId()}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_ROOT, rel), res.data);
    return rel;
  } catch (e) {
    console.warn("[telegram] avatar download:", e.message);
    return null;
  }
}

async function applyTelegramProfile(db, userId, verified) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!row) return;

  const displayName =
    [verified.firstName, verified.lastName].filter(Boolean).join(" ").trim() ||
    verified.username ||
    row.display_name;

  const avatarPath = !row.avatar_path && verified.photoUrl ? await downloadTelegramAvatar(verified.photoUrl) : null;

  const parts = [];
  const params = [];

  if (displayName && displayName !== row.display_name) {
    parts.push("display_name = ?");
    params.push(displayName);
  }
  if (avatarPath) {
    parts.push("avatar_path = ?");
    params.push(avatarPath);
  }

  if (parts.length) {
    params.push(userId);
    db.prepare(`UPDATE users SET ${parts.join(", ")} WHERE id = ?`).run(...params);
  }
}

module.exports = { applyTelegramProfile, downloadTelegramAvatar };
