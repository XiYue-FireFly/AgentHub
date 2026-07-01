import { StateCreator } from 'zustand'

export interface WorkbenchThread {
  id: string
  title: string
  workspaceId?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
}

export interface WorkbenchTurn {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  agentId?: string
  timestamp: number
}

export interface WorkbenchRun {
  id: string
  turnId: string
  agentId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: string
  error?: string
  startTime: number
  endTime?: number
}

export interface WorkbenchSnapshot {
  threads: WorkbenchThread[]
  turns: WorkbenchTurn[]
  runs: WorkbenchRun[]
  activeThreadId: string | null
}

export interface ThreadState {
  snapshot: WorkbenchSnapshot
  selectedThreadId: string | null
  allThreads: WorkbenchThread[]
}

export interface ThreadActions {
  setSelectedThreadId: (threadId: string | null) => void
  setAllThreads: (threads: WorkbenchThread[]) => void
  setSnapshot: (snapshot: WorkbenchSnapshot | ((prev: WorkbenchSnapshot) => WorkbenchSnapshot)) => void
  addThread: (thread: WorkbenchThread) => void
  updateThread: (id: string, updates: Partial<WorkbenchThread>) => void
  deleteThread: (id: string) => void
}

export type ThreadSlice = ThreadState & ThreadActions

export const createThreadSlice: StateCreator<ThreadSlice, [['zustand/immer', never]], [], ThreadSlice> = (set) => ({
  snapshot: { threads: [], turns: [], runs: [], activeThreadId: null },
  selectedThreadId: null,
  allThreads: [],

  setSelectedThreadId: (threadId) => set((state) => { state.selectedThreadId = threadId }),
  setAllThreads: (threads) => set((state) => { state.allThreads = threads }),
  setSnapshot: (snapshot) => set((state) => {
    state.snapshot = typeof snapshot === 'function' ? snapshot(state.snapshot) : snapshot
  }),
  addThread: (thread) => set((state) => { state.allThreads.push(thread) }),
  updateThread: (id, updates) => set((state) => {
    const index = state.allThreads.findIndex(t => t.id === id)
    if (index !== -1) {
      state.allThreads[index] = { ...state.allThreads[index], ...updates }
    }
  }),
  deleteThread: (id) => set((state) => {
    state.allThreads = state.allThreads.filter(t => t.id !== id)
    if (state.selectedThreadId === id) {
      state.selectedThreadId = null
    }
    if (state.snapshot.activeThreadId === id) {
      state.snapshot.activeThreadId = null
    }
  }),
})
