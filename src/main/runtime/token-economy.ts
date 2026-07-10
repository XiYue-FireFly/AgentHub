/**
 * Token Economy: configuration and utilities for token-aware request optimization.
 *
 * Inspired by Kun's token-economy.ts. Provides:
 * - Configurable token budget enforcement
 * - Tool description/result compression
 * - Concise response directives
 * - Request history hygiene (cumulative tool result budget)
 *
 * R15-aligned: Kun loop/token-economy reference pattern.
 */

export interface TokenEconomyConfig {
  /** Enable token economy mode (adds concise response instruction) */
  enabled?: boolean
  /** Compress tool descriptions in requests */
  compressToolDescriptions?: boolean
  /** Compress tool results in history */
  compressToolResults?: boolean
  /** Add concise response directive to system prompt */
  conciseResponses?: boolean
  /** Maximum cumulative tool result tokens across all history */
  maxCumulativeToolResultTokens?: number
  /** Number of most-recent tool results kept at full fidelity */
  keepRecentToolResults?: number
}

export interface NormalizedTokenEconomyConfig {
  enabled: boolean
  compressToolDescriptions: boolean
  compressToolResults: boolean
  conciseResponses: boolean
  maxCumulativeToolResultTokens: number
  keepRecentToolResults: number
}

export interface TextCompactionOptions {
  headTokens?: number
  tailTokens?: number
  marker?: string
}

export interface TextCompactionResult {
  text: string
  truncated: boolean
  originalTokens: number
  finalTokens: number
  savedTokens: number
}

export interface CompactChatMessage {
  role: string
  content: string
  [key: string]: any
}

export interface CompactChatMessagesOptions {
  maxTokens?: number
  keepRecentMessages?: number
  perHistoricalMessageTokens?: number
  currentMessageTokens?: number
}

export const DEFAULT_TOKEN_ECONOMY_CONFIG: NormalizedTokenEconomyConfig = {
  enabled: false,
  compressToolDescriptions: true,
  compressToolResults: true,
  conciseResponses: true,
  maxCumulativeToolResultTokens: 120_000,
  keepRecentToolResults: 4
}

export const TOKEN_ECONOMY_INSTRUCTION = [
  'Token economy mode is enabled.',
  'Reply concisely: answer directly, skip pleasantries, filler, and hedging.',
  'Preserve exact code, commands, paths, URLs, identifiers, and quoted errors.',
  'When tool output says content was omitted, use narrower read/grep/bash ranges instead of guessing.'
].join('\n')

/** Normalize a partial config to a full config with defaults. */
export function normalizeTokenEconomyConfig(
  input: TokenEconomyConfig | undefined
): NormalizedTokenEconomyConfig {
  return {
    ...DEFAULT_TOKEN_ECONOMY_CONFIG,
    ...(input ?? {})
  }
}

/** Estimate tokens for a text string. CJK chars ~1 token each, ASCII ~4 chars/token. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let asciiRun = 0
  let tokens = 0
  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiRun += 1
    } else {
      if (asciiRun > 0) {
        tokens += Math.ceil(asciiRun / 4)
        asciiRun = 0
      }
      tokens += 1
    }
  }
  if (asciiRun > 0) tokens += Math.ceil(asciiRun / 4)
  return Math.max(0, tokens)
}

/** Truncate a tool result to fit within a token budget. */
export function truncateToolResult(
  result: string,
  maxTokens: number
): { text: string; truncated: boolean } {
  if (!result) return { text: '', truncated: false }
  const estimated = estimateTokens(result)
  if (estimated <= maxTokens) return { text: result, truncated: false }
  // Truncate to approximately maxTokens worth of text
  const maxChars = maxTokens * 4 // rough estimate
  const truncated = result.slice(0, maxChars) + '\n...[truncated by token economy]'
  return { text: truncated, truncated: true }
}

/**
 * Reasonix-inspired head/tail compaction for large dynamic context.
 *
 * It keeps the beginning and end because file dumps, logs, and markdown usually
 * place identifiers/intent near the head and failures or conclusions near the
 * tail. This is deterministic and avoids a summarizer call.
 */
export function compactTextByTokenBudget(
  value: string,
  maxTokens: number,
  options: TextCompactionOptions = {}
): TextCompactionResult {
  const text = String(value || "")
  const originalTokens = estimateTokens(text)
  const safeMax = Math.max(0, Math.floor(maxTokens || 0))
  if (!text || originalTokens <= safeMax) {
    return { text, truncated: false, originalTokens, finalTokens: originalTokens, savedTokens: 0 }
  }
  if (safeMax <= 0) {
    const marker = options.marker || `[content omitted by token economy; original ${originalTokens} tokens]`
    const finalTokens = estimateTokens(marker)
    return { text: marker, truncated: true, originalTokens, finalTokens, savedTokens: Math.max(0, originalTokens - finalTokens) }
  }

  const markerReserve = Math.min(96, Math.max(24, Math.floor(safeMax * 0.12)))
  const bodyBudget = Math.max(1, safeMax - markerReserve)
  const requestedTail = options.tailTokens ?? Math.max(64, Math.floor(bodyBudget * 0.25))
  const tailTokens = Math.min(requestedTail, Math.max(0, bodyBudget - 1))
  const headTokens = Math.max(1, Math.min(options.headTokens ?? (bodyBudget - tailTokens), bodyBudget - tailTokens))
  let currentHeadTokens = headTokens
  let head = takeStartByTokens(text, currentHeadTokens).trimEnd()
  const tail = takeEndByTokens(text, tailTokens).trimStart()
  const marker = options.marker || `[... ${Math.max(1, originalTokens - headTokens - tailTokens)} estimated tokens omitted by token economy; use narrower reads if needed ...]`
  let compacted = [head, marker, tail].filter(Boolean).join("\n")

  while (estimateTokens(compacted) > safeMax && currentHeadTokens > 1) {
    const shrink = Math.max(1, Math.floor(currentHeadTokens * 0.1))
    currentHeadTokens = Math.max(1, currentHeadTokens - shrink)
    const nextHead = takeStartByTokens(text, currentHeadTokens).trimEnd()
    compacted = [nextHead, marker, tail].filter(Boolean).join("\n")
    if (nextHead === head) break
    head = nextHead
  }

  const finalTokens = estimateTokens(compacted)
  return {
    text: compacted,
    truncated: true,
    originalTokens,
    finalTokens,
    savedTokens: Math.max(0, originalTokens - finalTokens)
  }
}

/**
 * Compact a chat history without discarding the latest user request.
 * Older messages are first compacted individually; if the full history is still
 * too large, old turns collapse into a deterministic summary and the recent
 * tail remains verbatim/near-verbatim.
 */
export function compactChatMessages<T extends CompactChatMessage>(
  messages: T[],
  options: CompactChatMessagesOptions = {}
): T[] {
  const maxTokens = options.maxTokens ?? 20_000
  const keepRecent = Math.max(1, options.keepRecentMessages ?? 4)
  const historicalBudget = Math.max(256, options.perHistoricalMessageTokens ?? 1_800)
  const currentBudget = Math.max(historicalBudget, options.currentMessageTokens ?? 10_000)
  if (messages.length <= 1) {
    const only = messages[0]
    if (!only) return messages
    const roleOverhead = 4 + estimateTokens(only.role || "")
    const budget = Math.max(1, Math.min(currentBudget, maxTokens - roleOverhead))
    const next = compactTextByTokenBudget(only.content, budget)
    return next.truncated ? [{ ...only, content: next.text }] as T[] : messages
  }
  const recentStart = Math.max(0, messages.length - keepRecent)
  const seen = new Map<string, number>()

  let compacted = messages.map((message, index) => {
    const isCurrent = index === messages.length - 1
    const isRecent = index >= recentStart
    const normalized = normalizeForDedupe(message.content)
    if (!isCurrent && normalized && seen.has(normalized)) {
      return {
        ...message,
        content: `[Duplicate ${message.role} context omitted by token economy; same content appeared earlier in this request.]`
      }
    }
    if (normalized) seen.set(normalized, index)
    const budget = isCurrent ? currentBudget : isRecent ? Math.max(historicalBudget, 3_000) : historicalBudget
    const next = compactTextByTokenBudget(message.content, budget)
    return next.truncated ? { ...message, content: next.text } : message
  })

  if (estimateMessagesTokens(compacted) <= maxTokens) return compacted

  const tail = compacted.slice(Math.max(0, compacted.length - keepRecent))
  const older = compacted.slice(0, Math.max(0, compacted.length - keepRecent))
  if (older.length > 0) {
    const summary = deterministicHistorySummary(older)
    compacted = [{ ...older[0], role: "user", content: summary }, ...tail]
  }

  while (compacted.length > 1 && estimateMessagesTokens(compacted) > maxTokens) {
    compacted.splice(1, 1)
  }

  const lastIndex = compacted.length - 1
  if (lastIndex >= 0 && estimateMessagesTokens(compacted) > maxTokens) {
    const current = compactTextByTokenBudget(compacted[lastIndex].content, currentBudget)
    compacted[lastIndex] = { ...compacted[lastIndex], content: current.text }
  }
  return compacted
}

export function estimateMessagesTokens(messages: Array<{ content?: string; role?: string }>): number {
  return messages.reduce((sum, message) => sum + 4 + estimateTokens(message.role || "") + estimateTokens(message.content || ""), 0)
}

function deterministicHistorySummary(messages: CompactChatMessage[]): string {
  const selected = messages.length <= 8 ? messages : [...messages.slice(0, 3), ...messages.slice(-5)]
  const omitted = Math.max(0, messages.length - selected.length)
  const lines = [
    "[AgentHub Compacted History]",
    `${messages.length} older message(s) were compacted to reduce token use. Recent messages and the current request are kept separately.`,
    ...selected.map((message, index) => {
      const preview = compactTextByTokenBudget(message.content.replace(/\s+/g, " ").trim(), 120).text
      return `- ${index + 1}. ${message.role}: ${preview}`
    })
  ]
  if (omitted) lines.push(`- ${omitted} middle message(s) omitted.`)
  return lines.join("\n")
}

function normalizeForDedupe(value: string): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
  return normalized.length >= 200 ? normalized : ""
}

function takeStartByTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return ""
  let tokens = 0
  let asciiRun = 0
  let end = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code <= 0x7f) {
      asciiRun += 1
      if (tokens + Math.ceil(asciiRun / 4) > maxTokens) break
    } else {
      if (asciiRun > 0) {
        tokens += Math.ceil(asciiRun / 4)
        asciiRun = 0
      }
      if (tokens + 1 > maxTokens) break
      tokens += 1
    }
    end = i + 1
  }
  return text.slice(0, end)
}

function takeEndByTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return ""
  let tokens = 0
  let asciiRun = 0
  let start = text.length
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const code = text.charCodeAt(i)
    if (code <= 0x7f) {
      asciiRun += 1
      if (tokens + Math.ceil(asciiRun / 4) > maxTokens) break
    } else {
      if (asciiRun > 0) {
        tokens += Math.ceil(asciiRun / 4)
        asciiRun = 0
      }
      if (tokens + 1 > maxTokens) break
      tokens += 1
    }
    start = i
  }
  return text.slice(start)
}
