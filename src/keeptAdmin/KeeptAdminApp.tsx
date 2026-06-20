import { Link, Navigate, Route, Routes } from 'react-router-dom'

function ModerationPlaceholder() {
  return (
    <section className="rounded-2xl border border-stone-200 bg-[#f7f7f4] p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Keept Admin</p>
      <h1 className="mt-2 text-2xl font-semibold text-[#26251e]">Moderation</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">
        Панель модерации контента (PII / prompt injection). Реализация — Antigravity по{' '}
        <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">docs/bookmarks-bro/ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md</code>
        . API уже доступен:{' '}
        <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">GET/POST /api/v1/keept/moderation/*</code>
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/bookmarks-bro"
          className="inline-flex items-center rounded-lg bg-[#f54e00] px-4 py-2 text-sm font-medium text-white hover:bg-[#e04800]"
        >
          User app
        </Link>
        <a
          href="https://www.kaggle.com/competitions/vibecoding-agents-capstone-project"
          className="inline-flex items-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-[#26251e] hover:bg-stone-50"
          target="_blank"
          rel="noreferrer"
        >
          Kaggle Capstone
        </a>
      </div>
    </section>
  )
}

export function KeeptAdminApp() {
  return (
    <div className="min-h-screen bg-[#f7f7f4] text-[#26251e]">
      <div className="mx-auto flex min-h-screen max-w-6xl gap-6 px-4 py-6 md:px-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <p className="text-lg font-semibold">Keept Admin</p>
          <p className="mt-1 text-xs text-stone-500">keept.me · moderation</p>
          <nav className="mt-6 space-y-1 text-sm">
            <Link to="/keept/admin" className="block rounded-lg bg-white px-3 py-2 font-medium shadow-sm">
              Moderation
            </Link>
            <span className="block rounded-lg px-3 py-2 text-stone-400">Metrics (soon)</span>
            <span className="block rounded-lg px-3 py-2 text-stone-400">Settings (soon)</span>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Routes>
            <Route index element={<ModerationPlaceholder />} />
            <Route path="*" element={<Navigate to="/keept/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
