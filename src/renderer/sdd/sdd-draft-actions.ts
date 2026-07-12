/**
 * SDD Draft Actions - 需求草稿操作
 *
 * 处理需求的创建、保存、加载等操作
 */

import { useSddDraftStore, type SddDraft, type SddDesignContext, type SddRequirementBlock, type SddTrace } from './sdd-draft-store'
import { hydrateDraftHistoryFromDisk, recordAiHistory } from './sdd-draft-history'
import { applyVerifyVerdictsToContent, hashVerifyContent, type VerifyCriterionVerdict, type VerifyDraftSnapshot } from './sdd-verify-prompt'
import { deriveTraceStatuses } from './sdd-trace-dispatch'

// ============================================================
// Draft Actions
// ============================================================

interface DraftSaveIdentity {
  workspaceRoot: string
  draftId: string
  draftSession: number
  editRevision: number
}

interface DraftContentIdentity extends DraftSaveIdentity {
  content: string
}

interface InFlightDraftSave {
  identity: DraftSaveIdentity
  promise: Promise<boolean>
}

let inFlightDraftSave: InFlightDraftSave | null = null
let draftLoadGeneration = 0

function isLatestDraftLoad(generation: number): boolean {
  return generation === draftLoadGeneration
}

export function invalidateDraftLoads(): void {
  draftLoadGeneration++
}

function sameSaveIdentity(left: DraftSaveIdentity, right: DraftSaveIdentity): boolean {
  return (
    left.workspaceRoot === right.workspaceRoot &&
    left.draftId === right.draftId &&
    left.draftSession === right.draftSession &&
    left.editRevision === right.editRevision
  )
}

function matchesDraftContentIdentity(state: ReturnType<typeof useSddDraftStore.getState>, identity: DraftContentIdentity): boolean {
  return state.activeDraft?.workspaceRoot === identity.workspaceRoot &&
    state.activeDraft.id === identity.draftId &&
    state.draftSession === identity.draftSession &&
    state.editRevision === identity.editRevision &&
    state.content === identity.content
}

function captureSourceIdentity(): DraftSaveIdentity | null {
  const state = useSddDraftStore.getState()
  return state.activeDraft
    ? {
        workspaceRoot: state.activeDraft.workspaceRoot,
        draftId: state.activeDraft.id,
        draftSession: state.draftSession,
        editRevision: state.editRevision
      }
    : null
}

function isSourceSafelySaved(identity: DraftSaveIdentity | null): boolean {
  const state = useSddDraftStore.getState()
  if (!identity) return state.activeDraft === null
  return (
    state.activeDraft?.workspaceRoot === identity.workspaceRoot &&
    state.activeDraft.id === identity.draftId &&
    state.draftSession === identity.draftSession &&
    state.editRevision === identity.editRevision &&
    state.saveStatus === 'saved' &&
    state.content === state.lastSavedContent
  )
}

async function ensureSourceDurable(identity: DraftSaveIdentity | null): Promise<boolean> {
  if (!identity) return isSourceSafelySaved(null)
  const state = useSddDraftStore.getState()
  if (!sameSaveIdentity(identity, {
    workspaceRoot: state.activeDraft?.workspaceRoot ?? '',
    draftId: state.activeDraft?.id ?? '',
    draftSession: state.draftSession,
    editRevision: state.editRevision
  })) return false
  if (['dirty', 'saving', 'error'].includes(state.saveStatus)) {
    const saved = await saveDraftToDisk()
    if (!saved) return false
  }
  return isSourceSafelySaved(identity)
}

/**
 * 创建新需求草稿
 */
export async function createNewDraft(
  workspaceRoot: string,
  title: string,
  template?: 'blank' | 'standard' | 'minimal'
): Promise<SddDraft | null> {
  const sourceIdentity = captureSourceIdentity()
  if (!await ensureSourceDurable(sourceIdentity) || !isSourceSafelySaved(sourceIdentity)) return null
  try {
    const draft = await window.electronAPI.sdd.createDraft(workspaceRoot, title, template)
    if (!draft || !isSourceSafelySaved(sourceIdentity)) return null
    useSddDraftStore.getState().setActiveDraft(draft)
    return draft
  } catch (error: any) {
    if (isSourceSafelySaved(sourceIdentity)) {
      useSddDraftStore.getState().setError(error.message || 'Failed to create draft')
    }
    throw error
  }
}

/**
 * F-W4: After persist rehydrate, reload draft from disk so buffer matches filesystem.
 */
export async function reloadActiveDraftFromDisk(): Promise<void> {
  const { activeDraft, draftSession, editRevision } = useSddDraftStore.getState()
  if (!activeDraft?.id || !activeDraft.workspaceRoot) return
  const snapshot: DraftSaveIdentity = {
    workspaceRoot: activeDraft.workspaceRoot,
    draftId: activeDraft.id,
    draftSession,
    editRevision
  }
  try {
    const draft = await window.electronAPI.sdd.getDraft(snapshot.workspaceRoot, snapshot.draftId)
    if (!draft) return
    // Only overwrite the exact saved draft instance captured before the disk read.
    const current = useSddDraftStore.getState()
    if (
      current.saveStatus !== 'saved' ||
      current.activeDraft?.id !== snapshot.draftId ||
      current.activeDraft.workspaceRoot !== snapshot.workspaceRoot ||
      current.draftSession !== snapshot.draftSession ||
      current.editRevision !== snapshot.editRevision
    ) return
    useSddDraftStore.getState().setActiveDraft(draft)
  } catch {
    /* keep rehydrated snapshot */
  }
}

/**
 * 加载需求草稿
 */
export async function loadDraft(workspaceRoot: string, draftId: string): Promise<boolean> {
  const loadGeneration = ++draftLoadGeneration
  const sourceIdentity = captureSourceIdentity()
  const canCommitLoad = () => isLatestDraftLoad(loadGeneration) && isSourceSafelySaved(sourceIdentity)

  try {
    // G2-MH7: flush dirty buffer before replacing active draft; abort switch on failure
    const sourceDurable = await ensureSourceDurable(sourceIdentity)
    if (!isLatestDraftLoad(loadGeneration)) return false
    if (!sourceDurable || !isSourceSafelySaved(sourceIdentity)) return false

    const draft = await window.electronAPI.sdd.getDraft(workspaceRoot, draftId)
    if (!canCommitLoad()) return false
    if (!draft) {
      if (!canCommitLoad()) return false
      useSddDraftStore.getState().setError('Draft not found')
      return false
    }

    let trace: SddTrace | null = null
    try {
      trace = await window.electronAPI.sdd.getTrace(workspaceRoot, draftId)
      if (!canCommitLoad()) return false
    } catch (traceError) {
      if (!canCommitLoad()) return false
      console.error('Failed to load draft trace:', traceError)
    }

    if (!canCommitLoad()) return false
    // Commit draft and trace together only after both target reads are settled.
    useSddDraftStore.setState(state => ({
      activeDraft: draft,
      content: draft.content || '',
      lastSavedContent: draft.content || '',
      saveStatus: 'saved',
      operationStatus: 'idle',
      error: null,
      draftSession: state.draftSession + 1,
      editRevision: 0,
      requirementBlocks: [],
      trace
    }))

    if (!isLatestDraftLoad(loadGeneration)) return false
    const committedDraft = useSddDraftStore.getState().activeDraft
    if (committedDraft?.id !== draft.id || committedDraft.workspaceRoot !== draft.workspaceRoot) return false
    hydrateDraftHistoryFromDisk(draft.id, draft.workspaceRoot).catch(() => {})
    return true
  } catch (error: any) {
    if (!canCommitLoad()) return false
    useSddDraftStore.getState().setError(error.message || 'Failed to load draft')
    return false
  }
}

/**
 * 保存草稿到磁盘
 */
export function saveDraftToDisk(): Promise<boolean> {
  const store = useSddDraftStore.getState()
  const draft = store.activeDraft

  if (!draft) return Promise.resolve(true)

  const snapshot = {
    workspaceRoot: draft.workspaceRoot,
    draftId: draft.id,
    content: store.content,
    designContext: draft.designContext
      ? {
          ...draft.designContext,
          ...(draft.designContext.tone ? { tone: [...draft.designContext.tone] } : {})
        }
      : undefined,
    draftSession: store.draftSession,
    editRevision: store.editRevision
  }
  const identity: DraftSaveIdentity = snapshot

  if (inFlightDraftSave && sameSaveIdentity(inFlightDraftSave.identity, identity)) {
    return inFlightDraftSave.promise
  }
  if (store.saveStatus === 'saved' && store.content === store.lastSavedContent) return Promise.resolve(true)

  // G2-MC1: refuse accidental empty overwrite of a non-empty document
  // (e.g. rehydrate left content empty while lastSaved/disk had body).
  if (snapshot.content === '' && (store.lastSavedContent || '').length > 0) {
    store.markError(snapshot.draftSession, snapshot.editRevision, 'Refused to save empty content over a non-empty draft')
    return Promise.resolve(false)
  }

  store.setSaveStatus('saving')

  const operation = (async (): Promise<boolean> => {
    try {
      // 保存需求内容
      await window.electronAPI.sdd.updateDraft(
        snapshot.workspaceRoot,
        snapshot.draftId,
        snapshot.content,
        snapshot.designContext
      )
      const current = useSddDraftStore.getState()
      const isCurrentSnapshot = (
        current.activeDraft?.id === snapshot.draftId &&
        current.activeDraft.workspaceRoot === snapshot.workspaceRoot &&
        current.draftSession === snapshot.draftSession &&
        current.editRevision === snapshot.editRevision
      )
      if (isCurrentSnapshot) {
        current.markSaved(snapshot.draftSession, snapshot.editRevision)
      }
      return isCurrentSnapshot
    } catch (error: any) {
      const current = useSddDraftStore.getState()
      if (
        current.activeDraft?.id === snapshot.draftId &&
        current.activeDraft.workspaceRoot === snapshot.workspaceRoot
      ) {
        current.markError(snapshot.draftSession, snapshot.editRevision, error.message || 'Failed to save draft')
      }
      return false
    }
  })()
  const trackedSave: InFlightDraftSave = { identity, promise: operation }
  trackedSave.promise = operation.finally(() => {
    if (inFlightDraftSave === trackedSave) {
      inFlightDraftSave = null
    }
  })
  inFlightDraftSave = trackedSave
  return trackedSave.promise
}

/**
 * 删除需求草稿
 */
export async function deleteDraft(workspaceRoot: string, draftId: string): Promise<void> {
  const state = useSddDraftStore.getState()
  const sourceSession = (
    state.activeDraft?.id === draftId &&
    state.activeDraft.workspaceRoot === workspaceRoot
  ) ? state.draftSession : null
  const isCurrentDeleteSource = () => {
    if (sourceSession === null) return false
    const current = useSddDraftStore.getState()
    return current.activeDraft?.id === draftId &&
      current.activeDraft.workspaceRoot === workspaceRoot &&
      current.draftSession === sourceSession
  }
  invalidateDraftLoads()
  try {
    await window.electronAPI.sdd.deleteDraft(workspaceRoot, draftId)
    if (isCurrentDeleteSource()) {
      useSddDraftStore.getState().clearDraft()
    }
  } catch (error: any) {
    if (isCurrentDeleteSource()) {
      useSddDraftStore.getState().setError(error.message || 'Failed to delete draft')
    }
    throw error
  }
}

/**
 * 更新设计上下文
 */
export async function updateDesignContext(
  workspaceRoot: string,
  draftId: string,
  designContext: SddDesignContext
): Promise<void> {
  try {
    await window.electronAPI.sdd.updateDesignContext(workspaceRoot, draftId, designContext)
    useSddDraftStore.getState().updateDesignContext(designContext)
  } catch (error: any) {
    useSddDraftStore.getState().setError(error.message || 'Failed to update design context')
  }
}

/**
 * 解析需求块
 */
export async function parseRequirementBlocks(): Promise<boolean> {
  const { content, activeDraft, draftSession, editRevision } = useSddDraftStore.getState()
  if (!activeDraft) return false
  const { id: draftId, workspaceRoot } = activeDraft
  try {
    const blocks = await window.electronAPI.sdd.parseBlocks(content)
    const current = useSddDraftStore.getState()
    if (
      current.activeDraft?.id !== draftId ||
      current.activeDraft.workspaceRoot !== workspaceRoot ||
      current.draftSession !== draftSession ||
      current.editRevision !== editRevision ||
      current.content !== content
    ) return false
    current.setRequirementBlocks(blocks)
    return true
  } catch (error: any) {
    console.error('Failed to parse requirement blocks:', error)
    return false
  }
}

async function parseRequirementBlocksForDraft(
  draft: Pick<SddDraft, 'workspaceRoot' | 'id'>,
  content: string,
  sourceIdentity?: DraftContentIdentity
): Promise<SddRequirementBlock[]> {
  const blocks = await window.electronAPI.sdd.parseBlocks(content)
  const current = useSddDraftStore.getState()
  const canCommit = sourceIdentity
    ? matchesDraftContentIdentity(current, sourceIdentity)
    : (
    current.activeDraft?.id === draft.id &&
    current.activeDraft.workspaceRoot === draft.workspaceRoot &&
    current.content === content
    )
  if (canCommit) {
    current.setRequirementBlocks(blocks)
  }
  return blocks
}

/**
 * 计算需求追踪
 */
export async function computeTrace(planMarkdown?: string): Promise<void> {
  const { activeDraft } = useSddDraftStore.getState()
  if (!activeDraft) return

  try {
    const trace = await window.electronAPI.sdd.computeTrace(
      activeDraft.workspaceRoot,
      activeDraft.id,
      planMarkdown
    )
    useSddDraftStore.getState().setTrace(trace)
  } catch (error: any) {
    console.error('Failed to compute trace:', error)
  }
}

/**
 * Compute and persist the requirement trace for an assistant-generated plan.
 */
export async function persistPlanTrace(planMarkdown: string, draftInput?: Pick<SddDraft, 'workspaceRoot' | 'id'>): Promise<SddTrace | null> {
  const sourceState = useSddDraftStore.getState()
  const targetDraft = draftInput ?? sourceState.activeDraft
  if (!targetDraft) return null
  const sourceSnapshot: DraftContentIdentity | null =
    sourceState.activeDraft?.id === targetDraft.id && sourceState.activeDraft.workspaceRoot === targetDraft.workspaceRoot
      ? {
          workspaceRoot: targetDraft.workspaceRoot,
          draftId: targetDraft.id,
          draftSession: sourceState.draftSession,
          editRevision: sourceState.editRevision,
          content: sourceState.content
        }
      : null
  let sourceInvalidated = false
  const unsubscribeSource = sourceSnapshot
    ? useSddDraftStore.subscribe(currentState => {
        const targetIsActive = currentState.activeDraft?.id === targetDraft.id &&
          currentState.activeDraft.workspaceRoot === targetDraft.workspaceRoot
        if (targetIsActive && !matchesDraftContentIdentity(currentState, sourceSnapshot)) {
          sourceInvalidated = true
        }
      })
    : null

  try {
    const trace = await window.electronAPI.sdd.computeTrace(
      targetDraft.workspaceRoot,
      targetDraft.id,
      planMarkdown
    )
    const currentState = useSddDraftStore.getState()
    const targetIsActive = currentState.activeDraft?.id === targetDraft.id &&
      currentState.activeDraft.workspaceRoot === targetDraft.workspaceRoot
    if (sourceInvalidated) return null
    if (targetIsActive && sourceSnapshot && matchesDraftContentIdentity(currentState, sourceSnapshot)) {
      currentState.setTrace(trace)
    }
    if (trace) {
      await window.electronAPI.sdd.saveTrace(targetDraft.workspaceRoot, targetDraft.id, trace)
    }
    return trace
  } catch (error: any) {
    console.error('Failed to persist plan trace:', error)
    return null
  } finally {
    unsubscribeSource?.()
  }
}

export async function refreshTraceRequirementBlocksAfterVerification(
  draft: Pick<SddDraft, 'workspaceRoot' | 'id'>,
  verifiedContent?: string,
  verifiedBlocks?: SddRequirementBlock[]
): Promise<SddTrace | null> {
  const store = useSddDraftStore.getState()
  const isTargetActive = store.activeDraft?.id === draft.id && store.activeDraft.workspaceRoot === draft.workspaceRoot
  const sourceSnapshot = isTargetActive
    ? {
        draftSession: store.draftSession,
        editRevision: store.editRevision,
        content: store.content
      }
    : null
  const isSameActiveSource = () => {
    if (!sourceSnapshot) return false
    const current = useSddDraftStore.getState()
    return current.activeDraft?.id === draft.id &&
      current.activeDraft.workspaceRoot === draft.workspaceRoot &&
      current.draftSession === sourceSnapshot.draftSession &&
      current.editRevision === sourceSnapshot.editRevision &&
      current.content === sourceSnapshot.content
  }
  const storeTrace = isTargetActive && store.trace?.draftId === draft.id ? store.trace : null
  const trace = storeTrace ?? await window.electronAPI.sdd.getTrace?.(draft.workspaceRoot, draft.id)
  if (trace?.draftId !== draft.id) return null
  if (!trace) return null
  const requirementBlocks = verifiedBlocks
    ? verifiedBlocks
    : verifiedContent
    ? await window.electronAPI.sdd.parseBlocks(verifiedContent)
    : isSameActiveSource() && store.requirementBlocks.length > 0
      ? store.requirementBlocks
      : isSameActiveSource()
        ? await window.electronAPI.sdd.parseBlocks(store.content)
        : trace.requirementBlocks
  const nextTrace: SddTrace = {
    ...trace,
    requirementBlocks,
    derivedStatuses: deriveTraceStatuses({ ...trace, requirementBlocks }, trace.planItems),
    timestamp: new Date().toISOString()
  }
  await window.electronAPI.sdd.saveTrace(draft.workspaceRoot, draft.id, nextTrace)
  if (isSameActiveSource()) {
    useSddDraftStore.getState().setTrace(nextTrace)
  }
  return nextTrace
}

/**
 * Apply AI verification verdicts to the active requirement draft.
 *
 * Only passing verdicts are written back. Failed or unknown criteria remain
 * unchanged, and the caller is expected to show the full review report.
 */
export async function applyVerifyVerdicts(verdicts: VerifyCriterionVerdict[], snapshot?: VerifyDraftSnapshot): Promise<{
  appliedCount: number
  verifiedRequirementIds: string[]
  warnings: string[]
}> {
  const store = useSddDraftStore.getState()
  const draft = store.activeDraft
  if (!draft) throw new Error('No active draft')
  if (snapshot) {
    if (draft.id !== snapshot.draftId || draft.workspaceRoot !== snapshot.workspaceRoot) {
      throw new Error('Verification applies to a different requirement draft. Re-run verification for the current draft.')
    }
    if (hashVerifyContent(store.content) !== snapshot.contentHash) {
      throw new Error('Requirement document changed after verification. Re-run verification before applying results.')
    }
  }

  const result = applyVerifyVerdictsToContent(store.content, verdicts)
  if (!result.changed) {
    return {
      appliedCount: result.appliedCount,
      verifiedRequirementIds: result.verifiedRequirementIds,
      warnings: result.warnings
    }
  }

  const source = {
    draftId: draft.id,
    workspaceRoot: draft.workspaceRoot,
    draftSession: store.draftSession,
    editRevision: store.editRevision,
    content: store.content
  }
  await recordAiHistory(draft, source.content, 'acceptance verification writeback')
  const afterHistory = useSddDraftStore.getState()
  if (
    afterHistory.activeDraft?.id !== source.draftId ||
    afterHistory.activeDraft.workspaceRoot !== source.workspaceRoot ||
    afterHistory.draftSession !== source.draftSession ||
    afterHistory.editRevision !== source.editRevision ||
    afterHistory.content !== source.content ||
    (snapshot && hashVerifyContent(afterHistory.content) !== snapshot.contentHash)
  ) {
    throw new Error('Requirement document changed while recording verification history. Re-run verification before applying results.')
  }
  afterHistory.setContent(result.content)
  const saved = await saveDraftToDisk()
  if (!saved) {
    const current = useSddDraftStore.getState()
    if (
      current.activeDraft?.id !== draft.id ||
      current.activeDraft.workspaceRoot !== draft.workspaceRoot ||
      current.content !== result.content
    ) {
      throw new Error('Requirement draft changed while saving verification updates. Re-open the verified draft and re-run verification.')
    }
    throw new Error('Failed to save verification updates')
  }
  const verifiedState = useSddDraftStore.getState()
  const activeDraftAfterSave = verifiedState.activeDraft
  const contentAfterSave = verifiedState.content
  if (
    activeDraftAfterSave?.id !== draft.id ||
    activeDraftAfterSave.workspaceRoot !== draft.workspaceRoot ||
    contentAfterSave !== result.content
  ) {
    throw new Error('Requirement draft changed while saving verification updates. Re-open the verified draft and re-run verification.')
  }
  const verifiedSource: DraftContentIdentity = {
    workspaceRoot: draft.workspaceRoot,
    draftId: draft.id,
    draftSession: verifiedState.draftSession,
    editRevision: verifiedState.editRevision,
    content: result.content
  }
  const verifiedBlocks = await parseRequirementBlocksForDraft(draft, result.content, verifiedSource)
  const afterParsing = useSddDraftStore.getState()
  const targetIsActive = afterParsing.activeDraft?.id === draft.id && afterParsing.activeDraft.workspaceRoot === draft.workspaceRoot
  if (targetIsActive && !matchesDraftContentIdentity(afterParsing, verifiedSource)) {
    throw new Error('Requirement draft changed while parsing verification updates. Re-open the verified draft and re-run verification.')
  }
  await refreshTraceRequirementBlocksAfterVerification(draft, result.content, verifiedBlocks)

  return {
    appliedCount: result.appliedCount,
    verifiedRequirementIds: result.verifiedRequirementIds,
    warnings: result.warnings
  }
}

// ============================================================
// List Actions
// ============================================================

/**
 * 列出所有需求
 */
export async function listDrafts(workspaceRoot: string) {
  try {
    return await window.electronAPI.sdd.listDrafts(workspaceRoot)
  } catch (error: any) {
    console.error('Failed to list drafts:', error)
    return []
  }
}

/**
 * 检查需求是否存在
 */
export async function draftExists(workspaceRoot: string, draftId: string): Promise<boolean> {
  try {
    return await window.electronAPI.sdd.exists(workspaceRoot, draftId)
  } catch {
    return false
  }
}
