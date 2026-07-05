import { describe, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>()
}))

const workspaceMock = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; rootPath: string }>
}))

const sddStoreMock = vi.hoisted(() => ({
  createSddStore: vi.fn(() => ({
    listDrafts: vi.fn(async () => [{ id: 'draft-1' }]),
    createDraft: vi.fn(async () => ({ id: 'draft-1' }))
  }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../hub/workspace', () => ({
  getWorkspaceManager: () => ({
    list: () => workspaceMock.workspaces
  })
}))

vi.mock('../../sdd/sdd-store', () => sddStoreMock)

describe('SDD IPC workspace trust', () => {
  it('rejects SDD operations outside registered workspace roots', async () => {
    vi.resetModules()
    electronMock.handlers.clear()
    sddStoreMock.createSddStore.mockClear()
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    const otherRoot = resolve(process.cwd(), 'other-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]

    const { registerSddIpc } = await import('../sdd-ipc')
    registerSddIpc()

    const listDrafts = electronMock.handlers.get('sdd:listDrafts')
    const createDraft = electronMock.handlers.get('sdd:createDraft')

    await expect(listDrafts?.({}, registeredRoot)).resolves.toEqual([{ id: 'draft-1' }])
    await expect(listDrafts?.({}, otherRoot)).resolves.toEqual([])
    await expect(createDraft?.({}, otherRoot, 'Title')).resolves.toBeNull()
  })

  it('uses the registered canonical workspace root after validation', async () => {
    vi.resetModules()
    electronMock.handlers.clear()
    sddStoreMock.createSddStore.mockClear()
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    const equivalentRoot = `${registeredRoot}${sep}.`
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]

    const { registerSddIpc } = await import('../sdd-ipc')
    registerSddIpc()

    const listDrafts = electronMock.handlers.get('sdd:listDrafts')
    await expect(listDrafts?.({}, equivalentRoot)).resolves.toEqual([{ id: 'draft-1' }])

    expect(sddStoreMock.createSddStore).toHaveBeenCalledWith(registeredRoot)
    expect(sddStoreMock.createSddStore).not.toHaveBeenCalledWith(equivalentRoot)
  })
})
