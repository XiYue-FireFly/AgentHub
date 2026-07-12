import type {
  PromptDecisionCapability,
  PromptEnvelope,
  PromptOrigin,
  PromptPreparationSession
} from "../../shared/prompt-contract"
import type { DecisionOwner } from "../../shared/decision-contract"
import { hashPromptText } from "../../prompt-core/canonical-json"
import { LruCache } from "../../prompt-core/lru-cache"
import {
  PROMPT_OPTIMIZER_VERSION,
  analyzePrompt,
  finalizePromptEnvelope,
  shouldGeneratePromptCandidates,
  startPromptPreparation,
  withPreparationState
} from "../../prompt-core/prompt-preparation-core"
import { buildPromptArtifactCacheKey } from "../../prompt-core/prompt-candidate-validator"
import { requirePromptIngress } from "./prompt-ingress-registry"

export interface PromptCacheContext {
  readonly locale: string
  readonly contextSignature: string
  readonly pluginSignature: string
  readonly skillSignature: string
  readonly attachmentSignature: string
  readonly providerId: string
  readonly modelId: string
}

export type PromptSelection =
  | { readonly kind: "original" }
  | { readonly kind: "candidate"; readonly index: number }
  | { readonly kind: "custom"; readonly text: string }
  | { readonly kind: "retry-candidates" }
  | { readonly kind: "decision-required" }
  | { readonly kind: "cancelled" }

export interface PromptDecisionInput {
  readonly owner?: DecisionOwner
  readonly sessionId: string
  readonly origin: PromptOrigin
  readonly attempt: number
  readonly originalPrompt: string
  readonly candidates: readonly string[]
  readonly candidateError?: string
  readonly retryAllowed: boolean
}

export interface PromptDecisionPort {
  decide(input: PromptDecisionInput): Promise<PromptSelection>
}

export interface PromptDecisionPortRouter {
  for(origin: PromptOrigin, capability: PromptDecisionCapability): PromptDecisionPort
}

export type PromptPreparationOutcome =
  | { readonly kind: "ready"; readonly session: PromptPreparationSession; readonly envelope: PromptEnvelope; readonly artifact: unknown }
  | { readonly kind: "decision-required"; readonly session: PromptPreparationSession; readonly candidates: readonly string[]; readonly candidateError?: string }
  | { readonly kind: "cancelled"; readonly session: PromptPreparationSession }
  | { readonly kind: "failed"; readonly session: PromptPreparationSession; readonly error: string }

interface PromptPreparationDependencies {
  readonly id: (prefix: string) => string
  readonly now: () => number
  readonly audit: (event: { kind: string; payload: Record<string, unknown> }) => void
  readonly optimize: (prompt: string, context: PromptCacheContext) => { optimizedPrompt: string; artifact: unknown }
  readonly generateCandidates: (prompt: string, context: PromptCacheContext) => Promise<readonly string[]>
  readonly decisionPorts: PromptDecisionPortRouter
}

export class PromptPreparationService {
  private readonly candidateCache = new LruCache<string, readonly string[]>({
    capacity: 128,
    ttlMs: 30 * 60 * 1_000
  })
  private readonly terminalSessions = new Set<string>()

  constructor(private readonly deps: PromptPreparationDependencies) {}

  async prepareRoot(input: {
    origin: PromptOrigin
    prompt: string
    cacheContext: PromptCacheContext
    decisionOwner?: DecisionOwner
    reuseEnvelope?: PromptEnvelope
    retryStrategy?: "reuse-selection" | "reoptimize"
  }): Promise<PromptPreparationOutcome> {
    const ingress = requirePromptIngress(input.origin)
    if (ingress.scope === "none") throw new Error("Ingress does not create a Prompt session")

    const original = String(input.prompt).trim()
    const session = startPromptPreparation({
      sessionId: this.deps.id("prompt-session"),
      rootInputId: this.deps.id("root-input"),
      origin: input.origin,
      policy: ingress.policy,
      prompt: original,
      retryOfEnvelopeId: input.reuseEnvelope?.envelopeId
    })
    if (!this.emitAudit({ kind: "prompt:preparation-started", payload: this.sessionAudit(session) })) {
      return this.failed(session, new Error("Prompt preparation audit failed"))
    }

    try {
      if (input.reuseEnvelope && input.retryStrategy !== "reoptimize") {
        this.assertReusableEnvelope(session, original, input.reuseEnvelope)
      }
      const cacheKey = this.cacheKey(session, input.cacheContext, ingress.decisionCapability)
      let artifact: unknown
      let optimizedPrompt = original
      if (ingress.policy === "optimize") {
        const optimized = this.deps.optimize(original, input.cacheContext)
        optimizedPrompt = String(optimized.optimizedPrompt).trim()
        artifact = optimized.artifact
      }

      if (input.reuseEnvelope && input.retryStrategy !== "reoptimize") {
        return this.ready(session, original, input.reuseEnvelope.effectivePrompt, "reused-selection", artifact)
      }
      if (ingress.policy === "structured") {
        return this.ready(session, original, original, "structured", artifact)
      }
      if (ingress.policy !== "optimize") {
        return this.ready(session, original, original, "passthrough", artifact)
      }

      const analysis = analyzePrompt(original)
      if (!shouldGeneratePromptCandidates(analysis)) {
        return this.ready(session, original, optimizedPrompt, optimizedPrompt === original ? "unchanged" : "optimized", artifact)
      }

      return await this.resolveCandidateDecision({
        session,
        original,
        artifact,
        cacheKey,
        cacheContext: input.cacheContext,
        owner: input.decisionOwner,
        capability: ingress.decisionCapability
      })
    } catch (error) {
      return this.failed(session, error)
    }
  }

  private async resolveCandidateDecision(input: {
    session: PromptPreparationSession
    original: string
    artifact: unknown
    cacheKey: string
    cacheContext: PromptCacheContext
    owner?: DecisionOwner
    capability: PromptDecisionCapability
  }): Promise<PromptPreparationOutcome> {
    const maxAttempts = 3
    let session = input.session
    while (session.candidateAttemptCount < maxAttempts) {
      const attempt = session.candidateAttemptCount + 1
      session = withPreparationState(session, "awaiting-decision", attempt)
      const cached = this.candidateCache.get(input.cacheKey)
      let candidates = cached ?? Object.freeze([] as string[])
      let candidateError: string | undefined
      if (!cached) {
        try {
          const generated = await this.deps.generateCandidates(input.original, input.cacheContext)
          if (!Array.isArray(generated) || generated.some(candidate => typeof candidate !== "string")) {
            throw new Error("Prompt candidate generator returned invalid candidates")
          }
          candidates = Object.freeze([...generated])
          this.candidateCache.set(input.cacheKey, candidates)
        } catch (error) {
          candidateError = error instanceof Error ? error.message : String(error)
        }
      }
      if (!this.emitAudit({
        kind: "prompt:candidate-attempted",
        payload: {
          ...this.sessionAudit(session),
          attempt,
          status: candidateError ? "failed" : "validated",
          cacheStatus: cached ? "hit" : "miss",
          candidateCount: candidates.length
        }
      })) {
        return this.failed(session, new Error("Prompt preparation audit failed"))
      }

      const selection = await this.deps.decisionPorts.for(session.origin, input.capability).decide({
        owner: input.owner,
        sessionId: session.sessionId,
        origin: session.origin,
        attempt,
        originalPrompt: input.original,
        candidates,
        candidateError,
        retryAllowed: Boolean(candidateError) && attempt < maxAttempts
      })
      if (!selection || typeof selection !== "object" || !("kind" in selection)) {
        throw new Error("Prompt decision returned an invalid selection")
      }
      if (selection.kind === "retry-candidates") {
        if (!candidateError || attempt >= maxAttempts) throw new Error("Prompt candidate retry is not available")
        continue
      }
      if (selection.kind === "decision-required") {
        return Object.freeze({ kind: "decision-required", session, candidates, candidateError })
      }
      if (selection.kind === "cancelled") return this.cancelled(session)
      if (selection.kind === "original") return this.ready(session, input.original, input.original, "unchanged", input.artifact)
      if (selection.kind === "custom") {
        if (typeof selection.text !== "string" || !selection.text.trim()) {
          throw new Error("Prompt decision returned an invalid custom selection")
        }
        return this.ready(session, input.original, selection.text, "custom-selected", input.artifact)
      }
      if (selection.kind === "candidate") {
        if (!Number.isInteger(selection.index) || selection.index < 0) {
          throw new Error("Prompt candidate selection is out of range")
        }
        const selected = candidates[selection.index]
        if (!selected) throw new Error("Prompt candidate selection is out of range")
        return this.ready(session, input.original, selected, "candidate-selected", input.artifact)
      }
      throw new Error("Prompt decision returned an unknown selection")
    }
    throw new Error("Prompt candidate attempt limit reached without a decision")
  }

  private ready(
    session: PromptPreparationSession,
    originalPrompt: string,
    effectivePrompt: string,
    status: PromptEnvelope["status"],
    artifact: unknown
  ): PromptPreparationOutcome {
    const envelope = finalizePromptEnvelope({
      session,
      envelopeId: this.deps.id("prompt-envelope"),
      displayOriginalPrompt: originalPrompt,
      effectivePrompt,
      status,
      optimizerVersion: PROMPT_OPTIMIZER_VERSION,
      finalizedAt: this.deps.now()
    })
    const terminal = Object.freeze({ ...session, state: "finalized" as const })
    if (!this.emitAudit({
      kind: "prompt:prepared",
      payload: {
        envelopeId: envelope.envelopeId,
        sessionId: envelope.sessionId,
        rootInputId: envelope.rootInputId,
        origin: envelope.origin,
        policy: envelope.policy,
        state: terminal.state,
        status: envelope.status,
        optimizerVersion: envelope.optimizerVersion,
        inputHash: envelope.inputHash,
        preparedTextHash: envelope.preparedTextHash,
        optimizationCount: envelope.optimizationCount
      }
    })) {
      return this.failed(session, new Error("Prompt preparation audit failed"))
    }
    this.claimTerminal(session.sessionId)
    return Object.freeze({ kind: "ready", session: terminal, envelope, artifact })
  }

  private cancelled(session: PromptPreparationSession): PromptPreparationOutcome {
    this.claimTerminal(session.sessionId)
    const terminal = Object.freeze({ ...session, state: "cancelled" as const })
    this.emitAudit({ kind: "prompt:preparation-cancelled", payload: this.sessionAudit(terminal) })
    return Object.freeze({ kind: "cancelled", session: terminal })
  }

  private failed(session: PromptPreparationSession, error: unknown): PromptPreparationOutcome {
    this.claimTerminal(session.sessionId)
    const terminal = Object.freeze({ ...session, state: "failed" as const })
    this.emitAudit({
      kind: "prompt:preparation-failed",
      payload: { ...this.sessionAudit(terminal), errorCode: "prompt-preparation-failed" }
    })
    return Object.freeze({
      kind: "failed",
      session: terminal,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  private cacheKey(
    session: PromptPreparationSession,
    context: PromptCacheContext,
    capability: PromptDecisionCapability
  ): string {
    return buildPromptArtifactCacheKey({
      inputHash: session.inputHash,
      optimizerVersion: PROMPT_OPTIMIZER_VERSION,
      generatorVersion: "prompt-candidate-generator-v1",
      templateVersion: "prompt-candidate-template-v1",
      schemaVersion: "prompt-candidates-v1",
      policy: session.policy,
      origin: session.origin,
      interactionPolicy: capability,
      locale: context.locale,
      contextSignature: context.contextSignature,
      pluginSignature: context.pluginSignature,
      skillSignature: context.skillSignature,
      attachmentSignature: context.attachmentSignature,
      providerId: context.providerId,
      modelId: context.modelId
    })
  }

  private claimTerminal(sessionId: string): void {
    if (this.terminalSessions.has(sessionId)) throw new Error("Prompt preparation already terminal")
    this.terminalSessions.add(sessionId)
  }

  private assertReusableEnvelope(
    session: PromptPreparationSession,
    originalPrompt: string,
    reuseEnvelope: PromptEnvelope
  ): void {
    if (session.origin !== "workbench:retry") {
      throw new Error("Prompt reuse requires a workbench retry ingress")
    }
    const previousOriginal = String(reuseEnvelope.displayOriginalPrompt).trim()
    const previousHash = hashPromptText(previousOriginal)
    if (
      !previousOriginal ||
      previousOriginal !== originalPrompt ||
      reuseEnvelope.inputHash !== previousHash ||
      session.inputHash !== previousHash
    ) {
      throw new Error("Prompt reuse envelope does not match the current original input")
    }
  }

  private emitAudit(event: { kind: string; payload: Record<string, unknown> }): boolean {
    try {
      this.deps.audit(event)
      return true
    } catch {
      return false
    }
  }

  private sessionAudit(session: PromptPreparationSession): Record<string, unknown> {
    return {
      sessionId: session.sessionId,
      rootInputId: session.rootInputId,
      origin: session.origin,
      policy: session.policy,
      state: session.state,
      inputHash: session.inputHash,
      preparationCount: session.preparationCount,
      optimizationCount: session.optimizationCount,
      candidateAttemptCount: session.candidateAttemptCount,
      ...(session.retryOfEnvelopeId === undefined ? {} : { retryOfEnvelopeId: session.retryOfEnvelopeId })
    }
  }
}
