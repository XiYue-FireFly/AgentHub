import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { useShallow } from 'zustand/react/shallow'

import { createViewSlice, ViewSlice } from './slices/view-slice'
import { createThreadSlice, ThreadSlice } from './slices/thread-slice'
import { createRuntimeSlice, RuntimeSlice } from './slices/runtime-slice'
import { createAgentSlice, AgentSlice } from './slices/agent-slice'
import { createUISlice, UISlice } from './slices/ui-slice'

// Re-export types for backward compatibility
export type { ViewMode, SettingsTabKey, RightPanel } from './slices/view-slice'
export type { WorkbenchThread, WorkbenchTurn, WorkbenchRun, WorkbenchSnapshot } from './slices/thread-slice'
export type { RuntimeEvent, TerminalRun } from './slices/runtime-slice'
export type { ThinkingLevel, DispatchPreset, WorkbenchThinking, ModelSelection, LocalAgentStatus, SchedulePreview } from './slices/agent-slice'
export type { WorkbenchAttachment, WorkbenchGoal, ThreadTodo, KeyboardShortcutsConfigV1 } from './slices/ui-slice'

// Combined store type
export type WorkbenchState = ViewSlice & ThreadSlice & RuntimeSlice & AgentSlice & UISlice & {
  reset: () => void
}

// Create combined store
export const useWorkbenchStore = create<WorkbenchState>()(
  devtools(
    persist(
      immer((...args) => ({
        ...createViewSlice(...args as Parameters<typeof createViewSlice>),
        ...createThreadSlice(...args as Parameters<typeof createThreadSlice>),
        ...createRuntimeSlice(...args as Parameters<typeof createRuntimeSlice>),
        ...createAgentSlice(...args as Parameters<typeof createAgentSlice>),
        ...createUISlice(...args as Parameters<typeof createUISlice>),

        // Reset action for lifecycle management
        reset: () => args[0]((state) => {
          // Clear runtime/transient state
          state.snapshot = { threads: [], turns: [], runs: [], activeThreadId: null }
          state.allThreads = []
          state.events = []
          state.sending = false
          state.threadTodos = []
          state.terminalRuns = []
          state.activeGoal = null
          state.sendError = null
          state.pendingComposerAttachments = []
          state.pendingBrowserUrl = null
          state.projectDialogOpen = false
          state.projectDraft = { name: '', rootPath: '' }
          state.projectError = null
          state.search = ''
          state.workspaces = []
          state.workspaceId = null
          state.mode = 'lead-workers'
          state.targetAgent = null
          state.modelSelection = null
          state.localAgents = []
          state.schedules = []
          // Preserve user preferences: view, settingsTab, thinking, keyboardShortcuts, customSchedule, smartSchedule, scheduleOverrides, inspectorWidth
        }),
      })),
      {
        name: 'workbench-store',
        version: 1,
        migrate: (persistedState, version) => {
          // Handle future schema changes
          return persistedState as WorkbenchState
        },
        partialize: (state) => ({
          view: state.view,
          settingsTab: state.settingsTab,
          selectedThreadId: state.selectedThreadId,
          mode: state.mode,
          thinking: state.thinking,
          customSchedule: state.customSchedule,
          smartSchedule: state.smartSchedule,
          scheduleOverrides: state.scheduleOverrides,
          inspectorWidth: state.inspectorWidth,
          keyboardShortcuts: state.keyboardShortcuts,
        }),
      }
    ),
    { name: 'workbench-store' }
  )
)

// Selector hooks for better performance
// Primitive selectors - no shallow needed
export const useViewMode = () => useWorkbenchStore((state) => state.view)
export const useSelectedThreadId = () => useWorkbenchStore((state) => state.selectedThreadId)
export const useSending = () => useWorkbenchStore((state) => state.sending)
export const useMode = () => useWorkbenchStore((state) => state.mode)
export const useTargetAgent = () => useWorkbenchStore((state) => state.targetAgent)
export const useSearch = () => useWorkbenchStore((state) => state.search)
export const useRightPanel = () => useWorkbenchStore((state) => state.rightPanel)
export const useWorkspaceId = () => useWorkbenchStore((state) => state.workspaceId)
export const useAnnouncementOpen = () => useWorkbenchStore((state) => state.announcementOpen)
export const usePendingBrowserUrl = () => useWorkbenchStore((state) => state.pendingBrowserUrl)
export const useSendError = () => useWorkbenchStore((state) => state.sendError)
export const useProjectDialogOpen = () => useWorkbenchStore((state) => state.projectDialogOpen)
export const useProjectError = () => useWorkbenchStore((state) => state.projectError)
export const useViewportWidth = () => useWorkbenchStore((state) => state.viewportWidth)

// Object/array selectors - use useShallow for performance (Zustand v5 pattern)
export const useAllThreads = () => useWorkbenchStore(useShallow((state) => state.allThreads))
export const useEvents = () => useWorkbenchStore(useShallow((state) => state.events))
export const useModelSelection = () => useWorkbenchStore(useShallow((state) => state.modelSelection))
export const useThinking = () => useWorkbenchStore(useShallow((state) => state.thinking))
export const useLocalAgents = () => useWorkbenchStore(useShallow((state) => state.localAgents))
export const useActiveGoal = () => useWorkbenchStore(useShallow((state) => state.activeGoal))
export const useThreadTodos = () => useWorkbenchStore(useShallow((state) => state.threadTodos))
export const useTerminalRuns = () => useWorkbenchStore(useShallow((state) => state.terminalRuns))
export const usePendingComposerAttachments = () => useWorkbenchStore(useShallow((state) => state.pendingComposerAttachments))
export const useWorkspaces = () => useWorkbenchStore(useShallow((state) => state.workspaces))
export const useSnapshot = () => useWorkbenchStore(useShallow((state) => state.snapshot))
export const useKeyboardShortcuts = () => useWorkbenchStore(useShallow((state) => state.keyboardShortcuts))
export const useProjectDraft = () => useWorkbenchStore(useShallow((state) => state.projectDraft))
export const useCustomSchedule = () => useWorkbenchStore(useShallow((state) => state.customSchedule))
export const useSmartSchedule = () => useWorkbenchStore(useShallow((state) => state.smartSchedule))
export const useSchedules = () => useWorkbenchStore(useShallow((state) => state.schedules))
export const useScheduleOverrides = () => useWorkbenchStore(useShallow((state) => state.scheduleOverrides))

// Derived selector hooks with useShallow
export const useCurrentThreadTodos = () =>
  useWorkbenchStore(
    useShallow((state) => state.threadTodos.filter(t => t.threadId === state.selectedThreadId))
  )

export const useCurrentThreadEvents = () =>
  useWorkbenchStore(
    useShallow((state) => state.events.filter(e => e.threadId === state.selectedThreadId))
  )
