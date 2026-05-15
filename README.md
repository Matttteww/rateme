# bottwich / РЭЙТМИ

Веб-приложение для стрима (Twitch, чат, оценки) и социальной платформы (профили, лента, треки, openvers, биты, ЛС, игры).

## Требования

- Node.js 22+ (нужен встроенный `node:sqlite`)
- .NET 8 — для Telegram-бота `бот тг/ChannelFileBot` (опционально)

## Быстрый старт (разработка)

1. Скопируй `.env.example` → `.env` и заполни переменные.
2. Установи зависимости и запусти:

```powershell
npm install
npm run dev
```

3. Открой http://localhost:5173 (Vite). API и WebSocket — порт **3847**.

## Роли и доступ

| Действие | Гость | После регистрации |
|----------|-------|-------------------|
| Смотреть ленту, треки, openvers, биты | да | да |
| Скачивать openvers/биты | нет | да |
| Посты, ЛС, загрузки, оценка, Царь SC | нет | да |
| Вкладки стримера (каталог TG, очередь DA) | нет | только `is_streamer` |

Логин стримера задаётся в `.env`: `STREAMER_USERNAME` (или `TWITCH_TOKEN_OWNER_LOGIN`).

## Платформа (ТЗ v1.3)

- **Треки** — релизы: оценка 0–10, топ, «Царь SC»
- **Openvers / Биты** — отдельные разделы, без оценки и игры
- **Лента и стена** — посты, лайки, комментарии, репосты, подписки
- **Поиск и обзор** — вкладки в соцсети
- **Telegram** — вход через виджет, привязка канала, импорт поста (стример)
- **Уведомления** — в реальном времени через WebSocket `/ws`

## Синхронизация с ботом

В `.env` и `бот тг/ChannelFileBot/appsettings.json` один секрет: `BOTTWICH_SYNC_SECRET` / `BottwichSyncSecret`.

| Endpoint | Назначение |
|----------|------------|
| `POST /api/tracks/from-telegram` | Трек из бота → каталог стримера |
| `POST /api/sync/wall-post` | Пост канала → лента стримера |

Бот должен быть **админом канала**. На сайте в **Настройки → Telegram-канал** укажите @канал — подтянутся подписчики и статус бота.

В appsettings бота:

- `BottwichStreamerUsername` — логин стримера на сайте
- `BottwichWallSyncUrl` — URL wall-sync (по умолчанию выводится из `BottwichSyncUrl`)
- `BottwichUsePlatformChannel`: `true` — канал берётся с сайта (`GET /api/sync/streamer-config`), не дублируйте в `ChannelUsername`

## Продакшен

```powershell
npm run build
npm start
```

Один процесс Node отдаёт API, WebSocket, `/uploads` и статику из `dist/client` на `PORT` (3847).

Рекомендуется reverse proxy (nginx/Caddy) с HTTPS. Cookie сессии: `sameSite=lax`, `httpOnly`.

### Админ

```powershell
node server/scripts/promoteAdmin.js username
```

## Структура

- `server/index.js` — Express, Twitch, WS, монтирование платформы
- `server/platform/` — SQLite, auth, API соцсети
- `client/platform/` — React UI соцсети
- `client/TrackArchive.jsx` — каталог TG (стример)
- `data/platform.db` — БД платформы
- `data/tracks.json` — каталог стримера

## Twitch

См. `.env.example`: Client ID/Secret, user token со scope `chat:read` и `moderator:read:chatters`. OAuth Twitch для пользователей сайта в MVP не используется.
