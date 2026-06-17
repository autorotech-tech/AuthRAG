# GEMINI.md — Antigravity для AuthRAG / Bookmarks Bro

Настройки для **Google Antigravity** в репозитории [autorotech-tech/AuthRAG](https://github.com/autorotech-tech/AuthRAG).

## Первое действие в каждой сессии

1. Прочитать **[docs/ANTIGRAVITY-INFRA-BRIEF.md](./docs/ANTIGRAVITY-INFRA-BRIEF.md)** — БД, env, UI, Tauri, extension.
2. Прочитать **[ROADMAP.md](./ROADMAP.md)** — фазы, блокеры, acceptance criteria.
3. Прочитать **[Autoro/Strategy/Unified Knowledge Base Plan.md](./Autoro/Strategy/Unified%20Knowledge%20Base%20Plan.md)**.
3. При работе с API — grep `bookmarks` / `knowledge` в `agent-api/main.py`.
4. При работе с Obsidian — search vault: `Bookmarks Bro`, `Unified Knowledge Base`.

## Ветка и remotes

- Основная ветка разработки: **`bookmarks-bro`**
- Прод-стейджинг UI: `swoop.autoro.tech` (монорепо website)
- Этот репо — **срез** для фокусной разработки AuthRAG

## Skills (подключить из website monorepo)

```bash
# в корне website (если есть)
bash scripts/link-antigravity-skills.sh
```

| Задача | Skill |
|--------|-------|
| React UI | `modern-web-guidance`, `frontend-dev-guidelines` |
| Extension E2E | `playwright-skill` |
| API bugs | `systematic-debugging`, `cbh-debug-playbook` |
| Многофазный sprint | `antigravity-workflows` |

## OpenRouter (обязательно)

- Модели только: `<provider>/<model>` (например `anthropic/claude-3.7-sonnet`).
- Ключи — через Swoop Admin / `service_settings`, не в репозитории.

## Типовые команды

```bash
# Backend syntax
python3 -m py_compile agent-api/main.py

# Smoke (нужны env)
node scripts/bookmarks-bro-smoke.mjs

# Extension zip
cd extensions/bookmarks-bro && zip -r ../bookmarks-bro.zip .
```

## Правила для агента

- **Не** переходить к multi-tenant (Phase 2), пока не закрыты auth + taxonomy + EN UI (Phase 1).
- **Не** доверять `workspaceId` с клиента без JWT middleware.
- **Не** коммитить `.env`, API keys, `service_settings` dumps.
- Минимальный diff; не рефакторить Swoop-несвязанный код.
- После изменений фронта в website: `npm run build`.

## Постановка задачи

Используйте шаблон из раздела **«Шаблон задачи для Antigravity»** в [ROADMAP.md](./ROADMAP.md).
