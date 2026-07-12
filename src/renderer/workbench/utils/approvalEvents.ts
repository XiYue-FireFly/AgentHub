type ApprovalRuntimeEvent = Pick<RuntimeEvent, 'kind' | 'turnId' | 'agentId' | 'payload'> & {
  id?: string
  seq?: number
  createdAt?: number | string
}

export type ApprovalAuditStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'stale'

export type ApprovalAuditEvent = {
  id: string
  turnId: string
  agentId?: string
  taskId?: string
  status: ApprovalAuditStatus
}

/**
 * Legacy agent approvals remain visible only as immutable audit records. New
 * choices are owned exclusively by the durable DecisionService decision bar.
 */
export function approvalAuditFromRuntimeEvent(event: ApprovalRuntimeEvent): ApprovalAuditEvent | null {
  if (event.kind !== 'agent:approval') return null
  const payload = record(event.payload)
  if (payload.auditOnly !== true) return null
  const request = record(payload.request)
  const id = stringValue(payload.requestId) || stringValue(payload.approvalId) || stringValue(request.id)
  if (!id) return null
  return {
    id,
    turnId: event.turnId,
    agentId: stringValue(event.agentId) || stringValue(payload.agentId) || undefined,
    taskId: stringValue(payload.taskId) || undefined,
    status: approvalAuditStatus(payload.status) || approvalAuditStatus(request.status) || 'pending'
  }
}

export function reconcileApprovalAuditEvents(events: ApprovalRuntimeEvent[]): ApprovalAuditEvent[] {
  const records = new Map<string, ApprovalAuditEvent>()
  for (const event of [...events].sort(compareEventOrder)) {
    const audit = approvalAuditFromRuntimeEvent(event)
    if (audit) records.set(audit.id, audit)
  }
  return [...records.values()]
}

function approvalAuditStatus(value: unknown): ApprovalAuditStatus | null {
  const normalized = stringValue(value).toLowerCase()
  return normalized === 'pending' || normalized === 'approved' || normalized === 'denied' ||
    normalized === 'cancelled' || normalized === 'stale'
    ? normalized
    : null
}

function compareEventOrder(left: ApprovalRuntimeEvent, right: ApprovalRuntimeEvent): number {
  const leftSequence = finiteNumber(left.seq)
  const rightSequence = finiteNumber(right.seq)
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return leftSequence - rightSequence
  }
  return timeValue(left.createdAt) - timeValue(right.createdAt)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
