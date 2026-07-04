export const KEYBOARD_SHORTCUT_STORE_KEY = 'agenthub.keyboardShortcuts.v1'
export const KEYBOARD_SHORTCUTS_CHANGED = 'agenthub:keyboard-shortcuts-change'

export const KEYBOARD_SHORTCUT_COMMANDS = [
  {
    id: 'new-chat',
    labelZh: '\u65b0\u5efa\u5bf9\u8bdd',
    labelEn: 'New chat',
    descriptionZh: '\u5728\u5f53\u524d\u5de5\u4f5c\u76ee\u5f55\u4e2d\u521b\u5efa\u65b0\u4f1a\u8bdd',
    descriptionEn: 'Create a new chat in the current workspace.',
    defaultBindings: ['Ctrl+N']
  },
  {
    id: 'choose-workspace',
    labelZh: '\u6dfb\u52a0\u5de5\u4f5c\u76ee\u5f55',
    labelEn: 'Add working folder',
    descriptionZh: '\u6253\u5f00\u5de5\u4f5c\u76ee\u5f55\u9009\u62e9\u7a97\u53e3',
    descriptionEn: 'Open the working-folder picker.',
    defaultBindings: ['Ctrl+O']
  },
  {
    id: 'view-chat',
    labelZh: '\u5207\u6362\u5230\u5bf9\u8bdd',
    labelEn: 'Open chat',
    descriptionZh: '\u56de\u5230\u4e3b\u5bf9\u8bdd\u5de5\u4f5c\u53f0',
    descriptionEn: 'Switch to the chat workbench.',
    defaultBindings: ['Ctrl+1']
  },
  {
    id: 'view-write',
    labelZh: '\u5207\u6362\u5230\u5199\u4f5c',
    labelEn: 'Open writing',
    descriptionZh: '\u6253\u5f00\u5199\u4f5c\u5de5\u4f5c\u53f0',
    descriptionEn: 'Switch to the writing workspace.',
    defaultBindings: ['Ctrl+2']
  },
  {
    id: 'view-tasks',
    labelZh: '\u5207\u6362\u5230\u4efb\u52a1',
    labelEn: 'Open tasks',
    descriptionZh: '\u67e5\u770b\u4efb\u52a1\u548c\u5386\u53f2\u8bb0\u5f55',
    descriptionEn: 'Open tasks and history.',
    defaultBindings: ['Ctrl+3']
  },
  {
    id: 'view-requirements',
    labelZh: '\u6253\u5f00\u9700\u6c42',
    labelEn: 'Open requirements',
    descriptionZh: '\u6253\u5f00\u9700\u6c42\u6587\u6863\u548c SDD \u52a9\u624b',
    descriptionEn: 'Open requirements documents and the SDD assistant.',
    defaultBindings: ['Ctrl+4']
  },
  {
    id: 'view-settings',
    labelZh: '\u5207\u6362\u5230\u8bbe\u7f6e',
    labelEn: 'Open settings',
    descriptionZh: '\u6253\u5f00\u8bbe\u7f6e\u9875',
    descriptionEn: 'Open Settings.',
    defaultBindings: ['Ctrl+5']
  },
  {
    id: 'panel-runs',
    labelZh: '\u6253\u5f00\u8fd0\u884c\u9762\u677f',
    labelEn: 'Open runs panel',
    descriptionZh: '\u67e5\u770b\u8fd0\u884c\u8282\u70b9\u3001\u8c03\u5ea6\u548c Agent \u72b6\u6001',
    descriptionEn: 'Open run nodes, schedules, and agent status.',
    defaultBindings: ['Ctrl+Shift+R']
  },
  {
    id: 'panel-git',
    labelZh: '\u6253\u5f00 Git \u9762\u677f',
    labelEn: 'Open Git panel',
    descriptionZh: '\u67e5\u770b Git \u53d8\u66f4\u3001\u5206\u652f\u3001diff \u548c\u63d0\u4ea4',
    descriptionEn: 'Open Git changes, branches, diffs, and commits.',
    defaultBindings: ['Ctrl+Shift+G']
  },
  {
    id: 'panel-browser',
    labelZh: '\u6253\u5f00\u6d4f\u89c8\u5668\u9762\u677f',
    labelEn: 'Open browser panel',
    descriptionZh: '\u6253\u5f00\u5185\u7f6e\u6d4f\u89c8\u5668\u548c\u6293\u53d6\u5de5\u5177',
    descriptionEn: 'Open the browser and capture tools.',
    defaultBindings: ['Ctrl+Shift+B']
  },
  {
    id: 'settings-shortcuts',
    labelZh: '\u6253\u5f00\u5feb\u6377\u952e\u8bbe\u7f6e',
    labelEn: 'Open shortcuts settings',
    descriptionZh: '\u7ba1\u7406\u6240\u6709\u5de5\u4f5c\u53f0\u5feb\u6377\u952e',
    descriptionEn: 'Manage all workbench shortcuts.',
    defaultBindings: ['Ctrl+Shift+K']
  },
  {
    id: 'settings-mcp',
    labelZh: '\u6253\u5f00 MCP \u8bbe\u7f6e',
    labelEn: 'Open MCP settings',
    descriptionZh: '\u6253\u5f00 MCP \u670d\u52a1\u5668\u7ba1\u7406\u9875',
    descriptionEn: 'Open MCP server settings.',
    defaultBindings: ['Ctrl+Shift+M']
  },
  {
    id: 'command-palette',
    labelZh: '\u547d\u4ee4\u9762\u677f',
    labelEn: 'Command palette',
    descriptionZh: '\u6253\u5f00\u5168\u5c40\u547d\u4ee4\u641c\u7d22\u9762\u677f',
    descriptionEn: 'Open the global command search palette.',
    defaultBindings: ['Ctrl+Shift+P']
  },
  {
    id: 'stop-task',
    labelZh: '\u505c\u6b62\u5f53\u524d\u4efb\u52a1',
    labelEn: 'Stop current task',
    descriptionZh: '\u505c\u6b62\u6b63\u5728\u8fd0\u884c\u7684\u4efb\u52a1',
    descriptionEn: 'Stop the currently running task.',
    defaultBindings: ['Ctrl+Shift+Escape']
  },
  {
    id: 'focus-composer',
    labelZh: '\u805a\u7126\u8f93\u5165\u6846',
    labelEn: 'Focus composer',
    descriptionZh: '\u5c06\u7126\u70b9\u79fb\u5230\u5e95\u90e8\u8f93\u5165\u6846',
    descriptionEn: 'Move focus to the bottom composer input.',
    defaultBindings: ['Ctrl+L']
  },
  {
    id: 'open-workflows',
    labelZh: '\u6253\u5f00\u5de5\u4f5c\u6d41',
    labelEn: 'Open workflows',
    descriptionZh: '\u6253\u5f00\u5de5\u4f5c\u6d41\u7ba1\u7406\u9762\u677f',
    descriptionEn: 'Open the workflows panel.',
    defaultBindings: ['Ctrl+Shift+W']
  }
] as const

export type KeyboardShortcutCommand = typeof KEYBOARD_SHORTCUT_COMMANDS[number]
export type KeyboardShortcutCommandId = KeyboardShortcutCommand['id']
export type KeyboardShortcutBindingsV1 = Partial<Record<KeyboardShortcutCommandId, string[]>>
export type KeyboardShortcutsConfigV1 = {
  bindings: KeyboardShortcutBindingsV1
}

export type KeyboardShortcutEventLike = {
  key: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

const COMMAND_IDS = new Set<string>(KEYBOARD_SHORTCUT_COMMANDS.map(command => command.id))
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const MODIFIER_LABELS: Record<string, 'Ctrl' | 'Shift' | 'Alt' | 'Meta'> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta'
}

export function defaultKeyboardShortcuts(): KeyboardShortcutsConfigV1 {
  return { bindings: {} }
}

export function normalizeKeyboardShortcuts(settings?: Partial<KeyboardShortcutsConfigV1> | null): KeyboardShortcutsConfigV1 {
  const bindings: KeyboardShortcutBindingsV1 = {}
  const rawBindings = settings?.bindings
  if (!rawBindings || typeof rawBindings !== 'object') return { bindings }

  for (const [rawCommandId, rawShortcuts] of Object.entries(rawBindings)) {
    if (!COMMAND_IDS.has(rawCommandId) || !Array.isArray(rawShortcuts)) continue
    const shortcuts = rawShortcuts
      .map(shortcut => normalizeKeyboardShortcut(shortcut))
      .filter((shortcut): shortcut is string => shortcut !== null)
      .filter((shortcut, index, list) => list.indexOf(shortcut) === index)
      .slice(0, 4)
    if (shortcuts.length > 0) bindings[rawCommandId as KeyboardShortcutCommandId] = shortcuts
  }

  return { bindings }
}

export function resolveKeyboardShortcutBindings(settings?: Partial<KeyboardShortcutsConfigV1> | null): Required<KeyboardShortcutBindingsV1> {
  const normalized = normalizeKeyboardShortcuts(settings)
  const bindings: Required<KeyboardShortcutBindingsV1> = {} as Required<KeyboardShortcutBindingsV1>
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    const configured = normalized.bindings[command.id]
    bindings[command.id] = configured && configured.length > 0 ? configured : [...command.defaultBindings]
  }
  return bindings
}

export function normalizeKeyboardShortcut(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null

  const split = raw.split('+')
  let key = split.pop() ?? ''
  if (!key && raw.endsWith('+')) key = '+'
  const modifiers = split
    .map(part => MODIFIER_LABELS[part.trim().toLowerCase()])
    .filter((part): part is 'Ctrl' | 'Shift' | 'Alt' | 'Meta' => Boolean(part))

  const normalizedKey = normalizeShortcutKey(key)
  if (!normalizedKey || MODIFIER_KEYS.has(normalizedKey)) return null
  const orderedModifiers = ['Ctrl', 'Shift', 'Alt', 'Meta']
    .filter(modifier =>
      modifiers.includes(modifier as 'Ctrl' | 'Shift' | 'Alt' | 'Meta') &&
      !(normalizedKey === '+' && modifier === 'Shift')
    )
  return [...orderedModifiers, normalizedKey].join('+')
}

export function keyboardEventToShortcut(event: KeyboardShortcutEventLike): string | null {
  const key = normalizeShortcutKey(event.key)
  if (!key || MODIFIER_KEYS.has(key)) return null
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.shiftKey && key !== '+' ? 'Shift' : '',
    event.altKey ? 'Alt' : '',
    event.metaKey ? 'Meta' : ''
  ].filter(Boolean)
  return [...modifiers, key].join('+')
}

export function findKeyboardShortcutCommand(
  bindings: Required<KeyboardShortcutBindingsV1>,
  shortcut: string | null
): KeyboardShortcutCommandId | null {
  if (!shortcut) return null
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    if (bindings[command.id].includes(shortcut)) return command.id
  }
  return null
}

export function findKeyboardShortcutConflict(
  bindings: Required<KeyboardShortcutBindingsV1>,
  commandId: KeyboardShortcutCommandId,
  shortcut: string
): KeyboardShortcutCommandId | null {
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    if (command.id === commandId) continue
    if (bindings[command.id].includes(shortcut)) return command.id
  }
  return null
}

export function shortcutDisplay(shortcuts?: string[]): string {
  return shortcuts?.[0] || ''
}

function normalizeShortcutKey(rawKey: string): string | null {
  const key = rawKey.trim()
  if (!key) return null
  if (key === ' ') return 'Space'
  if (key === '=') return '+'
  if (key.length === 1) return key.toUpperCase()
  const lower = key.toLowerCase()
  if (lower === 'esc') return 'Escape'
  if (lower === 'arrowup') return 'ArrowUp'
  if (lower === 'arrowdown') return 'ArrowDown'
  if (lower === 'arrowleft') return 'ArrowLeft'
  if (lower === 'arrowright') return 'ArrowRight'
  if (lower === 'plus') return '+'
  if (lower === 'minus') return '-'
  if (lower === 'comma') return ','
  if (lower.startsWith('f') && /^f\d{1,2}$/.test(lower)) return lower.toUpperCase()
  return key[0].toUpperCase() + key.slice(1)
}
