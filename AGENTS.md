# AGENTS.md — AuthRAG / Bookmarks Bro

Универсальные правила для агентов (Cursor, Antigravity, Claude Code). Продуктовый контекст — **authenticated RAG** для личной базы знаний.

## Стек

| Область | Выбор |
|---------|--------|
| UI | React 18, TypeScript, Tailwind (сборка в monorepo website / Vite) |
| API | Python FastAPI (`agent-api/main.py`) |
| DB | Postgres + pgvector; опционально изолированный Supabase BB |
| Extension | Chrome MV3 (`extensions/bookmarks-bro`) |
| Sync | Obsidian vault на VPS, Syncthing |

## Обязательно читать перед кодом

1. [ROADMAP.md](./ROADMAP.md)
2. [GEMINI.md](./GEMINI.md) — если Antigravity
3. [docs/bookmarks-bro/ADMIN-MULTIUSER.md](./docs/bookmarks-bro/ADMIN-MULTIUSER.md) — при auth/workspace

## Ограничения

- Минимальные правки по задаче.
- Секреты только через env / CI secrets.
- OpenRouter: полный ID модели `<provider>/<model>`.
- Workspace isolation — не ослаблять.

## Проверки

- API: `python3 -m py_compile agent-api/main.py`
- UI (в website): `npm run build`
- Extension: `docs/bookmarks-bro/TESTING.md`

## Obsidian memory protocol

При старте сложной задачи: `search_vault` → `Bookmarks Bro`, `Unified Knowledge Base`.  
После milestone: обновить заметку `Autoro/Bookmarks Bro Progress` в vault.
