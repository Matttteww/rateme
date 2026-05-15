const axios = require("axios");
const { TELEGRAM_BOT_TOKEN } = require("./telegramBot");

function tgApi(method, params = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    return Promise.resolve({ ok: false, description: "TELEGRAM_BOT_TOKEN не задан" });
  }
  return axios
    .get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
      params,
      timeout: 15000,
    })
    .then((r) => r.data)
    .catch((e) => ({
      ok: false,
      description: e.response?.data?.description || e.message || String(e),
    }));
}

function normalizeChannelUsername(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
    .split("/")[0]
    .split("?")[0];
}

async function fetchTelegramChannelInfo(channelUsername) {
  const username = normalizeChannelUsername(channelUsername);
  if (!username || !/^[a-zA-Z0-9_]{4,32}$/.test(username)) {
    return { ok: false, error: "Некорректный @username канала." };
  }

  const chatRef = `@${username}`;
  const chatRes = await tgApi("getChat", { chat_id: chatRef });
  if (!chatRes.ok) {
    return {
      ok: false,
      error:
        chatRes.description ||
        "Канал не найден. Проверь @username и что канал публичный или бот добавлен в канал.",
    };
  }

  const chat = chatRes.result;
  const isChannel = chat.type === "channel" || chat.type === "supergroup";
  if (!isChannel && chat.type !== "group") {
    return { ok: false, error: "Указанный чат не является каналом." };
  }

  let memberCount = null;
  const countRes = await tgApi("getChatMemberCount", { chat_id: chat.id });
  if (countRes.ok && typeof countRes.result === "number") {
    memberCount = countRes.result;
  }

  let botIsAdmin = false;
  let botCanPost = false;
  const tokenId = TELEGRAM_BOT_TOKEN.split(":")[0];
  if (/^\d+$/.test(tokenId)) {
    const memberRes = await tgApi("getChatMember", { chat_id: chat.id, user_id: tokenId });
    if (memberRes.ok) {
      const st = memberRes.result?.status;
      botIsAdmin = st === "administrator" || st === "creator";
      if (botIsAdmin && memberRes.result) {
        botCanPost = Boolean(memberRes.result.can_post_messages ?? memberRes.result.can_post_stories ?? true);
      }
    }
  }

  const meta = {
    username: chat.username || username,
    title: chat.title || username,
    description: chat.description || "",
    chatId: String(chat.id),
    memberCount,
    type: chat.type,
    inviteLink: chat.invite_link || (chat.username ? `https://t.me/${chat.username}` : null),
    botIsAdmin,
    botCanPost,
    photoFileId: chat.photo?.big_file_id || chat.photo?.small_file_id || null,
    checkedAt: Date.now(),
  };

  return { ok: true, meta };
}

module.exports = {
  fetchTelegramChannelInfo,
  normalizeChannelUsername,
  tgApi,
};
