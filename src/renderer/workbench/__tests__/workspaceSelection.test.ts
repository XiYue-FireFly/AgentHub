import { describe, expect, it } from 'vitest'
import {
  LAST_WORKSPACE_STORE_KEY,
  PERSONAL_WORKSPACE_SENTINEL,
  rememberWorkbenchWorkspaceId,
  resolveWorkbenchWorkspaceId
} from '../workspaceSelection'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }
  }
}

describe('workspace selection', () => {
  it('remembers personal chat explicitly when switching away from a workspace', () => {
    const storage = memoryStorage()

    rememberWorkbenchWorkspaceId('workspace-a', storage)
    expect(storage.getItem(LAST_WORKSPACE_STORE_KEY)).toBe('workspace-a')

    rememberWorkbenchWorkspaceId(null, storage)
    expect(storage.getItem(LAST_WORKSPACE_STORE_KEY)).toBe(PERSONAL_WORKSPACE_SENTINEL)
  })

  it('honors explicit workspace requests including personal chat', () => {
    expect(resolveWorkbenchWorkspaceId({
      requestedWorkspaceId: null,
      currentWorkspaceId: 'workspace-a',
      activeWorkspaceId: 'workspace-a',
      rememberedWorkspaceId: 'workspace-a',
      workspaces: [{ id: 'workspace-a' }]
    })).toBeNull()
  })

  it('uses visible active or remembered workspaces before falling back to the first workspace', () => {
    const workspaces = [{ id: 'workspace-a' }, { id: 'workspace-b' }]

    expect(resolveWorkbenchWorkspaceId({
      currentWorkspaceId: null,
      activeWorkspaceId: 'workspace-b',
      rememberedWorkspaceId: 'workspace-a',
      workspaces
    })).toBe('workspace-b')

    expect(resolveWorkbenchWorkspaceId({
      currentWorkspaceId: null,
      activeWorkspaceId: null,
      rememberedWorkspaceId: 'workspace-b',
      workspaces
    })).toBe('workspace-b')

    expect(resolveWorkbenchWorkspaceId({
      currentWorkspaceId: null,
      activeWorkspaceId: null,
      rememberedWorkspaceId: 'deleted-workspace',
      workspaces
    })).toBe('workspace-a')
  })

  it('keeps personal chat on next startup when that was the remembered target', () => {
    expect(resolveWorkbenchWorkspaceId({
      currentWorkspaceId: null,
      activeWorkspaceId: null,
      rememberedWorkspaceId: PERSONAL_WORKSPACE_SENTINEL,
      workspaces: [{ id: 'workspace-a' }]
    })).toBeNull()
  })

  it('auto-selects the first workspace when there is no remembered target', () => {
    expect(resolveWorkbenchWorkspaceId({
      currentWorkspaceId: null,
      activeWorkspaceId: null,
      rememberedWorkspaceId: null,
      workspaces: [{ id: 'workspace-a' }]
    })).toBe('workspace-a')
  })
})
