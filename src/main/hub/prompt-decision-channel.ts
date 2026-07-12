import type {
  DecisionRequest,
  DecisionResolution,
  DecisionResolveResult,
  DecisionSubmission
} from "../../shared/decision-contract"
import { createPromptDecisionRequest } from "../runtime/decision-request-factories"
import type { DecisionRequestOptions } from "../runtime/decision-service"
import type {
  PromptDecisionInput,
  PromptDecisionPort,
  PromptSelection
} from "../runtime/prompt-preparation-service"

export const HUB_PROMPT_DECISION_FRAME_MAX_BYTES = 64 * 1024
export const HUB_PROMPT_DECISION_MAX_CANDIDATES = 3
export const HUB_PROMPT_DECISION_MAX_CANDIDATE_CHARS = 16 * 1024
export const HUB_PROMPT_DECISION_MAX_CUSTOM_CHARS = 512 * 1024

export type DecisionResolverScope =
  | { readonly type: "webContents"; readonly webContentsId: number; readonly workspaceId: string | null }
  | { readonly type: "hub"; readonly sessionId: string }

export interface HubPromptDecisionRequestFrame {
  readonly type: "prompt:decision_request"
  readonly payload: {
    readonly requestId: string
    readonly sessionId: string
    readonly attempt: number
    readonly originalPreview: string
    readonly candidates: readonly string[]
    readonly candidateError?: string
    readonly retryAllowed: boolean
    readonly maxCustomChars: number
  }
}

export interface HubPromptDecisionResolveFrame {
  readonly type: "prompt:decision_resolve"
  readonly payload: {
    readonly requestId: string
    readonly sessionId: string
    readonly kind: "original" | "candidate" | "custom" | "retry" | "cancel"
    readonly candidateIndex?: number
    readonly customText?: string
  }
}

export type HubPromptDecisionFrame = HubPromptDecisionRequestFrame | HubPromptDecisionResolveFrame

interface HubDecisionService {
  request(request: DecisionRequest, options?: DecisionRequestOptions): Promise<DecisionResolution>
  resolve(submission: DecisionSubmission, sender: DecisionResolverScope): Promise<DecisionResolveResult>
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function preview(value: string, max = HUB_PROMPT_DECISION_MAX_CANDIDATE_CHARS): string {
  const text = String(value)
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

function assertBoundedCandidates(candidates: readonly string[]): void {
  if (candidates.length > HUB_PROMPT_DECISION_MAX_CANDIDATES) {
    throw new Error("Hub Prompt decision has too many candidates")
  }
  if (candidates.some(candidate => typeof candidate !== "string" || candidate.length > HUB_PROMPT_DECISION_MAX_CANDIDATE_CHARS)) {
    throw new Error("Hub Prompt decision candidate exceeds the transport limit")
  }
}

function optionsFor(input: PromptDecisionInput) {
  if (input.candidateError) {
    return [
      ...(input.retryAllowed ? [{ id: "retry-optimization", label: "Retry optimization", description: input.candidateError }] : []),
      { id: "original", label: "Keep original", description: input.originalPrompt }
    ]
  }
  return [
    { id: "original", label: "Keep original", description: input.originalPrompt },
    ...input.candidates.map((candidate, index) => ({
      id: `candidate-${index}`,
      label: `Candidate ${index + 1}`,
      description: candidate
    }))
  ]
}

function toSelection(resolution: DecisionResolution): PromptSelection {
  if (["cancelled", "timeout", "stale", "denied"].includes(resolution.status)) return { kind: "cancelled" }
  if (resolution.status === "submitted" && typeof resolution.text === "string") {
    return { kind: "custom", text: resolution.text }
  }
  if (resolution.status !== "selected") throw new Error("Hub Prompt decision returned an invalid resolution")
  const optionId = resolution.selectedOptionIds?.[0]
  if (optionId === "retry-optimization") return { kind: "retry-candidates" }
  if (optionId === "original") return { kind: "original" }
  const match = /^candidate-(\d+)$/.exec(optionId || "")
  if (!match) throw new Error("Hub Prompt decision returned an unknown option")
  return { kind: "candidate", index: Number(match[1]) }
}

function parseResolve(frame: unknown): DecisionSubmission | null {
  if (!isPlainRecord(frame) || !hasOnlyKeys(frame, ["type", "payload"]) || frame.type !== "prompt:decision_resolve") {
    return null
  }
  if (!isPlainRecord(frame.payload)) return null
  const payload = frame.payload
  if (typeof payload.requestId !== "string" || !payload.requestId || typeof payload.sessionId !== "string" || !payload.sessionId) {
    return null
  }
  if (payload.kind === "original" && hasOnlyKeys(payload, ["requestId", "sessionId", "kind"])) {
    return { requestId: payload.requestId, outcome: "selected", selectedOptionIds: ["original"] }
  }
  if (
    payload.kind === "candidate" &&
    hasOnlyKeys(payload, ["requestId", "sessionId", "kind", "candidateIndex"]) &&
    Number.isInteger(payload.candidateIndex) &&
    (payload.candidateIndex as number) >= 0 &&
    (payload.candidateIndex as number) < HUB_PROMPT_DECISION_MAX_CANDIDATES
  ) {
    return {
      requestId: payload.requestId,
      outcome: "selected",
      selectedOptionIds: [`candidate-${payload.candidateIndex}`]
    }
  }
  if (
    payload.kind === "custom" &&
    hasOnlyKeys(payload, ["requestId", "sessionId", "kind", "customText"]) &&
    typeof payload.customText === "string" &&
    payload.customText.trim().length > 0 &&
    payload.customText.length <= HUB_PROMPT_DECISION_MAX_CUSTOM_CHARS
  ) {
    return { requestId: payload.requestId, outcome: "submitted", customText: payload.customText }
  }
  if (payload.kind === "retry" && hasOnlyKeys(payload, ["requestId", "sessionId", "kind"])) {
    return { requestId: payload.requestId, outcome: "selected", selectedOptionIds: ["retry-optimization"] }
  }
  if (payload.kind === "cancel" && hasOnlyKeys(payload, ["requestId", "sessionId", "kind"])) {
    return { requestId: payload.requestId, outcome: "cancelled" }
  }
  return null
}

/**
 * Bridges one authenticated WebSocket session to a durable DecisionService
 * request. It intentionally trusts only the session captured at connection
 * time; message payloads never choose their own resolver identity.
 */
export class HubPromptDecisionChannel implements PromptDecisionPort {
  constructor(private readonly input: {
    sessionId: string
    supportsProtocol: boolean
    decisions: HubDecisionService
    send(frame: HubPromptDecisionRequestFrame): void
  }) {}

  async decide(input: PromptDecisionInput): Promise<PromptSelection> {
    if (input.owner?.type !== "hub" || input.owner.sessionId !== this.input.sessionId) {
      throw new Error("Hub Prompt decision owner does not match the authenticated session")
    }
    assertBoundedCandidates(input.candidates)
    if (!this.input.supportsProtocol) return { kind: "decision-required" }

    const request = createPromptDecisionRequest({
      owner: { type: "hub", sessionId: this.input.sessionId },
      kind: "single-select",
      title: "Choose the prepared Prompt",
      description: input.candidateError || "The original request is broad or ambiguous.",
      options: optionsFor(input),
      minSelections: 1,
      maxSelections: 1,
      allowCustom: true,
      customInput: { placeholder: "Write another version", maxChars: HUB_PROMPT_DECISION_MAX_CUSTOM_CHARS },
      idempotencyKey: `prompt-session:${input.sessionId}:attempt:${input.attempt}`
    })
    const frame: HubPromptDecisionRequestFrame = {
      type: "prompt:decision_request",
      payload: {
        requestId: request.id,
        sessionId: this.input.sessionId,
        attempt: input.attempt,
        originalPreview: preview(input.originalPrompt),
        candidates: input.candidates.map(candidate => preview(candidate)),
        ...(input.candidateError ? { candidateError: preview(input.candidateError, 1024) } : {}),
        retryAllowed: input.retryAllowed,
        maxCustomChars: HUB_PROMPT_DECISION_MAX_CUSTOM_CHARS
      }
    }
    if (Buffer.byteLength(JSON.stringify(frame), "utf8") > HUB_PROMPT_DECISION_FRAME_MAX_BYTES) {
      throw new Error("Hub Prompt decision frame exceeds the transport limit")
    }
    const resolution = await this.input.decisions.request(request, {
      onAdmitted: () => this.input.send(frame)
    })
    return toSelection(resolution)
  }

  resolve(frame: unknown, scope: DecisionResolverScope): Promise<DecisionResolveResult> {
    if (scope.type !== "hub" || scope.sessionId !== this.input.sessionId) {
      return Promise.resolve({ accepted: false })
    }
    if (!isPlainRecord(frame) || !isPlainRecord(frame.payload) || frame.payload.sessionId !== scope.sessionId) {
      return Promise.resolve({ accepted: false })
    }
    const submission = parseResolve(frame)
    if (!submission) return Promise.resolve({ accepted: false })
    return this.input.decisions.resolve(submission, scope)
  }
}
