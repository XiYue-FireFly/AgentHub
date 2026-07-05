import type { SetupTab } from '../../glass/connection-status'
import type { ViewMode } from '../viewModes'

export type ShortcutSettingsTab = SetupTab | 'shortcuts'
export type ShortcutPanel = 'runs' | 'git' | 'browser' | 'terminal'

export type ShortcutCommandAction =
  | { type: 'toggle-command-palette' }
  | { type: 'focus-composer' }
  | { type: 'stop-task' }
  | { type: 'new-chat' }
  | { type: 'choose-workspace' }
  | { type: 'set-view'; view: ViewMode }
  | { type: 'set-panel'; panel: ShortcutPanel }
  | { type: 'setup'; tab: ShortcutSettingsTab }

export function resolveShortcutCommandAction(commandId: string): ShortcutCommandAction | null {
  switch (commandId) {
    case 'command-palette':
      return { type: 'toggle-command-palette' }
    case 'focus-composer':
      return { type: 'focus-composer' }
    case 'stop-task':
      return { type: 'stop-task' }
    case 'new-chat':
      return { type: 'new-chat' }
    case 'choose-workspace':
      return { type: 'choose-workspace' }
    case 'view-chat':
      return { type: 'set-view', view: 'chat' }
    case 'view-write':
      return { type: 'set-view', view: 'write' }
    case 'view-tasks':
      return { type: 'set-view', view: 'tasks' }
    case 'view-requirements':
      return { type: 'set-view', view: 'requirements' }
    case 'view-settings':
      return { type: 'set-view', view: 'settings' }
    case 'open-workflows':
      return { type: 'set-view', view: 'workflows' }
    case 'panel-runs':
      return { type: 'set-panel', panel: 'runs' }
    case 'panel-git':
      return { type: 'set-panel', panel: 'git' }
    case 'panel-browser':
      return { type: 'set-panel', panel: 'browser' }
    case 'panel-terminal':
      return { type: 'set-panel', panel: 'terminal' }
    case 'settings-shortcuts':
      return { type: 'setup', tab: 'shortcuts' }
    case 'settings-mcp':
      return { type: 'setup', tab: 'mcp' }
    default:
      return null
  }
}
