import { describe, expect, it } from "vitest"
import { hashPromptText } from "../canonical-json"
import {
  analyzePrompt,
  finalizePromptEnvelope,
  PROMPT_OPTIMIZER_VERSION,
  shouldGeneratePromptCandidates,
  startPromptPreparation,
  withPreparationState
} from "../prompt-preparation-core"

describe("Prompt preparation core", () => {
  it.each([
    ["Run the test suite", "clear"],
    ["运行测试", "clear"],
    ["Fix this", "ambiguous"],
    ["帮我处理一下", "ambiguous"],
    ["Review every issue in the entire project", "broad"],
    ["检查整个项目的所有问题", "broad"],
    ["Optimize this prompt for implementation", "explicit-optimization"],
    ["请优化提示词", "explicit-optimization"],
    ["帮我改写提示词", "explicit-optimization"],
    ["润色 prompt", "explicit-optimization"]
  ] as const)("classifies %s as %s", (prompt, clarity) => {
    const analysis = analyzePrompt(prompt)

    expect(analysis.clarity).toBe(clarity)
    expect(Object.isFrozen(analysis)).toBe(true)
    expect(Object.isFrozen(analysis.signals)).toBe(true)
  })

  it("does not mistake unrelated optimizer language for an explicit request", () => {
    expect(analyzePrompt("Explain optimizer statistics in this code").clarity)
      .not.toBe("explicit-optimization")
  })

  it.each([
    ["clear", false],
    ["ambiguous", true],
    ["broad", true],
    ["explicit-optimization", true]
  ] as const)("generates candidates only for %s prompts when appropriate", (clarity, expected) => {
    expect(shouldGeneratePromptCandidates({ clarity, signals: [] })).toBe(expected)
  })

  it("uses the stable optimizer version", () => {
    expect(PROMPT_OPTIMIZER_VERSION).toBe("prompt-preparation-v1")
  })

  it("starts one frozen optimize session with trimmed input hash and retry lineage", () => {
    const session = startPromptPreparation({
      sessionId: "session-1",
      rootInputId: "input-1",
      origin: "workbench:create",
      policy: "optimize",
      prompt: "  Run tests  ",
      retryOfEnvelopeId: "envelope-previous"
    })

    expect(session).toMatchObject({
      state: "analyzing",
      preparationCount: 1,
      optimizationCount: 1,
      candidateAttemptCount: 0,
      retryOfEnvelopeId: "envelope-previous",
      inputHash: hashPromptText("Run tests")
    })
    expect(Object.isFrozen(session)).toBe(true)
  })

  it.each(["structured", "passthrough", "internal"] as const)(
    "does not count %s preparation as optimization",
    policy => {
      const session = startPromptPreparation({
        sessionId: `session-${policy}`,
        rootInputId: "input-1",
        origin: "workbench:create",
        policy,
        prompt: "Run tests"
      })

      expect(session.optimizationCount).toBe(0)
    }
  )

  it("updates nonterminal sessions immutably and tracks candidate attempts", () => {
    const session = startPromptPreparation({
      sessionId: "session-2",
      rootInputId: "input-2",
      origin: "workbench:create",
      policy: "structured",
      prompt: "Run tests"
    })

    const updated = withPreparationState(session, "awaiting-decision", 2)

    expect(updated).toMatchObject({ state: "awaiting-decision", candidateAttemptCount: 2 })
    expect(session).toMatchObject({ state: "analyzing", candidateAttemptCount: 0 })
    expect(updated).not.toBe(session)
    expect(Object.isFrozen(updated)).toBe(true)
  })

  it.each(["finalized", "cancelled", "failed"] as const)(
    "rejects updates to %s sessions",
    state => {
      const session = startPromptPreparation({
        sessionId: `terminal-${state}`,
        rootInputId: "input-terminal",
        origin: "workbench:create",
        policy: "passthrough",
        prompt: "Run tests"
      })

      const terminal = withPreparationState(session, state)

      expect(() => withPreparationState(terminal, "awaiting-decision"))
        .toThrow("Prompt preparation is already terminal")
    }
  )

  it("finalizes from awaiting decision with trimmed immutable text and lineage", () => {
    const session = startPromptPreparation({
      sessionId: "session-3",
      rootInputId: "input-3",
      origin: "quick-complete:inline-edit",
      policy: "optimize",
      prompt: "Run tests"
    })
    const awaitingDecision = withPreparationState(session, "awaiting-decision")

    const envelope = finalizePromptEnvelope({
      session: awaitingDecision,
      envelopeId: "envelope-3",
      displayOriginalPrompt: "  Run tests  ",
      effectivePrompt: "  Run the complete repository test suite.  ",
      status: "optimized",
      optimizerVersion: PROMPT_OPTIMIZER_VERSION,
      finalizedAt: 123
    })

    expect(envelope).toMatchObject({
      sessionId: "session-3",
      rootInputId: "input-3",
      displayOriginalPrompt: "Run tests",
      effectivePrompt: "Run the complete repository test suite.",
      origin: "quick-complete:inline-edit",
      policy: "optimize",
      inputHash: session.inputHash,
      preparedTextHash: hashPromptText("Run the complete repository test suite."),
      optimizationCount: 1
    })
    expect(envelope.preparedTextHash).not.toBe(envelope.inputHash)
    expect(Object.isFrozen(envelope)).toBe(true)
  })

  it.each(["finalized", "cancelled", "failed"] as const)(
    "rejects %s finalization with its state in the error",
    state => {
      const session = withPreparationState(startPromptPreparation({
        sessionId: `session-${state}`,
        rootInputId: "input-4",
        origin: "workbench:create",
        policy: "structured",
        prompt: "Run tests"
      }), state)

      expect(() => finalizePromptEnvelope({
        session,
        envelopeId: "envelope-4",
        displayOriginalPrompt: "Run tests",
        effectivePrompt: "Run tests",
        status: "structured",
        optimizerVersion: PROMPT_OPTIMIZER_VERSION,
        finalizedAt: 124
      })).toThrow(`Prompt preparation cannot finalize from ${state}`)
    }
  )

  it("rejects envelopes with empty original or effective prompt text", () => {
    const session = startPromptPreparation({
      sessionId: "session-5",
      rootInputId: "input-5",
      origin: "workbench:create",
      policy: "passthrough",
      prompt: "Run tests"
    })
    const base = {
      session,
      envelopeId: "envelope-5",
      status: "passthrough" as const,
      optimizerVersion: PROMPT_OPTIMIZER_VERSION,
      finalizedAt: 125
    }

    expect(() => finalizePromptEnvelope({ ...base, displayOriginalPrompt: "  ", effectivePrompt: "Run tests" }))
      .toThrow("Prompt envelope text must not be empty")
    expect(() => finalizePromptEnvelope({ ...base, displayOriginalPrompt: "Run tests", effectivePrompt: "  " }))
      .toThrow("Prompt envelope text must not be empty")
  })

  it("rejects a non-empty display original that does not match the session input", () => {
    const session = startPromptPreparation({
      sessionId: "session-6",
      rootInputId: "input-6",
      origin: "workbench:create",
      policy: "passthrough",
      prompt: "Run tests"
    })

    expect(() => finalizePromptEnvelope({
      session,
      envelopeId: "envelope-6",
      displayOriginalPrompt: "Run builds",
      effectivePrompt: "Run builds",
      status: "passthrough",
      optimizerVersion: PROMPT_OPTIMIZER_VERSION,
      finalizedAt: 126
    })).toThrow("Prompt envelope original prompt does not match session input")
  })
})
