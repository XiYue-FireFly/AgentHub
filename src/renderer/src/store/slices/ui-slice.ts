import { StateCreator } from 'zustand'

const MIN_INSPECTOR_WIDTH = 200
const MAX_INSPECTOR_WIDTH = 1200

export interface WorkbenchAttachment {
  id: string
  name: string
  type: string
  size: number
  path?: string
  dataUrl?: string
}

export interface WorkbenchGoal {
  id: string
  text: string
  status: 'active' | 'completed' | 'cancelled'
}

export interface ThreadTodo {
  id: string
  text: string
  done: boolean
  threadId: string
}

export interface KeyboardShortcutsConfigV1 {
  bindings: Record<string, string[]>
}

export interface UIState {
  search: string
  inspectorWidth: number
  viewportWidth: number
  pendingComposerAttachments: WorkbenchAttachment[]
  pendingBrowserUrl: string | null
  announcementOpen: boolean
  keyboardShortcuts: KeyboardShortcutsConfigV1
  sendError: string | null
  projectDialogOpen: boolean
  projectDraft: { name: string; rootPath: string }
  projectError: string | null
  activeGoal: WorkbenchGoal | null
  threadTodos: ThreadTodo[]
  workspaces: Array<{ id: string; name: string; rootPath: string }>
  workspaceId: string | null
}

export interface UIActions {
  setSearch: (search: string) => void
  setInspectorWidth: (width: number) => void
  setViewportWidth: (width: number) => void
  setPendingComposerAttachments: (attachments: WorkbenchAttachment[]) => void
  setPendingBrowserUrl: (url: string | null) => void
  setAnnouncementOpen: (open: boolean) => void
  setKeyboardShortcuts: (config: KeyboardShortcutsConfigV1) => void
  setSendError: (error: string | null) => void
  setProjectDialogOpen: (open: boolean) => void
  setProjectDraft: (draft: { name: string; rootPath: string }) => void
  setProjectError: (error: string | null) => void
  setActiveGoal: (goal: WorkbenchGoal | null) => void
  setThreadTodos: (todos: ThreadTodo[] | ((prev: ThreadTodo[]) => ThreadTodo[])) => void
  setWorkspaces: (workspaces: Array<{ id: string; name: string; rootPath: string }>) => void
  setWorkspaceId: (id: string | null) => void
  addAttachment: (attachment: WorkbenchAttachment) => void
  removeAttachment: (id: string) => void
  addTodo: (todo: ThreadTodo) => void
  updateTodo: (id: string, updates: Partial<ThreadTodo>) => void
  deleteTodo: (id: string) => void
}

export type UISlice = UIState & UIActions

export const createUISlice: StateCreator<UISlice, [['zustand/immer', never]], [], UISlice> = (set) => ({
  search: '',
  inspectorWidth: 460,
  viewportWidth: typeof window === 'undefined' ? 1280 : window.innerWidth,
  pendingComposerAttachments: [],
  pendingBrowserUrl: null,
  announcementOpen: true,
  keyboardShortcuts: { bindings: {} },
  sendError: null,
  projectDialogOpen: false,
  projectDraft: { name: '', rootPath: '' },
  projectError: null,
  activeGoal: null,
  threadTodos: [],
  workspaces: [],
  workspaceId: null,

  setSearch: (search) => set((state) => { state.search = search }),
  setInspectorWidth: (width) => set((state) => {
    state.inspectorWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(width, MAX_INSPECTOR_WIDTH))
  }),
  setViewportWidth: (width) => set((state) => { state.viewportWidth = width }),
  setPendingComposerAttachments: (attachments) => set((state) => { state.pendingComposerAttachments = attachments }),
  setPendingBrowserUrl: (url) => set((state) => { state.pendingBrowserUrl = url }),
  setAnnouncementOpen: (open) => set((state) => { state.announcementOpen = open }),
  setKeyboardShortcuts: (config) => set((state) => { state.keyboardShortcuts = config }),
  setSendError: (error) => set((state) => { state.sendError = error }),
  setProjectDialogOpen: (open) => set((state) => { state.projectDialogOpen = open }),
  setProjectDraft: (draft) => set((state) => { state.projectDraft = draft }),
  setProjectError: (error) => set((state) => { state.projectError = error }),
  setActiveGoal: (goal) => set((state) => { state.activeGoal = goal }),
  setThreadTodos: (todos) => set((state) => {
    state.threadTodos = typeof todos === 'function' ? todos(state.threadTodos) : todos
  }),
  setWorkspaces: (workspaces) => set((state) => { state.workspaces = workspaces }),
  setWorkspaceId: (id) => set((state) => { state.workspaceId = id }),
  addAttachment: (attachment) => set((state) => { state.pendingComposerAttachments.push(attachment) }),
  removeAttachment: (id) => set((state) => {
    state.pendingComposerAttachments = state.pendingComposerAttachments.filter(a => a.id !== id)
  }),
  addTodo: (todo) => set((state) => { state.threadTodos.push(todo) }),
  updateTodo: (id, updates) => set((state) => {
    const index = state.threadTodos.findIndex(t => t.id === id)
    if (index !== -1) {
      state.threadTodos[index] = { ...state.threadTodos[index], ...updates }
    }
  }),
  deleteTodo: (id) => set((state) => {
    state.threadTodos = state.threadTodos.filter(t => t.id !== id)
  }),
})
