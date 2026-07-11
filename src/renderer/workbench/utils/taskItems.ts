import type { ActivityStep, TaskItem, TaskUIStatus, TokenUsage } from '../../glass/meta'
import { upsertStep } from '../../glass/chat-transcript'
import { isTerminalTurnStatus } from '../../../shared/turn-status'

type RuntimeTaskEvent = Pick<RuntimeEvent, 'id' | 'threadId' | 'turnId' | 'seq' | 'kind' | 'agentId' | 'payload' | 'createdAt'>

export type RuntimeTaskEventsByThread = Record<string, RuntimeTaskEvent[] | undefined>

const INTERNAL_AGENT_IDS = new Set(['prompt-optimizer', 'budget-guard', 'dispatch-planner', 'router'])

export function deriveTaskItems(snapshot: WorkbenchSnapshot, eventsByThread: RuntimeTaskEventsByThread): TaskItem[] {
  const runsByTurn = groupRunsByTurn(snapshot.runs)
  const threadsById = new Map(snapshot.threads.map(thread => [thread.id, thread]))
  const hidden = new Set(snapshot.hiddenTaskTurnIds ?? [])

  return [...snapshot.turns]
    .filter(turn => !hidden.has(turn.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(turn => {
      const thread = threadsById.get(turn.threadId)
      const turnEvents = (eventsByThread[turn.threadId] || [])
        .filter(event => event.turnId === turn.id)
        .sort((a, b) => a.seq - b.seq)
      const runs = runsByTurn.get(turn.id) || []
      const agents = orderedAgents(turn, runs, turnEvents)
      const { results, errors, usage, steps } = summarizeTaskEvents(turnEvents)

      return {
        id: turn.id,
        threadId: turn.threadId,
        threadTitle: thread?.title,
        workspaceId: thread?.workspaceId ?? null,
        text: turn.prompt,
        mode: turn.mode as TaskItem['mode'],
        status: taskStatus(turn.status),
        agents,
        durationMs: taskDuration(turn, runs, turnEvents),
        createdAt: formatTime(turn.createdAt),
        ...(Object.keys(results).length ? { results } : {}),
        ...(Object.keys(errors).length ? { errors } : {}),
        ...(Object.keys(usage).length ? { usage } : {}),
        ...(Object.keys(steps).length ? { steps } : {})
      }
    })
}

function groupRunsByTurn(runs: AgentRunNode[]): Map<string, AgentRunNode[]> {
  const grouped = new Map<string, AgentRunNode[]>()
  for (const run of runs) {
    const list = grouped.get(run.turnId)
    if (list) list.push(run)
    else grouped.set(run.turnId, [run])
  }
  for (const list of grouped.values()) list.sort((a, b) => a.startedAt - b.startedAt)
  return grouped
}

function orderedAgents(turn: WorkbenchTurn, runs: AgentRunNode[], events: RuntimeTaskEvent[]): string[] {
  const ids: string[] = []
  const add = (value?: string | null) => {
    const id = value?.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  for (const run of runs) {
    if (!INTERNAL_AGENT_IDS.has(run.agentId)) add(run.agentId)
  }
  for (const event of events) {
    const agentId = event.agentId || event.payload?.agentId
    if (!agentId || INTERNAL_AGENT_IDS.has(agentId) || event.payload?.visibility === 'run' || event.kind === 'turn:summary') continue
    add(agentId)
  }
  add(turn.targetAgent)
  add(turn.modelSelection?.agentId)
  return ids
}

function summarizeTaskEvents(events: RuntimeTaskEvent[]): {
  results: Record<string, string>
  errors: Record<string, string>
  usage: Record<string, TokenUsage>
  steps: Record<string, ActivityStep[]>
} {
  const results: Record<string, string> = {}
  const errors: Record<string, string> = {}
  const usage: Record<string, TokenUsage> = {}
  const steps: Record<string, ActivityStep[]> = {}

  for (const event of events) {
    const agentId = event.agentId || event.payload?.agentId || 'orchestrate'
    if (INTERNAL_AGENT_IDS.has(agentId) || event.kind === 'turn:summary' || event.payload?.visibility === 'run') continue
    if (event.kind === 'agent:done') {
      const content = stringValue(event.payload?.content)
      if (content) results[agentId] = content
      const eventUsage = event.payload?.usage
      if (eventUsage && typeof eventUsage === 'object') {
        usage[agentId] = { ...eventUsage, modelId: eventUsage.modelId || event.payload?.modelId }
      }
      continue
    }
    if (event.kind === 'agent:error') {
      const error = stringValue(event.payload?.error || event.payload?.message)
      if (error) errors[agentId] = error
      continue
    }
    if (event.kind === 'agent:activity' && event.payload?.step) {
      steps[agentId] = upsertStep(steps[agentId], event.payload.step)
      continue
    }
    if (event.kind === 'orchestrate') {
      const payloadKind = String(event.payload?.kind || '')
      if (payloadKind === 'orchestrate:final') {
        const content = stringValue(event.payload?.content)
        if (content) results.orchestrate = content
      } else if (payloadKind === 'orchestrate:error') {
        const error = stringValue(event.payload?.error || event.payload?.content)
        if (error) errors.orchestrate = error
      }
    }
  }

  return { results, errors, usage, steps }
}

function taskStatus(status: WorkbenchTurnStatus): TaskUIStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled' || status === 'interrupted') return 'cancelled'
  return 'running'
}

function taskDuration(turn: WorkbenchTurn, runs: AgentRunNode[], events: RuntimeTaskEvent[]): number | null {
  const turnIsTerminal = isTerminalTurnStatus(turn.status)
  if (turnIsTerminal && typeof turn.completedAt === 'number' && turn.completedAt >= turn.createdAt) {
    return turn.completedAt - turn.createdAt
  }
  const runTimes = runs
    .filter(run => typeof run.endedAt === 'number' && run.endedAt >= run.startedAt)
    .map(run => ({ start: run.startedAt, end: run.endedAt as number }))
  if (turnIsTerminal && runTimes.length > 0) {
    return Math.max(...runTimes.map(run => run.end)) - Math.min(...runTimes.map(run => run.start))
  }
  const explicitDuration = [...events].reverse()
    .filter(event => turnIsTerminal || isExplicitTerminalTaskEvent(event))
    .map(event => event.payload?.durationMs)
    .find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  return typeof explicitDuration === 'number' ? explicitDuration : null
}

function isExplicitTerminalTaskEvent(event: RuntimeTaskEvent): boolean {
  if (event.kind === 'agent:done' || event.kind === 'agent:error') return true
  if (event.kind === 'orchestrate') {
    return event.payload?.kind === 'orchestrate:final' || event.payload?.kind === 'orchestrate:error'
  }
  if (event.kind === 'turn:status' || event.kind === 'run:status') {
    const status = event.payload?.status as WorkbenchTurnStatus | undefined
    return Boolean(status && isTerminalTurnStatus(status))
  }
  return false
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toTimeString().slice(0, 5)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
