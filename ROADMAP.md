# AuthRAG / Bookmarks Bro — ROADMAP для Antigravity

> **Версия:** 2026-06-16  
> **Статус:** active / in_progress  
> **Источник правды:** Obsidian vault (`Autoro/Bookmarks Bro *`, `Unified Knowledge Base Plan`) + этот репозиторий  
> **Целевой хостинг:** `swoop.autoro.tech` (dev/staging) → отдельный домен prod (migration-ready)

---

## 0. Контекст для агента

### Что такое AuthRAG / Bookmarks Bro

Продукт **Bookmarks Bro** — клиентский слой **authenticated RAG**:

- пользователь сохраняет знания из браузера, Telegram, ручного ввода;
- `agent-api` нормализует, обогащает, индексирует в Postgres + pgvector;
- заметки синхронизируются в Obsidian (`Autoro KB/ws-{workspace_id}`);
- UI даёт semantic search, идеи, reminders, экспорт KB.

**AuthRAG** — имя репозитория для автономной разработки этого контура без всего Swoop.

### Архитектурные инварианты (не нарушать)

1. **Single Source of Truth:** metadata + pipeline state в Postgres (`knowledge_items`, `knowledge_vectors`, bookmarks tables).
2. **Pipeline:** `captured → enriched → indexed → searchable` (см. математическую модель).
3. **Tenant isolation:** числовой `workspace_id`; Obsidian path `Autoro KB/ws-{id}`; API не должен доверять client-only `workspaceId` без JWT check.
4. **Variant A:** отдельный self-hosted Supabase для BB (`ops/bookmarks-bro-supabase/`).
5. **Extension auth:** bootstrap Bearer token (`POST /api/v1/bookmarks/bootstrap`), не хранить admin API key в расширении.
6. **OpenRouter:** модели только в формате `<provider>/<model>` (если трогаете LLM routing).

### Карта репозитория (куда смотреть первым)

| Задача | Файлы |
|--------|--------|
| UI приложения | `src/bookmarksBro/BookmarksBroApp.tsx`, `services.ts` |
| Админ-операции | `src/components/AdminBookmarksBro.tsx` |
| API bookmarks/knowledge | `agent-api/main.py` (grep `bookmarks`, `knowledge`) |
| SQL схема MVP | `migrate_bookmarks_bro_mvp.sql` |
| Chrome extension | `extensions/bookmarks-bro/` |
| Изолированный Supabase | `ops/bookmarks-bro-supabase/README.md` |
| Матмодель | `Autoro/Architecture/Bookmarks Bro Mathematical Model.md` |
| Стратегия KB | `Autoro/Strategy/Unified Knowledge Base Plan.md` |

### Skills для Antigravity (из AGENTS.md website)

| Тип задачи | Skill |
|------------|-------|
| UI / React | `modern-web-guidance`, `frontend-dev-guidelines`, `refero-cursor-warm-ivory` |
| E2E extension | `playwright-skill` |
| Отладка API | `systematic-debugging`, `cbh-debug-playbook` |
| SEO контент KB | `seo-content-writer` |
| Многофазный build | `antigravity-workflows` или `supergoal` |

Подключение skills: `bash scripts/link-antigravity-skills.sh` в монорепо website.

---

## 1. Текущее состояние (as of 2026-06-16)

### Реализовано ✅

- MVP UI: Search, Notes, Ideas, Reminders, Knowledge Base (`BookmarksBroApp`).
- Unified search + telemetry; workspace UI state sync (`GET/PUT workspace-ui-state`, debounce 700ms).
- `agent-api`: bookmarks sync/worker/enrich, semantic search, `ai-recommend`, `pipeline/run`, `metrics`, `workspaces/ensure`.
- Bootstrap token flow для extension (без client API key).
- Chrome extension: popup sync, background auto-sync, testing build `0.1.1-testing`.
- KB export: markdown, ZIP (`knowledge.md`, `items.json`, `vectors.json`, `manifest.json`).
- Generate ideas from full DB; Obsidian export/sync hooks.
- SQL foundation: `workspaces` owner-only + RLS policies в `migrate_bookmarks_bro_mvp.sql`.
- Документация: mathematical model, testing, admin multiuser.

### Блокеры перед multi-tenant (из Obsidian MVP Plan) 🔴

| # | Блокер | Симптом | Где чинить |
|---|--------|---------|------------|
| B1 | Google OAuth | `redirect_uri_mismatch` | Supabase Auth URLs, `VITE_AUTH_REDIRECT_TO`, Google Console |
| B2 | Email/password | Supabase `HTTP 401` | BB Supabase keys, `Login`, env |
| B3 | Taxonomy | дубли тегов/категорий | UI + enrich pipeline normalization |
| B4 | EN UI | смешанный RU/EN | `BookmarksBroApp`, help strings |

**Правило:** не начинать Phase 2 (multi-user isolation), пока B1–B4 не закрыты.

### Технический долг

- `agent-api/main.py` — монолит; bookmarks и swoop в одном файле (в AuthRAG — срез, рефакторинг опционально).
- JWT → workspace enforcement не везде (дыра «знаю чужой workspaceId»).
- n8n Telegram ingestion: хардкод `KNOWLEDGE_WORKSPACE_ID` на prod.
- BB Supabase stack на VPS: bootstrap/recover скрипты требуют ручной доводки.

---

## 2. Фазы разработки

### Phase 0 — Repo hygiene & Antigravity bootstrap (1–2 дня)

**Цель:** агент может клонировать AuthRAG и сразу ориентироваться.

| ID | Задача | Критерий готовности |
|----|--------|---------------------|
| 0.1 | README + ROADMAP + GEMINI в репо | Файлы на ветке `bookmarks-bro` |
| 0.2 | `.env.example` для agent-api bookmarks | Документированы `BOOKMARKS_*`, `EXTENSION_BOOTSTRAP_*` |
| 0.3 | Smoke scripts в CI (optional) | `scripts/bookmarks-bro-smoke.mjs` exit 0 на staging |
| 0.4 | Синхронизация Obsidian → `docs/obsidian/` | Ключевые заметки продублированы |

**Команды проверки:**

```bash
python3 -m py_compile agent-api/main.py
node scripts/bookmarks-bro-smoke.mjs   # с AGENT_API_URL + KEY
```

---

### Phase 1 — Pre-MVP blockers (Auth + Taxonomy + EN) (1–2 недели)

**Цель:** Definition of Ready перед multi-tenant.

#### 1.1 Auth (B1, B2)

- [ ] Поднять/починить BB Supabase (`ops/bookmarks-bro-supabase/bootstrap.sh` или `recover_bb_stack.sh`).
- [ ] Настроить Google OAuth: Authorized redirect URI = `<BOOKMARKS_SUPABASE_URL>/auth/v1/callback`.
- [ ] `VITE_SUPABASE_URL` / anon key → BB stack, не основной Swoop Supabase.
- [ ] E2E: Google login + email signup + session в BookmarksBro UI.
- [ ] Документировать в `docs/bookmarks-bro/AUTH-SETUP.md`.

**Acceptance:** два чистых браузерных профиля проходят login без 400/401.

#### 1.2 Taxonomy (B3)

- [ ] Canonical categories dictionary (YAML/JSON в `schemas/`).
- [ ] Normalizer: trim, lower, singular/plural, dedupe в enrich worker.
- [ ] UI filters по canonical tags.

**Acceptance:** duplicate tag rate < 5% на тестовом workspace после re-enrich.

#### 1.3 English UI (B4)

- [ ] Перевести user-facing strings в `BookmarksBroApp` + extension popup.
- [ ] Glossary: Search, Ideas, Reminders, Knowledge Base, Workspace.

**Acceptance:** нет кириллицы в production UI paths (кроме user content).

---

### Phase 2 — Multi-user isolation (приоритет №1 после Phase 1) (2–3 недели)

**Цель:** tenant-safe AuthRAG.

| ID | Задача | API / код |
|----|--------|-----------|
| 2.1 | JWT-scoped workspaces | `GET/POST /api/v1/bookmarks/workspaces` фильтр по `owner_id` |
| 2.2 | Middleware workspace guard | каждый endpoint с `workspaceId` ∈ allowed set |
| 2.3 | `workspace_members` table | roles: owner, admin, member, readonly |
| 2.4 | Extension: workspace из ensure, не hardcode | `services.ts` `resolveWorkspaceId()` |
| 2.5 | Obsidian per-workspace vault | `KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT=Autoro KB/ws-{id}` |
| 2.6 | Telegram `chat_id → workspace` | таблица `telegram_workspace_links` + n8n node |

**Acceptance:**

- User A не может прочитать/записать workspace User B (curl + JWT тесты).
- RLS на BB Postgres подтверждён интеграционным тестом.

См. `docs/bookmarks-bro/ADMIN-MULTIUSER.md`.

---

### Phase 3 — Ingestion channels (2–4 недели)

#### 3.1 Browser (стабилизация)

- [ ] Edge/Firefox parity (manifest gecko).
- [ ] Incremental sync marker (last modified).
- [ ] Profile UX: naming, validation, status polling.

#### 3.2 Telegram

- [ ] n8n workflow: `Prepare Input` → `Resolve workspace` → `knowledge/capture`.
- [ ] Один webhook + mapping table (вариант A из Unified KB Plan).
- [ ] Статусы pipeline в ответ боту.

#### 3.3 Mobile / share target (backlog)

- [ ] Unified capture API для iOS/Android shortcuts.

---

### Phase 4 — RAG quality & Graph (опционально, 3–6 недель)

**Не дублировать Ruflo/внешние harness в prod.** Расширять `agent-api`.

| ID | Задача | Примечание |
|----|--------|------------|
| 4.1 | Hybrid search tuning | α semantic/text; метрики CTR top-3 |
| 4.2 | Entities/relations в Postgres | MVP GraphRAG без второго SSOT |
| 4.3 | `graph-search` endpoint | local/global/hybrid modes |
| 4.4 | Quality gates | ingest success ≥98%, median capture→searchable ≤2 min |

KPI из Unified KB Plan:

- Duplicate rate ≤ 5%
- Search success (open top-3) ≥ 60%

---

### Phase 5 — Production & migration (ongoing)

- [ ] Отдельный домен prod (env-only switch, без смены бизнес-логики).
- [ ] Rate limits, audit logs, spend caps на LLM enrich.
- [ ] Dashboard метрик: `GET /api/v1/bookmarks/metrics` → Grafana/Admin UI.
- [ ] Backup: ZIP export + Obsidian syncthing.

---

## 3. Backlog по компонентам (для постановки задач агенту)

### agent-api

```
POST /api/v1/bookmarks/bootstrap
POST /api/v1/bookmarks/sync/start
POST /api/v1/bookmarks/worker/run
POST /api/v1/bookmarks/enrich/run
POST /api/v1/bookmarks/pipeline/run
GET  /api/v1/bookmarks/metrics
POST /api/v1/bookmarks/ai-recommend
POST /api/v1/bookmarks/workspaces/ensure
GET  /api/v1/knowledge/search
POST /api/v1/knowledge/capture
POST /api/v1/knowledge/export
```

**Следующие PR-sized задачи:**

1. `workspace_access_middleware` — единая функция проверки JWT + workspaceId.
2. `telegram_workspace_links` migration + CRUD admin endpoint.
3. Tag normalizer module + unit tests.
4. Split bookmarks routes из main.py в `agent-api/routes/bookmarks.py` (refactor, без смены контрактов).

### Frontend (`src/bookmarksBro`)

1. EN i18n pass.
2. Admin table workspaces (не ручной id).
3. Error surfaces для auth (redirect_uri, 401).
4. KPI dashboard widget из metrics API.

### Extension

1. Onboarding wizard (bootstrap → first sync).
2. Incremental sync.
3. Pack `bookmarks-bro.zip` в release artifact GitHub Actions.

### Ops

1. Починить `bootstrap.sh` docker-compose source на VPS.
2. Документировать recover path в `ops/bookmarks-bro-supabase/RUNBOOK.md`.

---

## 4. Шаблон задачи для Antigravity

При постановке задачи агенту используйте формат:

```markdown
## Task: <короткое имя>
**Phase:** 1.1 Auth
**Repo:** autorotech-tech/AuthRAG branch bookmarks-bro
**Files:** agent-api/main.py, ops/bookmarks-bro-supabase/...

### Goal
<одно предложение>

### Acceptance criteria
- [ ] ...
- [ ] npm run build (если UI) / py_compile (если API)

### Do NOT
- менять несвязанные Swoop маршруты
- коммитить секреты
- ослаблять workspace isolation

### Verify
<команды>
```

---

## 5. Риски

| Риск | Митигация |
|------|-----------|
| API limits OpenRouter/OpenAI | key pool в service_settings, fallback model |
| PII в KB | redact в capture, policies в enrich |
| Монолит main.py | постепенный extract routes |
| AGPL соседних tools | OpenMontage не встраивать в prod SSOT |

---

## 6. Ссылки Obsidian (прочитать при старте сессии)

- `Autoro/Bookmarks Bro MVP Execution Plan 2026-05-07`
- `Autoro/Bookmarks Bro Progress`
- `Autoro/Strategy/Unified Knowledge Base Plan`
- `Autoro/Architecture/Bookmarks Bro Mathematical Model`
- `Autoro/Bookmarks Bro — agent-api LLM ключи`

Дубликаты в репо: `Autoro/Strategy/`, `Autoro/Architecture/`, `docs/obsidian/`.

---

## 7. Definition of Done (релиз MVP)

- [ ] Phase 1 blockers закрыты (auth, taxonomy, EN).
- [ ] Phase 2 isolation: JWT + workspace middleware + RLS.
- [ ] Extension E2E: install → bootstrap → sync → search в UI.
- [ ] Telegram capture в отдельный workspace клиента.
- [ ] `npm run build` + smoke scripts green на staging.
- [ ] ROADMAP обновлён, прогресс записан в Obsidian.

---

*Документ для автономной работы Antigravity. При расхождении с Obsidian — приоритет у Obsidian vault, затем обновить этот файл.*
