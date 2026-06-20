/**
 * Guard-verdict evaluation and approval service.
 *
 * Extracted from index.ts to isolate the guard-verdict lifecycle:
 * evaluate → emit → request-approval → resolve/cancel.
 *
 * Dependencies are injected to avoid circular imports with index.ts.
 */

import { explicitGuardVerdictFromText, riskVerdictForText, type GuardVerdict } from './guards'

export type GuardResolution = 'approved' | 'denied' | 'timeout'

export interface GuardDecision {
  requestId: string
  decision: GuardResolution
}

export interface GuardEventStore {
  appendSystemEvent(threadId: string, turnId: string, kind: string, agentId: string, payload: Record<string, any>): void
}

const GUARD_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

const pendingGuardApprovals = new Map<string, {
  turnId: string
  resolve: (value: GuardDecision) => void
  timer: ReturnType<typeof setTimeout>
}>()

export function evaluateGuardVerdict(reviewText: string, role: string): GuardVerdict {
  return explicitGuardVerdictFromText(reviewText) || riskVerdictForText(reviewText, role)
}

export function emitGuardVerdict(
  store: GuardEventStore,
  threadId: string, turnId: string, agentId: string, role: string, reviewText: string,
  extra: Record<string, any> = {}
): GuardVerdict {
  const verdict = evaluateGuardVerdict(reviewText, role)
  store.appendSystemEvent(threadId, turnId, 'guard:verdict', agentId, {
    role,
    ...verdict,
    ...extra,
    checkedAt: Date.now()
  })
  return verdict
}

export function executorVerdictNeedsApproval(verdict: GuardVerdict, role: string): boolean {
  return role === 'executor' && (verdict.level === 'high' || verdict.status === 'block')
}

export function resolveGuardApproval(requestId: string, approved: boolean): boolean {
  const pending = pendingGuardApprovals.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingGuardApprovals.delete(requestId)
  pending.resolve({ requestId, decision: approved ? 'approved' : 'denied' })
  return true
}

export function cancelGuardApprovalsForTurn(turnId: string): void {
  for (const [requestId, pending] of pendingGuardApprovals.entries()) {
    if (pending.turnId !== turnId) continue
    clearTimeout(pending.timer)
    pendingGuardApprovals.delete(requestId)
    pending.resolve({ requestId, decision: 'denied' })
  }
}

export function requestGuardApproval(
  store: GuardEventStore,
  input: { threadId: string; turnId: string; agentId: string; role: string; verdict: GuardVerdict }
): Promise<GuardDecision> {
  const requestId = `guard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  store.appendSystemEvent(input.threadId, input.turnId, 'guard:verdict', input.agentId, {
    role: input.role,
    ...input.verdict,
    status: 'needs-confirmation',
    requestId,
    requiresUserDecision: true,
    checkedAt: Date.now()
  })
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (!pendingGuardApprovals.delete(requestId)) return
      resolve({ requestId, decision: 'timeout' })
    }, GUARD_APPROVAL_TIMEOUT_MS)
    pendingGuardApprovals.set(requestId, { turnId: input.turnId, resolve, timer })
  })
}

/** Clear all pending guard approvals (for shutdown). */
export function clearAllGuardApprovals(): void {
  for (const [id, pending] of pendingGuardApprovals) {
    clearTimeout(pending.timer)
    pending.resolve({ requestId: id, decision: 'denied' })
  }
  pendingGuardApprovals.clear()
}
