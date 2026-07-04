/**
 * SDD IPC Handlers
 *
 * 需求驱动开发系统的 IPC 接口
 */

import { ipcMain } from 'electron'
import { isAbsolute, resolve } from 'node:path'
import { createSddStore } from '../sdd/sdd-store'
import { parseRequirementBlocks, parsePlanCovers, computeTrace } from '../sdd/sdd-trace'
import type { SddCreateOptions, SddUpdateOptions } from '../sdd/sdd-types'
import { getWorkspaceManager } from '../hub/workspace'

/** 验证 workspaceRoot 是合法路径且 draftId 不包含路径遍历字符 */
function validateSddPaths(workspaceRoot: string, draftId?: string): boolean {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') return false
  if (!isAbsolute(workspaceRoot)) return false
  const resolvedRoot = resolve(workspaceRoot)
  const registered = getWorkspaceManager().list().some(workspace => resolve(workspace.rootPath) === resolvedRoot)
  if (!registered) return false
  // draftId 必须是简单的标识符（UUID 格式），不允许路径分隔符或 ..
  if (draftId !== undefined) {
    if (!draftId || typeof draftId !== 'string') return false
    // 禁止路径遍历字符
    if (draftId.includes('..') || draftId.includes('/') || draftId.includes('\\')) return false
    // 验证为类似 UUID 的格式（字母数字+连字符）
    if (!/^[a-zA-Z0-9-]+$/.test(draftId)) return false
  }
  return true
}

export function registerSddIpc(): void {
  // 创建需求草稿
  ipcMain.handle("sdd:createDraft", async (_event, workspaceRoot: string, title: string, template?: string) => {
    if (!validateSddPaths(workspaceRoot)) return null
    const store = createSddStore(workspaceRoot)
    const options: SddCreateOptions = {
      workspaceRoot,
      title,
      template: template as 'blank' | 'standard' | 'minimal' | undefined
    }
    return store.createDraft(options)
  })

  // 获取需求草稿
  ipcMain.handle("sdd:getDraft", async (_event, workspaceRoot: string, draftId: string) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return null
    const store = createSddStore(workspaceRoot)
    return store.getDraft(draftId)
  })

  // 更新需求内容
  ipcMain.handle("sdd:updateDraft", async (_event, workspaceRoot: string, draftId: string, content: string) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return
    const store = createSddStore(workspaceRoot)
    const options: SddUpdateOptions = { content }
    return store.updateDraft(draftId, options)
  })

  // 更新设计上下文
  ipcMain.handle("sdd:updateDesignContext", async (_event, workspaceRoot: string, draftId: string, designContext: any) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return
    const store = createSddStore(workspaceRoot)
    const options: SddUpdateOptions = { designContext }
    return store.updateDraft(draftId, options)
  })

  // 删除需求草稿
  ipcMain.handle("sdd:deleteDraft", async (_event, workspaceRoot: string, draftId: string) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return
    const store = createSddStore(workspaceRoot)
    return store.deleteDraft(draftId)
  })

  // 列出所有需求
  ipcMain.handle("sdd:listDrafts", async (_event, workspaceRoot: string) => {
    if (!validateSddPaths(workspaceRoot)) return []
    const store = createSddStore(workspaceRoot)
    return store.listDrafts()
  })

  // 解析需求块
  ipcMain.handle("sdd:parseBlocks", async (_event, content: string) => {
    return parseRequirementBlocks(content)
  })

  // 解析计划 covers
  ipcMain.handle("sdd:parsePlanCovers", async (_event, planMarkdown: string) => {
    return parsePlanCovers(planMarkdown)
  })

  // 计算追踪
  ipcMain.handle("sdd:computeTrace", async (_event, workspaceRoot: string, draftId: string, planMarkdown?: string) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return null
    const store = createSddStore(workspaceRoot)
    const draft = await store.getDraft(draftId)
    if (!draft) return null

    return computeTrace({
      draftId,
      requirementMarkdown: draft.content,
      planMarkdown: planMarkdown || null
    })
  })

  // 保存追踪快照
  ipcMain.handle("sdd:saveTrace", async (_event, workspaceRoot: string, draftId: string, trace: any) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return
    const store = createSddStore(workspaceRoot)
    return store.saveTrace(draftId, trace)
  })

  // 获取追踪快照
  ipcMain.handle("sdd:getTrace", async (_event, workspaceRoot: string, draftId: string) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return null
    const store = createSddStore(workspaceRoot)
    return store.getTrace(draftId)
  })

  // 检查需求是否存在
  ipcMain.handle("sdd:exists", async (_event, workspaceRoot: string, draftId: string) => {
    if (!validateSddPaths(workspaceRoot, draftId)) return false
    const store = createSddStore(workspaceRoot)
    return store.exists(draftId)
  })
}
