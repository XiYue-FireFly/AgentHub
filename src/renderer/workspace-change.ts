export const WORKSPACE_CHANGE_EVENT = 'agenthub:workspace-change'

export type WorkspaceChangeDetail =
  | { kind: 'known'; activeWorkspaceId: string | null }
  | { kind: 'invalidate' }

export function notifyWorkspaceChange(detail: WorkspaceChangeDetail): void {
  window.dispatchEvent(new CustomEvent<WorkspaceChangeDetail>(WORKSPACE_CHANGE_EVENT, {
    detail
  }))
}

export function onWorkspaceChange(listener: (detail: WorkspaceChangeDetail) => void): () => void {
  const handleChange = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    if ((detail as { kind?: unknown }).kind === 'invalidate') {
      listener({ kind: 'invalidate' })
      return
    }
    if ((detail as { kind?: unknown }).kind !== 'known') return
    const activeWorkspaceId = (detail as { activeWorkspaceId?: unknown }).activeWorkspaceId
    if (activeWorkspaceId !== null && typeof activeWorkspaceId !== 'string') return
    listener({ kind: 'known', activeWorkspaceId })
  }
  window.addEventListener(WORKSPACE_CHANGE_EVENT, handleChange)
  return () => window.removeEventListener(WORKSPACE_CHANGE_EVENT, handleChange)
}
