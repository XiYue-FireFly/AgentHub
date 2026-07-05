export type AddPaletteMatch = { query: string; start: number; end: number }

function replaceLeadingAddToken(current: string, replacement: string): string {
  const match = current.match(/^(\s*)@\S*/)
  if (!match) {
    const prefix = current.trim() ? `${current.trimEnd()} ` : ''
    return `${prefix}${replacement}`.trimStart()
  }
  const leading = match[1] || ''
  const token = replacement.trim()
  const rest = current.slice(match[0].length).replace(/^\s+/, '')
  if (!token) return `${leading}${rest}`.trimStart()
  return `${leading}${token}${rest ? ` ${rest}` : ' '}`.trimStart()
}

export function replaceAddToken(current: string, match: AddPaletteMatch | null, replacement: string): string {
  if (!match) return replaceLeadingAddToken(current, replacement)
  const start = Math.max(0, Math.min(match.start, current.length))
  const end = Math.max(start, Math.min(match.end, current.length))
  const before = current.slice(0, start)
  const after = current.slice(end).replace(/^\s+/, '')
  const token = replacement.trim()
  if (!token) return `${before}${after}`.trimStart()
  const next = `${before}${token}${after ? ` ${after}` : ' '}`
  return before.trim() ? next : next.trimStart()
}

export function slashCommandQuery(value: string, commands: WorkbenchCommand[] = []): string | null {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('/') && !trimmed.startsWith('@')) return null
  if (trimmed.startsWith('@') && !isKnownAgentMentionCommand(trimmed, commands)) return null
  return normalizeCommandToken(trimmed.split(/\s+/, 1)[0] || '').replace(/^\/+/, '').toLowerCase()
}

export function addPaletteQuery(value: string, commands: WorkbenchCommand[] = [], caret = value.length): AddPaletteMatch | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const beforeCaret = value.slice(0, safeCaret)
  const match = beforeCaret.match(/(^|\s)@([^\s]*)$/)
  if (!match) return null
  const query = (match[2] || '').toLowerCase()
  const start = safeCaret - query.length - 1
  const end = safeCaret
  const token = value.slice(start, end)
  const beforeToken = value.slice(0, start)
  const atCommandPosition = beforeToken.trim().length === 0
  if (/^@plugin-[a-z0-9_-]+$/i.test(token)) return null
  if (atCommandPosition && isKnownAgentMentionCommand(token, commands)) return null
  return { query, start, end }
}

export function shouldRunComposerCommand(value: string, commands: WorkbenchCommand[]): boolean {
  const trimmed = value.trimStart()
  if (trimmed.startsWith('/')) return true
  return isKnownAgentMentionCommand(trimmed, commands)
}

function isKnownAgentMentionCommand(value: string, commands: WorkbenchCommand[]): boolean {
  if (!value.trimStart().startsWith('@') || !looksLikeAgentMentionCommand(value)) return false
  const token = normalizeCommandToken(value.trimStart().split(/\s+/, 1)[0] || '')
  return commands.some(command => command.label.toLowerCase() === token)
}

function looksLikeAgentMentionCommand(value: string): boolean {
  const token = value.trimStart().split(/\s+/, 1)[0] || ''
  if (!token.startsWith('@')) return false
  return /^@[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?$/i.test(token)
}

export function normalizeCommandToken(value: string): string {
  const lower = value.toLowerCase()
  if (lower.startsWith('@')) {
    const alias = lower.slice(1)
    return `/agent:${alias === 'minimax-code' ? 'opencode' : alias}`
  }
  if (lower.startsWith('/agent:minimax-code')) return '/agent:opencode'
  if (lower === '/schedule:firefly-custom') return '/schedule:smart-five-role'
  return lower
}

export function commandTextForSelection(currentText: string, command: WorkbenchCommand): string {
  const rawFirstToken = currentText.split(/\s+/, 1)[0] || ''
  const firstToken = normalizeCommandToken(rawFirstToken)
  if (firstToken === command.label.toLowerCase() && currentText.length > rawFirstToken.length) return currentText
  return command.insertText || command.label
}

export function currentTextHasCommandArgs(currentText: string, command: WorkbenchCommand): boolean {
  const rawFirstToken = currentText.split(/\s+/, 1)[0] || ''
  const firstToken = normalizeCommandToken(rawFirstToken)
  return firstToken === command.label.toLowerCase() && currentText.trim().length > rawFirstToken.length
}

export function filterCommands(commands: WorkbenchCommand[], query: string): WorkbenchCommand[] {
  const raw = query.trim().toLowerCase()
  const q = raw.startsWith('agent:') ? raw : raw ? `agent:${raw}` : raw
  if (!q) return commands
  return commands.filter(command => {
    const haystack = [
      command.label,
      command.label.replace(/^\/agent:/, ''),
      command.description,
      command.descriptionZh,
      command.descriptionEn,
      command.category,
      command.source,
      command.payload?.name,
      command.payload?.category,
      Array.isArray(command.payload?.tags) ? command.payload.tags.join(' ') : ''
    ].join(' ').toLowerCase()
    return haystack.includes(raw) || (command.source === 'local-agent' && haystack.includes(q))
  })
}

export function rankCommandsForPalette(commands: WorkbenchCommand[], query: string): WorkbenchCommand[] {
  const q = query.trim().toLowerCase()
  return [...commands].sort((a, b) => commandRank(a, q) - commandRank(b, q))
}

function commandRank(command: WorkbenchCommand, query: string): number {
  const label = command.label.toLowerCase().replace(/^\//, '')
  const exact = query && label === query ? -100 : 0
  const prefix = query && label.startsWith(query) ? -50 : 0
  const source = command.source === 'ecc' ? 0
    : command.category === 'session' ? 100
    : command.category === 'tool' ? 200
    : command.category === 'agent' ? 300
    : command.category === 'skill' ? 400
    : command.category === 'schedule' ? 500
    : 600
  const common = COMMON_COMMAND_ORDER.get(command.label.toLowerCase()) ?? 80
  return exact + prefix + source + common
}

const COMMON_COMMAND_ORDER = new Map<string, number>([
  ['/plan', 0],
  ['/goal', 1],
  ['/loop', 2],
  ['/tdd', 3],
  ['/code-review', 4],
  ['/review', 5],
  ['/verify', 6],
  ['/bug-hunt', 7],
  ['/ui-polish', 8],
  ['/docs', 9],
  ['/research', 10],
  ['/new', 12],
  ['/clear', 13],
  ['/context', 14],
  ['/terminal', 20],
  ['/git', 21],
  ['/browser', 22],
  ['/todo', 23]
])
