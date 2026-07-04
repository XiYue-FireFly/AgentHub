import type { WorkbenchSettingsTabKey } from '../NativeTitlebar'
import { isWorkbenchViewMode, type ViewMode } from '../viewModes'

export type WorkbenchMenuCommandLink = {
  action?: string
  params?: Record<string, string>
}

export type WorkbenchMenuCommandAction =
  | { type: 'new-thread' }
  | { type: 'open-project' }
  | { type: 'set-view'; view: ViewMode }
  | { type: 'set-panel'; panel: MenuPanel }
  | { type: 'setup'; tab?: WorkbenchSettingsTabKey }

type MenuPanel = 'runs' | 'git' | 'worktrees' | 'browser'

const MENU_PANELS = new Set<string>(['runs', 'git', 'worktrees', 'browser'])

function isMenuPanel(value: string | undefined): value is MenuPanel {
  return !!value && MENU_PANELS.has(value)
}

export function resolveWorkbenchMenuCommand(link: WorkbenchMenuCommandLink | null | undefined): WorkbenchMenuCommandAction | null {
  const action = link?.action
  const params = link?.params || {}
  if (action === 'new-thread') return { type: 'new-thread' }
  if (action === 'open-project') return { type: 'open-project' }
  if (action === 'view' && isWorkbenchViewMode(params.view)) {
    return { type: 'set-view', view: params.view }
  }
  if (action === 'open-panel' && isMenuPanel(params.panel)) {
    return { type: 'set-panel', panel: params.panel }
  }
  if (action === 'setup') {
    return { type: 'setup', tab: params.tab as WorkbenchSettingsTabKey }
  }
  return null
}
