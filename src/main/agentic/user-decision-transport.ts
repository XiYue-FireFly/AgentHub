import type { DispatchEnvelope, PromptDispatchLineage } from '../../shared/prompt-contract'
import type { ChatCompletionMessage } from '../providers/types'
import {
  parseAgentDecisionInput,
  type AgentDecisionInput,
  type AgentDecisionRequester,
  type AgentDecisionResolution
} from './user-decision-tool'

export interface AgentDecisionRequestEvent {
  type: 'decision_request'
  version: 1
  requestId: string
  sessionId: string
  continuation:
    | { mode: 'live' }
    | { mode: 'checkpoint'; checkpointId: string }
  request: AgentDecisionInput
}

export interface AgentDecisionResultEvent {
  type: 'decision_result'
  version: 1
  requestId: string
  sessionId: string
  resolution: AgentDecisionResolution
}

export interface AgentDecisionCheckpointState {
  version: 1
  turnId: string
  threadId?: string
  agentId: string
  sessionId: string
  checkpointId: string
  requestId: string
  lineage: PromptDispatchLineage
  dispatchEnvelope: DispatchEnvelope
  context: {
    prompt: string
    conversationText?: string
    messages?: ChatCompletionMessage[]
  }
}

export interface AgentDecisionCheckpointResult extends AgentDecisionResultEvent {
  checkpointId: string
}

export type AgentDecisionTransportOutcome =
  | { status: 'ignored' }
  | {
      status: 'unavailable'
      delivery: 'best-effort'
      reason: 'structured-decision-unsupported' | 'decision-channel-unavailable' | 'continuation-unavailable'
    }
  | { status: 'resumed-live'; result: AgentDecisionResultEvent }
  | { status: 'redispatched-checkpoint'; result: AgentDecisionCheckpointResult }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(field + ' must be a non-empty string')
  }
  return value.trim()
}

export function parseAgentDecisionRequestEvent(value: unknown): AgentDecisionRequestEvent | null {
  const event = record(value)
  if (!event || event.type !== 'decision_request') return null
  if (event.version !== 1) throw new Error('decision_request.version must be 1')

  const continuation = record(event.continuation)
  if (!continuation || (continuation.mode !== 'live' && continuation.mode !== 'checkpoint')) {
    throw new Error('decision_request.continuation is invalid')
  }

  const parsedContinuation = continuation.mode === 'live'
    ? { mode: 'live' as const }
    : {
        mode: 'checkpoint' as const,
        checkpointId: requiredString(continuation.checkpointId, 'checkpointId')
      }

  return {
    type: 'decision_request',
    version: 1,
    requestId: requiredString(event.requestId, 'requestId'),
    sessionId: requiredString(event.sessionId, 'sessionId'),
    continuation: parsedContinuation,
    request: parseAgentDecisionInput(event.request)
  }
}

export async function continueAgentDecisionEvent(input: {
  protocol: 'stdio-ndjson' | 'stdio-plain'
  event: unknown
  requestUserDecision?: AgentDecisionRequester
  checkpointState?: AgentDecisionCheckpointState
  resumeLive?: (result: AgentDecisionResultEvent) => Promise<void>
  redispatchCheckpoint?: (input: {
    state: AgentDecisionCheckpointState
    result: AgentDecisionCheckpointResult
  }) => Promise<void>
}): Promise<AgentDecisionTransportOutcome> {
  if (input.protocol === 'stdio-plain') {
    return {
      status: 'unavailable',
      delivery: 'best-effort',
      reason: 'structured-decision-unsupported'
    }
  }

  const event = parseAgentDecisionRequestEvent(input.event)
  if (!event) return { status: 'ignored' }
  if (!input.requestUserDecision) {
    return { status: 'unavailable', delivery: 'best-effort', reason: 'decision-channel-unavailable' }
  }

  const resolution = await input.requestUserDecision(event.request)
  const result: AgentDecisionResultEvent = {
    type: 'decision_result',
    version: 1,
    requestId: event.requestId,
    sessionId: event.sessionId,
    resolution
  }

  if (event.continuation.mode === 'live') {
    if (!input.resumeLive) {
      return { status: 'unavailable', delivery: 'best-effort', reason: 'continuation-unavailable' }
    }
    await input.resumeLive(result)
    return { status: 'resumed-live', result }
  }

  const state = input.checkpointState
  if (
    !state ||
    !input.redispatchCheckpoint ||
    state.requestId !== event.requestId ||
    state.sessionId !== event.sessionId ||
    state.checkpointId !== event.continuation.checkpointId
  ) {
    return { status: 'unavailable', delivery: 'best-effort', reason: 'continuation-unavailable' }
  }

  const checkpointResult: AgentDecisionCheckpointResult = {
    ...result,
    checkpointId: event.continuation.checkpointId
  }
  await input.redispatchCheckpoint({ state, result: checkpointResult })
  return { status: 'redispatched-checkpoint', result: checkpointResult }
}
