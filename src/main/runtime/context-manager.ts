/**
 * ContextManager: unified context window management.
 *
 * Tracks token budget usage across different context sources,
 * provides compaction suggestions, and generates context composition
 * reports for the Context Ledger UI.
 *
 * Phase 3.2: Context management enhancement.
 */

export type ContextSourceKind = 'system' | 'messages' | 'attachments' | 'skills' | 'workspace' | 'memory' | 'browser'

export interface ContextSource {
  kind: ContextSourceKind
  label: string
  tokens: number
  pinned: boolean
  removable: boolean
  priority: number // lower = higher priority, can be evicted first if over budget
}

export interface ContextComposition {
  windowTokens: number
  usedTokens: number
  freeTokens: number
  usedRatio: number
  tone: 'ok' | 'warn' | 'danger'
  sources: ContextSource[]
  /** Sources that could be removed to free up space */
  evictionCandidates: ContextSource[]
}

/** Estimate tokens from text length (CJK-aware). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length
  const rest = text.length - cjk
  return Math.ceil(cjk * 1.5 + rest / 4)
}

/** Resolve context window size for a model. */
export function resolveContextWindow(modelId: string, providers: Array<{ id: string; models: Array<{ id: string; contextWindow?: number }> }>): number {
  const defaults: Record<string, number> = {
    'gpt-4o': 128_000, 'gpt-4o-mini': 128_000,
    'claude-sonnet-4': 200_000, 'claude-haiku-4': 200_000,
    'deepseek-chat': 128_000, 'deepseek-v3': 128_000,
    'gemini-2.5-pro': 1_048_576, 'gemini-2.5-flash': 1_048_576,
    'o1': 200_000, 'o3': 200_000, 'o3-mini': 200_000,
    'o4-mini': 200_000
  }
  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.id === modelId && model.contextWindow) return model.contextWindow
    }
  }
  return defaults[modelId.toLowerCase()] || 128_000
}

/**
 * Build a context composition report from current sources.
 */
export function buildContextComposition(
  sources: ContextSource[],
  windowTokens: number,
  reserveForResponse = 4_096
): ContextComposition {
  const effectiveWindow = Math.max(0, windowTokens - reserveForResponse)
  const usedTokens = sources.reduce((sum, s) => sum + s.tokens, 0)
  const freeTokens = Math.max(0, effectiveWindow - usedTokens)
  const usedRatio = effectiveWindow > 0 ? usedTokens / effectiveWindow : 0

  const tone: ContextComposition['tone'] = usedRatio > 0.9 ? 'danger' : usedRatio > 0.75 ? 'warn' : 'ok'

  // Eviction candidates: unpinned sources sorted by priority (lowest priority first)
  const evictionCandidates = sources
    .filter(s => s.removable && !s.pinned)
    .sort((a, b) => a.priority - b.priority)

  return {
    windowTokens: effectiveWindow,
    usedTokens,
    freeTokens,
    usedRatio,
    tone,
    sources,
    evictionCandidates
  }
}

/**
 * Suggest which sources to evict to stay within budget.
 */
export function suggestEvictions(
  sources: ContextSource[],
  windowTokens: number,
  reserveForResponse = 4_096
): ContextSource[] {
  const effectiveWindow = Math.max(0, windowTokens - reserveForResponse)
  let used = sources.reduce((sum, s) => sum + s.tokens, 0)
  if (used <= effectiveWindow) return []

  // Higher priority number = lower importance = evict first
  const candidates = sources
    .filter(s => s.removable && !s.pinned)
    .sort((a, b) => b.priority - a.priority)

  const evict: ContextSource[] = []
  for (const c of candidates) {
    if (used <= effectiveWindow) break
    evict.push(c)
    used -= c.tokens
  }
  return evict
}
