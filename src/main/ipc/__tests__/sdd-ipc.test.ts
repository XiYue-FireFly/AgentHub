import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { join, resolve, sep } from 'node:path'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>()
}))

const workspaceMock = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; rootPath: string }>
}))

const sddStoreMock = vi.hoisted(() => {
  const updateDraft = vi.fn()
  const getDraft = vi.fn()
  const deleteDraft = vi.fn()
  const saveTrace = vi.fn()
  const getTrace = vi.fn()
  const getHistory = vi.fn()
  const saveHistory = vi.fn()
  const clearHistory = vi.fn()
  const exists = vi.fn()
  return {
    updateDraft,
    getDraft,
    deleteDraft,
    saveTrace,
    getTrace,
    getHistory,
    saveHistory,
    clearHistory,
    exists,
    createSddStore: vi.fn(() => ({
      listDrafts: vi.fn(async () => [{ id: 'draft-1' }]),
      createDraft: vi.fn(async () => ({ id: 'draft-1' })),
      updateDraft,
      getDraft,
      deleteDraft,
      saveTrace,
      getTrace,
      getHistory,
      saveHistory,
      clearHistory,
      exists
    }))
  }
})

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

async function setupUpdateHandler(registeredRoots?: string[]) {
  vi.resetModules()
  electronMock.handlers.clear()
  sddStoreMock.createSddStore.mockClear()
  sddStoreMock.updateDraft.mockReset()
  sddStoreMock.getDraft.mockReset()
  sddStoreMock.deleteDraft.mockReset()
  sddStoreMock.saveTrace.mockReset()
  sddStoreMock.getTrace.mockReset()
  sddStoreMock.getHistory.mockReset()
  sddStoreMock.saveHistory.mockReset()
  sddStoreMock.clearHistory.mockReset()
  sddStoreMock.exists.mockReset()
  const registeredRoot = registeredRoots?.[0] ?? resolve(process.cwd(), 'registered-workspace')
  workspaceMock.workspaces = (registeredRoots ?? [registeredRoot]).map((rootPath, index) => ({
    id: `ws-${index + 1}`,
    rootPath
  }))
  const { registerSddIpc } = await import('../sdd-ipc')
  registerSddIpc()
  return {
    registeredRoot,
    updateDraft: electronMock.handlers.get('sdd:updateDraft')!,
    getDraft: electronMock.handlers.get('sdd:getDraft')!,
    deleteDraft: electronMock.handlers.get('sdd:deleteDraft')!
  }
}

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

describe('SDD IPC draft update queue', () => {
  it('serializes full snapshots for the same canonical root and draft id', async () => {
    const { registeredRoot, updateDraft } = await setupUpdateHandler()
    const equivalentRoot = `${registeredRoot}${sep}.`
    const started: string[] = []
    let releaseA!: () => void
    const waitForA = new Promise<void>(resolve => { releaseA = resolve })
    sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
      started.push(options.content)
      if (options.content === 'A') await waitForA
    })

    const saveA = updateDraft({}, registeredRoot, 'draft-1', 'A', { brandColor: '#111111', tone: ['calm'] })
    await vi.waitFor(() => expect(started).toEqual(['A']))
    const saveB = updateDraft({}, equivalentRoot, 'draft-1', 'B', { brandColor: '#222222', tone: ['bold'] })
    await Promise.resolve()

    expect(started).toEqual(['A'])
    releaseA()
    await Promise.all([saveA, saveB])

    expect(started).toEqual(['A', 'B'])
    expect(sddStoreMock.updateDraft.mock.calls).toEqual([
      ['draft-1', { content: 'A', designContext: { brandColor: '#111111', tone: ['calm'] } }],
      ['draft-1', { content: 'B', designContext: { brandColor: '#222222', tone: ['bold'] } }]
    ])
  })

  it('continues the same-key queue after a rejected update', async () => {
    const { registeredRoot, updateDraft } = await setupUpdateHandler()
    const started: string[] = []
    sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
      started.push(options.content)
      if (options.content === 'A') throw new Error('disk full')
    })

    const results = await Promise.allSettled([
      updateDraft({}, registeredRoot, 'draft-1', 'A', { brandColor: '#111111' }),
      updateDraft({}, registeredRoot, 'draft-1', 'B', { brandColor: '#222222' })
    ])

    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
    expect(started).toEqual(['A', 'B'])
  })

  it('waits for a pending same-key update before reading the latest draft', async () => {
    const { registeredRoot, updateDraft, getDraft } = await setupUpdateHandler()
    let storedContent = 'old'
    let releaseUpdate!: () => void
    const waitForUpdate = new Promise<void>(resolve => { releaseUpdate = resolve })
    sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
      await waitForUpdate
      storedContent = options.content
    })
    sddStoreMock.getDraft.mockImplementation(async (draftId: string) => ({ id: draftId, content: storedContent }))

    const saving = updateDraft({}, registeredRoot, 'draft-1', 'new')
    await vi.waitFor(() => expect(sddStoreMock.updateDraft).toHaveBeenCalledOnce())
    const reading = getDraft({}, registeredRoot, 'draft-1')
    await Promise.resolve()

    expect(sddStoreMock.getDraft).not.toHaveBeenCalled()
    releaseUpdate()
    await expect(saving).resolves.toBeUndefined()
    await expect(reading).resolves.toMatchObject({ content: 'new' })
  })

  it('keeps a same-key update behind an in-progress consistent draft read', async () => {
    const { registeredRoot, updateDraft, getDraft } = await setupUpdateHandler()
    const order: string[] = []
    let storedContent = 'A'
    let releaseRead!: () => void
    const waitForRead = new Promise<void>(resolve => { releaseRead = resolve })
    sddStoreMock.getDraft.mockImplementation(async (draftId: string) => {
      order.push('read:start')
      const snapshot = { id: draftId, content: storedContent }
      await waitForRead
      order.push('read:end')
      return snapshot
    })
    sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
      order.push('update')
      storedContent = options.content
    })

    const reading = getDraft({}, registeredRoot, 'draft-1')
    await vi.waitFor(() => expect(order).toEqual(['read:start']))
    const saving = updateDraft({}, registeredRoot, 'draft-1', 'B')
    await Promise.resolve()

    expect(order).toEqual(['read:start'])
    releaseRead()
    await expect(reading).resolves.toMatchObject({ content: 'A' })
    await expect(saving).resolves.toBeUndefined()
    expect(order).toEqual(['read:start', 'read:end', 'update'])
    expect(storedContent).toBe('B')
  })

  it.each([
    { channel: 'sdd:computeTrace', observer: 'getDraft', args: ['# plan'] },
    { channel: 'sdd:saveTrace', observer: 'saveTrace', args: [{ draftId: 'draft-1' }] },
    { channel: 'sdd:getTrace', observer: 'getTrace', args: [] },
    { channel: 'sdd:getHistory', observer: 'getHistory', args: [] },
    { channel: 'sdd:saveHistory', observer: 'saveHistory', args: [[]] },
    { channel: 'sdd:clearHistory', observer: 'clearHistory', args: [] },
    { channel: 'sdd:exists', observer: 'exists', args: [] }
  ] as const)('queues $channel behind a pending same-key update', async ({ channel, observer, args }) => {
    const { registeredRoot, updateDraft } = await setupUpdateHandler()
    let releaseUpdate!: () => void
    const waitForUpdate = new Promise<void>(resolve => { releaseUpdate = resolve })
    sddStoreMock.updateDraft.mockImplementation(async () => { await waitForUpdate })
    sddStoreMock.getDraft.mockResolvedValue({ id: 'draft-1', content: '# Draft' })
    sddStoreMock.exists.mockResolvedValue(true)
    const observed = sddStoreMock[observer]
    const handler = electronMock.handlers.get(channel)!

    const saving = updateDraft({}, registeredRoot, 'draft-1', 'B')
    await vi.waitFor(() => expect(sddStoreMock.updateDraft).toHaveBeenCalledOnce())
    const operation = handler({}, registeredRoot, 'draft-1', ...args)
    await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate))

    try {
      expect(observed).not.toHaveBeenCalled()
    } finally {
      releaseUpdate()
      await Promise.allSettled([saving, operation])
    }
    expect(observed).toHaveBeenCalledOnce()
  })

  it('continues with a same-key write after a draft read rejects', async () => {
    const { registeredRoot, updateDraft, getDraft } = await setupUpdateHandler()
    sddStoreMock.getDraft.mockRejectedValue(new Error('read failed'))
    sddStoreMock.updateDraft.mockResolvedValue(undefined)

    const results = await Promise.allSettled([
      getDraft({}, registeredRoot, 'draft-1'),
      updateDraft({}, registeredRoot, 'draft-1', 'B')
    ])

    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
    expect(sddStoreMock.updateDraft).toHaveBeenCalledOnce()
  })

  it('queues same-key delete after a pending update so the draft cannot be resurrected', async () => {
    const { registeredRoot, updateDraft, deleteDraft } = await setupUpdateHandler()
    const order: string[] = []
    let exists = true
    let releaseUpdate!: () => void
    const waitForUpdate = new Promise<void>(resolve => { releaseUpdate = resolve })
    sddStoreMock.updateDraft.mockImplementation(async () => {
      order.push('update:start')
      await waitForUpdate
      exists = true
      order.push('update:end')
    })
    sddStoreMock.deleteDraft.mockImplementation(async () => {
      exists = false
      order.push('delete')
    })

    const saving = updateDraft({}, registeredRoot, 'draft-1', 'new')
    await vi.waitFor(() => expect(order).toEqual(['update:start']))
    const deleting = deleteDraft({}, registeredRoot, 'draft-1')
    await Promise.resolve()

    expect(order).toEqual(['update:start'])
    releaseUpdate()
    await Promise.all([saving, deleting])
    expect(order).toEqual(['update:start', 'update:end', 'delete'])
    expect(exists).toBe(false)
  })

  it('keeps C behind pending B after rejected A for the same key', async () => {
    const { registeredRoot, updateDraft } = await setupUpdateHandler()
    const started: string[] = []
    let releaseB!: () => void
    const waitForB = new Promise<void>(resolve => { releaseB = resolve })
    sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
      started.push(options.content)
      if (options.content === 'A') throw new Error('disk full')
      if (options.content === 'B') await waitForB
    })

    const results = Promise.allSettled([
      updateDraft({}, registeredRoot, 'draft-1', 'A'),
      updateDraft({}, registeredRoot, 'draft-1', 'B'),
      updateDraft({}, registeredRoot, 'draft-1', 'C')
    ])
    await vi.waitFor(() => expect(started).toEqual(['A', 'B']))
    await Promise.resolve()
    expect(started).toEqual(['A', 'B'])

    releaseB()
    await expect(results).resolves.toMatchObject([
      { status: 'rejected' },
      { status: 'fulfilled' },
      { status: 'fulfilled' }
    ])
    expect(started).toEqual(['A', 'B', 'C'])
  })

  it('does not block updates for different draft keys', async () => {
    const { registeredRoot, updateDraft } = await setupUpdateHandler()
    const started: string[] = []
    let releaseA!: () => void
    const waitForA = new Promise<void>(resolve => { releaseA = resolve })
    sddStoreMock.updateDraft.mockImplementation(async (draftId: string) => {
      started.push(draftId)
      if (draftId === 'draft-1') await waitForA
    })

    const saveA = updateDraft({}, registeredRoot, 'draft-1', 'A', { brandColor: '#111111' })
    await vi.waitFor(() => expect(started).toEqual(['draft-1']))
    const saveB = updateDraft({}, registeredRoot, 'draft-2', 'B', { brandColor: '#222222' })
    await vi.waitFor(() => expect(started).toEqual(['draft-1', 'draft-2']))

    releaseA()
    await Promise.all([saveA, saveB])
  })

  it('serializes the same draft through registered physical and junction workspace aliases', async () => {
    const tempRoot = await fs.mkdtemp(join(os.tmpdir(), 'agenthub-sdd-queue-'))
    const physicalRoot = join(tempRoot, 'physical')
    const aliasRoot = join(tempRoot, 'alias')
    await fs.mkdir(physicalRoot)
    await fs.symlink(physicalRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
    let releaseA!: () => void
    const waitForA = new Promise<void>(resolve => { releaseA = resolve })
    let saveA: Promise<unknown> | undefined
    let saveB: Promise<unknown> | undefined
    try {
      const { updateDraft } = await setupUpdateHandler([physicalRoot, aliasRoot])
      const started: string[] = []
      sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
        started.push(options.content)
        if (options.content === 'A') await waitForA
      })

      saveA = updateDraft({}, physicalRoot, 'draft-1', 'A')
      await vi.waitFor(() => expect(started).toEqual(['A']))
      saveB = updateDraft({}, aliasRoot, 'draft-1', 'B')
      await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate))

      expect(started).toEqual(['A'])
      releaseA()
      await Promise.all([saveA, saveB])
      expect(started).toEqual(['A', 'B'])
    } finally {
      releaseA()
      await Promise.allSettled([saveA, saveB].filter((value): value is Promise<unknown> => Boolean(value)))
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('serializes Windows case variants of the same draft id', async () => {
    const { registeredRoot, updateDraft } = await setupUpdateHandler()
    const started: string[] = []
    let releaseA!: () => void
    const waitForA = new Promise<void>(resolve => { releaseA = resolve })
    sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
      started.push(options.content)
      if (options.content === 'A') await waitForA
    })

    const saveA = updateDraft({}, registeredRoot, 'draft-1', 'A')
    await vi.waitFor(() => expect(started).toEqual(['A']))
    const saveB = updateDraft({}, registeredRoot, 'DRAFT-1', 'B')
    await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate))

    try {
      expect(started).toEqual(['A'])
    } finally {
      releaseA()
      await Promise.allSettled([saveA, saveB])
    }
    expect(started).toEqual(['A', 'B'])
  })

  it('reuses the last verified physical queue identity when a registered alias temporarily disappears', async () => {
    const tempRoot = await fs.mkdtemp(join(os.tmpdir(), 'agenthub-sdd-queue-cache-'))
    const physicalRoot = join(tempRoot, 'physical')
    const aliasRoot = join(tempRoot, 'alias')
    const hiddenAlias = join(tempRoot, 'alias-hidden')
    await fs.mkdir(physicalRoot)
    await fs.symlink(physicalRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
    let releaseA!: () => void
    const waitForA = new Promise<void>(resolve => { releaseA = resolve })
    let saveA: Promise<unknown> | undefined
    let saveB: Promise<unknown> | undefined
    try {
      const { updateDraft } = await setupUpdateHandler([aliasRoot])
      const started: string[] = []
      sddStoreMock.updateDraft.mockImplementation(async (_draftId: string, options: { content: string }) => {
        started.push(options.content)
        if (options.content === 'A') await waitForA
      })

      saveA = updateDraft({}, aliasRoot, 'draft-1', 'A')
      await vi.waitFor(() => expect(started).toEqual(['A']))
      await fs.rename(aliasRoot, hiddenAlias)
      saveB = updateDraft({}, aliasRoot, 'draft-1', 'B')
      await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate))

      expect(started).toEqual(['A'])
      releaseA()
      await Promise.all([saveA, saveB])
      expect(started).toEqual(['A', 'B'])
    } finally {
      releaseA()
      await Promise.allSettled([saveA, saveB].filter((value): value is Promise<unknown> => Boolean(value)))
      await fs.rm(tempRoot, { recursive: true, force: true })
    }
  })
})
