# Antigravity Brief — BrowserBro / Keep It For Me (`keept.me`)

> **Audience:** Google Antigravity and other autonomous agents.  
> **Updated:** 2026-06-16  
> **Status:** active — Phase 1 in progress  
> **Companion docs:** [ANTIGRAVITY-INFRA-BRIEF](./ANTIGRAVITY-INFRA-BRIEF.md), [ROADMAP](../ROADMAP.md)

---

## 0. Product identity (read first)

| Layer | Name | Notes |
|-------|------|--------|
| **Public product** | **Keep It For Me** | User-facing EN brand |
| **Short / domain** | **keept.me** | Marketing site and future prod host |
| **Internal codename** | **BrowserBro** / `browserbro` | Tasks, Obsidian, agent prompts |
| **Legacy code name** | **Bookmarks Bro** | Still in paths, tables, env prefixes — **do not mass-rename in Phase 1** |
| **Repo codename** | **AuthRAG** | Authenticated RAG slice for autonomous dev |

**Tagline (EN):** *Keep what matters — search it later with AI.*

### Naming rules for agents

1. **Phase 1:** Change **user-visible strings only** (UI, extension title, docs) to **Keep It For Me** / **Keept**.  
   Example: popup `<h1>Keep It For Me</h1>`, kicker `Keept · build …`.
2. **Do not rename** in Phase 1: npm package names, folder `src/bookmarksBro/`, route `/bookmarks-bro`, table `bookmarks_bro_bookmarks`, env `BOOKMARKS_*`, extension id folder `extensions/bookmarks-bro/`, API paths `/api/v1/bookmarks/*`.
3. **Phase 5+ (future):** optional mechanical rename `bookmarks-bro` → `keept` with migration plan — out of scope now.
4. **Russian:** brief RU only in `extensions/bookmarks-bro/SUPABASE_OAUTH_SETUP.md`; all other new ops docs **EN**.

---

## 1. Where to work

| What | Source of truth | Antigravity clone |
|------|-----------------|-------------------|
| Implementation | `autoro.tech/website` monorepo | **This repo** (`bookmarks-bro` branch) |
| UI build | `npm run build` in **website** | AuthRAG has no `package.json` |
| API | `website/agent-api/main.py` | Copy here |
| Extension | `website/extensions/bookmarks-bro/` | Copy here |

**Sync policy:** one batch sync **AuthRAG ← website** at **end of Phase 1** (not after every PR).

### Key paths

```
src/bookmarksBro/BookmarksBroApp.tsx
src/bookmarksBro/services.ts
agent-api/main.py
agent-api/schemas/categories.json      # NEW
extensions/bookmarks-bro/
ops/bookmarks-bro-supabase/
docs/bookmarks-bro/
```

### SPA routes (unchanged Phase 1)

- `/bookmarks-bro` — app  
- `/admin/bookmarks-bro` — admin ops  

### Hosting

| Env | Host | BB Supabase |
|-----|------|-------------|
| Staging | `swoop.autoro.tech` | `/bb-supabase` |
| Prod target | **`keept.me`** | TBD |

---

## 2. Locked decisions (Phase 1)

| Topic | Decision |
|-------|----------|
| AUTH-SETUP | EN `docs/bookmarks-bro/AUTH-SETUP.md` + brief RU in extension OAuth doc |
| Re-enrich legacy tags | **Phase 1.5** — write-path normalization only in Phase 1 |
| Search filters | Category + tag + RAG context (corpus + semantic/keyword) |
| AuthRAG sync | One batch at end of Phase 1 |
| Phase 2 | Blocked until B1–B4 done |
| Multi-user + Telegram | See **[ANTIGRAVITY-SWOOP-KEEPT.md](./ANTIGRAVITY-SWOOP-KEEPT.md)** |

Full Phase 1 checklist: website `docs/bookmarks-bro/ANTIGRAVITY-KEEPT-BRIEF.md`.

---

## 3. Phase 1 tasks (summary)

1. **Auth** — BB Supabase, OAuth, AUTH-SETUP.md  
2. **Taxonomy** — `categories.json`, `normalize_tags`, unit tests, enrich pipelines  
3. **EN UI + brand** — "Keep It For Me" in chrome; translate RU strings  
4. **Search** — facets, category/tag/RAG filters, tag pills  
5. **Verify** — `py_compile`, tests, `npm run build`, manual OAuth/search  

---

## 4. Invariants

- Bootstrap Bearer for extension (no admin API key in client)
- `BOOKMARKS_PGHOST` / `PGHOST` — not `DATABASE_URL`
- pgvector **1536** dimensions
- OpenRouter: `<provider>/<model>`

Details: [ANTIGRAVITY-INFRA-BRIEF](./ANTIGRAVITY-INFRA-BRIEF.md).

---

## 5. Skills

```bash
# In website monorepo:
bash scripts/link-antigravity-skills.sh
```

`modern-web-guidance`, `frontend-dev-guidelines`, `systematic-debugging`, `antigravity-workflows`.

---

## 6. Copy-paste kickoff

```
You are working on BrowserBro (product: Keep It For Me, domain keept.me).
Read docs/ANTIGRAVITY-KEEPT-BRIEF.md and docs/ANTIGRAVITY-INFRA-BRIEF.md.
Implement Phase 1 in website monorepo (source of truth); sync this repo at end.
User-visible EN → "Keep It For Me"; do not rename bookmarks-bro code paths.
Re-enrich legacy tags: Phase 1.5 only.
```
