# MCP setup for Antigravity (AuthRAG / Keept)

Operator checklist — configure in **Antigravity → MCP** (not committed secrets).

## 1. Google Workspace MCP

Follow: https://codelabs.developers.google.com/google-workspace-mcp-antigravity

- Enable Workspace APIs in Google Cloud Console
- OAuth consent + credentials for desktop/IDE
- Add server in Antigravity with scopes for Gmail, Calendar, Drive as needed

## 2. Obsidian vault (shared with Cursor)

- Vault path: operator Syncthing / local Obsidian folder
- MCP: `user-obsidian-vault` in Cursor; configure equivalent in Antigravity if available
- Session start: `search_vault` → `"Keep It For Me"`, `"Bookmarks Bro"`
- After milestones: update `Autoro/Keep It For Me Phase 1.md`

## 3. Developer Knowledge MCP

Used by project skill `always-verify-gcp` (`AuthRAG/.agent/skills/always-verify-gcp/`).

- Tool: `search_documents` for official GCP docs before running `gcloud` / `terraform`
- Pair with `agents-cli deploy` and `agents-cli infra single-project`

## 4. Optional (Keept ops)

| MCP | Use |
|-----|-----|
| Browser / Playwright | Extension E2E (`playwright-skill`) |
| Filesystem | Local agent-api logs |

## Verify

1. Antigravity chat: ask agent to list available MCP tools
2. Run `/understand src/bookmarksBro agent-api --language en` after `setup-understand-anything.sh`
3. `bash scripts/link-antigravity-skills.sh` — expect `Symlinked N skills`
