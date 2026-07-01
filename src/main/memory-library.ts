import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, normalize } from 'node:path'

export type MemoryCategory =
  | 'conversation'
  | 'task'
  | 'skill'
  | 'file'
  | 'system'
  | 'preference'
  | 'project'
  | 'style'
  | 'decision'
  | 'correction'
  | 'imported_conversation'

export type MemoryEntryStatus = 'candidate' | 'approved' | 'disabled'

export interface MemoryEntryInput {
  id?: string
  category: MemoryCategory
  title: string
  summary?: string
  content?: string
  source?: string
  tags?: string[]
  status?: MemoryEntryStatus
  confidence?: number
  metadata?: Record<string, any>
}

export interface MemorySelectionOptions {
  limit?: number
  tokenBudget?: number
}

export interface MemoryEntry extends MemoryEntryInput {
  id: string
  category: MemoryCategory
  summary: string
  tags: string[]
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface RuntimeMemoryState {
  messages: any[]
  tasks: any[]
}

export interface MemorySettingsState {
  enabled: boolean
}

export interface MemoryCatalog {
  version: 1
  root: string
  entries: MemoryEntry[]
  counts: Record<MemoryCategory, number>
  settings: MemorySettingsState
  runtimeUpdatedAt?: string
}

interface MemoryIndex {
  version: 1
  entries: MemoryEntry[]
  settings?: MemorySettingsState
  runtimeUpdatedAt?: string
}

const CATEGORIES: MemoryCategory[] = [
  'conversation',
  'task',
  'skill',
  'file',
  'system',
  'preference',
  'project',
  'style',
  'decision',
  'correction',
  'imported_conversation'
]
const DEFAULT_INDEX: MemoryIndex = { version: 1, entries: [], settings: { enabled: true } }

export class MemoryLibrary {
  readonly root: string
  private readonly indexPath: string
  private readonly historyDir: string
  private readonly latestPath: string

  constructor(root: string) {
    this.root = basename(normalize(root)) === 'memory' ? root : join(root, 'memory')
    this.indexPath = join(this.root, 'index.json')
    this.historyDir = join(this.root, 'history')
    this.latestPath = join(this.historyDir, 'session-latest.json')
    this.ensureDirs()
  }

  getCatalog(): MemoryCatalog {
    const index = this.readIndex()
    return {
      version: 1,
      root: this.root,
      entries: index.entries.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      counts: countEntries(index.entries),
      settings: normalizeMemorySettings(index.settings),
      runtimeUpdatedAt: index.runtimeUpdatedAt
    }
  }

  getSettings(): MemorySettingsState {
    return normalizeMemorySettings(this.readIndex().settings)
  }

  updateSettings(patch: Partial<MemorySettingsState>): MemorySettingsState {
    const index = this.readIndex()
    index.settings = normalizeMemorySettings({ ...normalizeMemorySettings(index.settings), ...patch })
    this.writeIndex(index)
    return index.settings
  }

  listEntries(category?: MemoryCategory): MemoryEntry[] {
    if (!this.getSettings().enabled) return []
    const entries = this.getCatalog().entries.filter(entry => (entry.status || 'approved') === 'approved' && !entry.deletedAt)
    return category ? entries.filter(entry => entry.category === category) : entries
  }

  searchEntries(query: string, category?: MemoryCategory): MemoryEntry[] {
    const entries = this.listEntries(category)
    const terms = tokenizeMemoryQuery(query)
    if (!terms.length) return entries
      .map((entry, index) => ({ entry, index, score: scoreMemoryEntry(entry, []) }))
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt) || a.index - b.index)
      .map(item => item.entry)
    return entries
      .map((entry, index) => ({ entry, index, score: scoreMemoryEntry(entry, terms) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt) || a.index - b.index)
      .map(item => item.entry)
  }

  selectContextEntries(query: string, limitOrOptions: number | MemorySelectionOptions = 8): MemoryEntry[] {
    if (!this.getSettings().enabled) return []
    const options = typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions
    const safeLimit = Math.max(0, Math.floor(Number(options?.limit) || 0))
    const tokenBudget = Math.max(0, Math.floor(Number(options?.tokenBudget) || 0))
    if (safeLimit <= 0) return []
    const entries = this.listEntries()
    const pinned = entries
      .filter(entry => entry.metadata?.pinned || entry.metadata?.pin)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const selected = new Map<string, MemoryEntry>()
    let usedTokens = 0
    const addEntry = (entry: MemoryEntry, force = false): boolean => {
      if (selected.has(entry.id)) return false
      if (selected.size >= safeLimit) return false
      const estimate = estimateMemoryTokens(entry)
      if (tokenBudget > 0 && !force && usedTokens + estimate > tokenBudget) return false
      selected.set(entry.id, {
        ...entry,
        metadata: {
          ...(entry.metadata || {}),
          estimateTokens: estimate
        }
      })
      usedTokens += estimate
      return true
    }

    for (const entry of pinned.slice(0, safeLimit)) addEntry(entry, true)
    for (const entry of this.searchEntries(query)) {
      if (selected.size >= safeLimit) break
      addEntry(entry)
    }
    if (selected.size < safeLimit) {
      for (const entry of this.searchEntries('')) {
        if (selected.size >= safeLimit) break
        addEntry(entry)
      }
    }
    return [...selected.values()].slice(0, safeLimit)
  }

  upsertEntry(input: MemoryEntryInput): MemoryEntry {
    const index = this.readIndex()
    const now = new Date().toISOString()
    const id = input.id || makeEntryId(input.category, input.source || input.title)
    const existing = index.entries.find(entry => entry.id === id)
    const entry: MemoryEntry = {
      id,
      category: input.category,
      title: cleanTitle(input.title),
      summary: input.summary || '',
      content: input.content,
      source: input.source,
      tags: input.tags || [],
      status: input.status || existing?.status || 'approved',
      confidence: typeof input.confidence === 'number' ? clampConfidence(input.confidence) : existing?.confidence,
      metadata: { ...(existing?.metadata || {}), ...(input.metadata || {}) },
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    index.entries = [entry, ...index.entries.filter(item => item.id !== id)]
    this.writeIndex(index)
    return entry
  }

  deleteEntry(id: string): boolean {
    const index = this.readIndex()
    const existing = index.entries.find(entry => entry.id === id)
    if (!existing) return false
    existing.deletedAt = new Date().toISOString()
    this.writeIndex(index)
    return true
  }

  restoreEntry(id: string): MemoryEntry | null {
    const index = this.readIndex()
    const existing = index.entries.find(entry => entry.id === id)
    if (!existing) return null
    existing.deletedAt = undefined
    existing.updatedAt = new Date().toISOString()
    this.writeIndex(index)
    return existing
  }

  listCandidates(): MemoryEntry[] {
    return this.getCatalog().entries.filter(entry => entry.status === 'candidate' && !entry.deletedAt)
  }

  approveCandidate(id: string): MemoryEntry | null {
    return this.updateEntry(id, { status: 'approved' })
  }

  updateEntry(id: string, patch: Partial<MemoryEntryInput>): MemoryEntry | null {
    const index = this.readIndex()
    const existing = index.entries.find(entry => entry.id === id)
    if (!existing) return null
    const now = new Date().toISOString()
    const entry: MemoryEntry = {
      ...existing,
      ...patch,
      id: existing.id,
      category: patch.category || existing.category,
      title: patch.title !== undefined ? cleanTitle(patch.title) : existing.title,
      summary: patch.summary !== undefined ? String(patch.summary || '') : existing.summary,
      tags: patch.tags || existing.tags || [],
      metadata: patch.metadata ? { ...(existing.metadata || {}), ...patch.metadata } : existing.metadata,
      status: patch.status || existing.status || 'approved',
      confidence: typeof patch.confidence === 'number' ? clampConfidence(patch.confidence) : existing.confidence,
      createdAt: existing.createdAt,
      updatedAt: now
    }
    index.entries = [entry, ...index.entries.filter(item => item.id !== id)]
    this.writeIndex(index)
    return entry
  }

  disableEntry(id: string): MemoryEntry | null {
    return this.updateEntry(id, { status: 'disabled' })
  }

  importConversation(source: string, content: string, options: { includeRaw?: boolean } = {}): MemoryEntry[] {
    if (!this.getSettings().enabled) return []
    const normalizedSource = cleanTitle(source || 'Imported conversation')
    const text = String(content || '').trim()
    if (!text) return []
    const candidates = extractCandidatesFromConversation(normalizedSource, text, options.includeRaw !== false)
    return candidates.map(candidate => this.upsertEntry({
      ...candidate,
      id: candidate.id || makeCandidateEntryId(candidate.category, normalizedSource, candidate),
      status: 'candidate'
    }))
  }

  saveRuntimeState(state: RuntimeMemoryState): RuntimeMemoryState {
    const normalized = normalizeRuntimeState(state)
    this.writeJson(this.latestPath, normalized)
    this.writeJson(join(this.historyDir, todayName()), normalized)

    const index = this.readIndex()
    const now = new Date().toISOString()
    index.entries = pruneRuntimeNoise(index.entries)
    index.runtimeUpdatedAt = now
    this.writeIndex(index)
    return normalized
  }

  loadRuntimeState(): RuntimeMemoryState {
    if (!existsSync(this.latestPath)) return { messages: [], tasks: [] }
    try {
      return normalizeRuntimeState(JSON.parse(readFileSync(this.latestPath, 'utf-8')))
    } catch {
      return { messages: [], tasks: [] }
    }
  }

  private ensureDirs(): void {
    mkdirSync(this.historyDir, { recursive: true })
  }

  private readIndex(): MemoryIndex {
    if (!existsSync(this.indexPath)) return { ...DEFAULT_INDEX, entries: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isMemoryEntry) : [],
        settings: normalizeMemorySettings(parsed.settings),
        runtimeUpdatedAt: typeof parsed.runtimeUpdatedAt === 'string' ? parsed.runtimeUpdatedAt : undefined
      }
    } catch {
      return { ...DEFAULT_INDEX, entries: [] }
    }
  }

  private writeIndex(index: MemoryIndex): void {
    this.writeJson(this.indexPath, index)
  }

  private writeJson(path: string, value: any): void {
    this.ensureDirs()
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8')
  }
}

function normalizeRuntimeState(input: any): RuntimeMemoryState {
  const messages = Array.isArray(input?.messages) ? input.messages.map(normalizeMessage) : []
  const tasks = Array.isArray(input?.tasks) ? input.tasks.map(normalizeTask) : []
  return { messages, tasks }
}

function normalizeMessage(message: any): any {
  const replies = Array.isArray(message?.replies) ? message.replies.map((reply: any) => {
    if (reply?.done) return reply
    return { ...reply, done: true, cancelled: true }
  }) : []
  return { ...message, replies }
}

function normalizeTask(task: any): any {
  return task?.status === 'running' ? { ...task, status: 'cancelled' } : task
}

/*
function messageToEntry(message: any): MemoryEntry {
  const agentIds = Array.isArray(message.replies) ? message.replies.map((reply: any) => reply.agentId).filter(Boolean) : []
  const errors = Array.isArray(message.replies) ? message.replies.map((reply: any) => reply.error).filter(Boolean) : []
  const resultCount = Array.isArray(message.replies) ? message.replies.filter((reply: any) => reply.text).length : 0
  return {
    id: makeEntryId('conversation', message.id || message.taskId || message.text),
    category: 'conversation',
    title: cleanTitle(message.text || 'Conversation'),
    summary: errors.length ? `包含 ${errors.length} 条错误` : `包含 ${resultCount} 条 Agent 回复`,
    content: JSON.stringify(message, null, 2),
    tags: ['chat', message.mode].filter(Boolean),
    status: 'approved',
    metadata: {
      messageId: message.id,
      taskId: message.taskId,
      mode: message.mode,
      agentIds
    },
    createdAt: '',
    updatedAt: ''
  }
}

function taskToEntry(task: any): MemoryEntry {
  return {
    id: makeEntryId('task', task.id || task.text),
    category: 'task',
    title: cleanTitle(task.text || 'Task'),
    summary: `${task.status || 'unknown'} via ${(task.agents || []).join(', ') || 'no agent'}`,
    content: JSON.stringify(task, null, 2),
    tags: ['task', task.mode, task.status].filter(Boolean),
    status: 'approved',
    metadata: {
      taskId: task.id,
      mode: task.mode,
      status: task.status,
      agents: task.agents || [],
      durationMs: task.durationMs
    },
    createdAt: '',
    updatedAt: ''
  }
}

function historyFileToEntry(source: string, title: string): MemoryEntry {
  return {
    id: makeEntryId('file', source),
    category: 'file',
    title,
    summary: 'AgentHub runtime memory snapshot',
    source,
    tags: ['history', 'snapshot'],
    status: 'approved',
    metadata: { kind: 'runtime-snapshot' },
    createdAt: '',
    updatedAt: ''
  }
}

*/
function countEntries(entries: MemoryEntry[]): Record<MemoryCategory, number> {
  return CATEGORIES.reduce((counts, category) => {
    counts[category] = entries.filter(entry => entry.category === category).length
    return counts
  }, {} as Record<MemoryCategory, number>)
}

function cleanTitle(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 96) || 'Untitled'
}

function makeEntryId(category: MemoryCategory, seed: string): string {
  return `${category}:${encodeURIComponent(String(seed || 'untitled')).slice(0, 120)}`
}

function makeCandidateEntryId(category: MemoryCategory, source: string, candidate: MemoryEntryInput): string {
  const seed = [source, candidate.title, candidate.summary, candidate.content, (candidate.tags || []).join(',')].join('\n')
  return `${category}:candidate:${hashMemorySeed(seed)}`
}

function hashMemorySeed(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function todayName(): string {
  return new Date().toISOString().slice(0, 10) + '.json'
}

function isMemoryEntry(value: any): value is MemoryEntry {
  return !!value && CATEGORIES.includes(value.category) && typeof value.id === 'string' && typeof value.title === 'string'
}

function normalizeMemorySettings(value: any): MemorySettingsState {
  return { enabled: value?.enabled !== false }
}

function extractCandidatesFromConversation(source: string, content: string, includeRaw: boolean): MemoryEntryInput[] {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(user|human|me|我|用户)\s*[:：-]\s*/i, '').trim())
    .filter(isMemoryWorthLine)
  const candidates: MemoryEntryInput[] = []
  if (includeRaw && isMemoryWorthText(content)) {
    candidates.push({
      category: 'imported_conversation',
      title: `${source} sample`,
      summary: clipText(content.replace(/\s+/g, ' '), 240),
      content: clipText(content, 12_000),
      source,
      tags: ['imported', 'conversation'],
      confidence: 0.6,
      metadata: { source, kind: 'raw-import' }
    })
  }

  const rules: Array<{ category: MemoryCategory; tags: string[]; pattern: RegExp; title: string; confidence: number }> = [
    { category: 'preference', tags: ['preference'], pattern: /(prefer|like|希望|以后|默认|偏好|总是|优先|保持|always|usually|by default)/i, title: 'User preference', confidence: 0.78 },
    { category: 'style', tags: ['style', 'format'], pattern: /(style|tone|format|格式|风格|语气|排版|简洁|详细|中文|英文|不要提及|回答)/i, title: 'Style preference', confidence: 0.76 },
    { category: 'project', tags: ['project'], pattern: /(project|repo|workspace|项目|仓库|应用|产品|发布|打包|GitHub|Release|AgentHub)/i, title: 'Project context', confidence: 0.7 },
    { category: 'decision', tags: ['decision'], pattern: /(decide|decision|选择|决定|采用|不要使用|改为|确认|已经确认)/i, title: 'Decision', confidence: 0.72 },
    { category: 'correction', tags: ['correction'], pattern: /(not|instead|wrong|fix|不要|不是|修正|纠正|错误|应该|实际应该|改成|去除)/i, title: 'Correction', confidence: 0.78 },
    { category: 'preference', tags: ['preference'], pattern: /(prefer|like|喜欢|偏好|希望|以后|默认|always|usually)/i, title: 'User preference', confidence: 0.72 },
    { category: 'style', tags: ['style', 'format'], pattern: /(style|tone|format|格式|风格|语气|排版|简洁|详细|中文|英文)/i, title: 'Style preference', confidence: 0.7 },
    { category: 'project', tags: ['project'], pattern: /(project|repo|workspace|项目|仓库|应用|产品|AgentHub)/i, title: 'Project context', confidence: 0.66 },
    { category: 'decision', tags: ['decision'], pattern: /(decide|decision|选择|决定|采用|不要使用|改为|确认)/i, title: 'Decision', confidence: 0.68 },
    { category: 'correction', tags: ['correction'], pattern: /(not|instead|wrong|fix|不要|不是|修正|纠正|错误|应该)/i, title: 'Correction', confidence: 0.7 }
  ]

  for (const rule of rules) {
    const matched = lines.filter(line => rule.pattern.test(line)).filter(isMemoryWorthText).slice(0, 4)
    if (!matched.length) continue
    const body = matched.join('\n')
    candidates.push({
      category: rule.category,
      title: cleanMemoryTitle(`${rule.title}: ${matched[0]}`),
      summary: distillMemorySummary(body, rule.category),
      content: body,
      source,
      tags: ['imported', ...rule.tags],
      confidence: rule.confidence,
      metadata: { source, extractedBy: 'keyword-rules', samples: matched.length }
    })
  }
  return dedupeCandidateInputs(candidates)
    .filter(candidate => isMemoryWorthText([candidate.title, candidate.summary, candidate.content].filter(Boolean).join('\n')))
    .slice(0, 8)
}

function pruneRuntimeNoise(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.filter(entry => {
    if (entry.metadata?.kind === 'runtime-snapshot') return false
    if (entry.tags?.includes('history') && entry.tags?.includes('snapshot')) return false
    if (entry.category === 'conversation' && entry.metadata?.messageId) return false
    if (entry.category === 'task' && entry.metadata?.taskId) return false
    if (entry.category === 'file' && String(entry.source || '').startsWith('history/')) return false
    if (!isMemoryWorthText([entry.title, entry.summary, entry.content].filter(Boolean).join('\n'))) {
      return !!entry.metadata?.pinned || !!entry.metadata?.pin
    }
    return true
  })
}

function isMemoryWorthLine(line: string): boolean {
  const text = String(line || '').trim()
  if (text.length < 12) return false
  return isMemoryWorthText(text)
}

function isMemoryWorthText(value: string): boolean {
  const raw = String(value || '')
  // Strip role prefixes before whitespace normalization (importConversation passes multi-line raw content)
  const stripped = raw.replace(/(?:^|\n)\s*(?:user|human|me|我|用户|assistant|bot|ai)\s*[:：-]\s*/gim, ' ')
  const text = stripped.replace(/\s+/g, ' ').trim()
  if (text.length < 12) return false
  const compact = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  // Extended noise list: covers low-value Chinese phrases that passed the old gate
  const noise = [
    'hi', 'hello', 'test', 'testing', 'ok', 'okay',
    '你好', '您好', '测试', '随便', '哈哈', '在吗', '收到', '分析项目', '继续',
    '修一下', '改一下', '弄一下', '帮我看看', '这个不对', '换一个', '看看这个',
    '之前那个', '刚才那个', '再来一次', '重试', '没反应', '卡住了',
    '好的', '可以', '没问题', '知道了', '明白了', '谢谢',
    'dailysessionsnapshot', 'latestsessionsnapshot'
  ]
  if (noise.includes(compact)) return false
  // Check if the entire text consists only of noise words (iterative stripping)
  let remainder = compact
  for (let pass = 0; pass < 3; pass++) {
    let reduced = remainder
    for (const word of noise) reduced = reduced.replaceAll(word, '')
    if (reduced === remainder) break
    remainder = reduced
  }
  if (remainder.length < 4) return false
  if (/^\[agenthub custom schedule\]/i.test(text)) return false
  if (/^(completed|cancelled|failed|running)\s+via\s+/i.test(text)) return false
  // Reject very short pure-command fragments without value signals
  const VALUE_SIGNALS = /(prefer|preference|always|usually|default|style|format|decision|correction|instead|project|workspace|repo|偏好|希望|以后|默认|总是|优先|保持|格式|风格|语气|项目|仓库|决定|确认|修正|纠正|不要|应该|改成|去除|发布|打包|验证)/i
  if (text.length < 30 && !VALUE_SIGNALS.test(text)) return false
  // Noise blacklist passed — accept the line as a valid memory candidate.
  return true
}

function cleanMemoryTitle(value: string): string {
  return cleanTitle(value.replace(/\s+/g, ' ').replace(/^(User|Assistant):\s*/i, '')).slice(0, 88)
}

function distillMemorySummary(body: string, category: MemoryCategory): string {
  const lines = body
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').replace(/^(User|Assistant):\s*/i, '').trim())
    .filter(Boolean)
    .slice(0, 3)
  const prefix: Partial<Record<MemoryCategory, string>> = {
    preference: 'Preference',
    style: 'Style rule',
    project: 'Project fact',
    decision: 'Decision',
    correction: 'Correction'
  }
  return clipText(`${prefix[category] || 'Memory'}: ${lines.join('; ')}`, 260)
}

/**
 * Tokenize a memory search query for matching.
 * - ASCII tokens: words of 2+ alphanumeric/underscore/hyphen characters
 * - CJK tokens: bigrams (sliding window of size 2) from contiguous CJK runs,
 *   inspired by Kun's memory-store ngrams() \u2014 this fixes the previous whole-run
 *   extraction which caused zero recall for partial CJK overlap queries.
 */
function tokenizeMemoryQuery(query: string): string[] {
  const text = String(query || '').toLowerCase()
  const ascii = text.match(/[a-z0-9_-]{2,}/g) || []
  const cjkRuns = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) || []
  const cjkBigrams: string[] = []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      cjkBigrams.push(run.slice(i, i + 2))
    }
  }
  return Array.from(new Set([...ascii, ...cjkBigrams]))
}

function scoreMemoryEntry(entry: MemoryEntry, terms: string[]): number {
  const title = searchableText(entry.title)
  const summary = searchableText(entry.summary)
  const content = searchableText(entry.content || '')
  const tags = searchableText((entry.tags || []).join(' '))
  let score = 0
  for (const term of terms) {
    if (title.includes(term)) score += 8
    if (tags.includes(term)) score += 6
    if (summary.includes(term)) score += 4
    if (content.includes(term)) score += 1
  }
  if (entry.metadata?.pinned || entry.metadata?.pin) score += 12
  if (typeof entry.confidence === 'number') score += Math.max(0, Math.min(1, entry.confidence)) * 3
  if (entry.category === 'preference' || entry.category === 'correction') score += 2
  if (entry.category === 'project' || entry.category === 'style' || entry.category === 'decision') score += 1
  // Value-signal keyword bonus (formerly in isMemoryWorthText as a hard gate)
  const valueSignals = /(prefer|preference|always|usually|default|style|format|decision|correction|instead|project|workspace|repo)/i
  const valueSignalsZh = /(偏好|希望|以后|默认|总是|优先|保持|格式|风格|语气|项目|仓库|决定|确认|修正|纠正|不要|应该|改成|去除|发布|打包|验证)/
  const allText = [title, tags, summary, content].join(' ')
  if (valueSignals.test(allText) || valueSignalsZh.test(allText)) score += 2
  if (!terms.length) score += Math.max(0, Date.parse(entry.updatedAt) || 0) / 1_000_000_000_000
  return Number(score.toFixed(4))
}

function estimateMemoryTokens(entry: MemoryEntry): number {
  const text = [
    entry.category,
    entry.title,
    entry.summary,
    entry.content,
    entry.source,
    ...(entry.tags || [])
  ].filter(Boolean).join('\n')
  return Math.max(1, Math.ceil(text.length / 4))
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function searchableText(value: string): string {
  return String(value || '').toLowerCase()
}

function dedupeCandidateInputs(candidates: MemoryEntryInput[]): MemoryEntryInput[] {
  const seen = new Set<string>()
  const out: MemoryEntryInput[] = []
  for (const candidate of candidates) {
    const key = `${candidate.category}:${candidate.summary || candidate.content || candidate.title}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

function clipText(value: string, max: number): string {
  const text = String(value || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`
}
