/**
 * SDD IPC Handlers
 *
 * 需求驱动开发系统的 IPC 接口
 */

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSddStore } from '../sdd/sdd-store'
import { parseRequirementBlocks, parsePlanCovers, computeTrace } from '../sdd/sdd-trace'
import type { SddCreateOptions, SddUpdateOptions } from '../sdd/sdd-types'
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
import { typedHandle } from './typed-ipc'

const draftOperationQueues = new Map<string, Promise<unknown>>()
const verifiedDraftQueueRoots = new Map<string, string>()

function normalizeQueuePath(pathText: string): string {
  return process.platform === 'win32' ? pathText.toLowerCase() : pathText
}

function canonicalDraftQueueRoot(workspaceRoot: string): string {
  const lexicalRoot = normalizeQueuePath(resolve(workspaceRoot))
  try {
    const physicalRoot = normalizeQueuePath(realpathSync(workspaceRoot))
    verifiedDraftQueueRoots.set(lexicalRoot, physicalRoot)
    return physicalRoot
  } catch {
    return verifiedDraftQueueRoots.get(lexicalRoot) ?? lexicalRoot
  }
}

function draftOperationQueueKey(workspaceRoot: string, draftId: string): string {
  const canonicalDraftId = process.platform === 'win32' ? draftId.toLowerCase() : draftId
  return `${canonicalDraftQueueRoot(workspaceRoot)}\0${canonicalDraftId}`
}

function enqueueDraftOperation<T>(
  workspaceRoot: string,
  draftId: string,
  update: () => Promise<T>
): Promise<T> {
  const key = draftOperationQueueKey(workspaceRoot, draftId)
  const previous = draftOperationQueues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(update)
  draftOperationQueues.set(key, current)
  return current.finally(() => {
    if (draftOperationQueues.get(key) === current) {
      draftOperationQueues.delete(key)
    }
  })
}

function enqueueExistingDraftMutation<T>(
  workspaceRoot: string,
  draftId: string,
  mutation: (store: ReturnType<typeof createSddStore>) => Promise<T>
): Promise<T | undefined> {
  return enqueueDraftOperation(workspaceRoot, draftId, async () => {
    const store = createSddStore(workspaceRoot)
    if (!await store.exists(draftId)) return undefined
    return mutation(store)
  })
}

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
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      return store.getDraft(draftId)
    })
  })

  // 更新需求内容
  typedHandle("sdd:updateDraft", async (_event, workspaceRoot, draftId, content, designContext) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      const options: SddUpdateOptions = { content, designContext }
      return store.updateDraft(draftId, options)
    })
  })

  // 更新设计上下文
  typedHandle("sdd:updateDesignContext", async (_event, workspaceRoot, draftId, designContext) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      const options: SddUpdateOptions = { designContext }
      return store.updateDraft(draftId, options)
    })
  })

  // 删除需求草稿
  typedHandle("sdd:deleteDraft", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      return store.deleteDraft(draftId)
    })
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
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      const draft = await store.getDraft(draftId)
      if (!draft) return null

      return computeTrace({
        draftId,
        requirementMarkdown: draft.content,
        planMarkdown: planMarkdown || null
      })
    })
  })

  // 保存追踪快照
  typedHandle("sdd:saveTrace", async (_event, workspaceRoot, draftId, trace) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    return enqueueExistingDraftMutation(registeredRoot, draftId, store => store.saveTrace(draftId, trace))
  })

  // 获取追踪快照
  typedHandle("sdd:getTrace", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return null
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      return store.getTrace(draftId)
    })
  })

  typedHandle("sdd:getHistory", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return []
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      return store.getHistory(draftId)
    })
  })

  typedHandle("sdd:saveHistory", async (_event, workspaceRoot, draftId, entries) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    return enqueueExistingDraftMutation(registeredRoot, draftId, store => store.saveHistory(draftId, entries))
  })

  typedHandle("sdd:clearHistory", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return
    return enqueueExistingDraftMutation(registeredRoot, draftId, store => store.clearHistory(draftId))
  })

  // 检查需求是否存在
  typedHandle("sdd:exists", async (_event, workspaceRoot, draftId) => {
    const registeredRoot = resolveSddRoot(workspaceRoot, draftId)
    if (!registeredRoot) return false
    return enqueueDraftOperation(registeredRoot, draftId, async () => {
      const store = createSddStore(registeredRoot)
      return store.exists(draftId)
    })
  })
}
