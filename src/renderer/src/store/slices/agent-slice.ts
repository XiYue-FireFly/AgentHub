import { StateCreator } from 'zustand'

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type DispatchPreset = 'auto' | 'broadcast' | 'chain' | 'orchestrate' | 'lead-workers' | 'parallel-review' | 'firefly-custom' | 'custom'

export interface WorkbenchThinking {
  mode: 'off' | 'auto' | 'enabled'
  level: ThinkingLevel
  collapseInUI?: boolean
  budgetTokens?: number
}

export interface ModelSelection {
  providerId: string
  modelId: string
}

export interface LocalAgentStatus {
  agentId: string
  configured: boolean
  path?: string
  version?: string
}

export interface SchedulePreview {
  preset: DispatchPreset
  label?: string
  labelZh?: string
  labelEn?: string
  description?: string
  descriptionZh?: string
  descriptionEn?: string
  agents?: string[]
  steps?: Array<{ id?: string; label?: string; labelZh?: string; labelEn?: string; agentId: string; prompt?: string; role?: string; mode?: string; dependsOn?: string[] }>
}

export interface AgentState {
  mode: DispatchPreset
  targetAgent: string | null
  modelSelection: ModelSelection | null
  thinking: WorkbenchThinking
  localAgents: LocalAgentStatus[]
  schedules: SchedulePreview[]
  customSchedule: SchedulePreview
  smartSchedule: SchedulePreview
  scheduleOverrides: Partial<Record<DispatchPreset, SchedulePreview>>
}

export interface AgentActions {
  setMode: (mode: DispatchPreset) => void
  setTargetAgent: (agent: string | null) => void
  setModelSelection: (selection: ModelSelection | null) => void
  setThinking: (thinking: WorkbenchThinking) => void
  setLocalAgents: (agents: LocalAgentStatus[]) => void
  setSchedules: (schedules: SchedulePreview[]) => void
  setCustomSchedule: (schedule: SchedulePreview) => void
  setSmartSchedule: (schedule: SchedulePreview) => void
  setScheduleOverrides: (overrides: Partial<Record<DispatchPreset, SchedulePreview>>) => void
}

export type AgentSlice = AgentState & AgentActions

const DEFAULT_THINKING: WorkbenchThinking = { mode: 'auto', level: 'medium', collapseInUI: true }
const DEFAULT_CUSTOM_SCHEDULE: SchedulePreview = { preset: 'custom' }
const DEFAULT_SMART_SCHEDULE: SchedulePreview = { preset: 'firefly-custom' }

export const createAgentSlice: StateCreator<AgentSlice, [['zustand/immer', never]], [], AgentSlice> = (set) => ({
  mode: 'lead-workers',
  targetAgent: null,
  modelSelection: null,
  thinking: DEFAULT_THINKING,
  localAgents: [],
  schedules: [],
  customSchedule: DEFAULT_CUSTOM_SCHEDULE,
  smartSchedule: DEFAULT_SMART_SCHEDULE,
  scheduleOverrides: {},

  setMode: (mode) => set((state) => { state.mode = mode }),
  setTargetAgent: (agent) => set((state) => { state.targetAgent = agent }),
  setModelSelection: (selection) => set((state) => { state.modelSelection = selection }),
  setThinking: (thinking) => set((state) => { state.thinking = thinking }),
  setLocalAgents: (agents) => set((state) => { state.localAgents = agents }),
  setSchedules: (schedules) => set((state) => { state.schedules = schedules }),
  setCustomSchedule: (schedule) => set((state) => { state.customSchedule = schedule }),
  setSmartSchedule: (schedule) => set((state) => { state.smartSchedule = schedule }),
  setScheduleOverrides: (overrides) => set((state) => { state.scheduleOverrides = overrides }),
})
