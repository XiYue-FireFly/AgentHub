/**
 * SDD Draft Actions - 需求草稿操作
 *
 * 处理需求的创建、保存、加载等操作
 */

import { useSddDraftStore, type SddDraft, type SddDesignContext } from './sdd-draft-store'

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

  if (!store.activeDraft) return true
  if (store.saveStatus === 'saved' && store.content === store.lastSavedContent) return true

  store.setSaveStatus('saving')

  try {
    // 保存需求内容
    await window.electronAPI.sdd.updateDraft(
      store.activeDraft.workspaceRoot,
      store.activeDraft.id,
      store.content
    )
    // 同时保存设计上下文（防止仅在内存中更新而未持久化）
    if (store.activeDraft.designContext) {
      await window.electronAPI.sdd.updateDesignContext(
        store.activeDraft.workspaceRoot,
        store.activeDraft.id,
        store.activeDraft.designContext
      )
    }
    store.markSaved()
    return true
  } catch (error: any) {
    store.setSaveStatus('error')
    store.setError(error.message || 'Failed to save draft')
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
  const { content } = useSddDraftStore.getState()
  try {
    const blocks = await window.electronAPI.sdd.parseBlocks(content)
    useSddDraftStore.getState().setRequirementBlocks(blocks)
  } catch (error: any) {
    console.error('Failed to parse requirement blocks:', error)
  }
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
