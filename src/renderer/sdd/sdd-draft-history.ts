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

export interface DraftHistorySummary {
  version: number
  timestamp: string
  message: string
  author: DraftHistoryEntry['author']
  title: string
  truncated?: boolean
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
const diskHydrateInFlight = new Map<string, number>()
const latestHydrationSequence = new Map<string, number>()
const authoritativeHistoryKeys = new Set<string>()
const historyMutationQueues = new Map<string, Promise<void>>()
let hydrationSequence = 0

function isWindowsHistoryIdentity(normalizedRoot: string): boolean {
  const platform = window.electronAPI?.platform
  if (platform) return platform === 'win32'
  return /^[a-zA-Z]:\//.test(normalizedRoot) || normalizedRoot.startsWith('//')
}

function normalizeHistoryRoot(workspaceRoot?: string): string {
  const normalized = (workspaceRoot || '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
  return isWindowsHistoryIdentity(normalized) ? normalized.toLowerCase() : normalized
}

function historyKey(draftId: string, workspaceRoot?: string): string {
  const normalizedRoot = normalizeHistoryRoot(workspaceRoot)
  const normalizedDraftId = isWindowsHistoryIdentity(normalizedRoot) ? draftId.toLowerCase() : draftId
  if (!normalizedRoot) return `${STORAGE_KEY_PREFIX}${normalizedDraftId}`
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(normalizedRoot)}::${normalizedDraftId}`
}

function advanceHydrationSequence(key: string): number {
  const sequence = ++hydrationSequence
  latestHydrationSequence.set(key, sequence)
  return sequence
}

function isLatestHydration(key: string, sequence: number): boolean {
  return latestHydrationSequence.get(key) === sequence
}

function cloneHistory(history: DraftHistoryEntry[]): DraftHistoryEntry[] {
  return history.map(entry => ({ ...entry }))
}

function currentHistorySnapshot(key: string): DraftHistoryEntry[] {
  const cached = historyCache.get(key)
  return cached ? cloneHistory(cached) : []
}

function enqueueHistoryMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = historyMutationQueues.get(key) ?? Promise.resolve()
  const result = previous.then(mutation)
  const tail = result.then(() => undefined, () => undefined)
  historyMutationQueues.set(key, tail)
  void tail.then(() => {
    if (historyMutationQueues.get(key) === tail) historyMutationQueues.delete(key)
  })
  return result
}

function normalizeHistoryEntries(entries: DraftHistoryEntry[]): DraftHistoryEntry[] {
  return entries
    .filter(entry => entry && typeof entry.version === 'number' && typeof entry.content === 'string')
    .slice(-MAX_HISTORY_VERSIONS)
    .map(entry => ({
      version: entry.version,
      timestamp: entry.timestamp,
      content: entry.content,
      title: entry.title,
      message: entry.message,
      author: entry.author,
      truncated: !!entry.truncated
    }))
}

async function getAuthoritativeHistory(draftId: string, workspaceRoot: string | undefined, key: string): Promise<DraftHistoryEntry[]> {
  if (authoritativeHistoryKeys.has(key)) return currentHistorySnapshot(key)
  if (!workspaceRoot) return currentHistorySnapshot(key)
  const sddApi = window.electronAPI?.sdd as Partial<typeof window.electronAPI.sdd> | undefined
  if (!sddApi?.getHistory) {
    if (sddApi?.saveHistory) {
      throw new Error('Cannot save history without an authoritative history baseline')
    }
    return currentHistorySnapshot(key)
  }

  while (true) {
    const sequence = advanceHydrationSequence(key)
    const entries = await sddApi.getHistory(workspaceRoot, draftId)
    if (isLatestHydration(key, sequence)) return normalizeHistoryEntries(entries)
    if (authoritativeHistoryKeys.has(key)) return currentHistorySnapshot(key)
  }
}

function setCachedHistory(draftId: string, workspaceRoot: string | undefined, entries: DraftHistoryEntry[]): DraftHistoryEntry[] {
  const key = historyKey(draftId, workspaceRoot)
  const normalized = normalizeHistoryEntries(entries)
  historyCache.set(key, normalized)
  authoritativeHistoryKeys.add(key)
  saveToLocalStorage(key, normalized)
  return normalized
}

async function saveToDisk(workspaceRoot: string | undefined, draftId: string, history: DraftHistoryEntry[]): Promise<void> {
  if (!workspaceRoot || !window.electronAPI?.sdd?.saveHistory) return
  await window.electronAPI.sdd.saveHistory(workspaceRoot, draftId, normalizeHistoryEntries(history))
}

function hydrateFromDiskIfNeeded(draftId: string, workspaceRoot?: string): void {
  if (!workspaceRoot || !window.electronAPI?.sdd?.getHistory) return
  const key = historyKey(draftId, workspaceRoot)
  const inFlightSequence = diskHydrateInFlight.get(key)
  if (inFlightSequence !== undefined && isLatestHydration(key, inFlightSequence)) return
  const sequence = advanceHydrationSequence(key)
  diskHydrateInFlight.set(key, sequence)
  let request: Promise<DraftHistoryEntry[]>
  try {
    request = window.electronAPI.sdd.getHistory(workspaceRoot, draftId)
  } catch {
    if (diskHydrateInFlight.get(key) === sequence) diskHydrateInFlight.delete(key)
    return
  }
  request
    .then(entries => {
      if (isLatestHydration(key, sequence) && Array.isArray(entries)) {
        setCachedHistory(draftId, workspaceRoot, entries)
      }
    })
    .catch(() => {})
    .finally(() => {
      if (diskHydrateInFlight.get(key) === sequence) diskHydrateInFlight.delete(key)
    })
}

export async function hydrateDraftHistoryFromDisk(draftId: string, workspaceRoot?: string): Promise<DraftHistoryEntry[]> {
  if (!workspaceRoot || !window.electronAPI?.sdd?.getHistory) return getDraftHistory(draftId, workspaceRoot)
  const key = historyKey(draftId, workspaceRoot)
  const sequence = advanceHydrationSequence(key)
  const entries = await window.electronAPI.sdd.getHistory(workspaceRoot, draftId)
  if (!isLatestHydration(key, sequence)) return currentHistorySnapshot(key)
  return cloneHistory(setCachedHistory(draftId, workspaceRoot, entries))
}

// ============================================================
// 历史记录管理
// ============================================================

/**
 * 获取草稿的历史记录
 */
export function getDraftHistory(draftId: string, workspaceRoot?: string): DraftHistoryEntry[] {
  const key = historyKey(draftId, workspaceRoot)
  const cached = historyCache.get(key)
  if (cached) return cloneHistory(cached)
  hydrateFromDiskIfNeeded(draftId, workspaceRoot)

  // 尝试从 localStorage 获取
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const entries = JSON.parse(raw) as DraftHistoryEntry[]
      historyCache.set(key, entries)
      hydrateFromDiskIfNeeded(draftId, workspaceRoot)
      return cloneHistory(entries)
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
  author: 'user' | 'system' | 'ai' = 'system',
  workspaceRoot?: string
): Promise<DraftHistoryEntry> {
  const key = historyKey(draftId, workspaceRoot)
  return enqueueHistoryMutation(key, async () => {
    const history = await getAuthoritativeHistory(draftId, workspaceRoot, key)
    const version = history.reduce((max, existing) => Math.max(max, existing.version), 0) + 1
    const entry: DraftHistoryEntry = {
      version,
      timestamp: new Date().toISOString(),
      content,
      title,
      message,
      author
    }
    const nextHistory = normalizeHistoryEntries([...history, entry])

    await saveToDisk(workspaceRoot, draftId, nextHistory)
    advanceHydrationSequence(key)
    setCachedHistory(draftId, workspaceRoot, nextHistory)
    return entry
  })
}

/**
 * 获取特定版本的历史记录
 */
export function getHistoryEntry(draftId: string, version: number, workspaceRoot?: string): DraftHistoryEntry | undefined {
  const history = getDraftHistory(draftId, workspaceRoot)
  return history.find(e => e.version === version)
}

/**
 * 恢复到指定版本
 */
export async function restoreFromHistory(draftId: string, version: number, workspaceRoot?: string): Promise<boolean> {
  const entry = getHistoryEntry(draftId, version, workspaceRoot)
  if (!entry) return false

  const store = useSddDraftStore.getState()
  const draft = store.activeDraft
  if (!draft || draft.id !== draftId) return false
  if (workspaceRoot && draft.workspaceRoot !== workspaceRoot) return false
  const source = {
    draftId: draft.id,
    workspaceRoot: draft.workspaceRoot,
    draftSession: store.draftSession,
    editRevision: store.editRevision,
    content: store.content
  }

  // 检查内容是否被截断
  if (entry.truncated) {
    console.warn(`[SDD] History entry v${version} content was truncated, restore may be incomplete`)
  }

  // 保存当前版本到历史（恢复前快照）
  await addHistoryEntry(draftId, source.content, draft.title, `恢复前快照 (v${version})`, 'system', source.workspaceRoot)

  const current = useSddDraftStore.getState()
  if (
    current.activeDraft?.id !== source.draftId ||
    current.activeDraft.workspaceRoot !== source.workspaceRoot ||
    current.draftSession !== source.draftSession ||
    current.editRevision !== source.editRevision ||
    current.content !== source.content
  ) return false

  // 恢复内容
  current.setContent(entry.content)

  return true
}

/**
 * 比较两个版本的差异
 */
export function diffHistoryVersions(
  draftId: string,
  versionA: number,
  versionB: number,
  workspaceRoot?: string
): { added: string[]; removed: string[]; changed: boolean } {
  const entryA = getHistoryEntry(draftId, versionA, workspaceRoot)
  const entryB = getHistoryEntry(draftId, versionB, workspaceRoot)

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
export function clearDraftHistory(draftId: string, workspaceRoot?: string): Promise<void> {
  const key = historyKey(draftId, workspaceRoot)
  return enqueueHistoryMutation(key, async () => {
    if (workspaceRoot && window.electronAPI?.sdd?.clearHistory) {
      await window.electronAPI.sdd.clearHistory(workspaceRoot, draftId)
    }
    advanceHydrationSequence(key)
    historyCache.set(key, [])
    authoritativeHistoryKeys.add(key)
    try {
      localStorage.removeItem(key)
    } catch { /* localStorage 清除失败，忽略 */ }
  })
}

/**
 * 获取历史摘要
 */
export function getHistorySummary(draftId: string, workspaceRoot?: string): DraftHistorySummary[] {
  return getDraftHistory(draftId, workspaceRoot).map(e => ({
    version: e.version,
    timestamp: e.timestamp,
    message: e.message,
    author: e.author,
    title: e.title,
    truncated: e.truncated
  }))
}

// ============================================================
// 辅助函数
// ============================================================

function saveToLocalStorage(key: string, history: DraftHistoryEntry[]): void {
  try {
    const entries = history.slice(-MAX_HISTORY_VERSIONS).map(e => ({
      version: e.version,
      timestamp: e.timestamp,
      content: e.content,
      truncated: false,
      title: e.title,
      message: e.message,
      author: e.author
    }))
    localStorage.setItem(key, JSON.stringify(entries))
  } catch { /* localStorage 保存失败（可能超出容量），忽略 */ }
}

/**
 * 在保存草稿时自动记录历史
 */
export async function recordSaveHistory(draft: SddDraft, content: string): Promise<void> {
  await addHistoryEntry(draft.id, content, draft.title, '手动保存', 'user', draft.workspaceRoot)
}

/**
 * 在 AI 修改后记录历史
 */
export async function recordAiHistory(draft: SddDraft, content: string, message: string): Promise<void> {
  await addHistoryEntry(draft.id, content, draft.title, `AI: ${message}`, 'ai', draft.workspaceRoot)
}
