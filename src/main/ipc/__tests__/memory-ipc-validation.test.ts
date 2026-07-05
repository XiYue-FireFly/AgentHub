import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'
import type { MemoryCatalogLike, MemoryEntryLike, MemoryGraphLike } from '../../../shared/ipc-contract'

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

const memoryEntry: MemoryEntryLike = {
  id: 'memory-1',
  category: 'preference',
  title: 'Concise output',
  summary: 'Prefer concise responses',
  content: 'The user prefers concise responses.',
  source: 'chat',
  tags: ['style'],
  status: 'approved',
  confidence: 0.9,
  metadata: { pinned: true, useCount: 2 },
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

const memoryGraph: MemoryGraphLike = {
  nodes: [
    {
      id: 'memory-1',
      label: 'Concise output',
      category: 'preference',
      status: 'approved',
      pinned: true,
      useCount: 2,
      importance: 0.7,
      tags: ['style']
    }
  ],
  edges: [],
  stats: {
    totalNodes: 1,
    totalEdges: 0,
    isolatedNodes: 1,
    categories: { preference: 1 }
  }
}

const memoryCatalog: MemoryCatalogLike = {
  version: 1,
  root: '',
  entries: [],
  counts: {
    conversation: 0,
    task: 0,
    skill: 0,
    file: 0,
    system: 0,
    preference: 0,
    project: 0,
    style: 0,
    decision: 0,
    correction: 0,
    imported_conversation: 0
  },
  settings: { enabled: true }
}

describe('memory IPC runtime validation', () => {
  it('rejects invalid memory payloads before side effects', async () => {
    const catalogHandler = vi.fn(async () => memoryCatalog)
    const updateSettingsHandler = vi.fn(async () => ({ enabled: true }))
    const listHandler = vi.fn(async () => [])
    const addHandler = vi.fn(async () => memoryEntry)
    const updateHandler = vi.fn(async () => memoryEntry)
    const graphHandler = vi.fn(async () => memoryGraph)
    const cleanupHandler = vi.fn(async () => [])
    const scoreHandler = vi.fn(async () => ({ entryId: '', score: 80, reasons: [] }))
    const conflictsHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('memory:catalog', catalogHandler)
    typedHandle('memory:updateSettings', updateSettingsHandler)
    typedHandle('memory:list', listHandler)
    typedHandle('memory:addEntry', addHandler)
    typedHandle('memory:updateEntry', updateHandler)
    typedHandle('memory:graph', graphHandler)
    typedHandle('memory:cleanupSuggestions', cleanupHandler)
    typedHandle('memory:scoreQuality', scoreHandler)
    typedHandle('memory:detectConflicts', conflictsHandler)

    expect(() => electronMock.handlers.get('memory:catalog')?.({}, 'extra')).toThrow(
      new IpcPayloadValidationError('memory:catalog', 'expected no arguments')
    )
    expect(() => electronMock.handlers.get('memory:updateSettings')?.({}, { enabled: 'yes' })).toThrow(
      new IpcPayloadValidationError('memory:updateSettings', 'patch.enabled must be a boolean')
    )
    expect(() => electronMock.handlers.get('memory:list')?.({}, 'unknown')).toThrow(
      new IpcPayloadValidationError('memory:list', 'category must be one of: conversation, task, skill, file, system, preference, project, style, decision, correction, imported_conversation')
    )
    expect(() => electronMock.handlers.get('memory:addEntry')?.({}, {
      ...memoryEntry,
      category: 'unknown'
    })).toThrow(
      new IpcPayloadValidationError('memory:addEntry', 'entry.category must be one of: conversation, task, skill, file, system, preference, project, style, decision, correction, imported_conversation')
    )
    expect(() => electronMock.handlers.get('memory:addEntry')?.({}, {
      ...memoryEntry,
      metadata: { nested: { bad: true } }
    })).toThrow(
      new IpcPayloadValidationError('memory:addEntry', 'entry.metadata.nested must be a primitive value or primitive array')
    )
    expect(() => electronMock.handlers.get('memory:updateEntry')?.({}, 'memory-1', {
      confidence: 2
    })).toThrow(new IpcPayloadValidationError('memory:updateEntry', 'patch.confidence must be at most 1'))
    expect(() => electronMock.handlers.get('memory:graph')?.({}, [{
      ...memoryEntry,
      tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`)
    }])).toThrow(new IpcPayloadValidationError('memory:graph', 'entries[0].tags must contain at most 32 items'))
    expect(() => electronMock.handlers.get('memory:cleanupSuggestions')?.({}, {
      ...memoryGraph,
      edges: [{ source: 'memory-1', target: 'memory-2', type: 'link', weight: 0.5 }]
    })).toThrow(new IpcPayloadValidationError('memory:cleanupSuggestions', 'graph.edges[0].type must be one of: tag, category, similarity'))
    expect(() => electronMock.handlers.get('memory:scoreQuality')?.({}, {
      title: '',
      category: 'preference'
    })).toThrow(new IpcPayloadValidationError('memory:scoreQuality', 'entry.title must not be empty'))
    expect(() => electronMock.handlers.get('memory:detectConflicts')?.({}, [{ id: 'a', title: 'A' }])).toThrow(
      new IpcPayloadValidationError('memory:detectConflicts', 'entries[0].category must be a string')
    )

    expect(catalogHandler).not.toHaveBeenCalled()
    expect(updateSettingsHandler).not.toHaveBeenCalled()
    expect(listHandler).not.toHaveBeenCalled()
    expect(addHandler).not.toHaveBeenCalled()
    expect(updateHandler).not.toHaveBeenCalled()
    expect(graphHandler).not.toHaveBeenCalled()
    expect(cleanupHandler).not.toHaveBeenCalled()
    expect(scoreHandler).not.toHaveBeenCalled()
    expect(conflictsHandler).not.toHaveBeenCalled()
  })

  it('passes valid memory payloads through unchanged', async () => {
    const settingsHandler = vi.fn(async () => ({ enabled: false }))
    const searchHandler = vi.fn(() => [memoryEntry])
    const addHandler = vi.fn(async () => memoryEntry)
    const importHandler = vi.fn(async () => [memoryEntry])
    const approveHandler = vi.fn(async () => memoryEntry)
    const updateHandler = vi.fn(async () => ({ ...memoryEntry, title: 'Updated' }))
    const deleteHandler = vi.fn(async () => true)
    const restoreHandler = vi.fn(async () => memoryEntry)
    const graphHandler = vi.fn(() => memoryGraph)
    const cleanupHandler = vi.fn(() => memoryGraph.nodes)
    const scoreHandler = vi.fn(() => ({ entryId: '', score: 80, reasons: [] }))
    const conflictsHandler = vi.fn(() => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('memory:updateSettings', settingsHandler)
    typedHandle('memory:search', searchHandler)
    typedHandle('memory:addEntry', addHandler)
    typedHandle('memory:importConversation', importHandler)
    typedHandle('memory:approveCandidate', approveHandler)
    typedHandle('memory:updateEntry', updateHandler)
    typedHandle('memory:delete', deleteHandler)
    typedHandle('memory:restore', restoreHandler)
    typedHandle('memory:graph', graphHandler)
    typedHandle('memory:cleanupSuggestions', cleanupHandler)
    typedHandle('memory:scoreQuality', scoreHandler)
    typedHandle('memory:detectConflicts', conflictsHandler)

    const patch = { title: 'Updated', metadata: { sourceLabel: 'settings' } }
    const qualityInput = { title: 'Quality memory', category: 'preference', summary: '', content: '', tags: ['style'], confidence: 0.8 }
    const conflictEntries = [
      { id: 'a', title: 'Same', category: 'preference', summary: '' },
      { id: 'b', title: 'Same', category: 'preference', summary: '' }
    ]

    await expect(electronMock.handlers.get('memory:updateSettings')?.({}, { enabled: false })).resolves.toEqual({ enabled: false })
    expect(electronMock.handlers.get('memory:search')?.({}, '', 'preference')).toEqual([memoryEntry])
    await expect(electronMock.handlers.get('memory:addEntry')?.({}, memoryEntry)).resolves.toBe(memoryEntry)
    await expect(electronMock.handlers.get('memory:importConversation')?.({}, 'chat', 'content')).resolves.toEqual([memoryEntry])
    await expect(electronMock.handlers.get('memory:approveCandidate')?.({}, 'memory-1')).resolves.toBe(memoryEntry)
    await expect(electronMock.handlers.get('memory:updateEntry')?.({}, 'memory-1', patch)).resolves.toMatchObject({ title: 'Updated' })
    await expect(electronMock.handlers.get('memory:delete')?.({}, 'memory-1')).resolves.toBe(true)
    await expect(electronMock.handlers.get('memory:restore')?.({}, 'memory-1')).resolves.toBe(memoryEntry)
    expect(electronMock.handlers.get('memory:graph')?.({}, [memoryEntry])).toBe(memoryGraph)
    expect(electronMock.handlers.get('memory:cleanupSuggestions')?.({}, memoryGraph)).toEqual(memoryGraph.nodes)
    expect(electronMock.handlers.get('memory:scoreQuality')?.({}, qualityInput)).toEqual({ entryId: '', score: 80, reasons: [] })
    expect(electronMock.handlers.get('memory:detectConflicts')?.({}, conflictEntries)).toEqual([])

    expect(settingsHandler).toHaveBeenCalledWith({}, { enabled: false })
    expect(searchHandler).toHaveBeenCalledWith({}, '', 'preference')
    expect(addHandler).toHaveBeenCalledWith({}, memoryEntry)
    expect(importHandler).toHaveBeenCalledWith({}, 'chat', 'content')
    expect(approveHandler).toHaveBeenCalledWith({}, 'memory-1')
    expect(updateHandler).toHaveBeenCalledWith({}, 'memory-1', patch)
    expect(deleteHandler).toHaveBeenCalledWith({}, 'memory-1')
    expect(restoreHandler).toHaveBeenCalledWith({}, 'memory-1')
    expect(graphHandler).toHaveBeenCalledWith({}, [memoryEntry])
    expect(cleanupHandler).toHaveBeenCalledWith({}, memoryGraph)
    expect(scoreHandler).toHaveBeenCalledWith({}, qualityInput)
    expect(conflictsHandler).toHaveBeenCalledWith({}, conflictEntries)
  })
})
