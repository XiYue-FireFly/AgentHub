// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyVerifyVerdicts, createNewDraft, deleteDraft, loadDraft, parseRequirementBlocks, persistPlanTrace, reloadActiveDraftFromDisk, saveDraftToDisk } from './sdd-draft-actions'
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('sdd draft actions', () => {
  beforeEach(async () => {
    await clearDraftHistory(draftA.id, draftA.workspaceRoot)
    await clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    await clearDraftHistory(draftA.id, draftA.workspaceRoot)
    await clearDraftHistory(draftB.id, draftB.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
  })

  it('does not commit parsed blocks to a same-id same-content draft in another workspace', async () => {
    const sharedContent = '# Shared requirement content'
    const pendingBlocks = deferred<SddTrace['requirementBlocks']>()
    const parsedBlocks = [{
      id: 'R-A',
      title: 'Workspace A requirement',
      status: 'draft' as const,
      description: 'Parsed for workspace A.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const workspaceBBlocks = [{
      id: 'R-B',
      title: 'Workspace B requirement',
      status: 'planned' as const,
      description: 'Already belongs to workspace B.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const parseBlocks = vi.fn(() => pendingBlocks.promise)
    ;(window as any).electronAPI = { sdd: { parseBlocks } }
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content: sharedContent })

    const parsing = parseRequirementBlocks()
    expect(parseBlocks).toHaveBeenCalledWith(sharedContent)
    useSddDraftStore.getState().setActiveDraft({ ...draftB, id: draftA.id, content: sharedContent })
    useSddDraftStore.getState().setRequirementBlocks(workspaceBBlocks)
    pendingBlocks.resolve(parsedBlocks)

    await expect(parsing).resolves.toBe(false)
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(draftB.workspaceRoot)
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(workspaceBBlocks)
  })

  it('returns false without an active draft and does not invoke the parser', async () => {
    const parseBlocks = vi.fn(async () => [])
    ;(window as any).electronAPI = { sdd: { parseBlocks } }

    await expect(parseRequirementBlocks()).resolves.toBe(false)
    expect(parseBlocks).not.toHaveBeenCalled()
  })

  it('returns false and preserves current blocks when parsing fails', async () => {
    const existingBlocks = [{
      id: 'R-1',
      title: 'Existing requirement',
      status: 'planned' as const,
      description: 'Keep this block.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const parseBlocks = vi.fn(async () => { throw new Error('parse unavailable') })
    ;(window as any).electronAPI = { sdd: { parseBlocks } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setRequirementBlocks(existingBlocks)

    await expect(parseRequirementBlocks()).resolves.toBe(false)
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(existingBlocks)
  })

  it('returns true only after parsed blocks are committed to the captured draft', async () => {
    const parsedBlocks = [{
      id: 'R-1',
      title: 'Parsed requirement',
      status: 'draft' as const,
      description: 'Committed to the active draft.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const parseBlocks = vi.fn(async () => parsedBlocks)
    ;(window as any).electronAPI = { sdd: { parseBlocks } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    await expect(parseRequirementBlocks()).resolves.toBe(true)
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(parsedBlocks)
  })

  it('saves a dirty source before creating and activating a new draft', async () => {
    const created = { ...draftA, id: 'draft-new', title: 'New draft', content: '# New draft' }
    let resolveSave!: () => void
    const pendingSave = new Promise<void>(resolve => { resolveSave = resolve })
    const updateDraft = vi.fn(() => pendingSave)
    const createDraft = vi.fn(async () => created)
    ;(window as any).electronAPI = { sdd: { updateDraft, createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# unsaved source')

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    let result: SddDraft | null = null
    try {
      expect(updateDraft).toHaveBeenCalledOnce()
      expect(createDraft).not.toHaveBeenCalled()
    } finally {
      resolveSave()
      result = await creating
    }

    expect(result).toEqual(created)
    expect(createDraft).toHaveBeenCalledOnce()
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(created.id)
  })

  it('does not create or activate when the deferred source save rejects', async () => {
    const created = { ...draftA, id: 'draft-new', title: 'New draft', content: '# New draft' }
    let rejectSave!: (error: Error) => void
    const pendingSave = new Promise<void>((_resolve, reject) => { rejectSave = reject })
    const updateDraft = vi.fn(() => pendingSave)
    const createDraft = vi.fn(async () => created)
    ;(window as any).electronAPI = { sdd: { updateDraft, createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# unsaved source')

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    expect(updateDraft).toHaveBeenCalledOnce()
    expect(createDraft).not.toHaveBeenCalled()
    rejectSave(new Error('disk full'))

    await expect(creating).resolves.toBeNull()
    expect(createDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftA.id)
    expect(useSddDraftStore.getState().content).toBe('# unsaved source')
  })

  it('reuses an already pending source save before creating a new draft', async () => {
    const created = { ...draftA, id: 'draft-new', title: 'New draft', content: '# New draft' }
    let resolveSave!: () => void
    const pendingSave = new Promise<void>(resolve => { resolveSave = resolve })
    const updateDraft = vi.fn(() => pendingSave)
    const createDraft = vi.fn(async () => created)
    ;(window as any).electronAPI = { sdd: { updateDraft, createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# unsaved source')
    const saving = saveDraftToDisk()

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    expect(updateDraft).toHaveBeenCalledOnce()
    expect(createDraft).not.toHaveBeenCalled()
    resolveSave()

    await expect(saving).resolves.toBe(true)
    await expect(creating).resolves.toEqual(created)
    expect(createDraft).toHaveBeenCalledOnce()
  })

  it('retries an error-state source and clears the save error before creating', async () => {
    const created = { ...draftA, id: 'draft-new', title: 'New draft', content: '# New draft' }
    let resolveRetry!: () => void
    const pendingRetry = new Promise<void>(resolve => { resolveRetry = resolve })
    const updateDraft = vi.fn(() => pendingRetry)
    const createDraft = vi.fn(async () => {
      expect(useSddDraftStore.getState().saveStatus).toBe('saved')
      expect(useSddDraftStore.getState().error).toBeNull()
      return created
    })
    ;(window as any).electronAPI = { sdd: { updateDraft, createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# unsaved source')
    useSddDraftStore.getState().setSaveStatus('error')
    useSddDraftStore.getState().setError('previous save failed')

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    expect(updateDraft).toHaveBeenCalledOnce()
    expect(createDraft).not.toHaveBeenCalled()
    resolveRetry()

    await expect(creating).resolves.toEqual(created)
    expect(createDraft).toHaveBeenCalledOnce()
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(created.id)
  })

  it('does not create from an error-state source when its retry fails', async () => {
    const createDraft = vi.fn(async () => ({ ...draftA, id: 'draft-new' }))
    const updateDraft = vi.fn(async () => { throw new Error('retry failed') })
    ;(window as any).electronAPI = { sdd: { updateDraft, createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# unsaved source')
    useSddDraftStore.getState().setSaveStatus('error')
    useSddDraftStore.getState().setError('previous save failed')

    await expect(createNewDraft(draftA.workspaceRoot, 'New draft')).resolves.toBeNull()

    expect(updateDraft).toHaveBeenCalledOnce()
    expect(createDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftA.id)
    expect(useSddDraftStore.getState().content).toBe('# unsaved source')
  })

  it.each(['revision', 'session'] as const)('does not activate a created draft after the source %s changes while create is pending', async change => {
    const created = { ...draftA, id: 'draft-new', title: 'New draft', content: '# New draft' }
    let resolveCreate!: (draft: SddDraft) => void
    const pendingCreate = new Promise<SddDraft>(resolve => { resolveCreate = resolve })
    const createDraft = vi.fn(() => pendingCreate)
    ;(window as any).electronAPI = { sdd: { createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    await vi.waitFor(() => expect(createDraft).toHaveBeenCalledOnce())
    if (change === 'revision') {
      useSddDraftStore.getState().setContent('# edit while creating')
    } else {
      useSddDraftStore.getState().setActiveDraft({ ...draftA, content: '# replacement source' })
    }
    resolveCreate(created)

    await expect(creating).resolves.toBeNull()
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftA.id)
    expect(useSddDraftStore.getState().activeDraft?.id).not.toBe(created.id)
  })

  it('does not invoke create if the source changes across the pre-create durability await', async () => {
    const createDraft = vi.fn(async () => ({ ...draftA, id: 'draft-new' }))
    ;(window as any).electronAPI = { sdd: { createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    useSddDraftStore.getState().setContent('# edit before create IPC')

    await expect(creating).resolves.toBeNull()
    expect(createDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().content).toBe('# edit before create IPC')
  })

  it.each(['revision', 'session'] as const)('does not apply a stale create error after the source %s changes', async change => {
    let rejectCreate!: (error: Error) => void
    const pendingCreate = new Promise<SddDraft>((_resolve, reject) => { rejectCreate = reject })
    const createDraft = vi.fn(() => pendingCreate)
    ;(window as any).electronAPI = { sdd: { createDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const creating = createNewDraft(draftA.workspaceRoot, 'New draft')
    await vi.waitFor(() => expect(createDraft).toHaveBeenCalledOnce())
    if (change === 'revision') {
      useSddDraftStore.getState().setContent('# edit while creating')
    } else {
      useSddDraftStore.getState().setActiveDraft({ ...draftA, content: '# replacement source' })
    }
    rejectCreate(new Error('create failed'))

    await expect(creating).rejects.toThrow('create failed')
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftA.id)
    expect(useSddDraftStore.getState().error).toBeNull()
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

  it.each(['session', 'revision'] as const)('does not persist a stale plan trace after the source %s changes during computation', async change => {
    const pendingTrace = deferred<SddTrace>()
    const api = {
      sdd: {
        computeTrace: vi.fn(() => pendingTrace.promise),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft(draftA)
    const sourceSession = useSddDraftStore.getState().draftSession
    const sourceRevision = useSddDraftStore.getState().editRevision

    const persisting = persistPlanTrace('- [ ] Implement checkout (covers: R-1)', {
      id: draftA.id,
      workspaceRoot: draftA.workspaceRoot
    })
    await vi.waitFor(() => expect(api.sdd.computeTrace).toHaveBeenCalledOnce())

    if (change === 'session') {
      useSddDraftStore.getState().setActiveDraft(draftB)
      useSddDraftStore.getState().setActiveDraft({ ...draftA, title: 'Replacement Draft A' })
      expect(useSddDraftStore.getState().draftSession).not.toBe(sourceSession)
    } else {
      useSddDraftStore.getState().setContent('# Draft A edited while computing')
      expect(useSddDraftStore.getState().editRevision).not.toBe(sourceRevision)
    }
    pendingTrace.resolve(trace)

    await expect(persisting).resolves.toBeNull()
    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().trace).toBeNull()
  })

  it('does not restore plan-trace persistence eligibility after an edited source becomes inactive', async () => {
    const pendingTrace = deferred<SddTrace>()
    const api = {
      sdd: {
        computeTrace: vi.fn(() => pendingTrace.promise),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft(draftA)

    const persisting = persistPlanTrace('- [ ] Implement checkout (covers: R-1)', {
      id: draftA.id,
      workspaceRoot: draftA.workspaceRoot
    })
    await vi.waitFor(() => expect(api.sdd.computeTrace).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setContent('# Draft A edited while computing')
    useSddDraftStore.getState().setActiveDraft(draftB)
    pendingTrace.resolve(trace)

    await expect(persisting).resolves.toBeNull()
    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft).toEqual(draftB)
    expect(useSddDraftStore.getState().trace).toBeNull()
  })

  it('persists an initially inactive target without injecting its trace when it becomes active', async () => {
    const pendingTrace = deferred<SddTrace>()
    const api = {
      sdd: {
        computeTrace: vi.fn(() => pendingTrace.promise),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft(draftB)

    const persisting = persistPlanTrace('- [ ] Implement checkout (covers: R-1)', {
      id: draftA.id,
      workspaceRoot: draftA.workspaceRoot
    })
    await vi.waitFor(() => expect(api.sdd.computeTrace).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setActiveDraft(draftA)
    pendingTrace.resolve(trace)

    await expect(persisting).resolves.toEqual(trace)
    expect(api.sdd.saveTrace).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id, trace)
    expect(useSddDraftStore.getState().activeDraft).toEqual(draftA)
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

  it('keeps fast B active when slow A with another id returns later and hydrates only B history', async () => {
    const targetA = { ...draftA, id: 'draft-a', title: 'Slow A', content: '# Slow A' }
    const targetB = { ...draftA, id: 'draft-b', title: 'Fast B', content: '# Fast B' }
    const traceB = { ...trace, draftId: targetB.id, timestamp: '2026-07-04T00:02:00.000Z' }
    const slowA = deferred<SddDraft | null>()
    const getDraft = vi.fn((_workspaceRoot: string, draftId: string) => (
      draftId === targetA.id ? slowA.promise : Promise.resolve(targetB)
    ))
    const getTrace = vi.fn(async (_workspaceRoot: string, draftId: string) => (
      draftId === targetB.id ? traceB : null
    ))
    const getHistory = vi.fn(async () => [])
    ;(window as any).electronAPI = { sdd: { getDraft, getTrace, getHistory } }

    const loadingA = loadDraft(targetA.workspaceRoot, targetA.id)
    await vi.waitFor(() => expect(getDraft).toHaveBeenCalledWith(targetA.workspaceRoot, targetA.id))
    const loadingB = loadDraft(targetB.workspaceRoot, targetB.id)

    const resultB = await loadingB
    slowA.resolve(targetA)
    const resultA = await loadingA

    expect(resultB).toBe(true)
    expect(resultA).toBe(false)
    expect(useSddDraftStore.getState().activeDraft).toEqual(targetB)
    expect(useSddDraftStore.getState().trace).toEqual(traceB)
    expect(getTrace).toHaveBeenCalledTimes(1)
    expect(getTrace).toHaveBeenCalledWith(targetB.workspaceRoot, targetB.id)
    expect(getHistory).toHaveBeenCalledTimes(1)
    expect(getHistory).toHaveBeenCalledWith(targetB.workspaceRoot, targetB.id)
  })

  it('uses one global generation across workspaces for the same draft id', async () => {
    const slowA = deferred<SddDraft | null>()
    const getDraft = vi.fn((workspaceRoot: string) => (
      workspaceRoot === draftA.workspaceRoot ? slowA.promise : Promise.resolve(draftB)
    ))
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null)
      }
    }

    const loadingA = loadDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(getDraft).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id))
    const loadingB = loadDraft(draftB.workspaceRoot, draftB.id)

    const resultB = await loadingB
    slowA.resolve(draftA)
    const resultA = await loadingA

    expect(resultB).toBe(true)
    expect(resultA).toBe(false)
    expect(useSddDraftStore.getState().activeDraft).toEqual(draftB)
  })

  it.each(['null', 'reject'] as const)('ignores stale A getDraft %s after B has committed', async outcome => {
    const targetA = { ...draftA, id: 'draft-a', title: 'Slow A' }
    const targetB = { ...draftA, id: 'draft-b', title: 'Fast B' }
    const slowA = deferred<SddDraft | null>()
    const getDraft = vi.fn((_workspaceRoot: string, draftId: string) => (
      draftId === targetA.id ? slowA.promise : Promise.resolve(targetB)
    ))
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null)
      }
    }

    const loadingA = loadDraft(targetA.workspaceRoot, targetA.id)
    await vi.waitFor(() => expect(getDraft).toHaveBeenCalledWith(targetA.workspaceRoot, targetA.id))
    const resultB = await loadDraft(targetB.workspaceRoot, targetB.id)

    if (outcome === 'null') slowA.resolve(null)
    else slowA.reject(new Error('stale A failed'))
    const resultA = await loadingA

    expect(resultB).toBe(true)
    expect(resultA).toBe(false)
    expect(useSddDraftStore.getState().activeDraft).toEqual(targetB)
    expect(useSddDraftStore.getState().error).toBeNull()
  })

  it.each(['null', 'reject'] as const)('preserves latest B %s error when older A succeeds later', async outcome => {
    const targetA = { ...draftA, id: 'draft-a', title: 'Slow A' }
    const targetB = { ...draftA, id: 'draft-b', title: 'Latest B' }
    const slowA = deferred<SddDraft | null>()
    const getDraft = vi.fn((_workspaceRoot: string, draftId: string) => {
      if (draftId === targetA.id) return slowA.promise
      return outcome === 'null'
        ? Promise.resolve(null)
        : Promise.reject(new Error('latest B failed'))
    })
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null)
      }
    }

    const loadingA = loadDraft(targetA.workspaceRoot, targetA.id)
    await vi.waitFor(() => expect(getDraft).toHaveBeenCalledWith(targetA.workspaceRoot, targetA.id))
    const resultB = await loadDraft(targetB.workspaceRoot, targetB.id)
    const latestError = outcome === 'null' ? 'Draft not found' : 'latest B failed'
    expect(useSddDraftStore.getState().error).toBe(latestError)

    slowA.resolve(targetA)
    const resultA = await loadingA

    expect(resultB).toBe(false)
    expect(resultA).toBe(false)
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
    expect(useSddDraftStore.getState().error).toBe(latestError)
  })

  it('does not let an older trace for the same draft key overwrite the latest load', async () => {
    const oldDraft = { ...draftA, content: '# Old target snapshot' }
    const latestDraft = { ...draftA, content: '# Latest target snapshot' }
    const oldTrace = { ...trace, timestamp: '2026-07-04T00:01:00.000Z' }
    const latestTrace = { ...trace, timestamp: '2026-07-04T00:03:00.000Z' }
    const pendingOldTrace = deferred<SddTrace | null>()
    const getDraft = vi.fn()
      .mockResolvedValueOnce(oldDraft)
      .mockResolvedValueOnce(latestDraft)
    const getTrace = vi.fn()
      .mockImplementationOnce(() => pendingOldTrace.promise)
      .mockResolvedValueOnce(latestTrace)
    const getHistory = vi.fn(async () => [])
    ;(window as any).electronAPI = { sdd: { getDraft, getTrace, getHistory } }

    const oldLoad = loadDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(getTrace).toHaveBeenCalledTimes(1))
    const latestResult = await loadDraft(draftA.workspaceRoot, draftA.id)

    pendingOldTrace.resolve(oldTrace)
    const oldResult = await oldLoad

    expect(latestResult).toBe(true)
    expect(oldResult).toBe(false)
    expect(useSddDraftStore.getState().content).toBe(latestDraft.content)
    expect(useSddDraftStore.getState().trace).toEqual(latestTrace)
    expect(getHistory).toHaveBeenCalledTimes(1)
  })

  it('does not log a stale trace failure or replace the latest load error', async () => {
    const pendingOldTrace = deferred<SddTrace | null>()
    const getDraft = vi.fn()
      .mockResolvedValueOnce(draftA)
      .mockResolvedValueOnce(null)
    const getTrace = vi.fn().mockImplementationOnce(() => pendingOldTrace.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(window as any).electronAPI = { sdd: { getDraft, getTrace } }

    const oldLoad = loadDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(getTrace).toHaveBeenCalledTimes(1))
    const latestResult = await loadDraft(draftA.workspaceRoot, draftA.id)
    expect(useSddDraftStore.getState().error).toBe('Draft not found')

    pendingOldTrace.reject(new Error('stale trace failed'))
    const oldResult = await oldLoad

    expect(latestResult).toBe(false)
    expect(oldResult).toBe(false)
    expect(consoleError).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
    expect(useSddDraftStore.getState().error).toBe('Draft not found')
  })

  it('does not apply a stale disk reload to the same draft id in another workspace', async () => {
    let resolveDraft!: (draft: SddDraft) => void
    const draftPromise = new Promise<SddDraft>(resolve => { resolveDraft = resolve })
    ;(window as any).electronAPI = {
      sdd: {
        getDraft: vi.fn(() => draftPromise)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const reloading = reloadActiveDraftFromDisk()
    useSddDraftStore.getState().setActiveDraft(draftB)
    resolveDraft({ ...draftA, content: '# stale workspace A' })
    await reloading

    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(draftB.workspaceRoot)
    expect(useSddDraftStore.getState().content).toBe(draftB.content)
  })

  it('does not apply a stale disk reload after replacing the same draft key', async () => {
    let resolveDraft!: (draft: SddDraft) => void
    const draftPromise = new Promise<SddDraft>(resolve => { resolveDraft = resolve })
    ;(window as any).electronAPI = { sdd: { getDraft: vi.fn(() => draftPromise) } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const reloading = reloadActiveDraftFromDisk()
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content: '# replacement snapshot' })
    resolveDraft({ ...draftA, content: '# stale disk snapshot' })
    await reloading

    expect(useSddDraftStore.getState().content).toBe('# replacement snapshot')
  })

  it('does not apply a stale disk reload after rehydrating the same draft key', async () => {
    let resolveDraft!: (draft: SddDraft) => void
    const draftPromise = new Promise<SddDraft>(resolve => { resolveDraft = resolve })
    const getDraft = vi.fn()
      .mockImplementationOnce(() => draftPromise)
      .mockResolvedValueOnce(null)
    ;(window as any).electronAPI = { sdd: { getDraft } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const reloading = reloadActiveDraftFromDisk()
    localStorage.setItem('sdd-draft-store', JSON.stringify({
      state: {
        activeDraft: { ...draftA, content: '# rehydrated snapshot' },
        lastSavedContent: '# rehydrated snapshot',
        saveStatus: 'saved'
      },
      version: 1
    }))
    await useSddDraftStore.persist.rehydrate()
    resolveDraft({ ...draftA, content: '# stale disk snapshot' })
    await reloading

    expect(useSddDraftStore.getState().content).toBe('# rehydrated snapshot')
  })

  it('does not apply a stale disk reload while a newer edit is saving', async () => {
    let resolveReload!: (draft: SddDraft) => void
    let resolveSave!: () => void
    const reloadPromise = new Promise<SddDraft>(resolve => { resolveReload = resolve })
    const savePromise = new Promise<void>(resolve => { resolveSave = resolve })
    const updateDraft = vi.fn(() => savePromise)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft: vi.fn(() => reloadPromise),
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const reloading = reloadActiveDraftFromDisk()
    useSddDraftStore.getState().setContent('# newer edit')
    const saving = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    resolveReload({ ...draftA, content: '# stale disk snapshot' })
    await reloading

    let saved = false
    try {
      expect(useSddDraftStore.getState().content).toBe('# newer edit')
      expect(useSddDraftStore.getState().saveStatus).toBe('saving')
    } finally {
      resolveSave()
      saved = await saving
    }
    expect(saved).toBe(true)
    expect(useSddDraftStore.getState().content).toBe('# newer edit')
    expect(useSddDraftStore.getState().saveStatus).toBe('saved')
  })

  it('does not clear the same draft id in another workspace after a stale delete completes', async () => {
    let resolveDelete!: () => void
    const deletePromise = new Promise<void>(resolve => { resolveDelete = resolve })
    const remove = vi.fn(() => deletePromise)
    ;(window as any).electronAPI = { sdd: { deleteDraft: remove } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const deleting = deleteDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setActiveDraft(draftB)
    resolveDelete()
    await deleting

    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(draftB.workspaceRoot)
    expect(useSddDraftStore.getState().content).toBe(draftB.content)
  })

  it('invalidates a loaded draft when deletion succeeds before its pending trace resolves', async () => {
    const pendingTrace = deferred<SddTrace | null>()
    const getHistory = vi.fn(async () => [])
    const remove = vi.fn(async () => undefined)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft: vi.fn(async () => draftA),
        getTrace: vi.fn(() => pendingTrace.promise),
        getHistory,
        deleteDraft: remove
      }
    }

    const loading = loadDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(window.electronAPI.sdd.getTrace).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id))
    await deleteDraft(draftA.workspaceRoot, draftA.id)
    pendingTrace.resolve(trace)

    await expect(loading).resolves.toBe(false)
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
    expect(useSddDraftStore.getState().trace).toBeNull()
    expect(useSddDraftStore.getState().error).toBeNull()
    expect(getHistory).not.toHaveBeenCalled()
  })

  it('invalidates an existing pending load as soon as delete starts even when trace resolves before delete', async () => {
    const pendingTrace = deferred<SddTrace | null>()
    const pendingDelete = deferred<void>()
    const getHistory = vi.fn(async () => [])
    const remove = vi.fn(() => pendingDelete.promise)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft: vi.fn(async () => draftA),
        getTrace: vi.fn(() => pendingTrace.promise),
        getHistory,
        deleteDraft: remove
      }
    }

    const loading = loadDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(window.electronAPI.sdd.getTrace).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id))
    const deleting = deleteDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id))
    pendingTrace.resolve(trace)

    try {
      await expect(loading).resolves.toBe(false)
      expect(useSddDraftStore.getState().activeDraft).toBeNull()
      expect(useSddDraftStore.getState().trace).toBeNull()
      expect(useSddDraftStore.getState().error).toBeNull()
      expect(getHistory).not.toHaveBeenCalled()
    } finally {
      pendingDelete.resolve()
      await deleting
    }

    expect(useSddDraftStore.getState().activeDraft).toBeNull()
    expect(useSddDraftStore.getState().trace).toBeNull()
    expect(useSddDraftStore.getState().error).toBeNull()
  })

  it('does not clear a replacement session with the same workspace and draft id after delete succeeds', async () => {
    const pendingDelete = deferred<void>()
    const remove = vi.fn(() => pendingDelete.promise)
    ;(window as any).electronAPI = { sdd: { deleteDraft: remove } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    const deletedSession = useSddDraftStore.getState().draftSession

    const deleting = deleteDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    const replacement = { ...draftA, title: 'Replacement session', content: '# Replacement session' }
    useSddDraftStore.getState().setActiveDraft(replacement)
    expect(useSddDraftStore.getState().draftSession).not.toBe(deletedSession)
    pendingDelete.resolve()
    await deleting

    expect(useSddDraftStore.getState().activeDraft).toEqual(replacement)
    expect(useSddDraftStore.getState().content).toBe(replacement.content)
    expect(useSddDraftStore.getState().error).toBeNull()
  })

  it('does not write an old delete rejection onto a draft in another workspace', async () => {
    const pendingDelete = deferred<void>()
    const remove = vi.fn(() => pendingDelete.promise)
    ;(window as any).electronAPI = { sdd: { deleteDraft: remove } }
    useSddDraftStore.getState().setActiveDraft(draftA)

    const deleting = deleteDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setActiveDraft(draftB)
    pendingDelete.reject(new Error('workspace A delete failed'))

    await expect(deleting).rejects.toThrow('workspace A delete failed')
    expect(useSddDraftStore.getState().activeDraft).toEqual(draftB)
    expect(useSddDraftStore.getState().content).toBe(draftB.content)
    expect(useSddDraftStore.getState().error).toBeNull()
  })

  it('does not write an old delete rejection onto a replacement session with the same key', async () => {
    const pendingDelete = deferred<void>()
    const remove = vi.fn(() => pendingDelete.promise)
    ;(window as any).electronAPI = { sdd: { deleteDraft: remove } }
    useSddDraftStore.getState().setActiveDraft(draftA)
    const deletedSession = useSddDraftStore.getState().draftSession

    const deleting = deleteDraft(draftA.workspaceRoot, draftA.id)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    const replacement = { ...draftA, title: 'Replacement session', content: '# Replacement session' }
    useSddDraftStore.getState().setActiveDraft(replacement)
    expect(useSddDraftStore.getState().draftSession).not.toBe(deletedSession)
    pendingDelete.reject(new Error('old session delete failed'))

    await expect(deleting).rejects.toThrow('old session delete failed')
    expect(useSddDraftStore.getState().activeDraft).toEqual(replacement)
    expect(useSddDraftStore.getState().content).toBe(replacement.content)
    expect(useSddDraftStore.getState().error).toBeNull()
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

    expect(updateDraft).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id, '# edited A', undefined)
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(draftB.id)
  })

  it('aborts a draft switch when the successful flush became stale after a newer edit', async () => {
    let resolveSave!: () => void
    const pendingSave = new Promise<void>(resolve => { resolveSave = resolve })
    const updateDraft = vi.fn(() => pendingSave)
    const getDraft = vi.fn(async () => draftB)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null),
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# first edit')

    const loading = loadDraft(draftB.workspaceRoot, draftB.id)
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setContent('# newer edit while saving')
    resolveSave()
    await loading

    expect(getDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(draftA.workspaceRoot)
    expect(useSddDraftStore.getState().content).toBe('# newer edit while saving')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
  })

  it('does not apply a target read if the source is edited after its flush while the read is pending', async () => {
    const source = { ...draftA, workspaceRoot: 'E:\\source-workspace', content: '# Source' }
    const target = { ...draftA, workspaceRoot: 'E:\\target-workspace', content: '# Target' }
    let resolveTarget!: (draft: SddDraft) => void
    const targetRead = new Promise<SddDraft>(resolve => { resolveTarget = resolve })
    const getDraft = vi.fn(() => targetRead)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null),
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(source)
    useSddDraftStore.getState().setContent('# flushed source')

    const loading = loadDraft(target.workspaceRoot, target.id)
    await vi.waitFor(() => expect(getDraft).toHaveBeenCalledOnce())
    expect(useSddDraftStore.getState().saveStatus).toBe('saved')
    useSddDraftStore.getState().setContent('# edit while target read is pending')
    resolveTarget(target)
    await loading

    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(source.workspaceRoot)
    expect(useSddDraftStore.getState().content).toBe('# edit while target read is pending')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
  })

  it('does not commit a target after the source is edited while its trace read is pending', async () => {
    const source = { ...draftA, id: 'source', content: '# Source' }
    const target = { ...draftA, id: 'target', content: '# Target' }
    const pendingTrace = deferred<SddTrace | null>()
    const getHistory = vi.fn(async () => [])
    ;(window as any).electronAPI = {
      sdd: {
        getDraft: vi.fn(async () => target),
        getTrace: vi.fn(() => pendingTrace.promise),
        getHistory
      }
    }
    useSddDraftStore.getState().setActiveDraft(source)

    const loading = loadDraft(target.workspaceRoot, target.id)
    await vi.waitFor(() => expect(window.electronAPI.sdd.getTrace).toHaveBeenCalledWith(target.workspaceRoot, target.id))
    useSddDraftStore.getState().setContent('# source edit while trace is pending')
    pendingTrace.resolve({ ...trace, draftId: target.id })

    const result = await loading
    expect(result).toBe(false)
    expect(useSddDraftStore.getState().activeDraft?.id).toBe(source.id)
    expect(useSddDraftStore.getState().content).toBe('# source edit while trace is pending')
    expect(useSddDraftStore.getState().trace).toBeNull()
    expect(getHistory).not.toHaveBeenCalled()
  })

  it('allocates navigation generation before a shared dirty flush so stale A never reads its target', async () => {
    const source = { ...draftA, workspaceRoot: 'E:\\source-workspace', content: '# Source' }
    const targetA = { ...draftA, workspaceRoot: 'E:\\target-a', content: '# Target A' }
    const targetB = { ...draftA, workspaceRoot: 'E:\\target-b', content: '# Target B' }
    let resolveSave!: () => void
    const pendingSave = new Promise<void>(resolve => { resolveSave = resolve })
    const updateDraft = vi.fn(() => pendingSave)
    const getDraft = vi.fn(async (workspaceRoot: string) => workspaceRoot === targetA.workspaceRoot ? targetA : targetB)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null),
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(source)
    useSddDraftStore.getState().setContent('# unsaved source')

    const loadingA = loadDraft(targetA.workspaceRoot, targetA.id)
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    const loadingB = loadDraft(targetB.workspaceRoot, targetB.id)

    let results: Array<PromiseSettledResult<boolean | void>> = []
    try {
      await Promise.resolve()
      expect(updateDraft).toHaveBeenCalledOnce()
      expect(getDraft).not.toHaveBeenCalled()
    } finally {
      resolveSave()
      results = await Promise.allSettled([loadingA, loadingB])
    }

    expect(results).toEqual([
      { status: 'fulfilled', value: false },
      { status: 'fulfilled', value: true }
    ])
    expect(getDraft).toHaveBeenCalledOnce()
    expect(getDraft).toHaveBeenCalledWith(targetB.workspaceRoot, targetB.id)
    expect(useSddDraftStore.getState().activeDraft).toEqual(targetB)
  })

  it('keeps concurrent navigation on the source when its shared pending save rejects', async () => {
    const source = { ...draftA, workspaceRoot: 'E:\\source-workspace', content: '# Source' }
    const targetA = { ...draftA, workspaceRoot: 'E:\\target-a', content: '# Target A' }
    const targetB = { ...draftA, workspaceRoot: 'E:\\target-b', content: '# Target B' }
    let rejectSave!: (error: Error) => void
    const pendingSave = new Promise<void>((_resolve, reject) => { rejectSave = reject })
    const updateDraft = vi.fn(() => pendingSave)
    const getDraft = vi.fn(async (workspaceRoot: string) => workspaceRoot === targetA.workspaceRoot ? targetA : targetB)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null),
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(source)
    useSddDraftStore.getState().setContent('# unsaved source')

    const loadingA = loadDraft(targetA.workspaceRoot, targetA.id)
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    const loadingB = loadDraft(targetB.workspaceRoot, targetB.id)
    await Promise.resolve()
    rejectSave(new Error('disk full'))
    await Promise.all([loadingA, loadingB])

    expect(updateDraft).toHaveBeenCalledOnce()
    expect(getDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(source.workspaceRoot)
    expect(useSddDraftStore.getState().content).toBe('# unsaved source')
  })

  it.each(['success', 'failure'] as const)('retries an error-state draft before navigation and switches only on %s', async outcome => {
    const source = { ...draftA, workspaceRoot: 'E:\\source-workspace', content: '# Source' }
    const target = { ...draftA, workspaceRoot: 'E:\\target-workspace', content: '# Target' }
    const updateDraft = vi.fn(async () => {
      if (outcome === 'failure') throw new Error('retry failed')
    })
    const getDraft = vi.fn(async () => target)
    ;(window as any).electronAPI = {
      sdd: {
        getDraft,
        getTrace: vi.fn(async () => null),
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(source)
    useSddDraftStore.getState().setContent('# unsaved source')
    useSddDraftStore.getState().setSaveStatus('error')
    useSddDraftStore.getState().setError('previous failure')

    await loadDraft(target.workspaceRoot, target.id)

    expect(updateDraft).toHaveBeenCalledOnce()
    if (outcome === 'success') {
      expect(getDraft).toHaveBeenCalledOnce()
      expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(target.workspaceRoot)
    } else {
      expect(getDraft).not.toHaveBeenCalled()
      expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(source.workspaceRoot)
      expect(useSddDraftStore.getState().content).toBe('# unsaved source')
    }
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
    useSddDraftStore.getState().markSaved(
      useSddDraftStore.getState().draftSession,
      useSddDraftStore.getState().editRevision
    )
    const s = useSddDraftStore.getState()
    expect(s.activeDraft?.content).toBe('# body after edit')
    expect(s.lastSavedContent).toBe('# body after edit')
    expect(s.saveStatus).toBe('saved')
  })

  it('saves content and design context as one unified draft snapshot', async () => {
    const updateDraft = vi.fn(async () => undefined)
    const updateDesignContext = vi.fn(async () => undefined)
    ;(window as any).electronAPI = { sdd: { updateDraft, updateDesignContext } }
    useSddDraftStore.getState().setActiveDraft({
      ...draftA,
      designContext: { designType: 'brand', brandColor: '#123456', tone: ['calm'] }
    })
    useSddDraftStore.getState().setContent('# Draft A\n\nEdited')

    await expect(saveDraftToDisk()).resolves.toBe(true)

    expect(updateDraft).toHaveBeenCalledOnce()
    expect(updateDraft).toHaveBeenCalledWith(
      draftA.workspaceRoot,
      draftA.id,
      '# Draft A\n\nEdited',
      { designType: 'brand', brandColor: '#123456', tone: ['calm'] }
    )
    expect(updateDesignContext).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)('does not apply a stale %s result after a newer edit revision', async outcome => {
    let resolveSave!: () => void
    let rejectSave!: (error: Error) => void
    const pendingSave = new Promise<void>((resolve, reject) => {
      resolveSave = resolve
      rejectSave = reject
    })
    const updateDraft = vi.fn(() => pendingSave)
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# edit A')

    const saving = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setContent('# edit B')
    if (outcome === 'success') resolveSave()
    else rejectSave(new Error('disk full'))

    await expect(saving).resolves.toBe(false)
    const state = useSddDraftStore.getState()
    expect(state.content).toBe('# edit B')
    expect(state.saveStatus).toBe('dirty')
    expect(state.error).toBeNull()
  })

  it('starts a distinct save for a newer revision and old cleanup does not clear it', async () => {
    let resolveOld!: () => void
    let resolveNew!: () => void
    const oldSave = new Promise<void>(resolve => { resolveOld = resolve })
    const newSave = new Promise<void>(resolve => { resolveNew = resolve })
    const updateDraft = vi.fn()
      .mockImplementationOnce(() => oldSave)
      .mockImplementationOnce(() => newSave)
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# revision one')
    const savingOld = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())

    useSddDraftStore.getState().setContent('# revision two')
    const savingNew = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(2))

    resolveOld()
    await expect(savingOld).resolves.toBe(false)
    resolveNew()
    await expect(savingNew).resolves.toBe(true)
    expect(updateDraft.mock.calls.map(call => call[2])).toEqual(['# revision one', '# revision two'])
    expect(useSddDraftStore.getState().content).toBe('# revision two')
    expect(useSddDraftStore.getState().saveStatus).toBe('saved')
  })

  it('returns the same in-flight promise for the same draft save identity', async () => {
    let resolveSave!: () => void
    const pendingSave = new Promise<void>(resolve => { resolveSave = resolve })
    const updateDraft = vi.fn(() => pendingSave)
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# pending identity')

    const first = saveDraftToDisk()
    const second = saveDraftToDisk()

    try {
      expect(second).toBe(first)
      expect(updateDraft).toHaveBeenCalledOnce()
    } finally {
      resolveSave()
      await Promise.all([first, second])
    }
  })

  it.each(['success', 'failure'] as const)('does not apply an old %s result after clearing and reopening the same draft at the same revision', async outcome => {
    let resolveSave!: () => void
    let rejectSave!: (error: Error) => void
    const pendingSave = new Promise<void>((resolve, reject) => {
      resolveSave = resolve
      rejectSave = reject
    })
    const updateDraft = vi.fn(() => pendingSave)
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# old edit')

    const saving = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    useSddDraftStore.getState().clearDraft()
    useSddDraftStore.getState().setActiveDraft({ ...draftA })
    useSddDraftStore.getState().setContent('# reopened edit')
    expect(useSddDraftStore.getState().editRevision).toBe(1)

    if (outcome === 'success') resolveSave()
    else rejectSave(new Error('old save failed'))

    await expect(saving).resolves.toBe(false)
    const state = useSddDraftStore.getState()
    expect(state.content).toBe('# reopened edit')
    expect(state.saveStatus).toBe('dirty')
    expect(state.error).toBeNull()
  })

  it.each(['success', 'failure'] as const)('does not apply an old %s result after replacing the active draft with the same key and revision', async outcome => {
    let resolveSave!: () => void
    let rejectSave!: (error: Error) => void
    const pendingSave = new Promise<void>((resolve, reject) => {
      resolveSave = resolve
      rejectSave = reject
    })
    const updateDraft = vi.fn(() => pendingSave)
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# old edit')

    const saving = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setActiveDraft({ ...draftA })
    useSddDraftStore.getState().setContent('# replacement edit')
    expect(useSddDraftStore.getState().editRevision).toBe(1)

    if (outcome === 'success') resolveSave()
    else rejectSave(new Error('old save failed'))

    await expect(saving).resolves.toBe(false)
    const state = useSddDraftStore.getState()
    expect(state.content).toBe('# replacement edit')
    expect(state.saveStatus).toBe('dirty')
    expect(state.error).toBeNull()
  })

  it.each(['success', 'failure'] as const)('does not apply an old %s result after rehydrating the same draft at the same revision', async outcome => {
    let resolveSave!: () => void
    let rejectSave!: (error: Error) => void
    const pendingSave = new Promise<void>((resolve, reject) => {
      resolveSave = resolve
      rejectSave = reject
    })
    const updateDraft = vi.fn(() => pendingSave)
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined),
        getDraft: vi.fn(async () => null)
      }
    }
    useSddDraftStore.getState().setActiveDraft(draftA)
    useSddDraftStore.getState().setContent('# old edit')

    const saving = saveDraftToDisk()
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledOnce())
    localStorage.setItem('sdd-draft-store', JSON.stringify({
      state: {
        activeDraft: { ...draftA, content: '# rehydrated snapshot' },
        lastSavedContent: '# rehydrated snapshot',
        saveStatus: 'saved'
      },
      version: 1
    }))
    await useSddDraftStore.persist.rehydrate()
    useSddDraftStore.getState().setContent('# rehydrated edit')
    expect(useSddDraftStore.getState().editRevision).toBe(1)

    if (outcome === 'success') resolveSave()
    else rejectSave(new Error('old save failed'))

    await expect(saving).resolves.toBe(false)
    const state = useSddDraftStore.getState()
    expect(state.content).toBe('# rehydrated edit')
    expect(state.saveStatus).toBe('dirty')
    expect(state.error).toBeNull()
  })

  it('does not expose or commit a loaded draft if the active draft changes before trace finishes', async () => {
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
    await vi.waitFor(() => expect(api.sdd.getTrace).toHaveBeenCalledWith('E:\\workspace-a', 'draft-1'))
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
    useSddDraftStore.getState().setActiveDraft(draftB)
    resolveTrace(trace)
    await expect(loading).resolves.toBe(false)

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
      expect.stringContaining('### R-1: Checkout {verified}'),
      undefined
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

  it('does not overwrite an edit made while verification history is saving', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment'
    ].join('\n')
    const historySave = deferred<void>()
    const api = {
      sdd: {
        saveHistory: vi.fn(() => historySave.promise),
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined),
        saveTrace: vi.fn(async () => undefined),
        parseBlocks: vi.fn(async () => [])
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })

    const applying = applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
    ])
    await vi.waitFor(() => expect(api.sdd.saveHistory).toHaveBeenCalledOnce())
    useSddDraftStore.getState().setContent('# newer edit during history save')
    historySave.resolve()

    await expect(applying).rejects.toThrow('Requirement document changed while recording verification history')
    expect(useSddDraftStore.getState().content).toBe('# newer edit during history save')
    expect(api.sdd.updateDraft).not.toHaveBeenCalled()
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

  it('loads the target workspace trace when verification parsing finishes on another workspace with the same draft id', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment'
    ].join('\n')
    const pendingBlocks = deferred<SddTrace['requirementBlocks']>()
    const pendingTargetTrace = deferred<SddTrace | null>()
    const workspaceBTrace: SddTrace = {
      draftId: draftA.id,
      requirementBlocks: [],
      planItems: [{
        id: 'B-1',
        text: 'B-1: Workspace B work',
        covers: ['R-B'],
        status: 'completed',
        lineNumber: 1
      }],
      coverage: { 'R-B': ['B-1'] },
      derivedStatuses: { 'R-B': 'done' },
      uncoveredRequirementIds: [],
      timestamp: '2026-07-04T00:02:00.000Z'
    }
    const verifiedBlocks: SddTrace['requirementBlocks'] = [{
      id: 'R-1',
      title: 'Checkout',
      status: 'verified',
      description: '',
      acceptanceCriteria: [{ text: 'submit payment', checked: true }],
      lineNumber: 3
    }]
    const api = {
      sdd: {
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined),
        getTrace: vi.fn(() => pendingTargetTrace.promise),
        saveTrace: vi.fn(async () => undefined),
        parseBlocks: vi.fn(() => pendingBlocks.promise)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })
    useSddDraftStore.getState().setTrace(trace)

    const applying = applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
    ])
    await vi.waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalled())
    useSddDraftStore.getState().setActiveDraft({ ...draftB, id: draftA.id })
    useSddDraftStore.getState().setTrace(workspaceBTrace)
    pendingBlocks.resolve(verifiedBlocks)
    await pendingBlocks.promise
    await Promise.resolve()
    pendingTargetTrace.resolve(trace)

    await expect(applying).resolves.toMatchObject({ appliedCount: 1 })
    expect(api.sdd.getTrace).toHaveBeenCalledWith(draftA.workspaceRoot, draftA.id)
    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems.map(item => item.id)).toEqual(['P-1'])
    expect(savedTrace.coverage).toEqual({ 'R-1': ['P-1'] })
    expect(savedTrace.requirementBlocks).toEqual(verifiedBlocks)
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe(draftB.workspaceRoot)
    expect(useSddDraftStore.getState().trace).toEqual(workspaceBTrace)
  })

  it('does not reuse or mutate a replacement session trace after verification parsing', async () => {
    const content = [
      '# Checkout',
      '',
      '### R-1: Checkout {done}',
      '- [ ] submit payment'
    ].join('\n')
    const pendingBlocks = deferred<SddTrace['requirementBlocks']>()
    const replacementBlocks: SddTrace['requirementBlocks'] = [{
      id: 'R-NEW',
      title: 'Replacement requirement',
      status: 'draft',
      description: 'Owned by the replacement session.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const replacementTrace: SddTrace = {
      draftId: draftA.id,
      requirementBlocks: replacementBlocks,
      planItems: [{
        id: 'NEW-1',
        text: 'Replacement-session work',
        covers: ['R-NEW'],
        status: 'pending',
        lineNumber: 1
      }],
      coverage: { 'R-NEW': ['NEW-1'] },
      derivedStatuses: { 'R-NEW': 'planned' },
      uncoveredRequirementIds: [],
      timestamp: '2026-07-04T00:03:00.000Z'
    }
    const api = {
      sdd: {
        updateDraft: vi.fn(async () => undefined),
        updateDesignContext: vi.fn(async () => undefined),
        getTrace: vi.fn(async () => trace),
        saveTrace: vi.fn(async () => undefined),
        parseBlocks: vi.fn(() => pendingBlocks.promise)
      }
    }
    ;(window as any).electronAPI = api
    useSddDraftStore.getState().setActiveDraft({ ...draftA, content })
    useSddDraftStore.getState().setTrace(trace)

    const applying = applyVerifyVerdicts([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
    ])
    await vi.waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalled())
    const verifiedContent = useSddDraftStore.getState().content
    const verifiedSession = useSddDraftStore.getState().draftSession
    const replacement = { ...draftA, title: 'Replacement session', content: verifiedContent }
    useSddDraftStore.getState().setActiveDraft(replacement)
    expect(useSddDraftStore.getState().draftSession).not.toBe(verifiedSession)
    useSddDraftStore.getState().setRequirementBlocks(replacementBlocks)
    useSddDraftStore.getState().setTrace(replacementTrace)
    pendingBlocks.resolve([{
      id: 'R-1',
      title: 'Checkout',
      status: 'verified',
      description: '',
      acceptanceCriteria: [{ text: 'submit payment', checked: true }],
      lineNumber: 3
    }])

    await expect(applying).rejects.toThrow('Requirement draft changed while parsing verification updates')
    expect(api.sdd.getTrace).not.toHaveBeenCalled()
    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft).toEqual(replacement)
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(replacementBlocks)
    expect(useSddDraftStore.getState().trace).toEqual(replacementTrace)
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
