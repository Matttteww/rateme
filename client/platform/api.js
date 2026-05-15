export async function api(path, options = {}) {
  const { signal, ...rest } = options;
  const r = await fetch(path, {
    credentials: "include",
    signal,
    ...rest,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!r.ok) {
    const isHtml = /<!DOCTYPE|<html/i.test(text);
    const pre = text.match(/<pre[^>]*>([^<]+)<\/pre>/i);
    const raw = pre ? pre[1].trim() : "";
    let message = data.error;
    if (isHtml || (message && /<!DOCTYPE|<html/i.test(String(message)))) {
      if (r.status === 404 && /Cannot (GET|PATCH|POST|DELETE)/i.test(raw)) {
        message =
          "На сервере нет этого API. Остановите npm run dev (Ctrl+C) и запустите снова — нужен перезапуск бэкенда.";
      } else {
        message = raw || `Ошибка ${r.status}`;
      }
    }
    throw new Error(message || `Ошибка ${r.status}`);
  }
  return data;
}
