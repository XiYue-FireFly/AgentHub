import { randomUUID } from "node:crypto"
import type {
  CanonicalDispatchPayload,
  DispatchEnvelope,
  PromptDispatchLineage
} from "../../shared/prompt-contract"
import { canonicalJson, sha256Hex } from "../../prompt-core/canonical-json"

export function canonicalProviderPayload(input: {
  providerId: string
  modelId: string
  protocol: string
  systemPrompt?: string
  messages: readonly unknown[]
  attachments?: readonly unknown[]
  tools?: readonly unknown[]
  toolChoice?: unknown
  thinking?: unknown
  contextLayers?: readonly string[]
}): CanonicalDispatchPayload {
  return Object.freeze({
    providerId: input.providerId,
    modelId: input.modelId,
    protocol: input.protocol,
    systemPrompt: input.systemPrompt || "",
    messages: Object.freeze(input.messages.map(message => Object.freeze({ ...(message as object) }))) as CanonicalDispatchPayload["messages"],
    attachments: Object.freeze([...(input.attachments || [])]),
    tools: Object.freeze([...(input.tools || [])]),
    toolChoice: input.toolChoice === undefined ? null : input.toolChoice,
    thinking: input.thinking === undefined ? null : input.thinking,
    contextLayers: Object.freeze([...(input.contextLayers || [])])
  })
}

export function createDispatchId(): string {
  return randomUUID()
}

export function createDispatchEnvelope(input: {
  dispatchId: string
  lineage: PromptDispatchLineage
  payload: CanonicalDispatchPayload
}): DispatchEnvelope {
  return Object.freeze({
    dispatchId: input.dispatchId,
    ...input.lineage,
    providerId: input.payload.providerId,
    modelId: input.payload.modelId,
    canonicalPayloadHash: sha256Hex(canonicalJson(input.payload)),
    optimizationCount: 0
  })
}

export function verifyDispatchEnvelope(
  envelope: DispatchEnvelope,
  payload: CanonicalDispatchPayload
): void {
  if (envelope.providerId !== payload.providerId || envelope.modelId !== payload.modelId) {
    throw new Error("DispatchEnvelope provider/model mismatch")
  }
  const currentHash = sha256Hex(canonicalJson(payload))
  if (currentHash !== envelope.canonicalPayloadHash) {
    throw new Error("DispatchEnvelope canonical payload hash mismatch")
  }
}

export function childDispatchLineage(
  parent: PromptDispatchLineage,
  parentDispatchId: string | undefined,
  origin: PromptDispatchLineage["origin"]
): PromptDispatchLineage {
  return Object.freeze({
    origin,
    policy: "internal",
    rootInputId: parent.rootInputId,
    rootEnvelopeId: parent.rootEnvelopeId,
    rootPreparedTextHash: parent.rootPreparedTextHash,
    ...(parentDispatchId ? { parentDispatchId } : {})
  })
}
