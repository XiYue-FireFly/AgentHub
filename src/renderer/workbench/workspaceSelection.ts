export const LAST_WORKSPACE_STORE_KEY = 'agenthub.workbench.lastWorkspace.v1'
export const PERSONAL_WORKSPACE_SENTINEL = '__agenthub_personal_workspace__'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type WorkspaceLike = { id: string }

export function readRememberedWorkspaceId(storage: StorageLike = localStorage): string | null {
  try {
    return storage.getItem(LAST_WORKSPACE_STORE_KEY)
  } catch {
    return null
  }
}

export function rememberWorkbenchWorkspaceId(id: string | null, storage: StorageLike = localStorage): void {
  try {
    if (id) storage.setItem(LAST_WORKSPACE_STORE_KEY, id)
    else storage.setItem(LAST_WORKSPACE_STORE_KEY, PERSONAL_WORKSPACE_SENTINEL)
  } catch {
    // Best-effort UI state only.
  }
}

export function resolveWorkbenchWorkspaceId(input: {
  requestedWorkspaceId?: string | null
  currentWorkspaceId: string | null
  activeWorkspaceId: string | null
  rememberedWorkspaceId: string | null
  workspaces: readonly WorkspaceLike[]
}): string | null {
  if (input.requestedWorkspaceId !== undefined) return input.requestedWorkspaceId

  const visibleIds = new Set(input.workspaces.map(workspace => workspace.id))
  if (input.currentWorkspaceId && visibleIds.has(input.currentWorkspaceId)) return input.currentWorkspaceId
  if (input.activeWorkspaceId && visibleIds.has(input.activeWorkspaceId)) return input.activeWorkspaceId
  if (input.rememberedWorkspaceId === PERSONAL_WORKSPACE_SENTINEL) return null
  if (input.rememberedWorkspaceId && visibleIds.has(input.rememberedWorkspaceId)) return input.rememberedWorkspaceId
  return input.workspaces[0]?.id ?? null
}
