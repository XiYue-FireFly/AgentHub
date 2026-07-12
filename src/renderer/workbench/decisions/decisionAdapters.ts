import type {
  DecisionRequest,
  DecisionSource,
  DecisionState,
  PendingDecision
} from '../../../shared/decision-contract'

type DecisionResolutionEvent = {
  readonly kind?: unknown
  readonly payload?: unknown
}

type DraftDecisionRequest = Omit<DecisionRequest, 'owner'>

interface DecisionItemFields {
  readonly id: string
  readonly threadId: string
  readonly createdAt: number
  readonly state: DecisionState
  readonly activatedAt?: number
  readonly expiresAt?: number
}

export interface RuntimeDecisionItem extends DecisionItemFields {
  readonly origin: 'runtime'
  readonly request: DecisionRequest
}

export interface DraftDecisionItem extends Omit<DecisionItemFields, 'state'> {
  readonly origin: 'draft'
  readonly request: DraftDecisionRequest
  readonly state: 'active'
  readonly draftRevision: number
  readonly draftHash: string
  readonly valuesByOptionId: Readonly<Record<string, unknown>>
}

export type DecisionItem = RuntimeDecisionItem | DraftDecisionItem

export type DraftDecisionInput = Omit<DraftDecisionItem, 'origin' | 'state'>

export interface StaleDecisionRecovery {
  readonly requestId: string
  readonly source: DecisionSource
  readonly originalTurnId: string
  readonly action: 'rerun-turn'
}

const DECISION_SOURCES = new Set<DecisionSource>([
  'prompt-optimizer',
  'agent',
  'router',
  'tool',
  'guard',
  'acp',
  'multi-model-loop'
])

export function runtimeDecisionItem(pending: PendingDecision): RuntimeDecisionItem | null {
  const { request } = pending
  if (request.owner.type !== 'turn') return null
  return {
    origin: 'runtime',
    id: request.id,
    threadId: request.owner.threadId,
    createdAt: request.createdAt,
    request,
    state: pending.state,
    activatedAt: pending.activatedAt,
    expiresAt: pending.expiresAt
  }
}

export function draftDecisionItem(input: DraftDecisionInput): DraftDecisionItem {
  return {
    ...input,
    origin: 'draft',
    state: 'active'
  }
}

export function staleDecisionRecoveryFromEvent(event: DecisionResolutionEvent): StaleDecisionRecovery | null {
  if (event.kind !== 'decision:resolved') return null
  if (!isRecord(event.payload)) return null
  const payload = event.payload
  if (!isRecord(payload.recovery)) return null
  const recovery = payload.recovery
  const requestId = payload.requestId
  const source = payload.source
  const originalTurnId = recovery.originalTurnId
  if (
    payload.status !== 'stale' ||
    recovery.kind !== 'rerun-turn' ||
    !isNonEmptyString(requestId) ||
    !isDecisionSource(source) ||
    !isNonEmptyString(originalTurnId)
  ) {
    return null
  }
  return {
    requestId,
    source,
    originalTurnId,
    action: 'rerun-turn'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDecisionSource(value: unknown): value is DecisionSource {
  return typeof value === 'string' && DECISION_SOURCES.has(value as DecisionSource)
}
