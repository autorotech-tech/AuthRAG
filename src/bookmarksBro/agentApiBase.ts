/**
 * База URL для запросов к agent-api (Bookmarks Bro, knowledge export).
 * Пусто → относительные пути `/api/v1/*` (dev: прокси Vite; prod: nginx на том же хосте что SPA).
 * Явный URL → нужен для сборок, где UI и API на разных origin (Tauri webview, расширение, отдельный CDN).
 */
export function bookmarksAgentApiBase(): string {
  const raw = import.meta.env.VITE_AGENT_API_BASE
  if (raw == null || String(raw).trim() === '') return ''
  return String(raw).trim().replace(/\/$/, '')
}

export function bookmarksAgentApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const base = bookmarksAgentApiBase()
  return base ? `${base}${normalized}` : normalized
}
