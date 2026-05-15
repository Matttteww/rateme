/** Нормализация объекта пользователя Telegram (postMessage или JSON). */
export function normalizeTelegramPayload(raw) {
  if (!raw?.hash || raw.id == null) return null;
  return {
    id: String(raw.id),
    first_name: raw.first_name || "",
    last_name: raw.last_name || "",
    username: raw.username || "",
    photo_url: raw.photo_url || "",
    auth_date: raw.auth_date != null ? String(raw.auth_date) : "",
    hash: raw.hash,
  };
}

function decodeTgAuthResult(encoded) {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const json = JSON.parse(atob(b64));
  return normalizeTelegramPayload(json);
}

export function parseTelegramHash(hash) {
  const h = (hash || "").replace(/^#/, "");
  if (!h) return null;

  let encoded = null;
  if (h.startsWith("tgAuthResult=")) {
    encoded = h.slice("tgAuthResult=".length).split("&")[0];
  } else {
    encoded = new URLSearchParams(h).get("tgAuthResult");
  }
  if (!encoded) return null;

  try {
    return decodeTgAuthResult(encoded);
  } catch {
    return null;
  }
}

/** Данные callback: #tgAuthResult=… или ?id=&hash=… */
export function getTelegramCallbackData() {
  const search = new URLSearchParams(window.location.search);
  if (search.get("hash") && search.get("id")) {
    return normalizeTelegramPayload({
      id: search.get("id"),
      first_name: search.get("first_name") || "",
      last_name: search.get("last_name") || "",
      username: search.get("username") || "",
      photo_url: search.get("photo_url") || "",
      auth_date: search.get("auth_date"),
      hash: search.get("hash"),
    });
  }
  return parseTelegramHash(window.location.hash);
}

export function clearTelegramCallbackUrl() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.startsWith("tgAuthResult=") && !new URLSearchParams(window.location.search).get("id")) {
    return;
  }
  const next = `${window.location.pathname}#/feed`;
  window.history.replaceState({}, "", next);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function clearTelegramAuthState() {
  try {
    sessionStorage.removeItem("bottwich_tg_last_hash");
  } catch {
    /* */
  }
}

export function wasTelegramHashProcessed(hash) {
  try {
    return sessionStorage.getItem("bottwich_tg_last_hash") === hash;
  } catch {
    return false;
  }
}

export function markTelegramHashProcessed(hash) {
  try {
    sessionStorage.setItem("bottwich_tg_last_hash", hash);
  } catch {
    /* */
  }
}
