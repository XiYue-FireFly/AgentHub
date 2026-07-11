import type { ApprovalItem } from '../../glass/approval-dialog'
import { tr } from '../../glass/i18n'
import { TERMINAL_TURN_STATUSES } from '../../../shared/turn-status'

const TERMINAL_STATUSES = new Set<string>([...TERMINAL_TURN_STATUSES, 'canceled', 'error'])

type ApprovalRuntimeEvent = Pick<RuntimeEvent, 'kind' | 'turnId' | 'agentId' | 'payload'> & {
  id?: string
  seq?: number
  createdAt?: number | string
}

type ApprovalDecisionApi = {
  resolveApproval: (requestId: string, approved: boolean) => Promise<boolean>
  setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'deny') => Promise<unknown>
}

export type ApprovalDecisionResult =
  | { outcome: 'resolved'; rememberError?: unknown }
  | { outcome: 'not-found' }
  | { outcome: 'failed'; error: unknown }
  | { outcome: 'busy' }

export type ApprovalDecisionPresentation = {
  remove: boolean
  error?: string
  notice?: string
}

export function approvalDecisionPresentation(result: ApprovalDecisionResult): ApprovalDecisionPresentation {
  if (result.outcome === 'resolved') {
    return result.rememberError
      ? {
          remove: true,
          notice: tr('审批已提交，但未能记住此选择。', 'Approval submitted, but this choice could not be remembered.')
        }
      : { remove: true }
  }
  if (result.outcome === 'not-found') {
    return {
      remove: false,
      error: tr('审批请求未被主进程接受，可能已失效。请重试或等待任务更新。', 'The approval request was not accepted and may be stale. Please retry or wait for the task to update.')
    }
  }
  if (result.outcome === 'failed') {
    const detail = result.error instanceof Error ? ` ${result.error.message}` : ''
    return {
      remove: false,
      error: `${tr('提交审批失败，请重试。', 'Failed to submit approval. Please try again.')}${detail}`
    }
  }
  return { remove: false }
}

export function approvalItemFromRuntimeEvent(event: ApprovalRuntimeEvent): ApprovalItem | null {
  if (event.kind !== 'agent:approval') return null
  if (resolvedApprovalId(event)) return null
  const payload = event.payload || {}
  const request = payload.request
  if (!request || typeof request !== 'object') return null

  const id = stringValue(request.id)
  const agentId = stringValue(event.agentId) || stringValue(payload.agentId)
  const tool = request.tool === 'write' || request.tool === 'exec' ? request.tool : null
  const toolName = stringValue(request.toolName)
  if (!id || !agentId || !tool || !toolName) return null

  return {
    id,
    taskId: stringValue(payload.taskId) || event.turnId,
    agentId,
    tool,
    toolName,
    label: stringValue(request.label) || undefined,
    detail: stringValue(request.detail) || undefined
  }
}

export function reduceApprovalItemsFromRuntimeEvent(
  items: ApprovalItem[],
  event: ApprovalRuntimeEvent
): ApprovalItem[] {
  const resolvedId = resolvedApprovalId(event)
  if (resolvedId) return items.filter(item => item.id !== resolvedId)
  const nextItem = approvalItemFromRuntimeEvent(event)
  if (!nextItem || items.some(item => item.id === nextItem.id)) return items
  return [...items, nextItem]
}

export function pendingApprovalItemsFromEvents(events: ApprovalRuntimeEvent[]): ApprovalItem[] {
  const pending = new Map<string, { item: ApprovalItem; turnId: string; scope: string; stepId: string }>()
  const tombstonedIds = new Set<string>()
  const terminalTurns = new Set<string>()
  const closedRunScopes = new Set<string>()
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftSequence = finiteNumber(left.event.seq)
      const rightSequence = finiteNumber(right.event.seq)
      if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
        return leftSequence - rightSequence
      }
      const byCreatedAt = timeValue(left.event.createdAt) - timeValue(right.event.createdAt)
      return byCreatedAt !== 0 ? byCreatedAt : left.index - right.index
    })

  for (const { event } of ordered) {
    const resolvedId = resolvedApprovalId(event)
    if (resolvedId) {
      pending.delete(resolvedId)
      tombstonedIds.add(resolvedId)
      continue
    }

    if (isTerminalTurnEvent(event)) {
      terminalTurns.add(event.turnId)
      for (const [id, existing] of pending) {
        if (existing.turnId === event.turnId) {
          pending.delete(id)
          tombstonedIds.add(id)
        }
      }
      continue
    }

    if (isRunStartEvent(event)) {
      reopenRunScopes(event, closedRunScopes)
      continue
    }

    if (isRunTerminalEvent(event)) {
      const scope = approvalScope(event)
      if (scope) closedRunScopes.add(scope)
      for (const [id, existing] of pending) {
        if (scope ? existing.scope === scope : existing.turnId === event.turnId) {
          pending.delete(id)
          tombstonedIds.add(id)
        }
      }
      continue
    }

    if (isAgentProgressEvent(event)) {
      const reference = progressApprovalReference(event)
      if (reference.requestId) {
        if (pending.delete(reference.requestId)) tombstonedIds.add(reference.requestId)
      } else if (reference.stepId) {
        for (const [id, existing] of pending) {
          if (existing.stepId === reference.stepId && approvalScopeMatches(existing, event)) {
            pending.delete(id)
            tombstonedIds.add(id)
          }
        }
      } else {
        const legacyCandidates = [...pending.entries()].filter(([, existing]) => (
          !existing.stepId && approvalScopeMatches(existing, event)
        ))
        if (legacyCandidates.length === 1) {
          const [id] = legacyCandidates[0]
          pending.delete(id)
          tombstonedIds.add(id)
        }
      }
      continue
    }

    const item = approvalItemFromRuntimeEvent(event)
    if (item) {
      const scope = approvalScope(event, item.taskId)
      if (!scope || tombstonedIds.has(item.id) || terminalTurns.has(event.turnId) || closedRunScopes.has(scope)) continue
      if (!pending.has(item.id)) pending.set(item.id, {
        item,
        turnId: event.turnId,
        scope,
        stepId: approvalRequestStepId(event)
      })
    }
  }

  return [...pending.values()].map(entry => entry.item)
}

export function reconcileApprovalItemsWithHistory(
  items: ApprovalItem[],
  events: ApprovalRuntimeEvent[],
  activeIds: ReadonlySet<string> | null = null
): ApprovalItem[] {
  const historicalApprovalIds = new Set(
    events.map(approvalItemFromRuntimeEvent).filter((item): item is ApprovalItem => Boolean(item)).map(item => item.id)
  )
  if (historicalApprovalIds.size === 0) return items
  const restored = pendingApprovalItemsFromEvents(events)
    .filter(item => activeIds === null || activeIds.has(item.id))
  const next = items.filter(item => !historicalApprovalIds.has(item.id))
  for (const item of restored) {
    if (!next.some(existing => existing.id === item.id)) next.push(item)
  }
  return next
}

export function createApprovalDecisionHandler(api: ApprovalDecisionApi): {
  decide: (item: ApprovalItem, approved: boolean, remember: boolean) => Promise<ApprovalDecisionResult>
} {
  const inFlight = new Set<string>()

  return {
    async decide(item, approved, remember) {
      if (inFlight.has(item.id)) return { outcome: 'busy' }
      inFlight.add(item.id)
      try {
        const resolved = await api.resolveApproval(item.id, approved)
        if (!resolved) return { outcome: 'not-found' }
        if (!remember) return { outcome: 'resolved' }
        try {
          await api.setApprovalOverride(item.agentId, item.tool, approved ? 'allow' : 'deny')
          return { outcome: 'resolved' }
        } catch (rememberError) {
          return { outcome: 'resolved', rememberError }
        }
      } catch (error) {
        return { outcome: 'failed', error }
      } finally {
        inFlight.delete(item.id)
      }
    }
  }
}

function resolvedApprovalId(event: ApprovalRuntimeEvent): string {
  if (event.kind !== 'agent:approval') return ''
  const payload = objectValue(event.payload)
  const request = objectValue(payload.request)
  const status = (stringValue(payload.status) || stringValue(request.status)).toLowerCase()
  if (!['approved', 'denied', 'resolved', 'stale', 'cancelled', 'canceled'].includes(status)) return ''
  return stringValue(payload.requestId) || stringValue(payload.approvalId) || stringValue(request.id)
}

function isAgentProgressEvent(event: ApprovalRuntimeEvent): boolean {
  return event.kind === 'agent:activity' || event.kind === 'agent:delta'
}

function progressApprovalReference(event: ApprovalRuntimeEvent): { requestId: string; stepId: string } {
  const payload = objectValue(event.payload)
  const step = objectValue(payload.step)
  return {
    requestId: stringValue(payload.requestId) || stringValue(payload.approvalId)
      || stringValue(step.requestId) || stringValue(step.approvalId),
    stepId: stringValue(payload.stepId) || stringValue(step.id)
  }
}

function approvalRequestStepId(event: ApprovalRuntimeEvent): string {
  return stringValue(objectValue(objectValue(event.payload).request).stepId)
}

function isRunStartEvent(event: ApprovalRuntimeEvent): boolean {
  return event.kind === 'agent:start' || event.kind === 'run:created'
}

function reopenRunScopes(event: ApprovalRuntimeEvent, closedRunScopes: Set<string>): void {
  const payload = objectValue(event.payload)
  const agentId = stringValue(event.agentId) || stringValue(payload.agentId)
  if (!event.turnId || !agentId) return
  const taskId = stringValue(payload.taskId)
  if (taskId) {
    closedRunScopes.delete(`${event.turnId}\u0000${agentId}\u0000${taskId}`)
    return
  }
  const prefix = `${event.turnId}\u0000${agentId}\u0000`
  for (const scope of closedRunScopes) {
    if (scope.startsWith(prefix)) closedRunScopes.delete(scope)
  }
}

function isRunTerminalEvent(event: ApprovalRuntimeEvent): boolean {
  if (event.kind === 'agent:done' || event.kind === 'agent:error') return true
  return event.kind === 'run:status' && isTerminalStatus(objectValue(event.payload).status)
}

function isTerminalTurnEvent(event: ApprovalRuntimeEvent): boolean {
  return event.kind === 'turn:status' && isTerminalStatus(objectValue(event.payload).status)
}

function isTerminalStatus(value: unknown): boolean {
  return TERMINAL_STATUSES.has(stringValue(value).toLowerCase())
}

function approvalScopeMatches(
  existing: { scope: string },
  event: ApprovalRuntimeEvent,
  fallbackTaskId = ''
): boolean {
  const scope = approvalScope(event, fallbackTaskId)
  return Boolean(scope && existing.scope === scope)
}

function approvalScope(event: ApprovalRuntimeEvent, fallbackTaskId = ''): string {
  const eventAgentId = stringValue(event.agentId) || stringValue(objectValue(event.payload).agentId)
  const eventTaskId = stringValue(objectValue(event.payload).taskId) || fallbackTaskId
  if (!event.turnId || !eventAgentId) return ''
  return `${event.turnId}\u0000${eventAgentId}\u0000${eventTaskId || event.turnId}`
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function timeValue(value: unknown): number {
  const numeric = finiteNumber(value)
  if (numeric !== null) return numeric
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
