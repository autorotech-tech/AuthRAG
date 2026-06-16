import { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import type { IdeaItem, KnowledgeItem, NoteItem, ReminderItem, SearchItem, SourceKind, TaskTokenUsage } from './types'
import { BOOKMARKS_BRO_BUILD } from './bookmarksBroBuild'
import {
  buildKnowledgeDraft,
  exportKnowledgeBundle,
  exportKnowledgeMarkdown,
  fetchObsidianNotesBridge,
  generateIdeasFromDatabase,
  generateIdeasFromNotes,
  listIdeas,
  listKnowledgeItems,
  listTaskTokenUsage,
  listReminders,
  pullWorkspaceUiState,
  pushWorkspaceUiStateNow,
  resolveWorkspaceId,
  syncWorkspaceUiStateNow,
  saveIdeas,
  saveKnowledgeItems,
  saveReminders,
  setBookmarksBroRemotePersistEnabled,
  trackTelemetry,
  unifiedSearch,
  upsertTaskTokenUsage,
} from './services'
import { getUiSyncStatus, subscribeUiSyncStatus, setUiSyncStatus, uiSyncStatusLabel } from './uiSyncStatus'
import type { UiSyncStatus } from './uiSyncStatus'

type TabKey = 'search' | 'notes' | 'ideas' | 'reminders' | 'knowledge'

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'search', label: 'Search' },
  { key: 'notes', label: 'Notes' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'knowledge', label: 'Knowledge Base' },
]

function scheduleReminder(reminder: ReminderItem): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  const fireAt = new Date(reminder.remindAt).getTime() - Date.now()
  if (fireAt <= 0) return
  window.setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification(`Bookmarks Bro: ${reminder.title}`, {
        body: `Напоминание по идее ${reminder.ideaId}`,
      })
    }
  }, fireAt)
}

export function BookmarksBroApp() {
  const [tab, setTab] = useState<TabKey>('search')
  const [query, setQuery] = useState('')
  const [taskForIdeas, setTaskForIdeas] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceKind | 'All'>('All')
  const [searchItems, setSearchItems] = useState<SearchItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [ideas, setIdeas] = useState<IdeaItem[]>(() => listIdeas())
  const [reminders, setReminders] = useState<ReminderItem[]>(() => listReminders())
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>(() => listKnowledgeItems())
  const [knowledgeTitle, setKnowledgeTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isNotesLoading, setIsNotesLoading] = useState(false)
  const [notesQuery, setNotesQuery] = useState('')
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [tokenUsage, setTokenUsage] = useState<TaskTokenUsage[]>([])
  const [exportQuery, setExportQuery] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [isDbIdeasLoading, setIsDbIdeasLoading] = useState(false)
  const [ingestValue, setIngestValue] = useState('')
  const [isIngesting, setIsIngesting] = useState(false)
  const [error, setError] = useState('')
  const [syncStatus, setSyncStatus] = useState<UiSyncStatus>(() => getUiSyncStatus())

  useEffect(() => subscribeUiSyncStatus(setSyncStatus), [])

  useEffect(() => {
    let cancelled = false
    async function hydrateFromServer() {
      setUiSyncStatus('hydrating')
      await resolveWorkspaceId()
      const remote = await pullWorkspaceUiState()
      if (cancelled) return

      const localIdeas = listIdeas()
      const localRem = listReminders()
      const localKb = listKnowledgeItems()

      if (remote) {
        const serverEmpty =
          remote.ideas.length === 0 &&
          remote.reminders.length === 0 &&
          remote.knowledgeItems.length === 0
        const localHas =
          localIdeas.length > 0 || localRem.length > 0 || localKb.length > 0

        if (serverEmpty && localHas) {
          setIdeas(localIdeas)
          setReminders(localRem)
          setKnowledgeItems(localKb)
          saveIdeas(localIdeas)
          saveReminders(localRem)
          saveKnowledgeItems(localKb)
          const ok = await pushWorkspaceUiStateNow()
          setUiSyncStatus(ok ? 'synced' : 'error')
        } else {
          setIdeas(remote.ideas)
          setReminders(remote.reminders)
          setKnowledgeItems(remote.knowledgeItems)
          saveIdeas(remote.ideas)
          saveReminders(remote.reminders)
          saveKnowledgeItems(remote.knowledgeItems)
          setUiSyncStatus('synced')
        }
      } else {
        setUiSyncStatus('offline')
      }

      if (!cancelled) {
        setBookmarksBroRemotePersistEnabled(true)
        void listTaskTokenUsage().then(setTokenUsage).catch(() => setTokenUsage([]))
      }
    }
    void hydrateFromServer()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    saveIdeas(ideas)
  }, [ideas])

  useEffect(() => {
    saveReminders(reminders)
  }, [reminders])

  useEffect(() => {
    saveKnowledgeItems(knowledgeItems)
  }, [knowledgeItems])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  const selectedSearchItems = useMemo(
    () => searchItems.filter((item) => selectedIds.includes(item.id)),
    [searchItems, selectedIds],
  )
  const totalTokens = useMemo(() => tokenUsage.reduce((sum, item) => sum + item.totalTokens, 0), [tokenUsage])
  const publishedCount = useMemo(
    () => knowledgeItems.filter((item) => item.status === 'published').length,
    [knowledgeItems],
  )

  async function handleSearch(): Promise<void> {
    setIsLoading(true)
    setError('')
    try {
      const rows = await unifiedSearch(query, sourceFilter)
      setSearchItems(rows)
      setSelectedIds([])
    } catch {
      setError('Не удалось выполнить поиск. Проверьте backend и доступ к данным.')
    } finally {
      setIsLoading(false)
    }
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleGenerateIdeas(): Promise<void> {
    if (!selectedSearchItems.length) {
      setError('Выберите минимум один результат поиска для генерации идей.')
      return
    }
    setError('')
    const generated = await generateIdeasFromNotes({
      searchItems: selectedSearchItems,
      task: taskForIdeas || 'Сгенерируй идеи по выбранным материалам.',
    })
    setIdeas((prev) => [...generated.ideas, ...prev])
    const updatedUsage = await upsertTaskTokenUsage({
        taskName: taskForIdeas || 'ideas-default-task',
        promptTokens: generated.tokenUsage.promptTokens,
        completionTokens: generated.tokenUsage.completionTokens,
        totalTokens: generated.tokenUsage.totalTokens,
      })
    setTokenUsage(updatedUsage)
    setTab('ideas')
  }

  async function handleGenerateIdeasFromDb(): Promise<void> {
    setIsDbIdeasLoading(true)
    setError('')
    try {
      const generated = await generateIdeasFromDatabase(taskForIdeas || 'Generate strategic ideas from my personal knowledge base')
      setIdeas((prev) => [...generated.ideas, ...prev])
      const updatedUsage = await upsertTaskTokenUsage({
        taskName: (taskForIdeas || 'ideas-db-wide-task') + '-db',
        promptTokens: generated.tokenUsage.promptTokens,
        completionTokens: generated.tokenUsage.completionTokens,
        totalTokens: generated.tokenUsage.totalTokens,
      })
      setTokenUsage(updatedUsage)
      setTab('ideas')
    } catch {
      setError('Не удалось сгенерировать идеи из всей БД.')
    } finally {
      setIsDbIdeasLoading(false)
    }
  }

  async function handleSyncNotes(): Promise<void> {
    setIsNotesLoading(true)
    setError('')
    try {
      const syncedNotes = await fetchObsidianNotesBridge(notesQuery)
      setNotes(syncedNotes)
      trackTelemetry('notes_synced', { query: notesQuery, count: syncedNotes.length })
    } catch {
      setError('Не удалось синхронизировать заметки из Obsidian bridge.')
    } finally {
      setIsNotesLoading(false)
    }
  }

  function addReminder(idea: IdeaItem): void {
    const remindAt = idea.remindAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const reminder: ReminderItem = {
      id: `rem-${Date.now()}`,
      ideaId: idea.id,
      title: idea.title,
      remindAt,
      done: false,
    }
    setReminders((prev) => [reminder, ...prev])
    scheduleReminder(reminder)
    setTab('reminders')
  }

  function createKnowledgeDraft(): void {
    if (!selectedSearchItems.length) {
      setError('Для базы знаний выберите результаты из поиска.')
      return
    }
    const draft = buildKnowledgeDraft(selectedSearchItems, knowledgeTitle)
    setKnowledgeItems((prev) => [draft, ...prev])
    trackTelemetry('kb_item_published', { draftId: draft.id, status: draft.status, refsCount: draft.refs.length, mode: 'draft' })
    setKnowledgeTitle('')
    setTab('knowledge')
  }

  function publishKnowledge(itemId: string): void {
    setKnowledgeItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, status: 'published' as const } : item)),
    )
    trackTelemetry('kb_item_published', { draftId: itemId, status: 'published', mode: 'publish' })
  }

  function downloadKnowledge(item: KnowledgeItem): void {
    const markdown = exportKnowledgeMarkdown(item)
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.title.replace(/\s+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleQuickIngest(): void {
    const value = ingestValue.trim()
    if (!value) return
    setIsIngesting(true)
    const isUrl = /^https?:\/\//i.test(value)
    const newItem: SearchItem = {
      id: `ingest-${Date.now()}`,
      source: isUrl ? 'Links' : 'Obsidian',
      title: isUrl ? `Captured link: ${value}` : value.slice(0, 72),
      snippet: isUrl ? 'Быстро добавлено через ingest bar. Добавьте в KB или используйте в генерации идей.' : value,
      link: isUrl ? value : undefined,
      tags: ['inbox', isUrl ? 'link' : 'note'],
      relevance: 0.66,
      createdAt: new Date().toISOString(),
    }
    setSearchItems((prev) => [newItem, ...prev])
    setSelectedIds((prev) => [newItem.id, ...prev])
    setIngestValue('')
    setIsIngesting(false)
    trackTelemetry('quick_ingest', { isUrl, source: newItem.source })
  }

  async function handleKnowledgeExport(semantic: boolean): Promise<void> {
    setIsExporting(true)
    setError('')
    try {
      const bundle = await exportKnowledgeBundle(exportQuery, { semantic, limit: 150 })
      const blob = new Blob([bundle.markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge-export-${bundle.mode}-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
      trackTelemetry('knowledge_export', { mode: bundle.mode, itemCount: bundle.itemCount, vectorCount: bundle.vectorCount })
    } catch {
      setError('Не удалось выгрузить базу знаний (Obsidian + vector).')
    } finally {
      setIsExporting(false)
    }
  }

  async function handleKnowledgeExportZip(semantic: boolean): Promise<void> {
    setIsExporting(true)
    setError('')
    try {
      const bundle = await exportKnowledgeBundle(exportQuery, { semantic, limit: 150 })
      const zip = new JSZip()
      zip.file('knowledge.md', bundle.markdown)
      zip.file('items.json', JSON.stringify(bundle.items, null, 2))
      zip.file(
        'vectors.json',
        JSON.stringify(
          bundle.items
            .filter((item) => item.embeddingModel || item.distance !== null)
            .map((item) => ({
              knowledgeItemId: item.knowledgeItemId,
              title: item.title,
              embeddingModel: item.embeddingModel ?? null,
              distance: item.distance ?? null,
            })),
          null,
          2,
        ),
      )
      zip.file(
        'manifest.json',
        JSON.stringify(
          {
            workspaceId: bundle.workspaceId,
            query: bundle.query,
            mode: bundle.mode,
            generatedAt: bundle.generatedAt,
            itemCount: bundle.itemCount,
            vectorCount: bundle.vectorCount,
            format: 'bookmarks-bro-knowledge-export-v1',
          },
          null,
          2,
        ),
      )

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge-export-${bundle.mode}-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      trackTelemetry('knowledge_export_zip', {
        mode: bundle.mode,
        itemCount: bundle.itemCount,
        vectorCount: bundle.vectorCount,
      })
    } catch {
      setError('Не удалось выгрузить ZIP базы знаний.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="bb-shell max-w-7xl mx-auto p-6 space-y-6">
      <header className="bb-card p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="bb-kicker">Bookmarks Bro · build {BOOKMARKS_BRO_BUILD}</p>
            <h1 className="bb-title">Knowledge Workspace</h1>
            <p className="bb-subtitle">
              Поиск, идеи, напоминания и выгрузка базы знаний через agent-api (персистентность UI на сервере).
            </p>
            <p className="text-xs text-[#807d72] mt-1">
              Sync: {uiSyncStatusLabel(syncStatus)}
              {syncStatus === 'error' || syncStatus === 'offline' ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="underline text-[#f54e00]"
                    onClick={() => void syncWorkspaceUiStateNow()}
                  >
                    Повторить
                  </button>
                </>
              ) : null}
            </p>
          </div>
          <button type="button" className="bb-btn-primary" onClick={() => void handleSearch()}>
            {isLoading ? 'Searching…' : 'Run Search'}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bb-stat"><span>Results</span><strong>{searchItems.length}</strong></div>
          <div className="bb-stat"><span>Ideas</span><strong>{ideas.length}</strong></div>
          <div className="bb-stat"><span>Published KB</span><strong>{publishedCount}</strong></div>
          <div className="bb-stat"><span>Total tokens</span><strong>{totalTokens}</strong></div>
        </div>
        <div className="bb-ingest">
          <input
            className="bb-ingest-input"
            value={ingestValue}
            onChange={(e) => setIngestValue(e.target.value)}
            placeholder="Paste URL or type a quick note..."
          />
          <button type="button" className="bb-ingest-btn" onClick={handleQuickIngest} disabled={isIngesting}>
            {isIngesting ? '…' : '+'}
          </button>
        </div>
      </header>

      <nav className="bb-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`bb-tab ${tab === item.key ? 'bb-tab-active' : ''}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === 'search' && (
        <section className="grid xl:grid-cols-[1fr_360px] gap-4">
          <div className="bb-card p-5 space-y-4">
            <div className="grid md:grid-cols-4 gap-3">
              <input
                className="bb-input md:col-span-2"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по заметкам, закладкам и ссылкам"
              />
              <select
                className="bb-input"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as SourceKind | 'All')}
              >
                <option value="All">All sources</option>
                <option value="Obsidian">Obsidian</option>
                <option value="Bookmarks">Bookmarks</option>
                <option value="Links">Links</option>
              </select>
              <button type="button" className="bb-btn-secondary" onClick={() => void handleSearch()}>
                {isLoading ? 'Searching…' : 'Search'}
              </button>
            </div>

            <ul className="space-y-3">
              {searchItems.map((item) => (
                <li key={item.id} className="bb-card p-3">
                  <label className="flex gap-3 items-start">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelect(item.id)} />
                    <span className="space-y-1">
                      <span className="block font-medium text-[#26251e]">{item.title}</span>
                      <span className="block text-sm text-[#5a5852]">{item.snippet}</span>
                      <span className="block text-xs text-[#807d72]">
                        {item.source} · relevance {(item.relevance * 100).toFixed(0)}%
                      </span>
                      {item.link && (
                        <a className="text-xs text-[#f54e00] break-all" href={item.link} target="_blank" rel="noreferrer">
                          {item.link}
                        </a>
                      )}
                    </span>
                  </label>
                </li>
              ))}
              {!searchItems.length && <li className="text-sm text-[#807d72]">Запустите поиск, чтобы увидеть результаты.</li>}
            </ul>
          </div>

          <aside className="bb-card p-5 space-y-4">
            <h3 className="font-semibold text-[#26251e]">Quick actions</h3>
            <input
              className="bb-input"
              value={taskForIdeas}
              onChange={(e) => setTaskForIdeas(e.target.value)}
              placeholder="Цель генерации идей"
            />
            <button type="button" className="bb-btn-primary w-full" onClick={() => void handleGenerateIdeas()}>
              Create ideas from selection
            </button>
            <button type="button" className="bb-btn-secondary w-full" onClick={() => void handleGenerateIdeasFromDb()}>
              {isDbIdeasLoading ? 'Generating DB ideas…' : 'Generate ideas from full DB'}
            </button>
            <input
              className="bb-input"
              value={knowledgeTitle}
              onChange={(e) => setKnowledgeTitle(e.target.value)}
              placeholder="Название knowledge draft"
            />
            <button type="button" className="bb-btn-secondary w-full" onClick={createKnowledgeDraft}>
              Add selection to KB
            </button>
            <p className="text-xs text-[#807d72]">Selected: {selectedSearchItems.length}</p>
          </aside>
        </section>
      )}

      {tab === 'ideas' && (
        <section className="space-y-3">
          {!!searchItems.length && (
            <article className="bb-card p-4 space-y-3">
              <h3 className="font-medium text-[#26251e]">Synthesize from current knowledge</h3>
              <p className="text-sm text-[#5a5852]">
                Сгенерировать идеи на основе текущих результатов поиска и заметок.
              </p>
              <button
                type="button"
                className="bb-btn-primary"
                onClick={() => {
                  if (!selectedIds.length) {
                    setSelectedIds(searchItems.slice(0, 3).map((row) => row.id))
                  }
                  void handleGenerateIdeas()
                }}
              >
                Assemble Insights
              </button>
              <button type="button" className="bb-btn-secondary" onClick={() => void handleGenerateIdeasFromDb()}>
                {isDbIdeasLoading ? 'Generating…' : 'DB-wide synthesis'}
              </button>
            </article>
          )}
          {ideas.map((idea) => (
            <article key={idea.id} className="bb-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-[#26251e]">{idea.title}</h3>
                <span className="bb-pill">{idea.priority}</span>
              </div>
              <p className="text-sm text-[#5a5852]">{idea.context}</p>
              <div className="flex gap-2">
                <button type="button" className="bb-btn-secondary" onClick={() => addReminder({ ...idea, status: 'active' })}>
                  Set Reminder
                </button>
              </div>
            </article>
          ))}
          {!ideas.length && <p className="text-sm text-[#807d72]">Пока нет идей. Сначала выполните поиск и генерацию.</p>}
        </section>
      )}

      {tab === 'notes' && (
        <section className="bb-card p-5 space-y-4">
          <div className="grid md:grid-cols-4 gap-3">
            <input
              className="bb-input md:col-span-3"
              value={notesQuery}
              onChange={(e) => setNotesQuery(e.target.value)}
              placeholder="Поиск и sync заметок Obsidian"
            />
            <button type="button" className="bb-btn-secondary" onClick={() => void handleSyncNotes()}>
              {isNotesLoading ? 'Syncing…' : 'Sync Notes'}
            </button>
          </div>
          <ul className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="bb-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-[#26251e]">{note.title}</h3>
                  <span className="bb-pill">{note.source}</span>
                </div>
                <p className="text-sm text-[#5a5852]">{note.content}</p>
                {note.link && (
                  <a className="text-xs text-[#f54e00] break-all" href={note.link} target="_blank" rel="noreferrer">
                    {note.link}
                  </a>
                )}
              </li>
            ))}
            {!notes.length && <li className="text-sm text-[#807d72]">Нажмите Sync Notes для загрузки заметок.</li>}
          </ul>
        </section>
      )}

      {tab === 'reminders' && (
        <section className="space-y-3">
          {reminders.map((reminder) => (
            <article key={reminder.id} className="bb-card p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-[#26251e]">{reminder.title}</p>
                <p className="text-xs text-[#807d72]">{new Date(reminder.remindAt).toLocaleString()}</p>
              </div>
              <button
                type="button"
                className="bb-btn-secondary"
                onClick={() =>
                  setReminders((prev) => prev.map((item) => (item.id === reminder.id ? { ...item, done: true } : item)))
                }
              >
                {reminder.done ? 'Done' : 'Mark done'}
              </button>
            </article>
          ))}
          {!reminders.length && <p className="text-sm text-[#807d72]">Напоминаний пока нет.</p>}
        </section>
      )}

      {tab === 'knowledge' && (
        <section className="space-y-3">
          <article className="bb-card p-4 space-y-3">
            <h3 className="font-medium text-[#26251e]">Export Obsidian + vector knowledge</h3>
            <div className="grid md:grid-cols-3 gap-3">
              <input
                className="bb-input md:col-span-2"
                value={exportQuery}
                onChange={(e) => setExportQuery(e.target.value)}
                placeholder="Export query (optional, default: knowledge)"
              />
              <button type="button" className="bb-btn-primary" onClick={() => void handleKnowledgeExport(true)}>
                {isExporting ? 'Exporting…' : 'Export semantic'}
              </button>
            </div>
            <button type="button" className="bb-btn-secondary" onClick={() => void handleKnowledgeExport(false)}>
              Export text mode
            </button>
            <div className="grid md:grid-cols-2 gap-3">
              <button type="button" className="bb-btn-primary" onClick={() => void handleKnowledgeExportZip(true)}>
                {isExporting ? 'Exporting ZIP…' : 'Export ZIP semantic'}
              </button>
              <button type="button" className="bb-btn-secondary" onClick={() => void handleKnowledgeExportZip(false)}>
                Export ZIP text mode
              </button>
            </div>
          </article>
          {knowledgeItems.map((item) => (
            <article key={item.id} className="bb-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-[#26251e]">{item.title}</h3>
                <span className="bb-pill">{item.status}</span>
              </div>
              <p className="text-sm text-[#5a5852] whitespace-pre-wrap">{item.summary}</p>
              <div className="flex gap-2">
                <button type="button" className="bb-btn-primary" onClick={() => publishKnowledge(item.id)}>
                  Publish
                </button>
                <button type="button" className="bb-btn-secondary" onClick={() => downloadKnowledge(item)}>
                  Export Markdown
                </button>
              </div>
            </article>
          ))}
          {!knowledgeItems.length && <p className="text-sm text-[#807d72]">Draft-ов базы знаний пока нет.</p>}
          {!!tokenUsage.length && (
            <div className="bb-card p-4 space-y-2">
              <h3 className="font-medium text-[#26251e]">Token usage by task</h3>
              <ul className="space-y-1">
                {tokenUsage.map((usage) => (
                  <li key={usage.id} className="text-xs text-[#5a5852]">
                    {usage.taskName}: total {usage.totalTokens} (prompt {usage.promptTokens}, completion {usage.completionTokens})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
