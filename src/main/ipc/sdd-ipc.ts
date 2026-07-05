/**
 * SDD IPC Handlers
 *
 * 需求驱动开发系统的 IPC 接口
 */

import { createSddStore } from '../sdd/sdd-store'
import { parseRequirementBlocks, parsePlanCovers, computeTrace } from '../sdd/sdd-trace'
import type { SddCreateOptions, SddUpdateOptions } from '../sdd/sdd-types'
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
import { typedHandle } from './typed-ipc'

/** 验证 workspaceRoot 是合法路径且 draftId 不包含路径遍历字符 */
function resolveSddRoot(workspaceRoot: string, draftId?: string): string | null {
  const registeredRoot = resolveRegisteredWorkspaceRoot(workspaceRoot)
  if (!registeredRoot) return null
  // draftId 必须是简单的标识符（UUID 格式），不允许路径分隔符或 ..
  if (draftId !== undefined) {
    if (!draftId || typeof draftId !== 'string') return null
    // 禁止路径遍历字符
    if (draftId.includes('..') || draftId.includes('/') || draftId.includes('\\')) return null
    // 验证为类似 UUID 的格式（字母数字+连字符）
    if (!/^[a-zA-Z0-9-]+$/.test(draftId)) return null
  }
  return registeredRoot
}

export function registerSddIpc(): void {
  // 创建需求草稿
  typedHandle("sdd:createDraft", async (_event, workspaceRoot, title, template) => {
    const registeredRoot = resolveSddRoot(workspaceRoot)
    if (!registeredRoot) return null
    const store = createSddStore(registeredRoot)
    const options: SddCreateOptions = {
      workspaceRoot: registeredRoot,
      title,
      template: template as 'blank' | 'standard' | 'minimal' | undefined
    }
    return store.createDraft(options)
  })

  // 获取需求草稿
  typedHandle("sdd:getDraft", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return null
    const store = createSddStore(registeredRoot)
    return store.getDraft(draftId)
  })

  // 更新需求内容
  typedHandle("sdd:updateDraft", async (_event, workspaceRoot, draftId, content) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    const store = createSddStore(registeredRoot)
    const options: SddUpdateOptions = { content }
    return store.updateDraft(draftId, options)
  })

  // 更新设计上下文
  typedHandle("sdd:updateDesignContext", async (_event, workspaceRoot, draftId, designContext) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    const store = createSddStore(registeredRoot)
    const options: SddUpdateOptions = { designContext }
    return store.updateDraft(draftId, options)
  })

  // 删除需求草稿
  typedHandle("sdd:deleteDraft", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    const store = createSddStore(registeredRoot)
    return store.deleteDraft(draftId)
  })

  // 列出所有需求
  typedHandle("sdd:listDrafts", async (_event, workspaceRoot) => {
    const registeredRoot = resolveSddRoot(workspaceRoot)
    if (!registeredRoot) return []
    const store = createSddStore(registeredRoot)
    return store.listDrafts()
  })

  // 解析需求块
  typedHandle("sdd:parseBlocks", async (_event, content) => {
    return parseRequirementBlocks(content)
  })

  // 解析计划 covers
  typedHandle("sdd:parsePlanCovers", async (_event, planMarkdown) => {
    return parsePlanCovers(planMarkdown)
  })

  // 计算追踪
  typedHandle("sdd:computeTrace", async (_event, workspaceRoot, draftId, planMarkdown) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return null
    const store = createSddStore(registeredRoot)
    const draft = await store.getDraft(draftId)
    if (!draft) return null

    return computeTrace({
      draftId,
      requirementMarkdown: draft.content,
      planMarkdown: planMarkdown || null
    })
  })

  // 保存追踪快照
  typedHandle("sdd:saveTrace", async (_event, workspaceRoot, draftId, trace) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    const store = createSddStore(registeredRoot)
    return store.saveTrace(draftId, trace)
  })

  // 获取追踪快照
  typedHandle("sdd:getTrace", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return null
    const store = createSddStore(registeredRoot)
    return store.getTrace(draftId)
  })

  typedHandle("sdd:getHistory", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return []
    const store = createSddStore(registeredRoot)
    return store.getHistory(draftId)
  })

  typedHandle("sdd:saveHistory", async (_event, workspaceRoot, draftId, entries) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    const store = createSddStore(registeredRoot)
    return store.saveHistory(draftId, entries)
  })

  typedHandle("sdd:clearHistory", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    const store = createSddStore(registeredRoot)
    return store.clearHistory(draftId)
  })

  // 检查需求是否存在
  typedHandle("sdd:exists", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return false
    const store = createSddStore(registeredRoot)
    return store.exists(draftId)
  })
}
