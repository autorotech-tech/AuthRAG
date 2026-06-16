export type UiSyncStatus = 'idle' | 'hydrating' | 'syncing' | 'synced' | 'error' | 'offline'

let status: UiSyncStatus = 'idle'
const listeners = new Set<(s: UiSyncStatus) => void>()

export function getUiSyncStatus(): UiSyncStatus {
  return status
}

export function setUiSyncStatus(next: UiSyncStatus): void {
  if (status === next) return
  status = next
  for (const fn of listeners) fn(next)
}

export function subscribeUiSyncStatus(fn: (s: UiSyncStatus) => void): () => void {
  listeners.add(fn)
  fn(status)
  return () => listeners.delete(fn)
}

export function uiSyncStatusLabel(s: UiSyncStatus): string {
  switch (s) {
    case 'hydrating':
      return 'Загрузка с сервера…'
    case 'syncing':
      return 'Сохранение…'
    case 'synced':
      return 'Синхронизировано'
    case 'error':
      return 'Ошибка синхронизации'
    case 'offline':
      return 'Локально (сервер недоступен)'
    default:
      return '—'
  }
}
