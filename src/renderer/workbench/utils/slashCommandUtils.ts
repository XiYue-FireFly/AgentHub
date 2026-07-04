/**
 * Parse slash command input into label and args.
 * Supports /command, @agent, /namespace:command patterns.
 */
export function parseSlashInput(value: string): { label: string; args: string } | null {
  const match = value.trim().match(/^((?:\/|@)[\w\u4e00-\u9fff][\w\u4e00-\u9fff_-]*(?::[\w\u4e00-\u9fff][\w\u4e00-\u9fff_-]*)?)(?:\s+([\s\S]*))?$/i)
  if (!match) return null
  const rawLabel = match[1].toLowerCase()
  const label = rawLabel.startsWith('@') ? `/agent:${rawLabel.slice(1) === 'minimax-code' ? 'opencode' : rawLabel.slice(1)}` : rawLabel
  return { label, args: (match[2] || '').trim() }
}

/**
 * Parse loop limit from command arguments.
 * Supports --n=5, --times=3, --limit=10, --max=8, 循环5, 轮数3 patterns.
 */
export function parseLoopLimit(value: string, fallback = 5): number {
  const match = value.match(/(?:--?(?:n|times|limit|max)|循环|轮数)\s*[=:]?\s*(\d{1,2})/i)
  const n = Math.floor(Number(match?.[1] || fallback) || fallback)
  return Math.max(1, Math.min(20, n))
}

/**
 * Strip loop flags from command arguments.
 */
export function stripLoopFlags(value: string): string {
  return value.replace(/(?:--?(?:n|times|limit|max)|循环|轮数)\s*[=:]?\s*\d{1,2}/gi, '').trim()
}
