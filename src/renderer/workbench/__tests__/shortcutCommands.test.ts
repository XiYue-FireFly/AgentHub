import { describe, expect, it } from 'vitest'
import { KEYBOARD_SHORTCUT_COMMANDS } from '../../keyboard-shortcuts'
import { resolveShortcutCommandAction } from '../utils/shortcutCommands'

describe('shortcut command utilities', () => {
  it('resolves command palette and focus commands', () => {
    expect(resolveShortcutCommandAction('command-palette')).toEqual({ type: 'toggle-command-palette' })
    expect(resolveShortcutCommandAction('focus-composer')).toEqual({ type: 'focus-composer' })
    expect(resolveShortcutCommandAction('stop-task')).toEqual({ type: 'stop-task' })
  })

  it('resolves workspace and view commands', () => {
    expect(resolveShortcutCommandAction('new-chat')).toEqual({ type: 'new-chat' })
    expect(resolveShortcutCommandAction('choose-workspace')).toEqual({ type: 'choose-workspace' })
    expect(resolveShortcutCommandAction('view-chat')).toEqual({ type: 'set-view', view: 'chat' })
    expect(resolveShortcutCommandAction('view-write')).toEqual({ type: 'set-view', view: 'write' })
    expect(resolveShortcutCommandAction('view-tasks')).toEqual({ type: 'set-view', view: 'tasks' })
    expect(resolveShortcutCommandAction('view-requirements')).toEqual({ type: 'set-view', view: 'requirements' })
    expect(resolveShortcutCommandAction('view-settings')).toEqual({ type: 'set-view', view: 'settings' })
    expect(resolveShortcutCommandAction('open-workflows')).toEqual({ type: 'set-view', view: 'workflows' })
  })

  it('resolves panel and settings commands', () => {
    expect(resolveShortcutCommandAction('panel-runs')).toEqual({ type: 'set-panel', panel: 'runs' })
    expect(resolveShortcutCommandAction('panel-git')).toEqual({ type: 'set-panel', panel: 'git' })
    expect(resolveShortcutCommandAction('panel-browser')).toEqual({ type: 'set-panel', panel: 'browser' })
    expect(resolveShortcutCommandAction('panel-terminal')).toEqual({ type: 'set-panel', panel: 'terminal' })
    expect(resolveShortcutCommandAction('settings-shortcuts')).toEqual({ type: 'setup', tab: 'shortcuts' })
    expect(resolveShortcutCommandAction('settings-mcp')).toEqual({ type: 'setup', tab: 'mcp' })
  })

  it('ignores unknown commands', () => {
    expect(resolveShortcutCommandAction('missing-command')).toBeNull()
  })

  it('maps every registered keyboard shortcut command', () => {
    const unmapped = KEYBOARD_SHORTCUT_COMMANDS
      .map(command => command.id)
      .filter(commandId => resolveShortcutCommandAction(commandId) === null)

    expect(unmapped).toEqual([])
  })
})
