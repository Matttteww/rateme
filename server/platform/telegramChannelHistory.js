const https = require("https");
const axios = require("axios");
const { normalizeChannelUsername } = require("./telegramChannel");
const { insertTelegramInbox } = require("./telegramInbox");
const {
  parseMediaFromHtmlBlock,
  normalizePublicChannelBody,
  itemHasMediaSlot,
  isCaptionOnlyTextPost,
  mergeMediaLists,
} = require("./telegramMedia");

const tgAgent = new https.Agent({ keepAlive: true, family: 4 });

const TG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
};

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** На t.me/s подпись и медио иногда идут соседними message id — объединяем в одну карточку. */
const TG_MERGE_MAX_ID_GAP = 6;

function mergeAdjacentChannelItems(items) {
  if (!items || items.length < 2) return items || [];
  const sorted = [...items].sort((a, b) => Number(a.telegramMessageId) - Number(b.telegramMessageId));

  function combineGroup(group) {
    const withMedia = group.filter(itemHasMediaSlot);
    const canonicalId =
      withMedia.length > 0
        ? String(Math.min(...withMedia.map((g) => Number(g.telegramMessageId))))
        : String(Math.min(...group.map((g) => Number(g.telegramMessageId))));
    let combinedMedia = [];
    for (const g of group) {
      combinedMedia = mergeMediaLists(combinedMedia, g.media || []);
    }
    const bodySeen = new Set();
    const bodyParts = [];
    for (const g of group) {
      const b = normalizePublicChannelBody(g.body, "");
      if (b && !bodySeen.has(b)) {
        bodySeen.add(b);
        bodyParts.push(b);
      }
    }
    const body = bodyParts.join("\n\n").trim();
    const hasSlot = group.some(itemHasMediaSlot);
    return {
      telegramMessageId: canonicalId,
      channelUsername: group[0].channelUsername,
      body,
      hasMedia:
        hasSlot || combinedMedia.some((m) => m.placeholder || m.url || m.telegramFileId),
      media: combinedMedia,
    };
  }

  const out = [];
  let i = 0;
  while (i < sorted.length) {
    const group = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length) {
      const prev = group[group.length - 1];
      const next = sorted[j];
      const chP = normalizeChannelUsername(prev.channelUsername);
      const chN = normalizeChannelUsername(next.channelUsername);
      if (chP !== chN) break;

      const delta = Number(next.telegramMessageId) - Number(prev.telegramMessageId);
      if (delta <= 0 || delta > TG_MERGE_MAX_ID_GAP) break;

      const canPair =
        (itemHasMediaSlot(prev) && isCaptionOnlyTextPost(next)) ||
        (isCaptionOnlyTextPost(prev) && itemHasMediaSlot(next));
      if (!canPair) break;
      group.push(next);
      j++;
    }

    if (group.length === 1) {
      out.push(group[0]);
      i += 1;
    } else {
      out.push(combineGroup(group));
      i = j;
    }
  }
  return out;
}

function extractTelegramWidgetText(block) {
  const html = String(block || "");
  const re = /<div[^>]*\btgme_widget_message_text\b[^>]*>/i;
  const mo = html.match(re);
  if (!mo || mo.index === undefined) return "";
  let pos = mo.index + mo[0].length;
  let depth = 1;
  while (pos < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", pos);
    const nextClose = html.indexOf("</div>", pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return decodeHtml(html.slice(mo.index + mo[0].length, nextClose));
      pos = nextClose + 6;
    }
  }
  return "";
}

function parsePublicChannelPage(html, channelUsername) {
  const username = normalizeChannelUsername(channelUsername);
  const items = [];
  const parts = String(html || "").split(/\sdata-post="/);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const postRef = block.split('"')[0];
    const refParts = postRef.split("/");
    const msgChannel = refParts[0] || username;
    const messageId = refParts[1];
    if (!messageId || !/^\d+$/.test(messageId)) continue;

    const textRaw = extractTelegramWidgetText(block);
    const hasMediaDom =
      /tgme_widget_message_photo|tgme_widget_message_photo_wrap|js-message_photo|tgme_widget_message_video|tgme_widget_message_video_player|js-message_video|tgme_widget_message_voice|tgme_widget_message_document|tgme_widget_message_roundvideo|tgme_widget_message_sticker|tgme_widget_message_animated_sticker|tgme_widget_message_music|tgme_widget_message_poll|tgme_widget_message_link_preview|message_sticker|js-message_sticker|message_audio|\bmedia_wrap\b|\bphoto_wrap\b|\bvideo_wrap\b|tgme_widget_message_grouped_photo/i.test(
        block
      );
    const decoded = decodeHtml(textRaw);
    const body = normalizePublicChannelBody(decoded, block);
    const media = parseMediaFromHtmlBlock(block);
    let hasMedia = hasMediaDom || media.length > 0;
    if (hasMediaDom && media.length === 0) {
      media.push({ kind: "image", url: null, placeholder: true });
    }
    items.push({
      telegramMessageId: messageId,
      body: body || "",
      hasMedia,
      media,
      channelUsername: msgChannel,
    });
  }

  const merged = mergeAdjacentChannelItems(items);
  const seen = new Set();
  return merged.filter((it) => {
    if (seen.has(it.telegramMessageId)) return false;
    seen.add(it.telegramMessageId);
    return it.body || it.hasMedia || (it.media && it.media.length);
  });
}

function parseRssChannel(xml, channelUsername) {
  const username = normalizeChannelUsername(channelUsername);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || "")))) {
    const block = m[1];
    const link =
      block.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() ||
      block.match(/<link[^>]+href="([^"]+)"/i)?.[1]?.trim();
    if (!link || !/t\.me\//i.test(link)) continue;
    const messageId = link.replace(/\/$/, "").split("/").pop();
    if (!messageId || !/^\d+$/.test(messageId)) continue;
    const title = decodeHtml(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const desc = decodeHtml(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "");
    const body = (desc || title || "").trim();
    items.push({
      telegramMessageId: messageId,
      body: body || "📎 Пост из Telegram",
      hasMedia: /photo|video|image|media/i.test(block),
      channelUsername: username,
    });
  }
  const seen = new Set();
  return items.filter((it) => {
    if (seen.has(it.telegramMessageId)) return false;
    seen.add(it.telegramMessageId);
    return true;
  });
}

async function fetchTgPreviewPage(url, attempt = 0) {
  const maxAttempts = 3;
  try {
    const res = await axios.get(url, {
      timeout: 45000,
      httpsAgent: tgAgent,
      headers: TG_HEADERS,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      responseType: "text",
    });
    const html = res.data;
    if (typeof html !== "string") {
      return { ok: false, error: "Пустой ответ" };
    }
    return { ok: true, html };
  } catch (e) {
    const retryable =
      /timeout|ETIMEDOUT|ECONNRESET|ECONNABORTED|socket hang up|ENOTFOUND|EAI_AGAIN/i.test(
        e.message || ""
      ) || e.code === "ECONNABORTED";
    if (retryable && attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return fetchTgPreviewPage(url, attempt + 1);
    }
    const msg =
      e.response?.status === 404
        ? "Канал не найден или приватный."
        : e.message || String(e);
    return { ok: false, error: msg };
  }
}

async function collectFromHtml(username, buildUrl, { limit = 40, maxPages = 2 }) {
  const collected = [];
  let cursor = null;
  let pages = 0;

  while (collected.length < limit && pages < maxPages) {
    const page = await fetchTgPreviewPage(buildUrl(cursor));
    if (!page.ok) {
      if (pages === 0) return { ok: false, error: page.error, items: [] };
      break;
    }
    const html = page.html;
    if (!html.includes("data-post=")) {
      if (pages === 0) return { ok: false, error: "Нет постов на странице", items: [] };
      break;
    }
    const batch = parsePublicChannelPage(html, username);
    if (!batch.length) break;
    for (const item of batch) {
      if (collected.length >= limit) break;
      if (!collected.some((x) => x.telegramMessageId === item.telegramMessageId)) {
        collected.push(item);
      }
    }
    const oldest = batch.reduce((min, it) => {
      const n = Number(it.telegramMessageId);
      return min == null || n < min ? n : min;
    }, null);
    if (oldest == null || String(oldest) === cursor) break;
    cursor = String(oldest);
    pages += 1;
  }

  collected.sort((a, b) => Number(b.telegramMessageId) - Number(a.telegramMessageId));
  return { ok: collected.length > 0, items: collected.slice(0, limit) };
}

async function collectFromRss(username, limit = 40) {
  const feeds = [
    `https://rsshub.app/telegram/channel/${username}`,
    `https://rsshub.rssforever.com/telegram/channel/${username}`,
  ];
  for (const feedUrl of feeds) {
    const page = await fetchTgPreviewPage(feedUrl);
    if (!page.ok || !page.html.includes("<item")) continue;
    const items = parseRssChannel(page.html, username)
      .sort((a, b) => Number(b.telegramMessageId) - Number(a.telegramMessageId))
      .slice(0, limit);
    if (items.length) return { ok: true, items, source: "rss" };
  }
  return { ok: false, items: [], error: "RSS недоступен" };
}

async function fetchPublicChannelMessages(channelUsername, { limit = 40, maxPages = 2 } = {}) {
  const username = normalizeChannelUsername(channelUsername);
  if (!username) return { ok: false, error: "Некорректный канал." };

  const htmlSources = [
    {
      name: "t.me",
      buildUrl: (cursor) =>
        cursor
          ? `https://t.me/s/${username}?before=${cursor}`
          : `https://t.me/s/${username}`,
    },
    {
      name: "mirror",
      buildUrl: (cursor) =>
        cursor
          ? `https://tg.i-c-a.su/s/${username}?before=${cursor}`
          : `https://tg.i-c-a.su/s/${username}`,
    },
  ];

  const errors = [];
  for (const src of htmlSources) {
    const result = await collectFromHtml(username, src.buildUrl, { limit, maxPages });
    if (result.ok && result.items.length) {
      return { ok: true, items: result.items, source: src.name };
    }
    if (result.error) errors.push(`${src.name}: ${result.error}`);
  }

  const rss = await collectFromRss(username, limit);
  if (rss.ok && rss.items.length) {
    return { ok: true, items: rss.items, source: rss.source };
  }
  errors.push(rss.error || "rss: пусто");

  return {
    ok: false,
    error:
      "Не удалось загрузить посты (t.me заблокирован или канал приватный). Проверьте @username, VPN или дождитесь нового поста от бота.",
    details: errors.join("; "),
    retryViaBrowser: true,
  };
}

function streamTgPreview(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: "GET",
        headers: TG_HEADERS,
        timeout: 90000,
        agent: tgAgent,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(res);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

async function pipeChannelPreview(channel, query, res) {
  const username = normalizeChannelUsername(channel);
  if (!username) {
    res.status(400).json({ error: "Некорректный канал" });
    return;
  }
  const qs = query.before ? `?before=${encodeURIComponent(String(query.before))}` : "";
  const path = `/s/${username}${qs}`;
  const hosts = ["t.me", "tg.i-c-a.su"];
  let lastErr = null;
  for (const host of hosts) {
    try {
      const upstream = await streamTgPreview(host, path);
      res.status(200);
      res.type("text/html; charset=utf-8");
      upstream.pipe(res);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  res.status(502).json({
    error: lastErr?.message || "Не удалось открыть превью канала",
  });
}

function importMessagesToInbox(db, userId, channelUsername, messages) {
  let imported = 0;
  let skipped = 0;
  for (const msg of messages) {
    const r = insertTelegramInbox(db, userId, {
      telegramMessageId: msg.telegramMessageId,
      body: msg.body,
      hasMedia: msg.hasMedia,
      media: msg.media || [],
      channelUsername,
    });
    if (r.duplicate) skipped += 1;
    else imported += 1;
  }
  return { imported, skipped, total: messages.length };
}

function importFromPreviewHtml(db, userId, channelUsername, html, limit = 40) {
  const items = parsePublicChannelPage(html, channelUsername)
    .sort((a, b) => Number(b.telegramMessageId) - Number(a.telegramMessageId))
    .slice(0, limit);
  return importMessagesToInbox(db, userId, channelUsername, items);
}

module.exports = {
  fetchTgPreviewPage,
  fetchPublicChannelMessages,
  importMessagesToInbox,
  importFromPreviewHtml,
  parsePublicChannelPage,
  pipeChannelPreview,
};
