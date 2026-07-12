import { describe, expect, it, vi } from "vitest"
import { hashPromptText } from "../../../prompt-core/canonical-json"
import {
  PROMPT_INGRESS_REGISTRY,
  requirePromptIngress
} from "../prompt-ingress-registry"
import {
  PromptPreparationService,
  type PromptDecisionPort,
  type PromptDecisionPortRouter
} from "../prompt-preparation-service"

const cacheContext = {
  locale: "en-US",
  contextSignature: "context",
  pluginSignature: "plugins",
  skillSignature: "skills",
  attachmentSignature: "attachments",
  providerId: "openai",
  modelId: "gpt"
}

function serviceFixture() {
  let sequence = 0
  const audit = vi.fn()
  const optimize = vi.fn((prompt: string) => ({
    optimizedPrompt: `[Prepared] ${prompt}`,
    artifact: { intent: "implementation" }
  }))
  const generateCandidates = vi.fn(async () => [
    "Fix the login regression and run focused tests.",
    "Reproduce the login regression, apply a minimal fix, and verify it."
  ])
  const decide = vi.fn<PromptDecisionPort["decide"]>()
  decide.mockResolvedValue({ kind: "candidate", index: 1 })
  const decisionPort: PromptDecisionPort = { decide }
  const decisionPorts: PromptDecisionPortRouter = { for: vi.fn(() => decisionPort) }
  return {
    audit,
    optimize,
    generateCandidates,
    decide,
    decisionPorts,
    service: new PromptPreparationService({
      id: prefix => `${prefix}-${++sequence}`,
      now: () => 123,
      audit,
      optimize,
      generateCandidates,
      decisionPorts
    })
  }
}

describe("Prompt ingress registry", () => {
  it("covers every contract origin and fails closed for unknown or sessionless ingress", async () => {
    expect(Object.keys(PROMPT_INGRESS_REGISTRY)).toHaveLength(20)
    expect(requirePromptIngress("workbench:create")).toMatchObject({
      policy: "optimize",
      scope: "root",
      decisionCapability: "desktop-inline"
    })
    expect(requirePromptIngress("internal:prompt-candidate")).toMatchObject({
      policy: "internal",
      scope: "none",
      decisionCapability: "none"
    })
    expect(() => requirePromptIngress("unknown:origin" as never)).toThrow("Unregistered Prompt ingress")

    const fixture = serviceFixture()
    await expect(fixture.service.prepareRoot({
      origin: "external-proxy:openai",
      prompt: "Forward this request",
      cacheContext
    })).rejects.toThrow("Ingress does not create a Prompt session")
  })
})

describe("PromptPreparationService", () => {
  it("starts and finalizes exactly one immutable optimize session with audit-safe metadata", async () => {
    const fixture = serviceFixture()
    const prompt = "Run the focused test suite"

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt,
      cacheContext
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.session).toMatchObject({
      state: "finalized",
      preparationCount: 1,
      optimizationCount: 1
    })
    expect(Object.isFrozen(result.session)).toBe(true)
    expect(result.envelope.sessionId).toBe(result.session.sessionId)
    expect(fixture.optimize).toHaveBeenCalledTimes(1)
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:prepared"])
    expect(fixture.audit.mock.calls.map(call => call[0].payload))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ origin: "workbench:create", policy: "optimize", state: "analyzing" }),
        expect.objectContaining({ origin: "workbench:create", policy: "optimize", status: "optimized" })
      ]))
    expect(JSON.stringify(fixture.audit.mock.calls)).not.toContain(prompt)
  })

  it("uses zero optimization count for structured preparation", async () => {
    const fixture = serviceFixture()

    const result = await fixture.service.prepareRoot({
      origin: "quick-complete:sdd-requirements",
      prompt: "Create acceptance criteria",
      cacheContext
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.session).toMatchObject({ policy: "structured", optimizationCount: 0 })
    expect(result.envelope.status).toBe("structured")
    expect(fixture.optimize).not.toHaveBeenCalled()
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:prepared"])
    expect(fixture.audit.mock.calls[1][0].payload).toMatchObject({
      origin: "quick-complete:sdd-requirements",
      policy: "structured",
      status: "structured",
      optimizationCount: 0
    })
  })

  it("recovers candidate generation failure within one session and up to three attempts", async () => {
    const fixture = serviceFixture()
    fixture.generateCandidates.mockRejectedValueOnce(new Error("candidate outage"))
    fixture.decide
      .mockResolvedValueOnce({ kind: "retry-candidates" })
      .mockResolvedValueOnce({ kind: "candidate", index: 0 })

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Fix this",
      cacheContext
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    const decisions = fixture.decide.mock.calls.map(([input]) => input)
    expect(decisions).toHaveLength(2)
    expect(new Set(decisions.map(decision => decision.sessionId)).size).toBe(1)
    expect(decisions.map(decision => decision.attempt)).toEqual([1, 2])
    expect(decisions[0]).toMatchObject({ candidateError: "candidate outage", candidates: [] })
    expect(result.session).toMatchObject({ state: "finalized", candidateAttemptCount: 2 })
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:candidate-attempted", "prompt:candidate-attempted", "prompt:prepared"])
  })

  it.each([
    ["original", { kind: "original" }, "ready", "unchanged"],
    ["custom", { kind: "custom", text: "Use this custom prompt" }, "ready", "custom-selected"],
    ["cancelled", { kind: "cancelled" }, "cancelled", undefined]
  ] as const)("handles %s candidate decisions without a second terminal outcome", async (_name, selection, expectedKind, expectedStatus) => {
    const fixture = serviceFixture()
    fixture.decide.mockResolvedValueOnce(selection)

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Fix this",
      cacheContext
    })

    expect(result.kind).toBe(expectedKind)
    if (result.kind === "ready") expect(result.envelope.status).toBe(expectedStatus)
    expect(fixture.audit.mock.calls.map(call => call[0].kind)).toContain(
      expectedKind === "cancelled" ? "prompt:preparation-cancelled" : "prompt:prepared"
    )
  })

  it("reuses the prior effective selection by default without candidates", async () => {
    const fixture = serviceFixture()
    const previous = {
      envelopeId: "previous-envelope",
      sessionId: "previous-session",
      rootInputId: "previous-input",
      displayOriginalPrompt: "Fix this",
      effectivePrompt: "Reproduce the login failure, fix the root cause, and run focused tests.",
      origin: "workbench:create" as const,
      policy: "optimize" as const,
      status: "candidate-selected" as const,
      optimizerVersion: "prompt-preparation-v1",
      inputHash: hashPromptText("Fix this"),
      preparedTextHash: "previous-prepared-hash",
      optimizationCount: 1 as const,
      finalizedAt: 1
    }

    const result = await fixture.service.prepareRoot({
      origin: "workbench:retry",
      prompt: previous.displayOriginalPrompt,
      reuseEnvelope: previous,
      cacheContext
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(result.envelope).toMatchObject({
      status: "reused-selection",
      effectivePrompt: previous.effectivePrompt,
      optimizationCount: 1
    })
    expect(result.session.retryOfEnvelopeId).toBe(previous.envelopeId)
    expect(fixture.generateCandidates).not.toHaveBeenCalled()
    expect(fixture.optimize).toHaveBeenCalledWith(previous.displayOriginalPrompt, cacheContext)
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:prepared"])
    expect(fixture.audit.mock.calls[1][0].payload).toMatchObject({
      origin: "workbench:retry",
      policy: "optimize",
      status: "reused-selection",
      optimizationCount: 1
    })
  })

  it("explicit reoptimization starts from the original and never the previous effective prompt", async () => {
    const fixture = serviceFixture()
    const previous = {
      envelopeId: "previous-envelope",
      sessionId: "previous-session",
      rootInputId: "previous-input",
      displayOriginalPrompt: "Fix this",
      effectivePrompt: "Old selected effective prompt",
      origin: "workbench:create" as const,
      policy: "optimize" as const,
      status: "candidate-selected" as const,
      optimizerVersion: "prompt-preparation-v1",
      inputHash: "previous-input-hash",
      preparedTextHash: "previous-prepared-hash",
      optimizationCount: 1 as const,
      finalizedAt: 1
    }

    const result = await fixture.service.prepareRoot({
      origin: "workbench:retry",
      prompt: previous.displayOriginalPrompt,
      reuseEnvelope: previous,
      retryStrategy: "reoptimize",
      cacheContext
    })

    expect(result.kind).toBe("ready")
    if (result.kind !== "ready") return
    expect(fixture.generateCandidates).toHaveBeenCalledWith(previous.displayOriginalPrompt, cacheContext)
    expect(fixture.generateCandidates).not.toHaveBeenCalledWith(previous.effectivePrompt, cacheContext)
    expect(result.envelope).toMatchObject({ status: "candidate-selected" })
    expect(result.envelope.effectivePrompt).not.toBe(previous.effectivePrompt)
  })

  it.each([
    ["different display original", "Different request", hashPromptText("Different request")],
    ["tampered input hash", "Fix this", "tampered-input-hash"]
  ])("fails closed before reusing an envelope with %s", async (_name, displayOriginalPrompt, inputHash) => {
    const fixture = serviceFixture()
    const reuseEnvelope = {
      envelopeId: "previous-envelope",
      sessionId: "previous-session",
      rootInputId: "previous-input",
      displayOriginalPrompt,
      effectivePrompt: "Never use this effective prompt",
      origin: "workbench:create" as const,
      policy: "optimize" as const,
      status: "candidate-selected" as const,
      optimizerVersion: "prompt-preparation-v1",
      inputHash,
      preparedTextHash: "previous-prepared-hash",
      optimizationCount: 1 as const,
      finalizedAt: 1
    }

    const result = await fixture.service.prepareRoot({
      origin: "workbench:retry",
      prompt: "Fix this",
      reuseEnvelope,
      cacheContext
    })

    expect(result).toMatchObject({ kind: "failed", session: { state: "failed" } })
    expect(fixture.generateCandidates).not.toHaveBeenCalled()
  })

  it("keeps cache entries free of session ownership and creates fresh lineage", async () => {
    const fixture = serviceFixture()
    const input = { origin: "workbench:create" as const, prompt: "Fix this", cacheContext }

    const first = await fixture.service.prepareRoot(input)
    const second = await fixture.service.prepareRoot(input)

    expect(first.kind).toBe("ready")
    expect(second.kind).toBe("ready")
    if (first.kind !== "ready" || second.kind !== "ready") return
    expect(first.session.sessionId).not.toBe(second.session.sessionId)
    expect(first.envelope.envelopeId).not.toBe(second.envelope.envelopeId)
    expect(fixture.generateCandidates).toHaveBeenCalledTimes(1)
  })

  it("fails closed for an invalid candidate selection without preparing an envelope", async () => {
    const fixture = serviceFixture()
    fixture.decide.mockResolvedValueOnce({ kind: "candidate", index: 99 })

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Fix this",
      cacheContext
    })

    expect(result).toMatchObject({ kind: "failed", session: { state: "failed" } })
    expect(fixture.audit.mock.calls.map(call => call[0].kind)).toEqual([
      "prompt:preparation-started",
      "prompt:candidate-attempted",
      "prompt:preparation-failed"
    ])
  })

  it("returns a failed terminal outcome when started audit throws", async () => {
    const fixture = serviceFixture()
    fixture.audit.mockImplementationOnce(() => { throw new Error("audit unavailable") })

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Run tests",
      cacheContext
    })

    expect(result).toMatchObject({ kind: "failed", session: { state: "failed" } })
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:preparation-failed"])
  })

  it("returns one failed terminal outcome when prepared audit throws", async () => {
    const fixture = serviceFixture()
    fixture.audit
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error("audit unavailable") })
      .mockImplementationOnce(() => undefined)

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Run tests",
      cacheContext
    })

    expect(result).toMatchObject({ kind: "failed", session: { state: "failed" } })
    expect(fixture.audit.mock.calls.map(call => call[0].kind))
      .toEqual(["prompt:preparation-started", "prompt:prepared", "prompt:preparation-failed"])
  })

  it("does not leak a failed-audit exception after a fail-closed selection", async () => {
    const fixture = serviceFixture()
    fixture.decide.mockResolvedValueOnce({ kind: "candidate", index: 99 })
    fixture.audit.mockImplementation(event => {
      if (event.kind === "prompt:preparation-failed") throw new Error("audit unavailable")
    })

    const result = await fixture.service.prepareRoot({
      origin: "workbench:create",
      prompt: "Fix this",
      cacheContext
    })

    expect(result).toMatchObject({ kind: "failed", session: { state: "failed" } })
  })
})
