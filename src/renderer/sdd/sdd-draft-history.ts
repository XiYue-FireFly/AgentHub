/**
 * SDD Draft History - 草稿历史管理
 *
 * 参照 kun 的 sdd-draft-history.ts 设计
 * 提供草稿版本控制、历史回退和差异比较功能
 */

import { useSddDraftStore, type SddDraft } from './sdd-draft-store'

// ============================================================
// 类型定义
// ============================================================

export interface DraftHistoryEntry {
  version: number
  timestamp: string
  content: string
  title: string
  message: string
  author: 'user' | 'system' | 'ai'
  truncated?: boolean
}

export interface DraftHistoryState {
  entries: DraftHistoryEntry[]
  maxVersions: number
}

// ============================================================
// 常量
// ============================================================

const MAX_HISTORY_VERSIONS = 20
const STORAGE_KEY_PREFIX = 'sdd-history-'

// ============================================================
// 内存缓存（补充磁盘存储）
// ============================================================

const historyCache = new Map<string, DraftHistoryEntry[]>()

// ============================================================
// 历史记录管理
// ============================================================

/**
 * 获取草稿的历史记录
 */
export function getDraftHistory(draftId: string): DraftHistoryEntry[] {
  // 先从内存缓存获取
  const cached = historyCache.get(draftId)
  if (cached) return cached

  // 尝试从 localStorage 获取
  try {
    const key = `${STORAGE_KEY_PREFIX}${draftId}`
    const raw = localStorage.getItem(key)
    if (raw) {
      const entries = JSON.parse(raw) as DraftHistoryEntry[]
      historyCache.set(draftId, entries)
      return entries
    }
  } catch { /* localStorage 读取失败，忽略 */ }

  return []
}

/**
 * 添加历史记录
 */
export function addHistoryEntry(
  draftId: string,
  content: string,
  title: string,
  message: string = '自动保存',
  author: 'user' | 'system' | 'ai' = 'system'
): DraftHistoryEntry {
  const history = getDraftHistory(draftId)
  const version = history.length > 0 ? history[history.length - 1].version + 1 : 1

  const entry: DraftHistoryEntry = {
    version,
    timestamp: new Date().toISOString(),
    content,
    title,
    message,
    author
  }

  // 添加新条目
  history.push(entry)

  // 限制历史记录数量
  while (history.length > MAX_HISTORY_VERSIONS) {
    history.shift()
  }

  // 保存到缓存和 localStorage
  historyCache.set(draftId, history)
  saveToLocalStorage(draftId, history)

  return entry
}

/**
 * 获取特定版本的历史记录
 */
export function getHistoryEntry(draftId: string, version: number): DraftHistoryEntry | undefined {
  const history = getDraftHistory(draftId)
  return history.find(e => e.version === version)
}

/**
 * 恢复到指定版本
 */
export function restoreFromHistory(draftId: string, version: number): boolean {
  const entry = getHistoryEntry(draftId, version)
  if (!entry) return false

  const store = useSddDraftStore.getState()
  const draft = store.activeDraft
  if (!draft || draft.id !== draftId) return false

  // 检查内容是否被截断
  if (entry.truncated) {
    console.warn(`[SDD] History entry v${version} content was truncated, restore may be incomplete`)
  }

  // 保存当前版本到历史（恢复前快照）
  addHistoryEntry(draftId, store.content, draft.title, `恢复前快照 (v${version})`, 'system')

  // 恢复内容
  store.setContent(entry.content)
  store.markSaved()

  return true
}

/**
 * 比较两个版本的差异
 */
export function diffHistoryVersions(
  draftId: string,
  versionA: number,
  versionB: number
): { added: string[]; removed: string[]; changed: boolean } {
  const entryA = getHistoryEntry(draftId, versionA)
  const entryB = getHistoryEntry(draftId, versionB)

  if (!entryA || !entryB) {
    return { added: [], removed: [], changed: false }
  }

  const linesA = entryA.content.split('\n')
  const linesB = entryB.content.split('\n')
  const setA = new Set(linesA)
  const setB = new Set(linesB)

  const added = linesB.filter(l => !setA.has(l) && l.trim() !== '')
  const removed = linesA.filter(l => !setB.has(l) && l.trim() !== '')

  return {
    added,
    removed,
    changed: added.length > 0 || removed.length > 0
  }
}

/**
 * 清除草稿的历史记录
 */
export function clearDraftHistory(draftId: string): void {
  historyCache.delete(draftId)
  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${draftId}`)
  } catch { /* localStorage 清除失败，忽略 */ }
}

/**
 * 获取历史摘要
 */
export function getHistorySummary(draftId: string): Array<{ version: number; timestamp: string; message: string; author: string }> {
  return getDraftHistory(draftId).map(e => ({
    version: e.version,
    timestamp: e.timestamp,
    message: e.message,
    author: e.author
  }))
}

// ============================================================
// 辅助函数
// ============================================================

function saveToLocalStorage(draftId: string, history: DraftHistoryEntry[]): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}${draftId}`
    // 只保存摘要信息以节省空间（最近 10 条）
    const summary = history.slice(-10).map(e => ({
      version: e.version,
      timestamp: e.timestamp,
      content: e.content.slice(0, 5000), // 限制内容长度
      truncated: e.content.length > 5000, // 标记是否被截断
      title: e.title,
      message: e.message,
      author: e.author
    }))
    localStorage.setItem(key, JSON.stringify(summary))
  } catch { /* localStorage 保存失败（可能超出容量），忽略 */ }
}

/**
 * 在保存草稿时自动记录历史
 */
export function recordSaveHistory(draft: SddDraft, content: string): void {
  addHistoryEntry(draft.id, content, draft.title, '手动保存', 'user')
}

/**
 * 在 AI 修改后记录历史
 */
export function recordAiHistory(draft: SddDraft, content: string, message: string): void {
  addHistoryEntry(draft.id, content, draft.title, `AI: ${message}`, 'ai')
}
