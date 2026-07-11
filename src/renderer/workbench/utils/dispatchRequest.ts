import { customScheduleHasRunnableSteps, normalizeScheduleForStorage, sanitizeCustomSchedule } from '../customSchedule'

export type SendPromptOverrides = {
  targetAgent?: string | null
  mode?: DispatchPreset
  customSchedule?: SchedulePreview | null
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
  scheduleTargetUnavailable: boolean
  targetUnavailable: boolean
}

export function resolveDispatchRequest(input: ResolveDispatchRequestInput): ResolvedDispatchRequest {
  const overrides = input.overrides || {}
  const rawTargetAgent = overrides.targetAgent !== undefined ? overrides.targetAgent : input.targetAgent
  const targetUnavailable = overrides.targetAgent !== undefined
    && typeof rawTargetAgent === 'string'
    && rawTargetAgent.length > 0
    && !input.usableLocalAgents.includes(rawTargetAgent)
  const requestedTargetAgent = rawTargetAgent && input.usableLocalAgents.includes(rawTargetAgent)
    ? rawTargetAgent
    : null
  const requestedModelSelection = requestedTargetAgent
    ? null
    : (overrides.modelSelection !== undefined ? overrides.modelSelection : input.modelSelection)
  const selectedProviderDirect = !requestedTargetAgent && requestedModelSelection?.source === 'provider'
  const selectedLocalDirect = !!requestedTargetAgent
  const nextTargetAgent = selectedProviderDirect ? null : requestedTargetAgent
  const nextMode = selectedProviderDirect || selectedLocalDirect ? 'auto' : (overrides.mode !== undefined ? overrides.mode : input.mode)
  const rawCustomSchedule = selectedProviderDirect || selectedLocalDirect
    ? undefined
    : (overrides.customSchedule !== undefined
        ? overrides.customSchedule || undefined
        : (!nextTargetAgent ? input.scheduleForMode(nextMode) : undefined))
  const explicitScheduleSnapshot = overrides.customSchedule !== undefined && overrides.customSchedule !== null
  const safeCustomSchedule = rawCustomSchedule
    ? explicitScheduleSnapshot ? resolveSnapshotSchedule(rawCustomSchedule, input.usableLocalAgents) : sanitizeCustomSchedule(rawCustomSchedule, input.usableLocalAgents)
    : undefined
  const scheduleTargetUnavailable = Boolean(explicitScheduleSnapshot && safeCustomSchedule?.steps.some(step => (
    step.agentId !== 'auto' && step.agentId !== 'all' && !input.usableLocalAgents.includes(step.agentId)
  )))
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
    scheduleUnavailable,
    scheduleTargetUnavailable,
    targetUnavailable
  }
}

function resolveSnapshotSchedule(schedule: SchedulePreview, usableLocalAgents: string[]): SchedulePreview {
  const canonical = normalizeScheduleForStorage(schedule)
  const fallback = usableLocalAgents[0] || 'auto'
  const graph = canonical.graph!
  return normalizeScheduleForStorage({
    ...canonical,
    graph: {
      ...graph,
      nodes: graph.nodes.map(node => ({
        ...node,
        agentId: node.agentId === 'auto' || node.agentId === 'all' ? fallback : node.agentId
      })),
      edges: graph.edges.map(edge => ({ ...edge })),
      layout: Object.fromEntries(Object.entries(graph.layout).map(([id, point]) => [id, { ...point }]))
    }
  })
}

export async function createTurnAndRefresh<T>(
  create: () => Promise<T>,
  refresh: (value: T) => Promise<void>
): Promise<{ ok: true; value: T; refreshError?: unknown } | { ok: false; error: unknown }> {
  let value: T
  try {
    value = await create()
  } catch (error) {
    return { ok: false, error }
  }
  try {
    await refresh(value)
    return { ok: true, value }
  } catch (refreshError) {
    return { ok: true, value, refreshError }
  }
}

export function classifyCreateFailure(error: unknown): 'cancelled' | 'create-failed' {
  if (!error || (typeof error !== 'object' && typeof error !== 'string')) return 'create-failed'
  const record = typeof error === 'object' ? error as Record<string, unknown> : null
  const details = [
    record?.code,
    record?.name,
    record?.message,
    typeof error === 'string' ? error : null
  ]
    .filter(value => typeof value === 'string')
    .join(' ')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
  return /\b(cancelled|canceled|aborted|aborterror)\b/.test(details)
    ? 'cancelled'
    : 'create-failed'
}
