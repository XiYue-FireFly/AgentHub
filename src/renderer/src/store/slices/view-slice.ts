import { StateCreator } from 'zustand'

export type ViewMode = 'chat' | 'write' | 'tasks' | 'settings' | 'workflows' | 'requirements'
export type SettingsTabKey = 'providers' | 'local-agents' | 'routing' | 'mcp' | 'appearance' | 'memory' | 'updates' | 'shortcuts' | 'models' | 'plugins' | 'usage' | 'approvals' | 'workspaces' | 'skills' | 'agentLoop' | 'requirements' | 'diagnostics'
export type RightPanel = 'runs' | 'git' | 'worktrees' | 'browser' | 'terminal' | 'files' | 'side-chat' | null

export interface ViewState {
  view: ViewMode
  settingsTab: SettingsTabKey
  rightPanel: RightPanel
}

export interface ViewActions {
  setView: (view: ViewMode) => void
  setSettingsTab: (tab: SettingsTabKey) => void
  setRightPanel: (panel: RightPanel) => void
}

export type ViewSlice = ViewState & ViewActions

export const createViewSlice: StateCreator<ViewSlice, [['zustand/immer', never]], [], ViewSlice> = (set) => ({
  view: 'chat',
  settingsTab: 'providers',
  rightPanel: null,

  setView: (view) => set((state) => { state.view = view }),
  setSettingsTab: (tab) => set((state) => { state.settingsTab = tab }),
  setRightPanel: (panel) => set((state) => { state.rightPanel = panel }),
})
