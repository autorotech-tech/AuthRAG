# Bookmarks Bro — MVP Execution Plan (2026-05-07)

Синхронизировано из Obsidian vault. Полный ROADMAP: см. ../../ROADMAP.md

## Итоги текущего этапа
- MVP-каркас Tauri + React: Search, Notes, Ideas, Reminders, Knowledge Base.
- Unified search, telemetry, ideas, reminders, KB draft/publish, markdown export.

## Блокеры перед multi-tenant
1. Auth: Google redirect_uri_mismatch + email 401
2. Taxonomy: canonical categories + tag dedupe
3. EN UI/help

## Порядок
Не переходить к multi-user isolation пока не закрыты Auth + taxonomy + EN.

## Variant A
Отдельный BB Supabase + RLS. См. ops/bookmarks-bro-supabase/
