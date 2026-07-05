import { describe, expect, it } from 'vitest'
import {
  findKeyboardShortcutCommand,
  findKeyboardShortcutConflict,
  keyboardEventToShortcut,
  KEYBOARD_SHORTCUT_COMMANDS,
  normalizeKeyboardShortcuts,
  normalizeKeyboardShortcut,
  resolveKeyboardShortcutBindings
} from '../../keyboard-shortcuts'

describe('keyboard shortcuts', () => {
  it('normalizes common shortcut strings', () => {
    expect(normalizeKeyboardShortcut('control + shift + g')).toBe('Ctrl+Shift+G')
    expect(normalizeKeyboardShortcut('ctrl++')).toBe('Ctrl++')
    expect(normalizeKeyboardShortcut('ctrl+=')).toBe('Ctrl++')
    expect(normalizeKeyboardShortcut('ctrl+shift++')).toBe('Ctrl++')
  })

  it('converts keyboard events to shortcut strings', () => {
    expect(keyboardEventToShortcut({ key: 'g', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+G')
    expect(keyboardEventToShortcut({ key: '=', ctrlKey: true })).toBe('Ctrl++')
    expect(keyboardEventToShortcut({ key: 'Shift', shiftKey: true })).toBeNull()
  })

  it('uses defaults and detects conflicts', () => {
    const bindings = resolveKeyboardShortcutBindings(normalizeKeyboardShortcuts({
      bindings: {
        'panel-git': ['Ctrl+Alt+G'],
        unknown: ['Ctrl+Shift+X']
      } as Record<string, string[]>
    }))

    expect(bindings['panel-git']).toEqual(['Ctrl+Alt+G'])
    expect(bindings['new-chat']).toEqual(['Ctrl+N'])
    expect(findKeyboardShortcutCommand(bindings, 'Ctrl+Alt+G')).toBe('panel-git')
    expect(findKeyboardShortcutCommand(bindings, 'Ctrl+Shift+X')).toBeNull()
    expect(findKeyboardShortcutConflict(bindings, 'view-chat', 'Ctrl+Alt+G')).toBe('panel-git')
  })

  it('exposes requirements as a first-class workbench shortcut', () => {
    const commandIds = KEYBOARD_SHORTCUT_COMMANDS.map(command => command.id)
    const bindings = resolveKeyboardShortcutBindings()

    expect(commandIds).toContain('view-requirements')
    expect(findKeyboardShortcutCommand(bindings, 'Ctrl+4')).toBe('view-requirements')
    expect(findKeyboardShortcutCommand(bindings, 'Ctrl+5')).toBe('view-settings')
  })
})
