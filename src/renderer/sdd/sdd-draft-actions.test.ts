// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyVerifyVerdicts, loadDraft, persistPlanTrace } from './sdd-draft-actions'
import { useSddDraftStore, type SddDraft, type SddTrace } from './sdd-draft-store'
import { clearDraftHistory, getDraftHistory } from './sdd-draft-history'
import { hashVerifyContent } from './sdd-verify-prompt'

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

const trace: SddTrace = {
  draftId: 'draft-1',
  requirementBlocks: [],
  planItems: [{
    id: 'P-1',
    text: 'Implement checkout (covers: R-1)',
    covers: ['R-1'],
    status: 'pending',
    lineNumber: 1
  }],
  coverage: { 'R-1': ['P-1'] },
  derivedStatuses: { 'R-1': 'planned' },
  uncoveredRequirementIds: [],
  timestamp: '2026-07-04T00:01:00.000Z'
}

describe('sdd draft actions', () => {
  beforeEach(() => {
    clearDraftHistory(draftA.id, draftA.workspaceRoot)
    clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    clearDraftHistory(draftA.id, draftA.workspaceRoot)
    clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
  })

  it('persists a captured plan trace without overwriting the active draft in another workspace', async () => {
    let resolveTrace: (value: SddTrace) => void = () => {}
    const tracePromise = new Promise<SddTrace>(resolve => {
      resolveTrace = resolve
    })
    const api = {
      sdd: {
        computeTrace: vi.fn(() => tracePromise),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft(draftA)

    const persisted = persistPlanTrace('- [ ] Implement checkout (covers: R-1)', {
      id: draftA.id,
      workspaceRoot: draftA.workspaceRoot
    })
    useSddDraftStore.getState().setActiveDraft(draftB)
    resolveTrace(trace)

    await expect(persisted).resolves.toEqual(trace)
    expect(api.sdd.computeTrace).toHaveBeenCalledWith(
      'E:\\workspace-a',
      'draft-1',
      '- [ ] Implement checkout (covers: R-1)'
    )
    expect(api.sdd.saveTrace).toHaveBeenCalledWith('E:\\workspace-a', 'draft-1', trace)
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe('E:\\workspace-b')
    expect(useSddDraftStore.getState().trace).toBeNull()
  })

  it('loads persisted trace when opening a draft', async () => {
    const api = {
      sdd: {
        getDraft: vi.fn(async () => draftA),
        getTrace: vi.fn(async () => trace)
      }
    }
    ;(window as any).electronAPI = api

    await loadDraft('E:\\workspace-a', 'draft-1')

    expect(api.sdd.getTrace).toHaveBeenCalledWith('E:\\workspace-a', 'draft-1')
    expect(useSddDraftStore.getState().activeDraft).toEqual(draftA)
    expect(useSddDraftStore.getState().trace).toEqual(trace)
  })

  it('refuses empty content overwrite of non-empty lastSaved (G2-MC1)', async () => {
    const { saveDraftToDisk } = await import('./sdd-draft-actions')
    const api = {
      sdd: {
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content: '# body' })
    useSddDraftStore.getState().setContent('') // user/rehydrate emptied buffer
    // lastSaved still non-empty from setActiveDraft
    const ok = await saveDraftToDisk()
    expect(ok).toBe(false)
    expect(api.sdd.updateDraft).not.toHaveBeenCalled()
  })

  it('flushes dirty draft before loadDraft switches (G2-MH7)', async () => {
    const updateDraft = vi.fn(async () => undefined)
    const api = {
      sdd: {
        getDraft: vi.fn(async () => draftB),
        getTrace: vi.fn(async () => null),
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# edited A')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')

    await loadDraft(draftB.workspaceRoot, draftB.id)

    expect(updateDraft).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id, '# edited A')
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftB.id)
  })

  it('aborts loadDraft when dirty flush fails (G2-MH7)', async () => {
    const getDraft = vi.fn(async () => draftB)
    const api = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null),
        updateDraft: vi.fn(async () => { throw new Error('disk full') }),
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# unsaved')
    await loadDraft(draftB.workspaceRoot, draftB.id)
    expect(getDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftA.id)
    expect(useSddDraftStore.getState().content).toBe('# unsaved')
  })

  it('markSaved syncs activeDraft.content for rehydrate (G2-MC1)', () => {
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content: '' })
    useSddDraftStore.getState().setContent('# body after edit')
    useSddDraftStore.getState().markSaved()
    const s = useSddDraftStore.getState()
    expect(s.activeDraft?.content).toBe('# body after edit')
    expect(s.lastSavedContent).toBe('# body after edit')
    expect(s.saveStatus).toBe('saved')
  })

  it('does not overwrite trace if the active draft changes before trace load finishes', async () => {
    let resolveTrace: (value: SddTrace) => void = () => {}
    const tracePromise = new Promise<SddTrace>(resolve => {
      resolveTrace = resolve
    })
    const api = {
      sdd: {
        getDraft: vi.fn(async () => draftA),
        getTrace: vi.fn(() => tracePromise)
      }
    }
    ;(window as any).electronAPI = api

    const loading = loadDraft('E:\\workspace-a', 'draft-1')
    await vi.waitFor(() => expect(useSddDraftStore.getState().activeDraft).toEqual(draftA))
    useSddDraftStore.getState().setActiveDraft(draftB)
    resolveTrace(trace)
    await loading

    expect(useSddDraftStore.getState().activeDraft).toEqual(draftB)
    expect(useSddDraftStore.getState().trace).toBeNull()
  })

  it('applies passing verification verdicts through history, save, and block parsing', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment',
      '- [ ] show receipt'
    ].join('\n')
    const api = {
      sdd: {
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined),
        saveTrace: vi.fn(async () => undefined),
        parseBlocks: vi.fn(async () => [{
          id: 'R-1',
          title: 'Checkout',
          status: 'verified',
          description: '',
          acceptanceCriteria: [
            { text: 'submit payment', checked: true },
            { text: 'show receipt', checked: true }
          ],
          lineNumber: 3
        }])
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })
    useSddDraftStore.getState().setTrace(trace)

    const result = await applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' },
      { requirementId: 'R-1', criterionIndex: 1, status: 'pass' }
    ])

    expect(result.appliedCount).toBe(2)
    expect(result.verifiedRequirementIds).toEqual(['R-1'])
    expect(api.sdd.updateDraft).toHaveBeenCalledWith(
      'E:\\workspace-a',
      'draft-1',
      expect.stringContaining('### R-1: Checkout {verified}')
    )
    expect(api.sdd.parseBlocks).toHaveBeenCalledWith(expect.stringContaining('- [x] show receipt'))
    expect(api.sdd.saveTrace).toHaveBeenCalledWith(
      'E:\\workspace-a',
      'draft-1',
      expect.objectContaining({
        requirementBlocks: [expect.objectContaining({ id: 'R-1', status: 'verified' })],
        derivedStatuses: { 'R-1': 'verified' }
      })
    )
    expect(useSddDraftStore.getState().trace?.derivedStatuses['R-1']).toBe('verified')
    expect(useSddDraftStore.getState().saveStatus).toBe('saved')
    const history = getDraftHistory('draft-1', 'E:\\workspace-a')
    expect(history).toHaveLength(1)
    expect(history[0].message).toContain('acceptance verification writeback')
    expect(history[0].content).toBe(content)
  })

  it('rejects verification trace refresh if the active draft changes while saving', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment'
    ].join('\n')
    let resolveUpdate: () => void = () => {}
    const updatePromise = new Promise<void>(resolve => {
      resolveUpdate = resolve
    })
    const api = {
      sdd: {
        updateDraft: vi.fn(() => updatePromise),
        updateDesignContext: vi.fn(async () => undefined),
        saveTrace: vi.fn(async () => undefined),
        parseBlocks: vi.fn(async () => [{
          id: 'R-1',
          title: 'Checkout',
          status: 'verified',
          description: '',
          acceptanceCriteria: [{ text: 'submit payment', checked: true }],
          lineNumber: 3
        }])
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })
    useSddDraftStore.getState().setTrace(trace)

    const applying = applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
    ])

    await vi.waitFor(() => expect(api.sdd.updateDraft).toHaveBeenCalled())
    useSddDraftStore.getState().setActiveDraft({ ...draftB, content: '# Draft B\n\n- unsaved' })
    useSddDraftStore.getState().setContent('# Draft B\n\n- still unsaved')
    resolveUpdate()

    await expect(applying).rejects.toThrow('Requirement draft changed while saving verification updates')
    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(api.sdd.parseBlocks).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe('E:\\workspace-b')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
  })

  it('refreshes verification trace from the target draft trace if store trace changes during block parsing', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment'
    ].join('\n')
    let resolveBlocks: (value: any[]) => void = () => {}
    const parseBlocksPromise = new Promise<any[]>(resolve => {
      resolveBlocks = resolve
    })
    const draftBTrace: SddTrace = {
      draftId: 'draft-b',
      requirementBlocks: [],
      planItems: [{
        id: 'B-1',
        text: 'B-1: Wrong draft work',
        covers: ['R-9'],
        status: 'completed',
        lineNumber: 1
      }],
      coverage: { 'R-9': ['B-1'] },
      derivedStatuses: { 'R-9': 'done' },
      uncoveredRequirementIds: [],
      timestamp: '2026-07-04T00:02:00.000Z'
    }
    const api = {
      sdd: {
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined),
        getTrace: vi.fn(async () => trace),
        saveTrace: vi.fn(async () => undefined),
        parseBlocks: vi.fn(() => parseBlocksPromise)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })
    useSddDraftStore.getState().setTrace(trace)

    const applying = applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
    ])

    await vi.waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalled())
    useSddDraftStore.getState().setActiveDraft({ ...draftB, id: 'draft-b' })
    useSddDraftStore.getState().setTrace(draftBTrace)
    resolveBlocks([{
      id: 'R-1',
      title: 'Checkout',
      status: 'verified',
      description: '',
      acceptanceCriteria: [{ text: 'submit payment', checked: true }],
      lineNumber: 3
    }])

    await expect(applying).resolves.toMatchObject({ appliedCount: 1 })
    expect(api.sdd.getTrace).toHaveBeenCalledWith('E:\\workspace-a', 'draft-1')
    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.draftId).toBe('draft-1')
    expect(savedTrace.planItems.map(item => item.id)).toEqual(['P-1'])
    expect(savedTrace.coverage).toEqual({ 'R-1': ['P-1'] })
    expect(savedTrace.requirementBlocks[0]).toMatchObject({ id: 'R-1', status: 'verified' })
    expect(useSddDraftStore.getState().trace).toEqual(draftBTrace)
  })

  it('rejects verification writeback when the draft changed after review', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment'
    ].join('\n')
    const api = {
      sdd: {
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined),
        parseBlocks: vi.fn(async () => [])
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })
    const snapshot = {
      draftId: 'draft-1',
      workspaceRoot: 'E:\\workspace-a',
      contentHash: hashVerifyContent(content)
    }
    useSddDraftStore.getState().setContent(`${content}\n- [ ] show receipt`)

    await expect(applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
    ], snapshot)).rejects.toThrow('Requirement document changed after verification')

    expect(api.sdd.updateDraft).not.toHaveBeenCalled()
  })
})
