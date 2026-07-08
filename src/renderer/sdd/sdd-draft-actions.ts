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

/**
 * 创建新需求草稿
 */
export async function createNewDraft(
  workspaceRoot: string,
  title: string,
  template?: 'blank' | 'standard' | 'minimal'
): Promise<SddDraft> {
  try {
    const draft = await window.electronAPI.sdd.createDraft(workspaceRoot, title, template)
    useSddDraftStore.getState().setActiveDraft(draft)
    return draft
  } catch (error: any) {
    useSddDraftStore.getState().setError(error.message || 'Failed to create draft')
    throw error
  }
}

/**
 * 加载需求草稿
 */
export async function loadDraft(workspaceRoot: string, draftId: string): Promise<void> {
  try {
    const draft = await window.electronAPI.sdd.getDraft(workspaceRoot, draftId)
    if (draft) {
      useSddDraftStore.getState().setActiveDraft(draft)
      hydrateDraftHistoryFromDisk(draft.id, draft.workspaceRoot).catch(() => {})
      try {
        const trace = await window.electronAPI.sdd.getTrace(workspaceRoot, draftId)
        const activeDraft = useSddDraftStore.getState().activeDraft
        if (activeDraft?.id === draftId && activeDraft.workspaceRoot === workspaceRoot) {
          useSddDraftStore.getState().setTrace(trace)
        }
      } catch (traceError) {
        console.error('Failed to load draft trace:', traceError)
      }
    } else {
      useSddDraftStore.getState().setError('Draft not found')
    }
  } catch (error: any) {
    useSddDraftStore.getState().setError(error.message || 'Failed to load draft')
  }
}

/**
 * 保存草稿到磁盘
 */
export async function saveDraftToDisk(): Promise<boolean> {
  const store = useSddDraftStore.getState()
  const draft = store.activeDraft
  const content = store.content
  const designContext = draft?.designContext

  if (!draft) return true
  if (store.saveStatus === 'saved' && content === store.lastSavedContent) return true

  store.setSaveStatus('saving')

  try {
    // 保存需求内容
    await window.electronAPI.sdd.updateDraft(
      draft.workspaceRoot,
      draft.id,
      content
    )
    // 同时保存设计上下文（防止仅在内存中更新而未持久化）
    if (designContext) {
      await window.electronAPI.sdd.updateDesignContext(
        draft.workspaceRoot,
        draft.id,
        designContext
      )
    }
    const current = useSddDraftStore.getState()
    if (
      current.activeDraft?.id === draft.id &&
      current.activeDraft.workspaceRoot === draft.workspaceRoot &&
      current.content === content
    ) {
      current.markSaved()
    }
    return true
  } catch (error: any) {
    const current = useSddDraftStore.getState()
    current.setSaveStatus('error')
    current.setError(error.message || 'Failed to save draft')
    return false
  }
}

/**
 * 删除需求草稿
 */
export async function deleteDraft(workspaceRoot: string, draftId: string): Promise<void> {
  try {
    await window.electronAPI.sdd.deleteDraft(workspaceRoot, draftId)
    const store = useSddDraftStore.getState()
    if (store.activeDraft?.id === draftId) {
      store.clearDraft()
    }
  } catch (error: any) {
    useSddDraftStore.getState().setError(error.message || 'Failed to delete draft')
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
export async function parseRequirementBlocks(): Promise<void> {
  const { content, activeDraft } = useSddDraftStore.getState()
  const draftId = activeDraft?.id
  try {
    const blocks = await window.electronAPI.sdd.parseBlocks(content)
    // Only apply if content and draft haven't changed during async operation
    const current = useSddDraftStore.getState()
    if (current.content === content && current.activeDraft?.id === draftId) {
      current.setRequirementBlocks(blocks)
    }
  } catch (error: any) {
    console.error('Failed to parse requirement blocks:', error)
  }
}

async function parseRequirementBlocksForDraft(
  draft: Pick<SddDraft, 'workspaceRoot' | 'id'>,
  content: string
): Promise<SddRequirementBlock[]> {
  const blocks = await window.electronAPI.sdd.parseBlocks(content)
  const current = useSddDraftStore.getState()
  if (
    current.activeDraft?.id === draft.id &&
    current.activeDraft.workspaceRoot === draft.workspaceRoot &&
    current.content === content
  ) {
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
  const targetDraft = draftInput ?? useSddDraftStore.getState().activeDraft
  if (!targetDraft) return null

  try {
    const trace = await window.electronAPI.sdd.computeTrace(
      targetDraft.workspaceRoot,
      targetDraft.id,
      planMarkdown
    )
    const activeDraft = useSddDraftStore.getState().activeDraft
    if (activeDraft?.id === targetDraft.id && activeDraft.workspaceRoot === targetDraft.workspaceRoot) {
      useSddDraftStore.getState().setTrace(trace)
    }
    if (trace) {
      await window.electronAPI.sdd.saveTrace(targetDraft.workspaceRoot, targetDraft.id, trace)
    }
    return trace
  } catch (error: any) {
    console.error('Failed to persist plan trace:', error)
    return null
  }
}

export async function refreshTraceRequirementBlocksAfterVerification(
  draft: Pick<SddDraft, 'workspaceRoot' | 'id'>,
  verifiedContent?: string,
  verifiedBlocks?: SddRequirementBlock[]
): Promise<SddTrace | null> {
  const store = useSddDraftStore.getState()
  const storeTrace = store.trace?.draftId === draft.id ? store.trace : null
  const trace = storeTrace ?? await window.electronAPI.sdd.getTrace?.(draft.workspaceRoot, draft.id)
  if (trace?.draftId !== draft.id) return null
  if (!trace) return null
  const activeDraft = useSddDraftStore.getState().activeDraft
  const isActiveDraft = activeDraft?.id === draft.id && activeDraft.workspaceRoot === draft.workspaceRoot
  const requirementBlocks = verifiedBlocks
    ? verifiedBlocks
    : verifiedContent
    ? await window.electronAPI.sdd.parseBlocks(verifiedContent)
    : isActiveDraft && store.requirementBlocks.length > 0
      ? store.requirementBlocks
      : isActiveDraft
        ? await window.electronAPI.sdd.parseBlocks(store.content)
        : trace.requirementBlocks
  const nextTrace: SddTrace = {
    ...trace,
    requirementBlocks,
    derivedStatuses: deriveTraceStatuses({ ...trace, requirementBlocks }, trace.planItems),
    timestamp: new Date().toISOString()
  }
  await window.electronAPI.sdd.saveTrace(draft.workspaceRoot, draft.id, nextTrace)
  const currentDraft = useSddDraftStore.getState().activeDraft
  if (currentDraft?.id === draft.id && currentDraft.workspaceRoot === draft.workspaceRoot) {
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

  recordAiHistory(draft, store.content, 'acceptance verification writeback')
  store.setContent(result.content)
  const saved = await saveDraftToDisk()
  if (!saved) throw new Error('Failed to save verification updates')
  const activeDraftAfterSave = useSddDraftStore.getState().activeDraft
  const contentAfterSave = useSddDraftStore.getState().content
  if (
    activeDraftAfterSave?.id !== draft.id ||
    activeDraftAfterSave.workspaceRoot !== draft.workspaceRoot ||
    contentAfterSave !== result.content
  ) {
    throw new Error('Requirement draft changed while saving verification updates. Re-open the verified draft and re-run verification.')
  }
  const verifiedBlocks = await parseRequirementBlocksForDraft(draft, result.content)
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
