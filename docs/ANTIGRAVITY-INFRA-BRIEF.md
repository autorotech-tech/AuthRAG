# AuthRAG / Bookmarks Bro — инфраструктурный бриф для Antigravity

> **Аудитория:** Google Antigravity и другие автономные агенты.  
> **Репозиторий:** https://github.com/autorotech-tech/AuthRAG  
> **Ветка:** `bookmarks-bro`  
> **Связанные документы:** [ROADMAP.md](../ROADMAP.md), [GEMINI.md](../GEMINI.md), [AGENTS.md](../AGENTS.md)

---

## 0. Контекст репозитория

AuthRAG — **срез** продукта Bookmarks Bro (authenticated RAG поверх личной KB). Полная сборка UI и Tauri по-прежнему живёт в monorepo **`autoro.tech/website`**:

| Компонент | В AuthRAG | В website monorepo |
|-----------|-----------|-------------------|
| React UI (`src/bookmarksBro/`) | ✅ копия | ✅ источник правды + Vite routes |
| `agent-api/` | ✅ | ✅ |
| Chrome extension | ✅ | ✅ |
| Tauri (`src-tauri/`) | ❌ нет | ✅ |
| `package.json`, `vite.config.ts` | ❌ нет | ✅ |

Маршруты SPA: `/bookmarks-bro`, `/admin/bookmarks-bro` (см. `website/src/App.tsx`).

---

## 1. Инфраструктура БД

### 1.1 Важное исправление: не `DATABASE_URL`

**`DATABASE_URL` в `agent-api` не используется.** Подключение к PostgreSQL идёт через **отдельные переменные окружения**.

| Переменная | По умолчанию (код) | Назначение |
|------------|-------------------|------------|
| `PGHOST` | `supabase-db` | Хост основной БД |
| `PGPORT` | `5433` | Порт |
| `PGDATABASE` | `postgres` | Имя БД |
| `PGUSER` | `supabase_admin` | Пользователь |
| `PGPASSWORD` | *(в образе / env)* | Пароль |

Для **изолированного Bookmarks Bro Supabase (Variant A)** — отдельный набор:

| Переменная | Назначение |
|------------|------------|
| `BOOKMARKS_PGHOST` | Хост BB Postgres |
| `BOOKMARKS_PGPORT` | Порт (часто `5432` в docker-сети) |
| `BOOKMARKS_PGDATABASE` | `postgres` |
| `BOOKMARKS_PGUSER` | `postgres` или `supabase_admin` |
| `BOOKMARKS_PGPASSWORD` | Пароль BB-стека |

Если `BOOKMARKS_PGHOST` **не задан**, bookmarks-таблицы используют тот же Postgres, что и `PGHOST` (`bookmarks_pg_connect()` в `agent-api/main.py`).

**Пример:** `ops/bookmarks-bro-supabase/.env.agent-api.bookmarks.example`

### 1.2 pgvector и схема

RAG-пайплайн опирается на **PostgreSQL + расширение `vector` (pgvector)**.

1. Убедиться, что Postgres поддерживает `CREATE EXTENSION vector`.
2. Применить миграцию:
   ```bash
   psql -U postgres -d postgres -f migrate_bookmarks_bro_mvp.sql
   ```
3. Ключевые объекты:
   - `public.workspaces` (multi-tenant, RLS owner-only)
   - `bookmarks_bro_bookmarks`, `bookmark_page_content`, sync jobs
   - `knowledge_items`, `knowledge_vectors` — pipeline `captured → searchable`
   - `bookmark_page_content.embedding vector(1536)` — размерность **1536**, не менять без миграции

См. также: `Autoro/Architecture/Bookmarks Bro Mathematical Model.md`, `docs/bookmarks-bro/MATHEMATICAL-MODEL.md`.

### 1.3 Supabase (Auth + опционально отдельный стек)

**Предполагается активный инстанс Supabase/PostgreSQL.** Для prod Bookmarks Bro рекомендуется **отдельный self-hosted BB stack** (не общий Swoop KB).

| Переменная | Назначение |
|------------|------------|
| `BOOKMARKS_SUPABASE_URL` | Публичный URL Kong, напр. `https://swoop.autoro.tech/bb-supabase` |
| `BOOKMARKS_SUPABASE_ANON_KEY` | Anon key BB-проекта |
| `SUPABASE_URL` | Fallback для Auth, если `BOOKMARKS_*` пусты |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | Fallback anon key |

Развёртывание: `ops/bookmarks-bro-supabase/README.md` (`bootstrap.sh`, `recover_bb_stack.sh`, SQL `001_bookmarks_bro_isolation.sql`).

Подключение `agent-api` к BB-стеку:
```bash
docker compose \
  -f docker-compose.yml \
  -f ops/bookmarks-bro-supabase/docker-compose.agent-api.bookmarks.override.yml \
  up -d --build agent-api
```

### 1.4 RAG-пайплайн (backend)

```
Extension/UI → bootstrap Bearer → sync/start → worker → enrich → indexed/searchable
                                                      ↓
                                            pgvector(1536) + knowledge_items
```

| Эндпоинт | Роль |
|----------|------|
| `POST /api/v1/bookmarks/bootstrap` | Короткоживущий Bearer для extension (без client API key) |
| `POST /api/v1/bookmarks/sync/start` | Ingest закладок |
| `POST /api/v1/bookmarks/worker/run` | Fetch контента страниц |
| `POST /api/v1/bookmarks/enrich/run` | LLM summary + embeddings |
| `POST /api/v1/bookmarks/pipeline/run` | Orchestration demo-потока |
| `POST /api/v1/knowledge/search` | Semantic/text/hybrid search |
| `POST /api/v1/bookmarks/ai-recommend` | RAG recommend по задаче |
| `POST /api/v1/bookmarks/workspaces/ensure` | Auto-provision workspace |

**LLM / embeddings:** ключи из `public.service_settings` (Swoop Admin), fallback `OPENAI_API_KEY`. OpenRouter-модели только в формате `<provider>/<model>`. См. `agent-api/ENV.md`.

### 1.5 Проверка БД и API

```bash
python3 -m py_compile agent-api/main.py
node scripts/bookmarks-bro-smoke.mjs
node scripts/bookmarks-bro-api-test.mjs
```

Ожидание: `GET /api/v1/bookmarks/workspaces` с невалидным ключом → **401** (роут существует), не 404.

---

## 2. Фронтенд: React UI

### 2.1 Где код и где сборка

| Путь | Содержимое |
|------|------------|
| `src/bookmarksBro/BookmarksBroApp.tsx` | Основное приложение (Search, Notes, Ideas, Reminders, KB) |
| `src/bookmarksBro/services.ts` | API client, workspace resolve, UI sync |
| `src/bookmarksBro/agentApiBase.ts` | Base URL для agent-api |
| `src/components/AdminBookmarksBro.tsx` | Операторская панель (не end-user UI) |

**Сборка:** из monorepo `website` (Vite), не из AuthRAG standalone.

```bash
cd /path/to/website
npm run dev
# http://localhost:5173/bookmarks-bro
```

Prod: `https://swoop.autoro.tech/bookmarks-bro`

### 2.2 Переменные окружения (фронт, в корне `website`)

```env
# Пусто = относительные пути /api/v1 (prod: nginx на том же домене)
VITE_AGENT_API_BASE=

# Только npm run dev — куда проксировать /api/v1
VITE_AGENT_API_PROXY_TARGET=http://127.0.0.1:8900

# BB Supabase Auth (не основной Swoop Supabase для prod BB)
VITE_SUPABASE_URL=https://swoop.autoro.tech/bb-supabase
VITE_SUPABASE_ANON_KEY=<bb_anon_key>

# Переходный период; предпочтительный путь extension/UI — bootstrap token
VITE_BOOKMARKS_API_KEY=<agent_api_key_from_service_settings>
```

Логика `agentApiBase.ts`:
- `VITE_AGENT_API_BASE` пуст → запросы на `/api/v1/*` относительно текущего origin.
- Явный URL → для Tauri, extension webview, отдельного CDN.

### 2.3 Auth (Phase 1 blockers)

До multi-tenant (ROADMAP Phase 2) закрыть:

| Блокер | Действие |
|--------|----------|
| Google OAuth `redirect_uri_mismatch` | Supabase redirect + Google Console; `VITE_AUTH_REDIRECT_TO` |
| Email/password `401` | BB anon key, правильный `VITE_SUPABASE_URL` |
| EN UI | перевод строк в `BookmarksBroApp.tsx` |

OAuth redirect для extension: `chrome-extension://<ID>/oauth-callback.html` — см. `agent-api/ENV.md`, `extensions/bookmarks-bro/SUPABASE_OAUTH_SETUP.md`.

---

## 3. Tauri (desktop)

**В AuthRAG нет `src-tauri/`.** Desktop shell — только в **`website/src-tauri/`**.

```bash
cd /path/to/website
npm run tauri dev
# или
npm run tauri build
```

Для Tauri webview обязательно задать при сборке:
```env
VITE_AGENT_API_BASE=https://swoop.autoro.tech
```
Иначе относительные `/api/v1` не достигнут `agent-api`.

---

## 4. Chrome extension

Пакет: `extensions/bookmarks-bro/` (в AuthRAG полный).

### 4.1 Конфигурация

`extension-config.js`:

```javascript
apiBaseDefault: 'https://swoop.autoro.tech',
supabaseAuthPathDefault: '/bb-supabase',
webAppPath: '/bookmarks-bro',
workspaceIdFallback: '1',  // до ensure/workspace resolve
build: '0.1.1-testing',
```

В popup Settings (или baked defaults):
- **API Base** → `https://swoop.autoro.tech`
- **Supabase Auth Path** → `/bb-supabase`

### 4.2 Auth flow (no client API key)

1. Extension вызывает `POST /api/v1/bookmarks/bootstrap` (HMAC, TTL, IP-bound).
2. Получает Bearer token (`bookmarks:ingest`).
3. Все ingest-запросы: `Authorization: Bearer <token>`, **не** `X-API-Key`.

Admin/оператор: `X-API-Key` из `service_settings.agent_api_key` (только Swoop admin / scripts).

### 4.3 Установка и тест

```bash
# Chrome → chrome://extensions → Load unpacked → extensions/bookmarks-bro/
cd extensions/bookmarks-bro && zip -r ../bookmarks-bro.zip .
```

**Manifest:** `version` только semver (`0.3.1`). Суффикс `-testing` только в `extension-config.js` build label, **не** в `manifest.json`.

Документация: `docs/bookmarks-bro/TESTING.md`, `extensions/bookmarks-bro/TESTING.md`.

### 4.4 OAuth (Google / Microsoft)

1. Supabase Dashboard → включить провайдеры.
2. Redirect URL: `chrome-extension://<EXTENSION_ID>/oauth-callback.html`
3. См. `extensions/bookmarks-bro/SUPABASE_OAUTH_SETUP.md`

---

## 5. Чеклист готовности инфраструктуры

- [ ] `migrate_bookmarks_bro_mvp.sql` применён; `vector` extension OK
- [ ] `agent-api` подключается к Postgres (`PG*` или `BOOKMARKS_PG*`)
- [ ] BB Supabase Auth: `BOOKMARKS_SUPABASE_URL` + anon key
- [ ] Nginx: `/api/v1` → agent-api, `/bb-supabase` → BB Kong (если Variant A)
- [ ] `GET /api/v1/bookmarks/workspaces` → 401 с bad key (не 404)
- [ ] UI: `/bookmarks-bro` открывается (dev или swoop)
- [ ] Extension: bootstrap 200 → sync/pipeline 200
- [ ] (опционально) Tauri build из `website` с `VITE_AGENT_API_BASE`

---

## 6. Ограничения для агента

1. **Не** искать и не добавлять `DATABASE_URL` — использовать `PG*` / `BOOKMARKS_PG*`.
2. **Не** считать AuthRAG полностью автономным SPA — UI собирается из `website`.
3. **Не** хранить admin API keys в extension.
4. **Не** начинать ROADMAP Phase 2 (multi-tenant), пока не закрыты Phase 1 blockers (auth, taxonomy, EN UI).
5. Минимальный diff; секреты только через env / CI, не в git.
6. После изменений API: `python3 -m py_compile agent-api/main.py`.
7. После изменений UI в website: `npm run build`.

---

## 7. Ссылки

| Документ | Путь |
|----------|------|
| Roadmap | [ROADMAP.md](../ROADMAP.md) |
| Antigravity settings | [GEMINI.md](../GEMINI.md) |
| Agent rules | [AGENTS.md](../AGENTS.md) |
| agent-api env | [agent-api/ENV.md](../agent-api/ENV.md) |
| BB Supabase ops | [ops/bookmarks-bro-supabase/README.md](../ops/bookmarks-bro-supabase/README.md) |
| Multi-user model | [docs/bookmarks-bro/ADMIN-MULTIUSER.md](./bookmarks-bro/ADMIN-MULTIUSER.md) |
| KB + Obsidian | [docs/local-kb-and-obsidian.md](./local-kb-and-obsidian.md) |
| Unified KB strategy | [Autoro/Strategy/Unified Knowledge Base Plan.md](../Autoro/Strategy/Unified%20Knowledge%20Base%20Plan.md) |

---

*Версия брифа: 2026-06-16. При расхождении с кодом — приоритет у `agent-api/main.py` и `ROADMAP.md`.*
