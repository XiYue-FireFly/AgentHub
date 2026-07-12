import type { MultiModelFusionConfig } from '../../shared/ipc-contract'

/** The only prompt payload that can cross the final dispatch boundary. */
export type FinalizedPromptEnvelope = Readonly<{
  envelopeId: string
  effectivePrompt: string
}>

export interface PreparedTurnDispatch {
  envelope: unknown
  fusion: MultiModelFusionConfig
}

export interface PreparedTurnDispatchDependencies<T> {
  dispatchOrdinary(envelope: FinalizedPromptEnvelope): Promise<T>
  runFusion(envelope: FinalizedPromptEnvelope, config: MultiModelFusionConfig): Promise<T>
}

export interface FusionDegradedEvent {
  mode: 'degraded'
  routeCount: number
  reason: string
  visibility: 'run'
}

export type FusionAvailability<T> =
  | { kind: 'fusion' }
  | { kind: 'degraded'; result: T }

const FUSION_UNAVAILABLE_REASON = 'MULTI_MODEL_UNAVAILABLE: at least two distinct resolved models are required'

/**
 * Fusion is an optional enhancement. When it cannot obtain two distinct,
 * read-only compatible routes, record the degraded mode before performing one
 * ordinary dispatch of the same immutable prepared root.
 */
export async function degradeFusionIfUnavailable<T>(
  input: {
    envelope: FinalizedPromptEnvelope
    routeCount: number
    emitDegraded(event: FusionDegradedEvent): Promise<void>
  },
  dispatchOrdinary: (envelope: FinalizedPromptEnvelope) => Promise<T>
): Promise<FusionAvailability<T>> {
  if (input.routeCount >= 2) return { kind: 'fusion' }
  await input.emitDegraded({
    mode: 'degraded',
    routeCount: input.routeCount,
    reason: FUSION_UNAVAILABLE_REASON,
    visibility: 'run'
  })
  return { kind: 'degraded', result: await dispatchOrdinary(input.envelope) }
}

function isFinalizedPromptEnvelope(value: unknown): value is FinalizedPromptEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  return typeof envelope.envelopeId === 'string'
    && envelope.envelopeId.trim().length > 0
    && typeof envelope.effectivePrompt === 'string'
    && envelope.effectivePrompt.trim().length > 0
}

/**
 * Routes the sole finalized root Prompt envelope into either normal dispatch
 * or multi-model fusion. Raw user text never reaches this boundary.
 */
export async function dispatchPreparedTurn<T>(
  input: PreparedTurnDispatch,
  dependencies: PreparedTurnDispatchDependencies<T>
): Promise<T> {
  if (!isFinalizedPromptEnvelope(input?.envelope)) {
    throw new Error('A finalized Prompt envelope is required before dispatch.')
  }
  const envelope = input.envelope
  if (input.fusion.enabled) {
    return dependencies.runFusion(envelope, input.fusion)
  }
  return dependencies.dispatchOrdinary(envelope)
}
