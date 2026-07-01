import { StateCreator } from 'zustand'

const MAX_EVENTS = 5000

export interface RuntimeEvent {
  id?: string
  threadId: string
  turnId?: string
  seq: number
  kind: string
  agentId?: string
  content?: string
  error?: string
  payload?: any
  timestamp: number
  ts?: number  // alias for backward compatibility
}

export interface TerminalRun {
  id: string
  command: string
  output: string
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
}

export interface RuntimeState {
  events: RuntimeEvent[]
  sending: boolean
  terminalRuns: TerminalRun[]
}

export interface RuntimeActions {
  setEvents: (events: RuntimeEvent[] | ((prev: RuntimeEvent[]) => RuntimeEvent[])) => void
  setSending: (sending: boolean) => void
  setTerminalRuns: (runs: TerminalRun[] | ((prev: TerminalRun[]) => TerminalRun[])) => void
  addEvent: (event: RuntimeEvent) => void
  addTerminalRun: (run: TerminalRun) => void
  updateTerminalRun: (id: string, updates: Partial<TerminalRun>) => void
  deleteTerminalRun: (id: string) => void
}

export type RuntimeSlice = RuntimeState & RuntimeActions

export const createRuntimeSlice: StateCreator<RuntimeSlice, [['zustand/immer', never]], [], RuntimeSlice> = (set) => ({
  events: [],
  sending: false,
  terminalRuns: [],

  setEvents: (events) => set((state) => {
    state.events = typeof events === 'function' ? events(state.events) : events
  }),
  setSending: (sending) => set((state) => { state.sending = sending }),
  setTerminalRuns: (runs) => set((state) => {
    state.terminalRuns = typeof runs === 'function' ? runs(state.terminalRuns) : runs
  }),
  addEvent: (event) => set((state) => {
    if (!event.threadId) return
    const withId = event.id ? event : { ...event, id: crypto.randomUUID() }
    state.events.push(withId)
    if (state.events.length > MAX_EVENTS) {
      state.events = state.events.slice(state.events.length - MAX_EVENTS)
    }
  }),
  addTerminalRun: (run) => set((state) => { state.terminalRuns.push(run) }),
  updateTerminalRun: (id, updates) => set((state) => {
    const index = state.terminalRuns.findIndex(r => r.id === id)
    if (index !== -1) {
      state.terminalRuns[index] = { ...state.terminalRuns[index], ...updates }
    }
  }),
  deleteTerminalRun: (id) => set((state) => {
    state.terminalRuns = state.terminalRuns.filter(r => r.id !== id)
  }),
})
