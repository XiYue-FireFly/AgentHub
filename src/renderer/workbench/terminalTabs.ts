export interface TerminalTab {
  id: string
  index: number
  title?: string
}

export interface TerminalTabState {
  tabs: TerminalTab[]
  activeTabId: string
}

export const MAX_WORKSPACE_TAB_STATE_CACHE = 16

export function closeTerminalTabState(state: TerminalTabState, tabId: string): TerminalTabState {
  if (state.tabs.length <= 1) return state
  const closingIndex = state.tabs.findIndex(tab => tab.id === tabId)
  if (closingIndex < 0) return state

  const nextTabs = state.tabs.filter(tab => tab.id !== tabId)
  let nextActiveTabId = state.activeTabId
  if (state.activeTabId === tabId) {
    const nextActive = state.tabs[closingIndex + 1] ?? state.tabs[closingIndex - 1] ?? nextTabs[0]
    nextActiveTabId = nextActive?.id ?? nextTabs[0]?.id ?? state.activeTabId
  }

  if (!nextTabs.some(tab => tab.id === nextActiveTabId)) {
    nextActiveTabId = nextTabs[0]?.id ?? state.activeTabId
  }

  return { tabs: nextTabs, activeTabId: nextActiveTabId }
}

export function rememberWorkspaceTabState(
  cache: Map<string, TerminalTabState>,
  key: string,
  state: TerminalTabState,
  maxEntries = MAX_WORKSPACE_TAB_STATE_CACHE
): void {
  cache.delete(key)
  cache.set(key, cloneTerminalTabState(state))
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (typeof oldest !== 'string') break
    cache.delete(oldest)
  }
}

export function getRememberedWorkspaceTabState(
  cache: Map<string, TerminalTabState>,
  key: string
): TerminalTabState | undefined {
  const state = cache.get(key)
  if (!state) return undefined
  cache.delete(key)
  cache.set(key, state)
  return cloneTerminalTabState(state)
}

function cloneTerminalTabState(state: TerminalTabState): TerminalTabState {
  return {
    tabs: state.tabs.map(tab => ({ ...tab })),
    activeTabId: state.activeTabId
  }
}
