/**
 * Memory Scoring Module
 *
 * Extracted from memory-library.ts for reusability and testability.
 * Provides tokenization and scoring functions for memory retrieval.
 */

export interface MemoryEntryForScoring {
  title: string
  summary?: string
  content?: string
  tags?: string[]
  category: string
  confidence?: number
  pinned?: boolean
  metadata?: Record<string, unknown>
  updatedAt?: string
}

/**
 * Tokenize a memory search query for matching.
 * - ASCII tokens: words of 2+ alphanumeric/underscore/hyphen characters
 * - CJK tokens: bigrams (sliding window of size 2) from contiguous CJK runs
 *
 * This fixes the previous whole-run extraction which caused zero recall
 * for partial CJK overlap queries.
 */
export function tokenizeMemoryQuery(query: string): string[] {
  const text = String(query || '').toLowerCase()
  const ascii = text.match(/[a-z0-9_-]{2,}/g) || []
  const cjkRuns = text.match(/[一-鿿぀-ヿ가-힯]+/g) || []
  const cjkBigrams: string[] = []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      cjkBigrams.push(run.slice(i, i + 2))
    }
  }
  return Array.from(new Set([...ascii, ...cjkBigrams]))
}

/**
 * Make text searchable by lowercasing and normalizing whitespace.
 */
export function searchableText(text: string | undefined): string {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Score a memory entry against query terms.
 *
 * Scoring weights:
 * - title match: +8
 * - tags match: +6
 * - summary match: +4
 * - content match: +1
 * - pinned: +12
 * - confidence: 0-3
 * - high-value category (preference/correction): +2
 * - other valuable category (project/style/decision): +1
 * - value signal keywords: +2
 */
export function scoreMemoryEntry(entry: MemoryEntryForScoring, terms: string[]): number {
  const title = searchableText(entry.title)
  const summary = searchableText(entry.summary)
  const content = searchableText(entry.content || '')
  const tags = searchableText((entry.tags || []).join(' '))

  let score = 0

  // Field match scoring
  for (const term of terms) {
    if (title.includes(term)) score += 8
    if (tags.includes(term)) score += 6
    if (summary.includes(term)) score += 4
    if (content.includes(term)) score += 1
  }

  // Pinned bonus
  if (entry.pinned || entry.metadata?.pinned || entry.metadata?.pin) score += 12

  // Confidence bonus (0-3)
  if (typeof entry.confidence === 'number') {
    score += Math.max(0, Math.min(1, entry.confidence)) * 3
  }

  // Category bonus
  if (entry.category === 'preference' || entry.category === 'correction') {
    score += 2
  } else if (entry.category === 'project' || entry.category === 'style' || entry.category === 'decision') {
    score += 1
  }

  // Value-signal keyword bonus
  const valueSignals = /(prefer|preference|always|usually|default|style|format|decision|correction|instead|project|workspace|repo)/i
  const valueSignalsZh = /(偏好|希望|以后|默认|总是|优先|保持|格式|风格|语气|项目|仓库|决定|确认|修正|纠正|不要|应该|改成|去除|发布|打包|验证)/
  const allText = [title, tags, summary, content].join(' ')
  if (valueSignals.test(allText) || valueSignalsZh.test(allText)) {
    score += 2
  }

  // Recency bonus for empty queries
  if (!terms.length && entry.updatedAt) {
    score += Math.max(0, Date.parse(entry.updatedAt) || 0) / 1_000_000_000_000
  }

  return Number(score.toFixed(4))
}

/**
 * Estimate token count for a memory entry.
 * Rough estimate: 1 token per 4 characters.
 */
export function estimateMemoryTokens(entry: MemoryEntryForScoring): number {
  const text = [
    entry.category,
    entry.title,
    entry.summary,
    entry.content,
    (entry.tags || []).join(' ')
  ].filter(Boolean).join(' ')
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Check if text contains value signal keywords.
 */
export function hasValueSignal(text: string): boolean {
  const valueSignals = /(prefer|preference|always|usually|default|style|format|decision|correction|instead|project|workspace|repo)/i
  const valueSignalsZh = /(偏好|希望|以后|默认|总是|优先|保持|格式|风格|语气|项目|仓库|决定|确认|修正|纠正|不要|应该|改成|去除|发布|打包|验证)/
  return valueSignals.test(text) || valueSignalsZh.test(text)
}
