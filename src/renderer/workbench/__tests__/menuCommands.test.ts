import { describe, expect, it } from 'vitest'
import { resolveWorkbenchMenuCommand } from '../utils/menuCommands'

describe('workbench menu command utilities', () => {
  it('resolves top-level menu commands', () => {
    expect(resolveWorkbenchMenuCommand({ action: 'new-thread', params: {} })).toEqual({ type: 'new-thread' })
    expect(resolveWorkbenchMenuCommand({ action: 'open-project', params: {} })).toEqual({ type: 'open-project' })
  })

  it('resolves valid view and panel commands', () => {
    expect(resolveWorkbenchMenuCommand({ action: 'view', params: { view: 'requirements' } })).toEqual({
      type: 'set-view',
      view: 'requirements'
    })
    expect(resolveWorkbenchMenuCommand({ action: 'open-panel', params: { panel: 'git' } })).toEqual({
      type: 'set-panel',
      panel: 'git'
    })
    expect(resolveWorkbenchMenuCommand({ action: 'open-panel', params: { panel: 'worktrees' } })).toEqual({
      type: 'set-panel',
      panel: 'worktrees'
    })
  })

  it('resolves setup commands and preserves the default setup tab behavior', () => {
    expect(resolveWorkbenchMenuCommand({ action: 'setup', params: { tab: 'mcp' } })).toEqual({
      type: 'setup',
      tab: 'mcp'
    })
    expect(resolveWorkbenchMenuCommand({ action: 'setup', params: {} })).toEqual({ type: 'setup', tab: undefined })
  })

  it('ignores unknown or unsupported menu commands', () => {
    expect(resolveWorkbenchMenuCommand(null)).toBeNull()
    expect(resolveWorkbenchMenuCommand({ action: 'missing', params: {} })).toBeNull()
    expect(resolveWorkbenchMenuCommand({ action: 'view', params: { view: 'providers' } })).toBeNull()
    expect(resolveWorkbenchMenuCommand({ action: 'open-panel', params: { panel: 'terminal' } })).toBeNull()
  })
})
