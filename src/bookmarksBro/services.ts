import type {
  IdeaItem,
  KnowledgeExportBundle,
  KnowledgeItem,
  NoteItem,
  ReminderItem,
  SearchItem,
  SourceKind,
  TaskTokenUsage,
} from './types'
import { bookmarksAgentApiUrl } from './agentApiBase'
import { setUiSyncStatus } from './uiSyncStatus'

const IDEAS_KEY = 'bookmarks_bro_ideas'
const REMINDERS_KEY = 'bookmarks_bro_reminders'
const KNOWLEDGE_KEY = 'bookmarks_bro_knowledge'
const TOKENS_KEY = 'bookmarks_bro_tokens'
const WORKSPACE_KEY = 'bookmarks_bro_workspace_id'
const BOOTSTRAP_TOKEN_KEY = 'bookmarks_bro_bootstrap_token'

const fallbackDataset: SearchItem[] = [
  {
    id: 'demo-obsidian-1',
    source: 'Obsidian',
    title: 'AI Agents маркетинг гипотезы',
    snippet: 'Сводка экспериментов по контент-воронке и GPT-процессу генерации идей.',
    link: 'obsidian://open?vault=Autoro&file=AI%20Agents%20Marketing',
    tags: ['ai', 'marketing', 'hypothesis'],
    relevance: 0.78,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'demo-bookmark-1',
    source: 'Bookmarks',
    title: 'Конкурентный анализ инструментов knowledge-base',
    snippet: 'Материал по архитектуре knowledge ingestion + vector search.',
    link: 'https://example.com/knowledge-stack',
    tags: ['kb', 'architecture'],
    relevance: 0.73,
    createdAt: new Date().toISOString(),
  },
]

const fallbackNotes: NoteItem[] = [
  {
    id: 'note-obsidian-1',
    title: 'Unified Knowledge Base Plan',
    content: 'Идемпотентный ingestion pipeline с состояниями captured/enriched/indexed/searchable.',
    source: 'Obsidian',
    tags: ['knowledge-base', 'architecture'],
    updatedAt: new Date().toISOString(),
    link: 'obsidian://open?vault=Autoro&file=Unified%20Knowledge%20Base%20Plan',
  },
]

function readLocal<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeLocal<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function getCachedWorkspaceId(): string {
  const fromStorage = localStorage.getItem(WORKSPACE_KEY)
  if (fromStorage && fromStorage.trim()) return fromStorage.trim()
  return ''
}

function bookmarksHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  const apiKey = import.meta.env.VITE_BOOKMARKS_API_KEY?.trim()
  const bootstrapToken = localStorage.getItem(BOOTSTRAP_TOKEN_KEY)?.trim()
  if (bootstrapToken) {
    headers.Authorization = `Bearer ${bootstrapToken}`
  } else if (apiKey) {
    headers['X-API-Key'] = apiKey
  }
  return headers
}

export async function resolveWorkspaceId(): Promise<string> {
  const cached = getCachedWorkspaceId()
  if (cached) return cached

  try {
    const ensureRes = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspaces/ensure'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
    })
    if (ensureRes.ok) {
      const ensurePayload = (await ensureRes.json()) as { workspaceId?: string }
      const ensured = String(ensurePayload.workspaceId ?? '').trim()
      if (ensured) {
        localStorage.setItem(WORKSPACE_KEY, ensured)
        return ensured
      }
    }
  } catch {
    // best effort fallback to list endpoint
  }

  try {
    const listRes = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspaces'), {
      headers: bookmarksHeaders(),
    })
    if (listRes.ok) {
      const listPayload = (await listRes.json()) as { items?: Array<{ id?: string }> }
      const firstId = String(listPayload.items?.[0]?.id ?? '').trim()
      if (firstId) {
        localStorage.setItem(WORKSPACE_KEY, firstId)
        return firstId
      }
    }
  } catch {
    // no-op
  }

  localStorage.setItem(WORKSPACE_KEY, '1')
  return '1'
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function safeNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function parseUsage(payload: Record<string, unknown>, promptText: string, completionText: string) {
  const usage = (payload.usage ?? payload.tokenUsage ?? {}) as Record<string, unknown>
  const promptTokens = safeNumber(usage.prompt_tokens ?? usage.promptTokens) || estimateTokens(promptText)
  const completionTokens =
    safeNumber(usage.completion_tokens ?? usage.completionTokens) || estimateTokens(completionText)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
}

export async function listTaskTokenUsage(): Promise<TaskTokenUsage[]> {
  const localRows = readLocal<TaskTokenUsage>(TOKENS_KEY)
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(
      bookmarksAgentApiUrl(`/api/v1/bookmarks/token-usage?workspaceId=${encodeURIComponent(workspaceId)}&limit=200`),
      {
        headers: bookmarksHeaders(),
      },
    )
    if (!response.ok) throw new Error(`token_usage_failed_${response.status}`)
    const payload = (await response.json()) as { items?: Array<Record<string, unknown>> }
    const rows = (payload.items ?? []).map((row, idx) => ({
      id: `srv-${idx}-${String(row.taskName ?? 'task')}`,
      taskName: String(row.taskName ?? 'unknown-task'),
      promptTokens: safeNumber(row.promptTokens),
      completionTokens: safeNumber(row.completionTokens),
      totalTokens: safeNumber(row.totalTokens),
      updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    }))
    writeLocal(TOKENS_KEY, rows)
    return rows
  } catch {
    return localRows
  }
}

export async function upsertTaskTokenUsage(entry: Omit<TaskTokenUsage, 'id' | 'updatedAt'>): Promise<TaskTokenUsage[]> {
  const localCurrent = await listTaskTokenUsage()
  const workspaceId = await resolveWorkspaceId()
  try {
    await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/token-usage/log'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        taskName: entry.taskName,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        provider: 'bookmarks-bro-ui',
        model: 'inferred',
      }),
    })
  } catch {
    // best-effort server log
  }
  const existingLocal = localCurrent.find((row) => row.taskName === entry.taskName)
  if (existingLocal) {
    const next = localCurrent.map((row) =>
      row.taskName === entry.taskName
        ? {
            ...row,
            promptTokens: row.promptTokens + entry.promptTokens,
            completionTokens: row.completionTokens + entry.completionTokens,
            totalTokens: row.totalTokens + entry.totalTokens,
            updatedAt: new Date().toISOString(),
          }
        : row,
    )
    writeLocal(TOKENS_KEY, next)
    return next
  }

  const created: TaskTokenUsage = {
    id: `tok-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    ...entry,
  }
  const next = [created, ...localCurrent]
  writeLocal(TOKENS_KEY, next)
  return next
}

export function trackTelemetry(event: string, properties: Record<string, unknown>): void {
  const payload = {
    event,
    properties,
    ts: new Date().toISOString(),
  }
  try {
    const raw = localStorage.getItem('bookmarks_bro_telemetry')
    const events = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : []
    localStorage.setItem('bookmarks_bro_telemetry', JSON.stringify([payload, ...events].slice(0, 200)))
  } catch {
    // best-effort telemetry storage
  }
}

function mapSource(value: unknown): SourceKind {
  const source = String(value ?? '').toLowerCase()
  if (source.includes('obsidian')) return 'Obsidian'
  if (source.includes('link')) return 'Links'
  return 'Bookmarks'
}

function normalizeSearchItem(item: unknown, idx: number): SearchItem {
  const row = (item ?? {}) as Record<string, unknown>
  return {
    id: String(row.id ?? row.bookmarkId ?? `row-${idx}`),
    source: mapSource(row.source),
    title: String(row.title ?? row.url ?? 'Untitled'),
    snippet: String(row.snippet ?? row.summary ?? row.content ?? ''),
    link: typeof row.url === 'string' ? row.url : undefined,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    relevance: Number(row.relevance ?? row.score ?? 0),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
  }
}

export async function unifiedSearch(query: string, sourceFilter: SourceKind | 'All'): Promise<SearchItem[]> {
  const trimmed = query.trim()
  const workspaceId = await resolveWorkspaceId()
  if (!trimmed) {
    return fallbackDataset.filter((row) => sourceFilter === 'All' || row.source === sourceFilter)
  }

  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/search'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId, query: trimmed, limit: 20 }),
    })
    if (!response.ok) throw new Error(`search_failed_${response.status}`)
    const payload = (await response.json()) as { items?: unknown[]; results?: unknown[] }
    const rows = payload.items ?? payload.results ?? []
    const normalized = rows.map(normalizeSearchItem)
    const filtered = normalized.filter((row) => sourceFilter === 'All' || row.source === sourceFilter)
    trackTelemetry('search_success', {
      query: trimmed,
      sourceFilter,
      resultsCount: filtered.length,
      mode: 'semantic_or_keyword',
    })
    return filtered
  } catch {
    const local = fallbackDataset.filter((row) => {
      const hit =
        row.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        row.snippet.toLowerCase().includes(trimmed.toLowerCase()) ||
        row.tags.some((tag) => tag.toLowerCase().includes(trimmed.toLowerCase()))
      return hit && (sourceFilter === 'All' || row.source === sourceFilter)
    })
    trackTelemetry('search_success', {
      query: trimmed,
      sourceFilter,
      resultsCount: local.length,
      mode: 'fallback_local',
    })
    return local
  }
}

export async function generateIdeasFromNotes(input: {
  searchItems: SearchItem[]
  task: string
}): Promise<{ ideas: IdeaItem[]; tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const ids = input.searchItems.map((item) => item.id)
  const workspaceId = await resolveWorkspaceId()
  if (!input.task.trim()) {
    return { ideas: [], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  }

  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/ai-recommend'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId, task: input.task, limit: 5 }),
    })
    if (!response.ok) throw new Error(`ai_recommend_failed_${response.status}`)
    const payload = (await response.json()) as { picks?: Array<Record<string, unknown>> }
    const now = new Date().toISOString()
    const ideas = (payload.picks ?? []).slice(0, 5).map((pick, index) => ({
      id: `idea-${Date.now()}-${index}`,
      title: String(pick.title ?? `Идея #${index + 1}`),
      context: String(pick.reason ?? pick.summary ?? 'Сгенерировано из похожих материалов и заметок.'),
      originRefs: ids,
      priority: 'medium' as const,
      status: 'draft' as const,
      createdAt: now,
    }))
    const usage = parseUsage(payload, input.task, ideas.map((item) => item.context).join('\n'))
    trackTelemetry('idea_created', {
      task: input.task,
      ideasCount: ideas.length,
      sourceCount: input.searchItems.length,
      mode: 'ai',
      totalTokens: usage.totalTokens,
    })
    return { ideas, tokenUsage: usage }
  } catch {
    const top = input.searchItems.slice(0, 3)
    const ideas = top.map((item, index) => ({
      id: `idea-fallback-${Date.now()}-${index}`,
      title: `Идея: ${item.title}`,
      context: `На основе ${item.source}: ${item.snippet.slice(0, 180)}`,
      originRefs: [item.id],
      priority: 'medium' as const,
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
    }))
    const usage = {
      promptTokens: estimateTokens(input.task),
      completionTokens: estimateTokens(ideas.map((item) => item.context).join('\n')),
      totalTokens: estimateTokens(input.task) + estimateTokens(ideas.map((item) => item.context).join('\n')),
    }
    trackTelemetry('idea_created', {
      task: input.task,
      ideasCount: ideas.length,
      sourceCount: input.searchItems.length,
      mode: 'fallback',
      totalTokens: usage.totalTokens,
    })
    return { ideas, tokenUsage: usage }
  }
}

export async function generateIdeasFromDatabase(task: string): Promise<{
  ideas: IdeaItem[]
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
}> {
  const workspaceId = await resolveWorkspaceId()
  const cleanTask = task.trim()
  if (!cleanTask) {
    return { ideas: [], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  }

  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/ai-recommend'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        task: cleanTask,
        retrieveLimit: 64,
        maxPicks: 12,
        searchMode: 'hybrid',
      }),
    })
    if (!response.ok) throw new Error(`db_ai_recommend_failed_${response.status}`)
    const payload = (await response.json()) as { picks?: Array<Record<string, unknown>>; usage?: Record<string, unknown> }
    const now = new Date().toISOString()
    const ideas = (payload.picks ?? []).slice(0, 12).map((pick, index) => ({
      id: `db-idea-${Date.now()}-${index}`,
      title: String(pick.title ?? `Knowledge idea #${index + 1}`),
      context: String(pick.reason ?? pick.summary ?? 'Generated from personal knowledge base vectors.'),
      originRefs: [String(pick.bookmarkId ?? pick.url ?? `db-ref-${index}`)],
      priority: 'high' as const,
      status: 'draft' as const,
      createdAt: now,
    }))
    const usage = parseUsage(payload as Record<string, unknown>, cleanTask, ideas.map((item) => item.context).join('\n'))
    trackTelemetry('idea_created', {
      task: cleanTask,
      ideasCount: ideas.length,
      sourceCount: 'database',
      mode: 'db-wide',
      totalTokens: usage.totalTokens,
    })
    return { ideas, tokenUsage: usage }
  } catch {
    const fallbackIdea: IdeaItem = {
      id: `db-idea-fallback-${Date.now()}`,
      title: 'Knowledge synthesis needed',
      context: 'Не удалось получить идеи из всей БД. Проверьте доступ к API и embeddings.',
      originRefs: ['db-fallback'],
      priority: 'medium',
      status: 'draft',
      createdAt: new Date().toISOString(),
    }
    const usage = {
      promptTokens: estimateTokens(cleanTask),
      completionTokens: estimateTokens(fallbackIdea.context),
      totalTokens: estimateTokens(cleanTask) + estimateTokens(fallbackIdea.context),
    }
    return { ideas: [fallbackIdea], tokenUsage: usage }
  }
}

export async function fetchObsidianNotesBridge(query: string): Promise<NoteItem[]> {
  const trimmed = query.trim()
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/knowledge/search'), {
      method: 'POST',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId, query: trimmed || 'knowledge', limit: 20 }),
    })
    if (!response.ok) throw new Error(`notes_bridge_failed_${response.status}`)
    const payload = (await response.json()) as { items?: Array<Record<string, unknown>>; results?: Array<Record<string, unknown>> }
    const rows = payload.items ?? payload.results ?? []
    const notes = rows.map((row, index) => ({
      id: String(row.id ?? `note-row-${index}`),
      title: String(row.title ?? row.url ?? 'Knowledge Note'),
      content: String(row.summary ?? row.snippet ?? row.content ?? ''),
      source: 'Obsidian' as const,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      updatedAt: String(row.updatedAt ?? row.createdAt ?? new Date().toISOString()),
      link: typeof row.url === 'string' ? row.url : undefined,
    }))
    return notes
  } catch {
    if (!trimmed) return fallbackNotes
    return fallbackNotes.filter(
      (note) =>
        note.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        note.content.toLowerCase().includes(trimmed.toLowerCase()) ||
        note.tags.some((tag) => tag.toLowerCase().includes(trimmed.toLowerCase())),
    )
  }
}

export async function exportKnowledgeBundle(
  query: string,
  options?: { semantic?: boolean; limit?: number },
): Promise<KnowledgeExportBundle> {
  const workspaceId = await resolveWorkspaceId()
  const payload = {
    workspaceId,
    query: query.trim() || 'knowledge',
    semantic: options?.semantic ?? true,
    limit: options?.limit ?? 120,
  }

  const response = await fetch(bookmarksAgentApiUrl('/api/v1/knowledge/export'), {
    method: 'POST',
    headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`knowledge_export_failed_${response.status}`)
  }
  return (await response.json()) as KnowledgeExportBundle
}

/** После hydrate UI — иначе первая запись локального состояния перезапишет данные на сервере пустым снапшотом. */
let bookmarksBroRemotePersist = false

export function setBookmarksBroRemotePersistEnabled(value: boolean): void {
  bookmarksBroRemotePersist = value
}

let workspaceUiPersistTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleWorkspaceUiPersist(): void {
  if (!bookmarksBroRemotePersist) return
  if (workspaceUiPersistTimer != null) clearTimeout(workspaceUiPersistTimer)
  workspaceUiPersistTimer = setTimeout(() => {
    workspaceUiPersistTimer = null
    setUiSyncStatus('syncing')
    void pushWorkspaceUiStateNow().then((ok) => setUiSyncStatus(ok ? 'synced' : 'error'))
  }, 700)
}

export async function pullWorkspaceUiState(): Promise<{
  ideas: IdeaItem[]
  reminders: ReminderItem[]
  knowledgeItems: KnowledgeItem[]
  updatedAt: string | null
} | null> {
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(
      bookmarksAgentApiUrl(`/api/v1/bookmarks/workspace-ui-state?workspaceId=${encodeURIComponent(workspaceId)}`),
      { headers: bookmarksHeaders() },
    )
    if (!response.ok) {
      setUiSyncStatus('offline')
      return null
    }
    const payload = (await response.json()) as Record<string, unknown>
    const ideas = Array.isArray(payload.ideas) ? (payload.ideas as IdeaItem[]) : []
    const reminders = Array.isArray(payload.reminders) ? (payload.reminders as ReminderItem[]) : []
    const knowledgeItems = Array.isArray(payload.knowledgeItems)
      ? (payload.knowledgeItems as KnowledgeItem[])
      : []
    const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : null
    return { ideas, reminders, knowledgeItems, updatedAt }
  } catch {
    setUiSyncStatus('offline')
    return null
  }
}

export async function pushWorkspaceUiStateNow(): Promise<boolean> {
  const workspaceId = await resolveWorkspaceId()
  try {
    const response = await fetch(bookmarksAgentApiUrl('/api/v1/bookmarks/workspace-ui-state'), {
      method: 'PUT',
      headers: bookmarksHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        workspaceId,
        ideas: readLocal<IdeaItem>(IDEAS_KEY),
        reminders: readLocal<ReminderItem>(REMINDERS_KEY),
        knowledgeItems: readLocal<KnowledgeItem>(KNOWLEDGE_KEY),
      }),
    })
    if (response.ok) setUiSyncStatus('synced')
    else setUiSyncStatus('error')
    return response.ok
  } catch {
    setUiSyncStatus('error')
    return false
  }
}

/** Принудительная синхронизация (кнопка в UI). */
export async function syncWorkspaceUiStateNow(): Promise<boolean> {
  setUiSyncStatus('syncing')
  return pushWorkspaceUiStateNow()
}

export function listIdeas(): IdeaItem[] {
  return readLocal<IdeaItem>(IDEAS_KEY)
}

export function saveIdeas(next: IdeaItem[]): void {
  writeLocal(IDEAS_KEY, next)
  scheduleWorkspaceUiPersist()
}

export function listReminders(): ReminderItem[] {
  return readLocal<ReminderItem>(REMINDERS_KEY)
}

export function saveReminders(next: ReminderItem[]): void {
  writeLocal(REMINDERS_KEY, next)
  scheduleWorkspaceUiPersist()
}

export function listKnowledgeItems(): KnowledgeItem[] {
  return readLocal<KnowledgeItem>(KNOWLEDGE_KEY)
}

export function saveKnowledgeItems(next: KnowledgeItem[]): void {
  writeLocal(KNOWLEDGE_KEY, next)
  scheduleWorkspaceUiPersist()
}

export function buildKnowledgeDraft(items: SearchItem[], title: string): KnowledgeItem {
  return {
    id: `kb-${Date.now()}`,
    title: title.trim() || 'Knowledge Draft',
    summary: items.map((item) => `- ${item.title}: ${item.snippet}`).join('\n'),
    tags: Array.from(new Set(items.flatMap((item) => item.tags))).slice(0, 12),
    refs: items.map((item) => item.link ?? item.id),
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
}

export function exportKnowledgeMarkdown(item: KnowledgeItem): string {
  const frontmatter = [
    '---',
    `title: "${item.title.replace(/"/g, '\\"')}"`,
    `status: "${item.status}"`,
    `tags: [${item.tags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(', ')}]`,
    `created_at: "${item.createdAt}"`,
    '---',
    '',
  ].join('\n')

  const refs = item.refs.map((ref) => `- ${ref}`).join('\n')
  return `${frontmatter}# ${item.title}\n\n## Summary\n${item.summary}\n\n## References\n${refs}\n`
}
