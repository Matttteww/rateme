const MEDIA_TABLE = {
  releases: "releases",
  beats: "beats",
  openvers: "openvers",
};

function safeFileName(title, ext = "mp3") {
  const base = String(title || "audio")
    .replace(/[<>:"/\\|?*]+/g, "")
    .trim()
    .slice(0, 120);
  return `${base || "audio"}.${ext}`;
}

export async function downloadMediaItem(item, mediaType) {
  const table = MEDIA_TABLE[mediaType];
  if (!table) throw new Error("Неизвестный тип.");

  if (item.audio?.kind === "yandex" || item.audio?.openExternal) {
    window.open(item.audio.url, "_blank", "noopener,noreferrer");
    return;
  }

  if (item.audio?.kind !== "file") throw new Error("Нет файла для скачивания.");

  const r = await fetch(`/api/media/${table}/${item.id}/download`, { credentials: "include" });
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try {
      const j = await r.json();
      if (j.error) msg = j.error;
    } catch {
      /* */
    }
    throw new Error(msg);
  }

  const blob = await r.blob();
  const disp = r.headers.get("Content-Disposition") || "";
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disp);
  let name = match ? decodeURIComponent(match[1].replace(/"/g, "")) : safeFileName(item.title);
  if (!/\.\w{2,5}$/i.test(name)) name = safeFileName(item.title);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
