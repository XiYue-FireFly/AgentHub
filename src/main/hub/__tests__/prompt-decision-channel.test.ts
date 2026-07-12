import { describe, expect, it, vi } from "vitest"
import type { DecisionResolution } from "../../../shared/decision-contract"
import {
  HUB_PROMPT_DECISION_FRAME_MAX_BYTES,
  HubPromptDecisionChannel
} from "../prompt-decision-channel"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function decisionInput(overrides: Record<string, unknown> = {}) {
  return {
    owner: { type: "hub" as const, sessionId: "hub-a" },
    sessionId: "prompt-session-a",
    origin: "hub:websocket" as const,
    attempt: 1,
    originalPrompt: "Fix it",
    candidates: ["Repair only the failing login flow.", "Audit the login module and repair the root cause."],
    retryAllowed: false,
    ...overrides
  }
}

function fixture(supportsProtocol = true) {
  const waiting = deferred<DecisionResolution>()
  const send = vi.fn()
  const decisions = {
    request: vi.fn((request: any, options?: { onAdmitted?: (request: any) => void }) => {
      options?.onAdmitted?.(request)
      return waiting.promise
    }),
    resolve: vi.fn(async (submission: any, sender: any) => {
      waiting.resolve({
        requestId: submission.requestId,
        status: submission.outcome === "submitted" ? "submitted" : submission.outcome === "cancelled" ? "cancelled" : "selected",
        selectedOptionIds: submission.selectedOptionIds,
        text: submission.customText,
        resolvedAt: 1
      })
      return { accepted: true as const, sender }
    })
  }
  return {
    send,
    decisions,
    channel: new HubPromptDecisionChannel({
      sessionId: "hub-a",
      supportsProtocol,
      decisions: decisions as any,
      send
    })
  }
}

describe("HubPromptDecisionChannel", () => {
  it("emits a bounded request and resumes the same awaiting Hub preparation", async () => {
    const subject = fixture()
    const preparation = subject.channel.decide(decisionInput())

    await vi.waitFor(() => expect(subject.send).toHaveBeenCalledOnce())
    const frame = subject.send.mock.calls[0]?.[0]
    expect(frame).toMatchObject({
      type: "prompt:decision_request",
      payload: {
        sessionId: "hub-a",
        candidates: [
          "Repair only the failing login flow.",
          "Audit the login module and repair the root cause."
        ]
      }
    })
    expect(Buffer.byteLength(JSON.stringify(frame), "utf8")).toBeLessThanOrEqual(HUB_PROMPT_DECISION_FRAME_MAX_BYTES)

    await expect(subject.channel.resolve({
      type: "prompt:decision_resolve",
      payload: {
        requestId: frame.payload.requestId,
        sessionId: "hub-a",
        kind: "candidate",
        candidateIndex: 0
      }
    }, { type: "hub", sessionId: "hub-a" })).resolves.toMatchObject({ accepted: true })
    await expect(preparation).resolves.toEqual({ kind: "candidate", index: 0 })
    expect(subject.decisions.resolve).toHaveBeenCalledWith(expect.objectContaining({
      requestId: frame.payload.requestId,
      outcome: "selected",
      selectedOptionIds: ["candidate-0"]
    }), { type: "hub", sessionId: "hub-a" })
  })

  it("rejects a resolver outside the authenticated Hub session without resuming", async () => {
    const subject = fixture()
    const preparation = subject.channel.decide(decisionInput())
    await vi.waitFor(() => expect(subject.send).toHaveBeenCalledOnce())
    const frame = subject.send.mock.calls[0]?.[0]

    await expect(subject.channel.resolve({
      type: "prompt:decision_resolve",
      payload: { requestId: frame.payload.requestId, sessionId: "hub-a", kind: "original" }
    }, { type: "hub", sessionId: "hub-b" })).resolves.toEqual({ accepted: false })
    expect(subject.decisions.resolve).not.toHaveBeenCalled()

    await subject.channel.resolve({
      type: "prompt:decision_resolve",
      payload: { requestId: frame.payload.requestId, sessionId: "hub-a", kind: "cancel" }
    }, { type: "hub", sessionId: "hub-a" })
    await expect(preparation).resolves.toEqual({ kind: "cancelled" })
  })

  it("returns decision-required without creating a continuation for a client without protocol support", async () => {
    const subject = fixture(false)

    await expect(subject.channel.decide(decisionInput())).resolves.toEqual({ kind: "decision-required" })
    expect(subject.decisions.request).not.toHaveBeenCalled()
    expect(subject.send).not.toHaveBeenCalled()
  })

  it("keeps separate prompt sessions from sharing a Hub decision idempotency key", async () => {
    const subject = fixture()
    void subject.channel.decide(decisionInput({ sessionId: "prompt-session-a" }))
    void subject.channel.decide(decisionInput({ sessionId: "prompt-session-b" }))

    await vi.waitFor(() => expect(subject.decisions.request).toHaveBeenCalledTimes(2))
    const [first, second] = subject.decisions.request.mock.calls.map(([request]) => request)
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
  })
})
