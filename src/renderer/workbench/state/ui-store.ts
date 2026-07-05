import { create } from 'zustand'
import type { WorkbenchRightPanel, WorkbenchSettingsTabKey } from '../NativeTitlebar'
import { DEFAULT_INSPECTOR_WIDTH, clampInspectorWidth } from '../WorkbenchPanels'
import { isWorkbenchViewMode, type ViewMode } from '../viewModes'

export type WorkbenchUiSettingsTabKey = WorkbenchSettingsTabKey

export const INSPECTOR_WIDTH_STORE_KEY = 'agenthub.workbench.inspectorWidth.v1'
export const LAST_VIEW_STORE_KEY = 'agenthub.workbench.lastView.v1'
export const ANNOUNCEMENT_STORE_KEY = 'agenthub.workbench.announcement.v0.5.4'

type Updater<T> = T | ((previous: T) => T)

interface WorkbenchUiState {
  view: ViewMode
  settingsTab: WorkbenchUiSettingsTabKey
  rightPanel: WorkbenchRightPanel
  inspectorWidth: number
  announcementOpen: boolean
  commandPaletteOpen: boolean
}

interface WorkbenchUiActions {
  setView: (view: ViewMode) => void
  applyStartupView: (startupOpenTarget: string | undefined) => void
  setSettingsTab: (tab: WorkbenchUiSettingsTabKey) => void
  setRightPanel: (panel: WorkbenchRightPanel) => void
  setInspectorWidth: (width: number, viewportWidth?: number) => void
  hydrateInspectorWidth: (value: unknown, viewportWidth?: number) => void
  setCommandPaletteOpen: (next: Updater<boolean>) => void
  setAnnouncementOpen: (open: boolean) => void
  closeAnnouncement: () => void
}

export type WorkbenchUiStore = WorkbenchUiState & WorkbenchUiActions

function readInitialAnnouncementOpen(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(ANNOUNCEMENT_STORE_KEY) !== 'seen'
  } catch {
    return true
  }
}

function persistLastView(view: ViewMode): void {
  try { localStorage.setItem(LAST_VIEW_STORE_KEY, view) } catch { /* noop */ }
}

function markAnnouncementSeen(): void {
  try { localStorage.setItem(ANNOUNCEMENT_STORE_KEY, 'seen') } catch { /* noop */ }
}

function resolveUpdater<T>(current: T, updater: Updater<T>): T {
  return typeof updater === 'function' ? (updater as (previous: T) => T)(current) : updater
}

export const useWorkbenchUiStore = create<WorkbenchUiStore>()((set) => ({
  view: 'chat',
  settingsTab: 'providers',
  rightPanel: null,
  inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
  announcementOpen: readInitialAnnouncementOpen(),
  commandPaletteOpen: false,

  setView: (view) => {
    persistLastView(view)
    set({ view })
  },

  applyStartupView: (startupOpenTarget) => {
    if (startupOpenTarget === 'settings') {
      persistLastView('settings')
      set({ settingsTab: 'appearance', view: 'settings' })
      return
    }

    if (startupOpenTarget === 'last') {
      let view: ViewMode = 'chat'
      try {
        const saved = localStorage.getItem(LAST_VIEW_STORE_KEY)
        if (isWorkbenchViewMode(saved)) view = saved
      } catch { /* noop */ }
      persistLastView(view)
      set({ view })
      return
    }

    set({ view: 'chat' })
  },

  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setInspectorWidth: (width, viewportWidth) => set({ inspectorWidth: clampInspectorWidth(width, viewportWidth) }),
  hydrateInspectorWidth: (value, viewportWidth) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      set({ inspectorWidth: clampInspectorWidth(value, viewportWidth) })
    }
  },
  setCommandPaletteOpen: (next) => set(state => ({ commandPaletteOpen: resolveUpdater(state.commandPaletteOpen, next) })),
  setAnnouncementOpen: (announcementOpen) => set({ announcementOpen }),
  closeAnnouncement: () => {
    markAnnouncementSeen()
    set({ announcementOpen: false })
  }
}))

export function resetWorkbenchUiStoreForTests(): void {
  useWorkbenchUiStore.setState({
    view: 'chat',
    settingsTab: 'providers',
    rightPanel: null,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    announcementOpen: readInitialAnnouncementOpen(),
    commandPaletteOpen: false
  })
}
