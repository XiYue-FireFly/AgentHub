import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

describe('memory IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.resetModules()
  })

  async function setup() {
    const approvedEntry = {
      id: 'memory-1',
      category: 'preference',
      title: 'Concise output',
      summary: 'Prefer concise output',
      tags: ['style'],
      status: 'approved',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
      metadata: { pinned: true }
    }
    const candidateEntry = {
      ...approvedEntry,
      id: 'candidate-1',
      status: 'candidate'
    }
    const memory = {
      getCatalog: vi.fn(() => ({
        version: 1,
        root: 'user-data/memory',
        entries: [approvedEntry],
        counts: { preference: 1 },
        settings: { enabled: true }
      })),
      getSettings: vi.fn(() => ({ enabled: true })),
      updateSettings: vi.fn((patch: unknown) => ({ enabled: (patch as { enabled?: boolean }).enabled !== false })),
      listEntries: vi.fn(() => [approvedEntry]),
      searchEntries: vi.fn(() => [approvedEntry]),
      upsertEntry: vi.fn((input: unknown) => ({ ...approvedEntry, ...(input as Record<string, unknown>), id: 'memory-2' })),
      importConversation: vi.fn(() => [candidateEntry]),
      listCandidates: vi.fn(() => [candidateEntry]),
      approveCandidate: vi.fn(() => approvedEntry),
      updateEntry: vi.fn((_id: string, patch: unknown) => ({ ...approvedEntry, ...(patch as Record<string, unknown>) })),
      disableEntry: vi.fn(() => ({ ...approvedEntry, status: 'disabled' })),
      deleteEntry: vi.fn(() => true),
      restoreEntry: vi.fn(() => approvedEntry)
    }

    const { registerMemoryIpc } = await import('../memory-ipc')
    registerMemoryIpc(() => memory as any)
    return { memory, approvedEntry }
  }

  it('delegates catalog, settings, list, and search requests', async () => {
    const { memory } = await setup()

    await expect(Promise.resolve(electronMock.handlers.get('memory:catalog')?.({}))).resolves.toMatchObject({
      version: 1,
      root: 'user-data/memory'
    })
    await expect(Promise.resolve(electronMock.handlers.get('memory:getSettings')?.({}))).resolves.toEqual({ enabled: true })
    await expect(Promise.resolve(electronMock.handlers.get('memory:updateSettings')?.({}, { enabled: false }))).resolves.toEqual({ enabled: false })
    await expect(Promise.resolve(electronMock.handlers.get('memory:list')?.({}, 'preference'))).resolves.toHaveLength(1)
    expect(electronMock.handlers.get('memory:search')?.({}, 'concise', 'preference')).toHaveLength(1)

    expect(memory.updateSettings).toHaveBeenCalledWith({ enabled: false })
    expect(memory.listEntries).toHaveBeenCalledWith('preference')
    expect(memory.searchEntries).toHaveBeenCalledWith('concise', 'preference')
  })

  it('delegates memory mutation requests with arguments intact', async () => {
    const { memory } = await setup()
    const input = { category: 'project', title: 'AgentHub', summary: 'Desktop app' }
    const patch = { title: 'Updated title', metadata: { source: 'settings' } }

    await expect(Promise.resolve(electronMock.handlers.get('memory:addEntry')?.({}, input))).resolves.toMatchObject({ id: 'memory-2', title: 'AgentHub' })
    await expect(Promise.resolve(electronMock.handlers.get('memory:importConversation')?.({}, 'chat', 'content'))).resolves.toHaveLength(1)
    await expect(Promise.resolve(electronMock.handlers.get('memory:listCandidates')?.({}))).resolves.toHaveLength(1)
    await expect(Promise.resolve(electronMock.handlers.get('memory:approveCandidate')?.({}, 'candidate-1'))).resolves.toMatchObject({ id: 'memory-1' })
    await expect(Promise.resolve(electronMock.handlers.get('memory:updateEntry')?.({}, 'memory-1', patch))).resolves.toMatchObject({ title: 'Updated title' })
    await expect(Promise.resolve(electronMock.handlers.get('memory:disableEntry')?.({}, 'memory-1'))).resolves.toMatchObject({ status: 'disabled' })
    expect(electronMock.handlers.get('memory:delete')?.({}, 'memory-1')).toBe(true)
    expect(electronMock.handlers.get('memory:restore')?.({}, 'memory-1')).toMatchObject({ id: 'memory-1' })

    expect(memory.upsertEntry).toHaveBeenCalledWith(input)
    expect(memory.importConversation).toHaveBeenCalledWith('chat', 'content')
    expect(memory.approveCandidate).toHaveBeenCalledWith('candidate-1')
    expect(memory.updateEntry).toHaveBeenCalledWith('memory-1', patch)
    expect(memory.disableEntry).toHaveBeenCalledWith('memory-1')
    expect(memory.deleteEntry).toHaveBeenCalledWith('memory-1')
    expect(memory.restoreEntry).toHaveBeenCalledWith('memory-1')
  })

  it('builds memory graph and cleanup suggestions from IPC payloads', async () => {
    const { approvedEntry } = await setup()
    const graph = electronMock.handlers.get('memory:graph')?.({}, [approvedEntry])

    expect(graph).toMatchObject({
      nodes: [{ id: 'memory-1', pinned: true }],
      stats: { totalNodes: 1, totalEdges: 0, isolatedNodes: 1 }
    })
    expect(electronMock.handlers.get('memory:cleanupSuggestions')?.({}, graph)).toEqual([])
  })
})
