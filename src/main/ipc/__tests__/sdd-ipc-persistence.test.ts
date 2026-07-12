import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>()
}))

const workspaceMock = vi.hoisted(() => ({
  rootPath: ''
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
    list: () => [{ id: 'ws-1', rootPath: workspaceMock.rootPath }]
  })
}))

describe('SDD IPC persistence ordering', () => {
  beforeEach(async () => {
    vi.resetModules()
    electronMock.handlers.clear()
    workspaceMock.rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-sdd-ipc-'))
    const { registerSddIpc } = await import('../sdd-ipc')
    registerSddIpc()
  })

  afterEach(async () => {
    await fs.rm(workspaceMock.rootPath, { recursive: true, force: true })
  })

  async function createDraft() {
    const handler = electronMock.handlers.get('sdd:createDraft')!
    const draft = await handler({}, workspaceMock.rootPath, 'Draft', 'blank')
    expect(draft).toBeTruthy()
    return draft as { id: string }
  }

  function draftDir(draftId: string): string {
    return path.join(workspaceMock.rootPath, '.agenthub', 'requirements', draftId)
  }

  function traceFor(draftId: string) {
    return {
      draftId,
      requirementBlocks: [],
      planItems: [],
      coverage: {},
      derivedStatuses: {},
      uncoveredRequirementIds: [],
      timestamp: new Date().toISOString()
    }
  }

  it.each([
    { channel: 'sdd:saveTrace', args: (draftId: string) => [traceFor(draftId)] },
    { channel: 'sdd:saveHistory', args: (_draftId: string) => [[]] },
    { channel: 'sdd:clearHistory', args: (_draftId: string) => [] }
  ] as const)('does not recreate a deleted draft through late $channel', async ({ channel, args }) => {
    const draft = await createDraft()
    await electronMock.handlers.get('sdd:deleteDraft')!({}, workspaceMock.rootPath, draft.id)
    await expect(fs.access(draftDir(draft.id))).rejects.toMatchObject({ code: 'ENOENT' })

    await electronMock.handlers.get(channel)!({}, workspaceMock.rootPath, draft.id, ...args(draft.id))

    await expect(fs.access(draftDir(draft.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { channel: 'sdd:saveTrace', args: (draftId: string) => [traceFor(draftId)] },
    { channel: 'sdd:saveHistory', args: (_draftId: string) => [[]] }
  ] as const)('keeps the draft deleted when $channel is queued before delete', async ({ channel, args }) => {
    const draft = await createDraft()
    await electronMock.handlers.get(channel)!({}, workspaceMock.rootPath, draft.id, ...args(draft.id))

    await electronMock.handlers.get('sdd:deleteDraft')!({}, workspaceMock.rootPath, draft.id)

    await expect(fs.access(draftDir(draft.id))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
