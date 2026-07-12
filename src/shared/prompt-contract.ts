export const PROMPT_ORIGINS = [
  "workbench:create",
  "workbench:retry",
  "hub:websocket",
  "cli:headless",
  "quick-complete:prompt-enhancer",
  "quick-complete:sdd-requirements",
  "quick-complete:inline-edit",
  "quick-complete:browser-summary",
  "quick-complete:browser-analysis",
  "external-proxy:openai",
  "external-proxy:anthropic",
  "external-proxy:agent",
  "internal:schedule",
  "internal:agentic-round",
  "internal:prompt-candidate",
  "internal:loop-candidate",
  "internal:loop-synthesizer",
  "internal:loop-judge",
  "internal:loop-executor",
  "internal:model-diagnostic"
] as const

export type PromptOrigin = typeof PROMPT_ORIGINS[number]
export type PromptPolicy = "optimize" | "structured" | "passthrough" | "internal"
export type PromptSessionScope = "root" | "draft" | "none"
export type PromptDecisionCapability =
  | "desktop-inline"
  | "websocket"
  | "terminal"
  | "none"
  | "client-owned"

export type PromptPreparationState =
  | "analyzing"
  | "awaiting-decision"
  | "finalized"
  | "cancelled"
  | "failed"

export interface PromptPreparationSession {
  readonly sessionId: string
  readonly rootInputId: string
  readonly origin: PromptOrigin
  readonly policy: PromptPolicy
  readonly state: PromptPreparationState
  readonly inputHash: string
  readonly preparationCount: 1
  readonly optimizationCount: 0 | 1
  readonly candidateAttemptCount: number
  readonly retryOfEnvelopeId?: string
}

export type PromptEnvelopeStatus =
  | "optimized"
  | "unchanged"
  | "candidate-selected"
  | "custom-selected"
  | "reused-selection"
  | "structured"
  | "passthrough"

export interface PromptEnvelope {
  readonly envelopeId: string
  readonly sessionId: string
  readonly rootInputId: string
  readonly displayOriginalPrompt: string
  readonly effectivePrompt: string
  readonly origin: PromptOrigin
  readonly policy: PromptPolicy
  readonly status: PromptEnvelopeStatus
  readonly optimizerVersion: string
  readonly inputHash: string
  readonly preparedTextHash: string
  readonly optimizationCount: 0 | 1
  readonly finalizedAt: number
}

export interface PromptDispatchLineage {
  readonly origin: PromptOrigin
  readonly policy: PromptPolicy
  readonly rootInputId?: string
  readonly rootEnvelopeId?: string
  readonly rootPreparedTextHash?: string
  readonly parentDispatchId?: string
}

export interface DispatchEnvelope extends PromptDispatchLineage {
  readonly dispatchId: string
  readonly providerId: string
  readonly modelId: string
  readonly canonicalPayloadHash: string
  readonly optimizationCount: 0
}

export interface CanonicalDispatchMessage {
  readonly role: string
  readonly content: unknown
  readonly name?: string
  readonly toolCallId?: string
  readonly toolCalls?: unknown
}

export interface CanonicalDispatchPayload {
  readonly providerId: string
  readonly modelId: string
  readonly protocol: string
  readonly systemPrompt: string
  readonly messages: readonly CanonicalDispatchMessage[]
  readonly attachments: readonly unknown[]
  readonly tools: readonly unknown[]
  readonly toolChoice: unknown
  readonly thinking: unknown
  readonly contextLayers: readonly string[]
}

export function promptLineageFromEnvelope(envelope: PromptEnvelope): PromptDispatchLineage {
  return Object.freeze({
    origin: envelope.origin,
    policy: envelope.policy,
    rootInputId: envelope.rootInputId,
    rootEnvelopeId: envelope.envelopeId,
    rootPreparedTextHash: envelope.preparedTextHash
  })
}
