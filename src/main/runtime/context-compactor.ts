/**
 * Context Compactor for AgentHub
 *
 * Inspired by Kun's context-compactor.ts
 * Compacts long conversation histories into summaries to stay within model context windows.
 */

export type CompactionMode = 'normal' | 'aggressive' | 'force'

export interface CompactionPlan {
  mode: CompactionMode
  keepRecent: number
  reason: string
}

export interface CompactionResult {
  compacted: boolean
  summary?: string
  replacedCount: number
  keptCount: number
  mode?: CompactionMode
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  agentId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  toolResults?: Array<{ id: string; output: string; isError?: boolean }>
}

// Default thresholds (in estimated tokens)
const DEFAULT_SOFT_THRESHOLD = 50_000
const DEFAULT_HARD_THRESHOLD = 100_000
const AGGRESSIVE_THRESHOLD_RATIO = 0.6

// Character to token ratio (rough estimate)
const CHARS_PER_TOKEN = 4

export class ContextCompactor {
  private readonly softThreshold: number
  private readonly hardThreshold: number

  constructor(options?: {
    softThreshold?: number
    hardThreshold?: number
  }) {
    this.softThreshold = options?.softThreshold ?? DEFAULT_SOFT_THRESHOLD
    this.hardThreshold = options?.hardThreshold ?? DEFAULT_HARD_THRESHOLD
  }

  /**
   * Estimate token count for a message.
   */
  estimateTokens(message: ConversationMessage): number {
    const contentTokens = Math.ceil(message.content.length / CHARS_PER_TOKEN)
    const toolTokens = (message.toolCalls?.length ?? 0) * 50 + (message.toolResults?.length ?? 0) * 50
    return contentTokens + toolTokens
  }

  /**
   * Estimate total token count for a conversation.
   */
  estimateTotalTokens(messages: ConversationMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateTokens(msg), 0)
  }

  /**
   * Determine if compaction is needed.
   */
  shouldCompact(messages: ConversationMessage[]): boolean {
    return this.planCompaction(messages) !== null
  }

  /**
   * Plan compaction strategy based on current conversation size.
   */
  planCompaction(messages: ConversationMessage[]): CompactionPlan | null {
    const tokens = this.estimateTotalTokens(messages)
    if (tokens < this.softThreshold) return null

    const aggressiveThreshold = this.softThreshold + Math.floor((this.hardThreshold - this.softThreshold) * AGGRESSIVE_THRESHOLD_RATIO)
    const mode: CompactionMode =
      tokens >= this.hardThreshold ? 'force' :
      tokens >= aggressiveThreshold ? 'aggressive' :
      'normal'

    const keepRecent = mode === 'force' ? 1 : mode === 'aggressive' ? 2 : 4
    return {
      mode,
      keepRecent,
      reason: `Estimated ${tokens} tokens reached ${mode} compaction threshold`
    }
  }

  /**
   * Compact a conversation by summarizing older messages.
   */
  compact(messages: ConversationMessage[], options?: {
    keepRecent?: number
    mode?: CompactionMode
    summaryOverride?: string
  }): CompactionResult {
    if (messages.length <= 1) {
      return { compacted: false, replacedCount: 0, keptCount: messages.length }
    }

    const plan = this.planCompaction(messages)
    if (!plan) {
      return { compacted: false, replacedCount: 0, keptCount: messages.length }
    }

    const keepRecent = options?.keepRecent ?? plan.keepRecent
    const mode = options?.mode ?? plan.mode

    // Ensure we keep at least some recent messages
    const effectiveKeepRecent = Math.min(keepRecent, messages.length - 1)
    const replaceEnd = messages.length - effectiveKeepRecent

    // Split into messages to replace and messages to keep
    const toReplace = messages.slice(0, replaceEnd)
    const toKeep = messages.slice(replaceEnd)

    // Build summary
    const summary = options?.summaryOverride ?? this.buildSummary(toReplace, mode)

    return {
      compacted: true,
      summary,
      replacedCount: toReplace.length,
      keptCount: toKeep.length,
      mode
    }
  }

  /**
   * Build a summary of messages.
   */
  private buildSummary(messages: ConversationMessage[], mode: CompactionMode): string {
    const lines: string[] = []
    lines.push(`[Compacted ${messages.length} messages - ${mode} mode]`)
    lines.push('')

    // Summarize each message
    for (const msg of messages) {
      const preview = this.clipText(msg.content, 200)
      if (msg.role === 'user') {
        lines.push(`User: ${preview}`)
      } else if (msg.role === 'assistant') {
        lines.push(`Assistant: ${preview}`)
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tool of msg.toolCalls) {
            lines.push(`  - Tool: ${tool.name}`)
          }
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * Clip text to a maximum length.
   */
  private clipText(text: string, max: number): string {
    const compact = text.replace(/\s+/g, ' ').trim()
    if (compact.length <= max) return compact
    return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
  }
}

/**
 * Create a default context compactor instance.
 */
export function createContextCompactor(options?: {
  softThreshold?: number
  hardThreshold?: number
}): ContextCompactor {
  return new ContextCompactor(options)
}
