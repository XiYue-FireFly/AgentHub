/**
 * Thread auto-title helpers (Kun / ccgui-inspired).
 * Pure logic — safe for Vitest without Electron.
 */

const DEFAULT_FALLBACK = 'New session'
const DEFAULT_MAX_LEN = 42

const EXACT_DEFAULTS = new Set(
  [
    'new session',
    'new chat',
    'new conversation',
    'untitled',
    '新会话',
    '新对话',
    '未命名',
    '未命名会话'
  ].map(s => s.toLowerCase())
)

/**
 * True for empty/whitespace and known placeholder titles (zh/en).
 */
export function isDefaultThreadTitle(title: string): boolean {
  const t = String(title ?? '').trim()
  if (!t) return true
  if (EXACT_DEFAULTS.has(t.toLowerCase())) return true
  // "Thread", "Thread 1", "Thread abc"
  if (/^thread(\s+\S+)?$/i.test(t)) return true
  return false
}

/**
 * Derive a short human title from the first user prompt.
 */
export function deriveThreadTitleFromPrompt(prompt: string, maxLen = DEFAULT_MAX_LEN): string {
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : DEFAULT_MAX_LEN
  let text = String(prompt ?? '')
  // Drop fenced code block openers on their own first lines
  text = text.replace(/^```[\w-]*\s*\n?/m, '')
  // Prefer first non-empty line
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let line = lines[0] || ''
  // Light markdown: strip leading heading markers / list bullets
  line = line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')
  // Strip wrapping quotes
  line = line.replace(/^["'`]+|["'`]+$/g, '')
  line = line.replace(/\s+/g, ' ').trim()
  if (!line) return DEFAULT_FALLBACK
  if (line.length <= limit) return line
  if (limit <= 1) return '…'
  return line.slice(0, Math.max(1, limit - 1)).trimEnd() + '…'
}

/**
 * Returns a new title when current is still a placeholder; otherwise null.
 */
export function maybeAutoTitle(currentTitle: string, prompt: string, maxLen?: number): string | null {
  if (!isDefaultThreadTitle(currentTitle)) return null
  const next = deriveThreadTitleFromPrompt(prompt, maxLen)
  const current = String(currentTitle ?? '').trim()
  if (!next || next === current) return null
  // Avoid renaming to bare fallback when prompt was empty
  if (next === DEFAULT_FALLBACK && !String(prompt ?? '').trim()) return null
  return next
}
