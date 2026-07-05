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
  restoreFromHistory
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

describe('sdd draft history', () => {
  beforeEach(() => {
    localStorage.clear()
    clearDraftHistory(draftA.id, draftA.workspaceRoot)
    clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    clearDraftHistory(draftA.id, draftA.workspaceRoot)
    clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
  })

  it('stores full snapshots and returns defensive copies', () => {
    ;(window as any).electronAPI = { sdd: { saveHistory: vi.fn(async () => undefined) } }
    const longContent = `# Draft\n\n${'x'.repeat(6000)}`
    addHistoryEntry(draftA.id, longContent, draftA.title, 'long snapshot', 'ai', draftA.workspaceRoot)

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
    clearDraftHistory(draftA.id, draftA.workspaceRoot)
    await hydrateDraftHistoryFromDisk(draftA.id, draftA.workspaceRoot)

    expect((window as any).electronAPI.sdd.getHistory).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id)
    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)[0].content).toBe('# from disk')
  })

  it('keeps same draft ids isolated by workspace root', () => {
    recordAiHistory(draftA, '# A before AI', 'assistant writeback')
    recordAiHistory(draftB, '# B before AI', 'assistant writeback')

    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)[0].content).toBe('# A before AI')
    expect(getDraftHistory(draftB.id, draftB.workspaceRoot)[0].content).toBe('# B before AI')
  })

  it('limits history to the latest configured versions while preserving monotonic version numbers', () => {
    for (let index = 0; index < 25; index++) {
      addHistoryEntry(draftA.id, `# v${index}`, draftA.title, `snapshot ${index}`, 'ai', draftA.workspaceRoot)
    }

    const summary = getHistorySummary(draftA.id, draftA.workspaceRoot)
    expect(summary).toHaveLength(20)
    expect(summary[0].version).toBe(6)
    expect(summary.at(-1)?.version).toBe(25)
  })

  it('restores only the active matching draft and leaves restored content dirty for disk save', () => {
    addHistoryEntry(draftA.id, '# restored', draftA.title, 'old version', 'ai', draftA.workspaceRoot)
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# current')

    expect(restoreFromHistory(draftA.id, 1, draftA.workspaceRoot)).toBe(true)
    expect(useSddDraftStore.getState().content).toBe('# restored')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
    expect(getHistorySummary(draftA.id, draftA.workspaceRoot).at(-1)?.message).toContain('恢复前快照')
  })

  it('refuses to restore a matching draft id from a different workspace', () => {
    addHistoryEntry(draftA.id, '# restored', draftA.title, 'old version', 'ai', draftA.workspaceRoot)
    useSddDraftStore.getState().setActiveDraft(draftB)

    expect(restoreFromHistory(draftA.id, 1, draftA.workspaceRoot)).toBe(false)
    expect(useSddDraftStore.getState().content).toBe('# Draft B')
  })

  it('diffs selected history versions', () => {
    addHistoryEntry(draftA.id, '# Draft\n\n- old', draftA.title, 'old', 'ai', draftA.workspaceRoot)
    addHistoryEntry(draftA.id, '# Draft\n\n- new', draftA.title, 'new', 'ai', draftA.workspaceRoot)

    const diff = diffHistoryVersions(draftA.id, 1, 2, draftA.workspaceRoot)

    expect(diff.changed).toBe(true)
    expect(diff.added).toEqual(['- new'])
    expect(diff.removed).toEqual(['- old'])
  })

  it('clears workspace-scoped history', () => {
    addHistoryEntry(draftA.id, '# A', draftA.title, 'old', 'ai', draftA.workspaceRoot)
    clearDraftHistory(draftA.id, draftA.workspaceRoot)

    expect(getDraftHistory(draftA.id, draftA.workspaceRoot)).toEqual([])
  })
})
