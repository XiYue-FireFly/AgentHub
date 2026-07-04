import { customScheduleHasRunnableSteps, sanitizeCustomSchedule } from '../customSchedule'

export type SendPromptOverrides = {
  targetAgent?: string | null
  mode?: DispatchPreset
  customSchedule?: SchedulePreview
  modelSelection?: ModelSelection | null
}

export type ResolveDispatchRequestInput = {
  targetAgent: string | null
  modelSelection: ModelSelection | null
  mode: DispatchPreset
  overrides?: SendPromptOverrides
  usableLocalAgents: string[]
  scheduleForMode: (preset: DispatchPreset) => SchedulePreview | undefined
}

export type ResolvedDispatchRequest = {
  mode: DispatchPreset
  targetAgent: string | null | undefined
  modelSelection: ModelSelection | undefined
  customSchedule: SchedulePreview | undefined
  selectedProviderDirect: boolean
  selectedLocalDirect: boolean
  scheduleUnavailable: boolean
}

export function resolveDispatchRequest(input: ResolveDispatchRequestInput): ResolvedDispatchRequest {
  const overrides = input.overrides || {}
  const requestedTargetAgent = overrides.targetAgent !== undefined ? overrides.targetAgent : input.targetAgent
  const requestedModelSelection = requestedTargetAgent
    ? null
    : (overrides.modelSelection !== undefined ? overrides.modelSelection : input.modelSelection)
  const selectedProviderDirect = !requestedTargetAgent && requestedModelSelection?.source === 'provider'
  const selectedLocalDirect = !!requestedTargetAgent
  const nextTargetAgent = selectedProviderDirect ? null : requestedTargetAgent
  const nextMode = selectedProviderDirect || selectedLocalDirect ? 'auto' : (overrides.mode || input.mode)
  const rawCustomSchedule = selectedProviderDirect || selectedLocalDirect
    ? undefined
    : (overrides.customSchedule || (!nextTargetAgent ? input.scheduleForMode(nextMode) : undefined))
  const safeCustomSchedule = rawCustomSchedule ? sanitizeCustomSchedule(rawCustomSchedule, input.usableLocalAgents) : undefined
  const scheduleUnavailable = safeCustomSchedule
    ? !customScheduleHasRunnableSteps(safeCustomSchedule)
    : nextMode === 'custom' || nextMode === 'firefly-custom'
      ? input.usableLocalAgents.length === 0
      : false

  return {
    mode: nextMode,
    targetAgent: nextTargetAgent,
    modelSelection: selectedLocalDirect ? undefined : requestedModelSelection || undefined,
    customSchedule: selectedProviderDirect || selectedLocalDirect ? undefined : safeCustomSchedule,
    selectedProviderDirect,
    selectedLocalDirect,
    scheduleUnavailable
  }
}
