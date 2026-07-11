// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addHistoryEntry,
  clearDraftHistory,
  diffHistoryVersions,
  getDraftHistory,
  getHistoryEntry,
  getHistorySummary,
  recordAiHistory,
  hydrateDraftHistoryFromDisk,
  restoreFromHistory,
  type DraftHistoryEntry
} from './sdd-draft-history'
import { useSddDraftStore, type SddDraft } from './sdd-draft-store'

const draftA: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace-a',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Draft A',
  content: '# Draft A',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

const draftB: SddDraft = {
  ...draftA,
  workspaceRoot: 'E:\\workspace-b',
  title: 'Draft B',
  content: '# Draft B'
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function historyEntry(content: string, version = 1): DraftHistoryEntry {
  return {
    version,
    timestamp: `2026-07-04T00:00:0${version}.000Z`,
    content,
    title: draftA.title,
    message: `snapshot ${version}`,
    author: 'ai'
  }
}

function historyStorageKey(draft: SddDraft): string {
  const normalizedRoot = draft.workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return `sdd-history-${encodeURIComponent(normalizedRoot)}::${draft.id.toLowerCase()}`
}

function integrityDraft(suffix: string): SddDraft {
  return {
    ...draftA,
    id: `integrity-${suffix}`,
    workspaceRoot: `E:\\history-integrity-${suffix}`,
    relativePath: `.agenthub/requirements/integrity-${suffix}/requirement.md`,
    title: `Integrity ${suffix}`
  }
}

function diskHistoryThrough(version: number): DraftHistoryEntry[] {
  return Array.from({ length: version }, (_, index) => historyEntry(`# disk v${index + 1}`, index + 1))
}

describe('sdd draft history', () => {
  beforeEach(async () => {
    delete (window as any).electronAPI
    localStorage.clear()
    await clearDraftHistory(draftA.id, draftA.workspaceRoot)
    await clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    localStorage.clear()
    await clearDraftHistory(draftA.id, draftA.workspaceRoot)
    await clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
  })

  it('stores full snapshots and returns defensive copies', async () => {
    ;(window as any).electronAPI = { sdd: { saveHistory: vi.fn(async () => undefined) } }
    const longContent = `# Draft\n\n${'x'.repeat(6000)}`
    await addHistoryEntry(draftA.id, longContent, draftA.title, 'long snapshot', 'ai', draftA.workspaceRoot)

    const history = getDraftHistory(draftA.id, draftA.workspaceRoot)
    expect(history[0].content).toHaveLength(longContent.length)
    history[0].content = '# mutated'

    expect(getHistoryEntry(draftA.id, 1, draftA.workspaceRoot)?.content).toBe(longContent)
    const historyStorageKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .find(key => key?.startsWith('sdd-history-'))
    expect(historyStorageKey).toBeTruthy()
    const raw = localStorage.getItem(historyStorageKey!)
    const persisted = JSON.parse(raw || '[]') as Array<{ content: string; truncated?: boolean }>
    expect(persisted[0].content).toBe(longContent)
    expect(persisted[0].truncated).toBe(false)
    expect((window as any).electronAPI.sdd.saveHistory).toHaveBeenCalledWith(
      draftA.workspaceRoot,
      draftA.id,
      expect.arrayContaining([expect.objectContaining({ content: longContent })])
    )
  })

  it('hydrates history from the draft directory after localStorage is cleared', async () => {
    const diskEntry = {
      version: 1,
      timestamp: '2026-07-04T00:00:00.000Z',
      content: '# from disk',
      title: draftA.title,
      message: 'disk snapshot',
      author: 'ai' as const
    }
    ;(window as any).electronAPI = {
      sdd: {
        getHistory: vi.fn(async () => [diskEntry]),
        saveHistory: vi.fn(async () => undefined)
      }
    }

    localStorage.clear()
    await clearDraftHistory(draftA.id, draftA.workspaceRoot)
    await hydrateDraftHistoryFromDisk(draftA.id, draftA.workspaceRoot)

    expect((window as any).electronAPI.sdd.getHistory).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id)
    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)[0].content).toBe('# from disk')
  })

  it('keeps explicit H2 when explicit H1 for the same key resolves last', async () => {
    const h1 = deferred<DraftHistoryEntry[]>()
    const h2 = deferred<DraftHistoryEntry[]>()
    const getHistory = vi.fn()
      .mockImplementationOnce(() => h1.promise)
      .mockImplementationOnce(() => h2.promise)
    ;(window as any).electronAPI = { sdd: { getHistory } }

    const first = hydrateDraftHistoryFromDisk(draftA.id, draftA.workspaceRoot)
    const second = hydrateDraftHistoryFromDisk(draftA.id, draftA.workspaceRoot)
    h2.resolve([historyEntry('# H2 newest', 2)])
    await expect(second).resolves.toEqual([expect.objectContaining({ content: '# H2 newest' })])

    h1.resolve([historyEntry('# H1 stale', 1)])
    await expect(first).resolves.toEqual([expect.objectContaining({ content: '# H2 newest' })])

    expect(getDraftHistory(draftA.id, draftA.workspaceRoot).map(entry => entry.content)).toEqual(['# H2 newest'])
    const persisted = JSON.parse(localStorage.getItem(historyStorageKey(draftA)) || '[]') as DraftHistoryEntry[]
    expect(persisted.map(entry => entry.content)).toEqual(['# H2 newest'])
  })

  it('shares latest sequence between implicit and explicit hydration for a normalized key', async () => {
    const target = integrityDraft('implicit-explicit')
    const implicitH1 = deferred<DraftHistoryEntry[]>()
    const explicitH2 = deferred<DraftHistoryEntry[]>()
    const getHistory = vi.fn()
      .mockImplementationOnce(() => implicitH1.promise)
      .mockImplementationOnce(() => explicitH2.promise)
    ;(window as any).electronAPI = { sdd: { getHistory } }

    expect(getDraftHistory(target.id, `${target.workspaceRoot}\\`)).toEqual([])
    const explicit = hydrateDraftHistoryFromDisk(target.id, target.workspaceRoot.replaceAll('\\', '/'))
    explicitH2.resolve([historyEntry('# explicit H2', 2)])
    await explicit

    implicitH1.resolve([historyEntry('# implicit H1 stale', 1)])
    await implicitH1.promise
    await Promise.resolve()

    expect(getDraftHistory(target.id, target.workspaceRoot)[0]?.content).toBe('# explicit H2')
    const persisted = JSON.parse(localStorage.getItem(historyStorageKey(target)) || '[]') as DraftHistoryEntry[]
    expect(persisted[0]?.content).toBe('# explicit H2')
  })

  it('does not let pending disk hydration replace a newly added local history entry', async () => {
    const pendingDisk = deferred<DraftHistoryEntry[]>()
    const getHistory = vi.fn(() => pendingDisk.promise)
    ;(window as any).electronAPI = {
      sdd: {
        getHistory,
        saveHistory: vi.fn(async () => undefined)
      }
    }

    const hydrating = hydrateDraftHistoryFromDisk(draftA.id, draftA.workspaceRoot)
    const adding = addHistoryEntry(draftA.id, '# local newest', draftA.title, 'local write', 'user', draftA.workspaceRoot)
    const callsBeforeDiskSettles = getHistory.mock.calls.length

    pendingDisk.resolve([historyEntry('# stale disk', 7)])
    await Promise.all([hydrating, adding])

    expect(getHistory).toHaveBeenCalledTimes(callsBeforeDiskSettles)
    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)[0]?.content).toBe('# local newest')
    const persisted = JSON.parse(localStorage.getItem(historyStorageKey(draftA)) || '[]') as DraftHistoryEntry[]
    expect(persisted[0]?.content).toBe('# local newest')
  })

  it('keeps a newer implicit marker when an older implicit request settles', async () => {
    const target = integrityDraft('implicit-marker-cleanup')
    const staleImplicitH1 = deferred<DraftHistoryEntry[]>()
    const staleExplicitH2 = deferred<DraftHistoryEntry[]>()
    const freshImplicitH3 = deferred<DraftHistoryEntry[]>()
    const getHistory = vi.fn()
      .mockImplementationOnce(() => staleImplicitH1.promise)
      .mockImplementationOnce(() => staleExplicitH2.promise)
      .mockImplementationOnce(() => freshImplicitH3.promise)
    ;(window as any).electronAPI = { sdd: { getHistory } }

    expect(getDraftHistory(target.id, target.workspaceRoot)).toEqual([])
    const explicit = hydrateDraftHistoryFromDisk(target.id, target.workspaceRoot)
    expect(getDraftHistory(target.id, target.workspaceRoot)).toEqual([])
    expect(getHistory).toHaveBeenCalledTimes(3)

    staleImplicitH1.resolve([historyEntry('# stale implicit H1', 1)])
    await staleImplicitH1.promise
    await Promise.resolve()
    await Promise.resolve()

    expect(getDraftHistory(target.id, target.workspaceRoot)).toEqual([])
    expect(getHistory).toHaveBeenCalledTimes(3)

    staleExplicitH2.resolve([historyEntry('# stale explicit H2', 2)])
    await expect(explicit).resolves.toEqual([])
    expect(getHistory).toHaveBeenCalledTimes(3)

    freshImplicitH3.resolve([historyEntry('# fresh implicit H3', 3)])
    await freshImplicitH3.promise
    await Promise.resolve()

    expect(getDraftHistory(target.id, target.workspaceRoot)[0]?.content).toBe('# fresh implicit H3')
  })

  it('waits for pending disk history before appending and saving the next version', async () => {
    const target = integrityDraft('single-add')
    const pendingDisk = deferred<DraftHistoryEntry[]>()
    const saveHistory = vi.fn(async (_workspaceRoot: string, _draftId: string, _entries: DraftHistoryEntry[]) => undefined)
    ;(window as any).electronAPI = {
      sdd: {
        getHistory: vi.fn(() => pendingDisk.promise),
        saveHistory
      }
    }

    const hydrating = hydrateDraftHistoryFromDisk(target.id, target.workspaceRoot)
    const adding = addHistoryEntry(target.id, '# local v8', target.title, 'local v8', 'user', target.workspaceRoot)
    const savesBeforeBaseline = saveHistory.mock.calls.length
    pendingDisk.resolve(diskHistoryThrough(7))
    const [, added] = await Promise.all([hydrating, adding])

    expect(savesBeforeBaseline).toBe(0)
    expect(added.version).toBe(8)
    expect(getDraftHistory(target.id, target.workspaceRoot).map(entry => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(getDraftHistory(target.id, target.workspaceRoot).at(-1)?.content).toBe('# local v8')
    const persisted = JSON.parse(localStorage.getItem(historyStorageKey(target)) || '[]') as DraftHistoryEntry[]
    expect(persisted.map(entry => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(saveHistory).toHaveBeenLastCalledWith(
      target.workspaceRoot,
      target.id,
      expect.arrayContaining([expect.objectContaining({ version: 8, content: '# local v8' })])
    )
    expect(saveHistory.mock.calls.at(-1)?.[2]).toHaveLength(8)
  })

  it('serializes two fast local adds on one disk baseline without losing either append', async () => {
    const target = integrityDraft('double-add')
    const pendingDisk = deferred<DraftHistoryEntry[]>()
    const getHistory = vi.fn(() => pendingDisk.promise)
    const saveHistory = vi.fn(async (_workspaceRoot: string, _draftId: string, _entries: DraftHistoryEntry[]) => undefined)
    ;(window as any).electronAPI = { sdd: { getHistory, saveHistory } }

    const firstAdd = addHistoryEntry(target.id, '# local v8', target.title, 'local v8', 'user', target.workspaceRoot)
    const secondAdd = addHistoryEntry(target.id, '# local v9', target.title, 'local v9', 'ai', target.workspaceRoot)
    const savesBeforeBaseline = saveHistory.mock.calls.length
    pendingDisk.resolve(diskHistoryThrough(7))
    const [first, second] = await Promise.all([firstAdd, secondAdd])

    expect(savesBeforeBaseline).toBe(0)
    expect([first.version, second.version]).toEqual([8, 9])
    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(getDraftHistory(target.id, target.workspaceRoot).map(entry => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(getDraftHistory(target.id, target.workspaceRoot).slice(-2).map(entry => entry.content)).toEqual(['# local v8', '# local v9'])
    expect((saveHistory.mock.calls.at(-1)?.[2] ?? []).map(entry => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('serializes Windows root and draft-id case aliases through one mutation key', async () => {
    const upper = {
      ...integrityDraft('windows-case'),
      id: 'Draft-Case',
      workspaceRoot: 'E:\\History-Case'
    }
    const lower = {
      ...upper,
      id: 'draft-case',
      workspaceRoot: 'e:\\history-case'
    }
    const pendingDisk = deferred<DraftHistoryEntry[]>()
    const getHistory = vi.fn(() => pendingDisk.promise)
    const saveHistory = vi.fn(async (_workspaceRoot: string, _draftId: string, _entries: DraftHistoryEntry[]) => undefined)
    ;(window as any).electronAPI = { platform: 'win32', sdd: { getHistory, saveHistory } }

    const firstAdd = addHistoryEntry(upper.id, '# upper v8', upper.title, 'upper', 'user', upper.workspaceRoot)
    const secondAdd = addHistoryEntry(lower.id, '# lower v9', lower.title, 'lower', 'ai', lower.workspaceRoot)
    pendingDisk.resolve(diskHistoryThrough(7))
    const [first, second] = await Promise.all([firstAdd, secondAdd])

    expect([first.version, second.version]).toEqual([8, 9])
    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(getDraftHistory(upper.id, upper.workspaceRoot).slice(-2).map(entry => entry.content)).toEqual(['# upper v8', '# lower v9'])
    expect(getDraftHistory(lower.id, lower.workspaceRoot).slice(-2).map(entry => entry.content)).toEqual(['# upper v8', '# lower v9'])
    expect((saveHistory.mock.calls.at(-1)?.[2] ?? []).map(entry => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('keeps a later clear authoritative after an earlier add was waiting for disk', async () => {
    const target = integrityDraft('add-then-clear')
    const pendingDisk = deferred<DraftHistoryEntry[]>()
    const saveHistory = vi.fn(async (_workspaceRoot: string, _draftId: string, _entries: DraftHistoryEntry[]) => undefined)
    const clearHistory = vi.fn(async () => undefined)
    ;(window as any).electronAPI = {
      sdd: {
        getHistory: vi.fn(() => pendingDisk.promise),
        saveHistory,
        clearHistory
      }
    }

    const adding = addHistoryEntry(target.id, '# local v8', target.title, 'local v8', 'user', target.workspaceRoot)
    const clearing = clearDraftHistory(target.id, target.workspaceRoot)
    pendingDisk.resolve(diskHistoryThrough(7))
    const [added] = await Promise.all([adding, clearing])

    expect(added.version).toBe(8)
    expect((saveHistory.mock.calls[0]?.[2] ?? []).map(entry => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(clearHistory).toHaveBeenCalledAfter(saveHistory)
    expect(localStorage.getItem(historyStorageKey(target))).toBeNull()
    expect(getDraftHistory(target.id, target.workspaceRoot)).toEqual([])
  })

  it('waits for an earlier clear before saving a later add as the only history', async () => {
    const target = integrityDraft('clear-then-add')
    const clearGate = deferred<void>()
    let disk = diskHistoryThrough(7)
    const events: string[] = []
    const clearHistory = vi.fn(async () => {
      events.push('clear:start')
      await clearGate.promise
      disk = []
      events.push('clear:done')
    })
    const getHistory = vi.fn(async () => disk)
    const saveHistory = vi.fn(async (_workspaceRoot: string, _draftId: string, entries: DraftHistoryEntry[]) => {
      events.push('save')
      disk = entries
    })
    ;(window as any).electronAPI = { sdd: { getHistory, saveHistory, clearHistory } }

    const clearing = clearDraftHistory(target.id, target.workspaceRoot)
    const adding = addHistoryEntry(target.id, '# first after clear', target.title, 'fresh', 'user', target.workspaceRoot)
    await Promise.resolve()
    const savesBeforeClearCompletes = saveHistory.mock.calls.length
    clearGate.resolve()
    const [, added] = await Promise.all([clearing, adding])

    expect(savesBeforeClearCompletes).toBe(0)
    expect(events).toEqual(['clear:start', 'clear:done', 'save'])
    expect(getHistory).not.toHaveBeenCalled()
    expect(added.version).toBe(1)
    expect(disk.map(entry => entry.content)).toEqual(['# first after clear'])
    expect(getDraftHistory(target.id, target.workspaceRoot).map(entry => entry.content)).toEqual(['# first after clear'])
  })

  it('rejects a local append and leaves cache untouched when saveHistory fails', async () => {
    const target = integrityDraft('save-failure')
    ;(window as any).electronAPI = {
      sdd: {
        getHistory: vi.fn(async () => diskHistoryThrough(7)),
        saveHistory: vi.fn(async () => { throw new Error('disk full') })
      }
    }

    await expect(Promise.resolve(addHistoryEntry(target.id, '# rejected v8', target.title, 'rejected', 'user', target.workspaceRoot))).rejects.toThrow('disk full')

    expect(localStorage.getItem(historyStorageKey(target))).toBeNull()
    expect(getDraftHistory(target.id, target.workspaceRoot).some(entry => entry.content === '# rejected v8')).toBe(false)
  })

  it('refuses disk persistence when an authoritative baseline cannot be read', async () => {
    const target = integrityDraft('missing-baseline-reader')
    const saveHistory = vi.fn(async (_workspaceRoot: string, _draftId: string, _entries: DraftHistoryEntry[]) => undefined)
    ;(window as any).electronAPI = { sdd: { saveHistory } }

    await expect(addHistoryEntry(target.id, '# unsafe append', target.title, 'unsafe', 'user', target.workspaceRoot)).rejects.toThrow('authoritative history baseline')

    expect(saveHistory).not.toHaveBeenCalled()
    expect(localStorage.getItem(historyStorageKey(target))).toBeNull()
  })

  it('keeps same draft ids isolated by workspace root', async () => {
    await recordAiHistory(draftA, '# A before AI', 'assistant writeback')
    await recordAiHistory(draftB, '# B before AI', 'assistant writeback')

    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)[0].content).toBe('# A before AI')
    expect(getDraftHistory(draftB.id, draftB.workspaceRoot)[0].content).toBe('# B before AI')
  })

  it('limits history to the latest configured versions while preserving monotonic version numbers', async () => {
    for (let index = 0; index < 25; index++) {
      await addHistoryEntry(draftA.id, `# v${index}`, draftA.title, `snapshot ${index}`, 'ai', draftA.workspaceRoot)
    }

    const summary = getHistorySummary(draftA.id, draftA.workspaceRoot)
    expect(summary).toHaveLength(20)
    expect(summary[0].version).toBe(6)
    expect(summary.at(-1)?.version).toBe(25)
  })

  it('restores only the active matching draft and leaves restored content dirty for disk save', async () => {
    await addHistoryEntry(draftA.id, '# restored', draftA.title, 'old version', 'ai', draftA.workspaceRoot)
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# current')

    await expect(restoreFromHistory(draftA.id, 1, draftA.workspaceRoot)).resolves.toBe(true)
    expect(useSddDraftStore.getState().content).toBe('# restored')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
    expect(getHistorySummary(draftA.id, draftA.workspaceRoot).at(-1)?.message).toContain('恢复前快照')
  })

  it('does not restore over an edit made while the pre-restore snapshot is saving', async () => {
    await addHistoryEntry(draftA.id, '# restored', draftA.title, 'old version', 'ai', draftA.workspaceRoot)
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# current before restore')
    const saveGate = deferred<void>()
    const saveHistory = vi.fn(() => saveGate.promise)
    ;(window as any).electronAPI = { sdd: { saveHistory } }

    const restoring = restoreFromHistory(draftA.id, 1, draftA.workspaceRoot)
    await vi.waitFor(() => expect(saveHistory).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setContent('# newer edit during history save')
    saveGate.resolve()

    await expect(restoring).resolves.toBe(false)
    expect(useSddDraftStore.getState().content).toBe('# newer edit during history save')
  })

  it('refuses to restore a matching draft id from a different workspace', async () => {
    await addHistoryEntry(draftA.id, '# restored', draftA.title, 'old version', 'ai', draftA.workspaceRoot)
    useSddDraftStore.getState().setActiveDraft(draftB)

    await expect(restoreFromHistory(draftA.id, 1, draftA.workspaceRoot)).resolves.toBe(false)
    expect(useSddDraftStore.getState().content).toBe('# Draft B')
  })

  it('diffs selected history versions', async () => {
    await addHistoryEntry(draftA.id, '# Draft\n\n- old', draftA.title, 'old', 'ai', draftA.workspaceRoot)
    await addHistoryEntry(draftA.id, '# Draft\n\n- new', draftA.title, 'new', 'ai', draftA.workspaceRoot)

    const diff = diffHistoryVersions(draftA.id, 1, 2, draftA.workspaceRoot)

    expect(diff.changed).toBe(true)
    expect(diff.added).toEqual(['- new'])
    expect(diff.removed).toEqual(['- old'])
  })

  it('clears workspace-scoped history', async () => {
    await addHistoryEntry(draftA.id, '# A', draftA.title, 'old', 'ai', draftA.workspaceRoot)
    await clearDraftHistory(draftA.id, draftA.workspaceRoot)

    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)).toEqual([])
  })
})
