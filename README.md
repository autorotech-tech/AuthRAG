# AuthRAG — Bookmarks Bro

**AuthRAG** — выделенный репозиторий продукта **Bookmarks Bro**: authenticated RAG поверх личной базы знаний (закладки, заметки, Telegram, Obsidian) с multi-tenant изоляцией через `workspace_id`.

Исходный монорепозиторий: [autoro.tech/website](https://github.com/autorotech-tech/website) (ветка `bookmarks-bro` здесь — срез для автономной разработки).

## Состав репозитория

| Путь | Назначение |
|------|------------|
| `src/bookmarksBro/` | React UI приложения (Search, Notes, Ideas, Reminders, Knowledge) |
| `src/components/AdminBookmarksBro.tsx` | Операторская панель Swoop |
| `agent-api/` | Backend: bookmarks, knowledge, embeddings, Obsidian sync |
| `extensions/bookmarks-bro/` | Chrome/Edge расширение для sync закладок |
| `ops/bookmarks-bro-supabase/` | Изолированный Supabase stack (Variant A) |
| `docs/` | Техдоки, тестирование, multi-user |
| `Autoro/Strategy/` | Стратегия единой KB (из Obsidian) |
| `ROADMAP.md` | **Главный план для Antigravity** |
| `GEMINI.md` | Настройки Google Antigravity |

## Быстрый старт (dev)

```bash
# Backend smoke (нужен Postgres + env из website)
cd agent-api && python -m py_compile main.py

# Extension package
cd extensions/bookmarks-bro && zip -r ../bookmarks-bro.zip .

# UI — собирается в контексте website (Vite); см. ROADMAP Phase 0
```

## Документация

- [ROADMAP.md](./ROADMAP.md) — фазы, критерии, задачи для агента
- [docs/bookmarks-bro/TESTING.md](./docs/bookmarks-bro/TESTING.md)
- [docs/bookmarks-bro/ADMIN-MULTIUSER.md](./docs/bookmarks-bro/ADMIN-MULTIUSER.md)
- [Autoro/Strategy/Unified Knowledge Base Plan.md](./Autoro/Strategy/Unified%20Knowledge%20Base%20Plan.md)

## Лицензия

Код наследует политику основного репозитория Autoro.tech.
