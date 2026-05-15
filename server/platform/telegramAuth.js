const crypto = require("crypto");

function verifyTelegramLogin(payload, botToken) {
  if (!botToken || !payload?.hash) return { ok: false, error: "Нет данных Telegram." };
  const authDate = Number(payload.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return { ok: false, error: "Сессия Telegram устарела. Войдите снова." };
  }
  const { hash, ...rest } = payload;
  const pairs = Object.keys(rest)
    .filter((k) => rest[k] != null && rest[k] !== "")
    .sort()
    .map((k) => `${k}=${rest[k]}`);
  const dataCheckString = pairs.join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (hmac !== hash) return { ok: false, error: "Подпись Telegram не совпала." };
  return {
    ok: true,
    telegramId: String(rest.id),
    username: rest.username ? String(rest.username).trim() : null,
    firstName: rest.first_name ? String(rest.first_name).trim() : "",
    lastName: rest.last_name ? String(rest.last_name).trim() : "",
    photoUrl: rest.photo_url ? String(rest.photo_url) : null,
  };
}

module.exports = { verifyTelegramLogin };
