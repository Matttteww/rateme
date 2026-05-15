const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { newId } = require("./authUtil");
const { TELEGRAM_BOT_TOKEN } = require("./telegramBot");
const { normalizeChannelUsername } = require("./telegramChannel");

function fetchTgPreviewPage(url, attempt) {
  return require("./telegramChannelHistory").fetchTgPreviewPage(url, attempt);
}

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "data", "uploads", "tg-inbox");

const TG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Referer: "https://t.me/",
};

function ensureTgInboxDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function guessKindFromPath(filePath, mime, url) {
  const ext = path.extname(filePath || url || "").toLowerCase();
  if (mime?.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return "image";
  if (mime?.startsWith("video/") || [".mp4", ".webm", ".mov"].includes(ext)) return "video";
  if (mime?.startsWith("audio/") || [".mp3", ".ogg", ".m4a", ".wav", ".opus"].includes(ext)) return "audio";
  if (/\.(mp4|webm)/i.test(url || "")) return "video";
  return "file";
}

function parseMediaJson(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function mergeMediaLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const m of list || []) {
      const fp = String(m.filePath || "").trim();
      const ur = String(m.url || "").trim();
      const fid = String(m.telegramFileId || "").trim();
      const key =
        (fp && `fp:${fp}`) ||
        (ur && `url:${ur}`) ||
        (fid && `tg:${fid}`) ||
        (m.placeholder || m.stickerPlaceholder
          ? `ph:${m.kind || "unknown"}:${m.stickerPlaceholder ? "sticker" : "generic"}`
          : null);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

function mediaHasPlayable(list) {
  return (list || []).some((m) => m.url || m.filePath);
}

function normalizeMediaInput(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((m) => ({
      kind: ["image", "video", "audio", "file"].includes(m?.kind) ? m.kind : "file",
      url: m?.url ? String(m.url).trim() : null,
      telegramFileId: m?.telegramFileId ? String(m.telegramFileId).trim() : null,
      thumbUrl: m?.thumbUrl ? String(m.thumbUrl).trim() : null,
      mime: m?.mime || null,
    }))
    .filter((m) => m.url || m.telegramFileId);
}

function addMediaUrl(media, url, kindHint) {
  let u = String(url || "")
    .replace(/\\'/g, "")
    .replace(/&amp;/g, "&")
    .trim();
  if (u.startsWith("//")) u = `https:${u}`;
  if (!u.startsWith("http")) return;
  if (media.some((m) => m.url === u)) return;
  const kind =
    kindHint ||
    (/\/(video|vid)/i.test(u) || /\.(mp4|webm|mov)(\?|$)/i.test(u)
      ? "video"
      : /\.(mp3|ogg|m4a|wav|opus|oga)(\?|$)/i.test(u)
        ? "audio"
        : "image");
  media.push({ kind, url: u });
}

/** Тексты-подписи виджета без смысла (не как пользовательская подпись к альбому). */
const TG_WIDGET_DUMMY_TEXT = /^(audio|аудио|voice|голосовое|видеосообщение|video|видео|document|файл|file|sticker|стикер|photo|фото|picture|GIF|gif|animation|😀+|…+|\.{2,})$/iu;

/** Тексты служебных подписей t.me без реального текста пользователя → заставляем has_media для enrich */
function inboxBodySignalsMissingRichMedia(body) {
  let b = String(body || "").replace(/^[\uFEFF\s\u200B\u00A0]+|[\uFEFF\s\u200B\u00A0]+$/g, "").trim();
  // «Audio», «Sticker» без переносов / с пробелами
  b = b.replace(/\s+/g, " ").trim();
  if (!b || b.length > 140) return false;
  const shortLabel = /^(.{1,40})$/u.exec(b)?.[1] || "";
  if (TG_WIDGET_DUMMY_TEXT.test(shortLabel)) return true;
  // Латиница кириллицей или наоборот в одном слове
  if (/^(аудио|голосовое|видеофайл|анимация)$/iu.test(b)) return true;
  return false;
}

function sanitizeInboxBodyForApi(body, htmlSnippet = "") {
  return normalizePublicChannelBody(body, htmlSnippet);
}

/** Есть слот медиа (DOM / превью), не обязательно с уже извлечённым URL */
function itemHasMediaSlot(it) {
  if (!it) return false;
  const list = it.media || [];
  if (list.some((m) => m.telegramFileId || m.url || m.placeholder || m.stickerPlaceholder)) return true;
  return Boolean(it.hasMedia);
}

function isCaptionOnlyTextPost(it) {
  if (!it || itemHasMediaSlot(it)) return false;
  const b = String(it.body || "").trim();
  if (!b) return false;
  if (TG_WIDGET_DUMMY_TEXT.test(b)) return false;
  return true;
}

function normalizePublicChannelBody(body, htmlBlock) {
  let b = String(body || "").replace(/^[\uFEFF\s\u200B\u00A0]+|[\uFEFF\s\u200B\u00A0]+$/g, "");
  b = b.replace(/\s+/g, " ").trim();
  if (TG_WIDGET_DUMMY_TEXT.test(b)) b = "";
  if (
    !b &&
    /\btgme_widget_message_(voice|document|roundvideo)|\b(message_audio|message_sticker|js-message_voice)\b/i.test(
      String(htmlBlock || "")
    )
  ) {
    b = "";
  }
  return b.trim();
}

function parseMediaFromHtmlBlock(block) {
  const media = [];
  const html = String(block || "");

  for (const m of html.matchAll(/<meta[^>]+property=["']og:(image|video|audio)["'][^>]+content=["']([^"']+)["']/gi)) {
    const prop = String(m[1] || "").toLowerCase();
    const u = m[2];
    if (!u || !/^https?:\/\//i.test(u)) continue;
    addMediaUrl(
      media,
      u,
      prop === "audio" ? "audio" : prop === "video" ? "video" : "image"
    );
  }

  for (const m of html.matchAll(/background-image:\s*url\(\s*['"]?([^'")\s]+)/gi)) {
    addMediaUrl(media, m[1], "image");
  }
  for (const m of html.matchAll(/url\(\s*['"]?(https?:\/\/[^'")\s]+)/gi)) {
    const u = m[1];
    if (/telesco\.pe|telegram\.org\/file|telegram-cdn(?:\.|$)|cdn\d|\.(jpg|jpeg|png|webp|gif|webm)(\?|$)/i.test(u)) {
      addMediaUrl(
        media,
        u,
        /\.(mp3|oga|ogg|m4a|opus|wav)(\?|$)/i.test(u)
          ? "audio"
          : /\.(mp4|webm|mov)(\?|$)/i.test(u)
            ? "video"
            : "image"
      );
    }
  }
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)/gi)) {
    const u = m[1];
    const kind = /\.(mp3|oga|ogg|m4a)(\?|$)/i.test(u) ? "audio" : "image";
    addMediaUrl(media, u, kind);
  }
  for (const m of html.matchAll(/<video[^>]+src=["']([^"']+)/gi)) {
    addMediaUrl(media, m[1], "video");
  }
  for (const m of html.matchAll(/<source[^>]+src=["']([^"']+)/gi)) {
    addMediaUrl(media, m[1], "video");
  }
  if (
    /\btgme_widget_message_video\b|tgme_widget_message_video_player|js-message_video|message_video|roundvideo/i.test(
      html
    ) &&
    !media.some((x) => x.kind === "video")
  ) {
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(mp4|webm)/gi)) {
      addMediaUrl(media, m[0], "video");
    }
  }
  if (
    /tgme_widget_message_voice|message_voice|audio_element|tgme_widget_message_document|message_audio|tgme_widget_message_music|audio_file|music_file|\bota_audio|\.oga|\.ogg|\.opus|\.mp3/i.test(html)
  ) {
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(ogg|oga|opus|mp3|m4a|wav)/gi)) {
      addMediaUrl(media, m[0], "audio");
    }
    if (!media.some((x) => x.kind === "audio")) {
      media.push({ kind: "audio", url: null, placeholder: true });
    }
  }
  if (/tgme_widget_message_sticker|message_sticker|js-message_sticker|tgme_widget_message_animated_sticker/i.test(html)) {
    const had = media.length;
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(webp|webm|png)/gi)) {
      if (/telegram-cdn|telesco|cdn\d/i.test(m[0])) addMediaUrl(media, m[0], "image");
    }
    if (media.length === had) media.push({ kind: "image", url: null, placeholder: true, stickerPlaceholder: true });
  }

  /* В «неподдерживаемых» сообщениях t.me текстом может быть только «Audio» без отдельного класса. */
  const labelAudio =
    /\btext_not_supported_wrap\b/i.test(html) &&
    />\s*[Aa][uU][dD][iI][oO]\s*</.test(html) &&
    !/tgme_widget_message_photo|tgme_widget_message_video_player|js-message_photo/i.test(html);
  if (labelAudio && !media.some((x) => x.kind === "audio")) {
    media.push({ kind: "audio", url: null, placeholder: true });
  }

  return media;
}

async function fetchMessageEmbedMedia(channelUsername, messageId) {
  const channel = normalizeChannelUsername(channelUsername);
  if (!channel || !messageId) return [];
  const urls = [
    `https://t.me/${channel}/${messageId}?embed=1&mode=tme`,
    `https://t.me/${channel}/${messageId}?single`,
    `https://t.me/s/${channel}/${messageId}`,
  ];
  let best = [];
  for (const url of urls) {
    const page = await fetchTgPreviewPage(url);
    if (!page.ok) continue;
    const found = parseMediaFromHtmlBlock(page.html);
    if (found.length > best.length) best = found;
    if (mediaHasPlayable(found)) return found;
  }
  return best;
}

async function enrichInboxMedia(db, userId, channelUsername, { limit = 50, maxMs = 42000 } = {}) {
  const channel = normalizeChannelUsername(channelUsername);
  if (!channel) return { enriched: 0 };

  function rowNeedsEnrichment(row) {
    const current = parseMediaJson(row.media_json);
    if (mediaHasPlayable(current)) return false;
    if (Number(row.has_media) === 1) return true;
    if (inboxBodySignalsMissingRichMedia(String(row.body || ""))) return true;
    const raw = String(row.media_json || "");
    return raw.includes('"placeholder":true') || raw.includes('"stickerPlaceholder":true');
  }

  const pool = db
    .prepare(
      `SELECT * FROM telegram_inbox WHERE user_id = ?
       ORDER BY CAST(telegram_message_id AS INTEGER) DESC LIMIT 240`
    )
    .all(userId);
  const rows = pool.filter(rowNeedsEnrichment).slice(0, Math.min(limit || 48, 48));

  const started = Date.now();
  let enriched = 0;
  for (const row of rows) {
    if (Date.now() - started > maxMs) break;
    const current = parseMediaJson(row.media_json);
    if (mediaHasPlayable(current)) continue;

    let found = await fetchMessageEmbedMedia(channel, row.telegram_message_id);
    if (!found.length) {
      const page = await fetchTgPreviewPage(`https://t.me/s/${channel}`);
      if (page.ok) {
        const needle = `data-post="${channel}/${row.telegram_message_id}"`;
        let idx = page.html.indexOf(needle);
        if (idx < 0) idx = page.html.indexOf(`data-post='${channel}/${row.telegram_message_id}'`);
        if (idx >= 0) {
          const slice = page.html.slice(idx, idx + 22000);
          found = parseMediaFromHtmlBlock(slice);
        }
      }
    }
    if (!found.length) continue;

    const merged = mergeMediaLists(current, found);
    const nextBody =
      mediaHasPlayable(merged) && inboxBodySignalsMissingRichMedia(String(row.body || ""))
        ? sanitizeInboxBodyForApi(row.body, "")
        : row.body;

    db.prepare("UPDATE telegram_inbox SET media_json = ?, has_media = 1, body = ? WHERE id = ?").run(
      JSON.stringify(merged),
      String(nextBody || "").trim(),
      row.id
    );
    enriched += 1;
    if (Date.now() - started > maxMs) break;
    await new Promise((r) => setTimeout(r, 35));
  }
  return { enriched, timedOut: Date.now() - started > maxMs };
}

function isAllowedRemoteMediaUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host.includes("telesco.pe") ||
      host.includes("telegram.org") ||
      host.includes("telegram-cdn") ||
      host.includes("t.me") ||
      host.includes("telegra.ph") ||
      /^cdn\d*\./.test(host)
    );
  } catch {
    return false;
  }
}

async function downloadTelegramFile(fileId) {
  if (!TELEGRAM_BOT_TOKEN || !fileId) return null;
  ensureTgInboxDir();
  try {
    const gf = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile`, {
      params: { file_id: fileId },
      timeout: 30000,
    });
    if (!gf.data?.ok || !gf.data.result?.file_path) return null;
    const tgPath = gf.data.result.file_path;
    const ext = path.extname(tgPath) || ".bin";
    const localName = `${newId()}${ext}`;
    const full = path.join(UPLOAD_ROOT, localName);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${tgPath}`;
    const bin = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 120000 });
    fs.writeFileSync(full, bin.data);
    const kind = guessKindFromPath(tgPath, null, fileUrl);
    return { kind, filePath: `tg-inbox/${localName}`, url: `/uploads/tg-inbox/${localName}` };
  } catch {
    return null;
  }
}

async function resolveMediaList(mediaList) {
  const out = [];
  for (const m of mediaList) {
    if (m.telegramFileId) {
      const dl = await downloadTelegramFile(m.telegramFileId);
      if (dl) {
        out.push({ kind: dl.kind, filePath: dl.filePath, url: dl.url, telegramFileId: m.telegramFileId });
        if (m.kind === "video" && m.thumbFileId) {
          const thumb = await downloadTelegramFile(m.thumbFileId);
          if (thumb) out.push({ kind: "image", filePath: thumb.filePath, url: thumb.url, isThumb: true });
        }
        continue;
      }
    }
    if (m.url) out.push({ kind: m.kind || "image", url: m.url, filePath: null });
    else if (m.placeholder || m.stickerPlaceholder)
      out.push({
        kind: m.kind || "image",
        url: null,
        placeholder: Boolean(m.placeholder),
        stickerPlaceholder: Boolean(m.stickerPlaceholder),
      });
  }
  return out;
}

function proxyMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith("/uploads/") || url.startsWith("/api/")) return url;
  if (/^https?:\/\//i.test(url) && isAllowedRemoteMediaUrl(url)) {
    return `/api/telegram/remote-media?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function mapMediaForApi(mediaList) {
  return (mediaList || []).map((m) => ({
    kind: m.kind || "file",
    url: m.url ? proxyMediaUrl(m.url) : m.filePath ? `/uploads/${m.filePath}` : null,
    originalUrl: m.url || null,
    placeholder: Boolean(m.placeholder),
    stickerPlaceholder: Boolean(m.stickerPlaceholder),
  }));
}

function copyMediaToWallAttachments(db, postId, mediaList) {
  if (!mediaList?.length) return;
  const ins = db.prepare(
    `INSERT INTO wall_attachments (id, post_id, kind, file_path, url, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  );
  let order = 0;
  for (const m of mediaList) {
    if (m.isThumb) continue;
    if (m.placeholder) continue;
    const kind = m.kind || "file";
    const filePath = m.filePath || null;
    let url = filePath ? null : m.url || null;
    if (url && isAllowedRemoteMediaUrl(url)) url = proxyMediaUrl(url);
    if (!filePath && !url) continue;
    ins.run(newId(), postId, kind, filePath, url, order++);
  }
}

module.exports = {
  parseMediaJson,
  parseMediaFromHtmlBlock,
  normalizePublicChannelBody,
  sanitizeInboxBodyForApi,
  inboxBodySignalsMissingRichMedia,
  normalizeMediaInput,
  mergeMediaLists,
  mediaHasPlayable,
  itemHasMediaSlot,
  isCaptionOnlyTextPost,
  resolveMediaList,
  mapMediaForApi,
  proxyMediaUrl,
  copyMediaToWallAttachments,
  enrichInboxMedia,
  fetchMessageEmbedMedia,
  isAllowedRemoteMediaUrl,
  TG_HEADERS,
};
