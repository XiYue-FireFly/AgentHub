import { describe, expect, it } from 'vitest'
import {
  closeTerminalTabState,
  getRememberedWorkspaceTabState,
  rememberWorkspaceTabState,
  type TerminalTab
} from '../terminalTabs'

const tabs: TerminalTab[] = [
  { id: 'main', index: 1 },
  { id: 'tab-2', index: 2 },
  { id: 'tab-3', index: 3 }
]

describe('terminal tab state', () => {
  it('selects the next neighbor when closing the active tab', () => {
    const next = closeTerminalTabState({ tabs, activeTabId: 'tab-2' }, 'tab-2')

    expect(next.tabs.map(tab => tab.id)).toEqual(['main', 'tab-3'])
    expect(next.activeTabId).toBe('tab-3')
  })

  it('keeps the current active tab when closing an inactive tab', () => {
    const next = closeTerminalTabState({ tabs, activeTabId: 'main' }, 'tab-2')

    expect(next.tabs.map(tab => tab.id)).toEqual(['main', 'tab-3'])
    expect(next.activeTabId).toBe('main')
  })

  it('does not close the final tab or missing tabs', () => {
    const single = { tabs: [{ id: 'main', index: 1 }], activeTabId: 'main' }

    expect(closeTerminalTabState(single, 'main')).toBe(single)
    const missing = { tabs, activeTabId: 'main' }
    expect(closeTerminalTabState(missing, 'missing')).toBe(missing)
  })

  it('keeps only a bounded LRU cache of workspace tab states', () => {
    const cache = new Map()
    rememberWorkspaceTabState(cache, 'workspace-a', { tabs: [tabs[0]], activeTabId: 'main' }, 2)
    rememberWorkspaceTabState(cache, 'workspace-b', { tabs: [tabs[1]], activeTabId: 'tab-2' }, 2)
    expect(getRememberedWorkspaceTabState(cache, 'workspace-a')?.activeTabId).toBe('main')

    rememberWorkspaceTabState(cache, 'workspace-c', { tabs: [tabs[2]], activeTabId: 'tab-3' }, 2)

    expect(cache.has('workspace-a')).toBe(true)
    expect(cache.has('workspace-b')).toBe(false)
    expect(cache.has('workspace-c')).toBe(true)
  })
})
