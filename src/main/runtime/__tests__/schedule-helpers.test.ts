import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  completeTurnWithFinalEvent: vi.fn(),
  appendSystemEvent: vi.fn(async () => undefined)
}))

vi.mock("../store", () => ({
  getWorkbenchRuntimeStore: () => ({
    completeTurnWithFinalEvent: h.completeTurnWithFinalEvent,
    appendSystemEvent: h.appendSystemEvent
  })
}))

vi.mock("../../agentic/approval", () => ({
  getApprovalConfig: () => ({
    getConfig: () => ({ preset: "custom" })
  })
}))

vi.mock("../guards", () => ({
  explicitGuardVerdictFromText: vi.fn(() => ({ level: "high", status: "block", reasons: ["unsafe output"] })),
  riskVerdictForText: vi.fn(() => ({ level: "low", status: "pass", reasons: [] })),
  guardShouldBlockExecutor: vi.fn((verdict, role) => role === "reviewer" && verdict.status === "block")
}))

import { runCustomScheduleTurn } from "../schedule-helpers"
import { GuardDecisionAdapter } from "../decision-adapters/guard-decision-adapter"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function scheduleInput(emitMemoryCandidates: ReturnType<typeof vi.fn>) {
  const dispatcher = {
    dispatch: vi.fn(async () => ({
      status: "completed",
      results: new Map([["codex", "final schedule secret"]]),
      errors: new Map<string, string>()
    }))
  }
  return {
    dispatcher,
    prompt: "schedule prompt",
    schedule: {
      preset: "firefly-custom",
      label: "Firefly",
      steps: [{ id: "lead", label: "Lead", role: "lead", agentId: "codex" }]
    },
    workspaceId: null,
    turnId: "turn-schedule",
    threadId: "thread-schedule",
    messages: [{ role: "user", content: "schedule prompt" }],
    isCancelled: () => false,
    emitMemoryCandidates
  } as any
}

describe("custom schedule finalization", () => {
  beforeEach(() => {
    h.completeTurnWithFinalEvent.mockReset()
    h.appendSystemEvent.mockClear()
  })

  it("does not import memory when the actor rejects a final release after cancellation", async () => {
    const completion = deferred<boolean>()
    h.completeTurnWithFinalEvent.mockReturnValueOnce(completion.promise)
    const emitMemoryCandidates = vi.fn(async () => undefined)
    const running = runCustomScheduleTurn(scheduleInput(emitMemoryCandidates))

    await vi.waitFor(() => expect(h.completeTurnWithFinalEvent).toHaveBeenCalledOnce())
    completion.resolve(false)

    await expect(running).resolves.toEqual({ status: "cancelled" })
    expect(emitMemoryCandidates).not.toHaveBeenCalled()
    expect(h.completeTurnWithFinalEvent).toHaveBeenCalledWith(
      "turn-schedule",
      expect.objectContaining({
        agentId: "codex",
        payload: expect.objectContaining({ content: "final schedule secret", visibility: "chat" })
      })
    )
  })

  it("imports memory only after the actor commits completion and the final release", async () => {
    h.completeTurnWithFinalEvent.mockResolvedValueOnce(true)
    const emitMemoryCandidates = vi.fn(async () => undefined)

    await expect(runCustomScheduleTurn(scheduleInput(emitMemoryCandidates)))
      .resolves.toEqual({ status: "completed" })
    expect(emitMemoryCandidates).toHaveBeenCalledOnce()
    expect(emitMemoryCandidates).toHaveBeenCalledWith(
      "thread-schedule",
      "turn-schedule",
      "schedule prompt",
      "final schedule secret"
    )
  })

  it("does not invent a parent dispatch ID for a root schedule child", async () => {
    h.completeTurnWithFinalEvent.mockResolvedValueOnce(true)
    const input = scheduleInput(vi.fn(async () => undefined))

    await expect(runCustomScheduleTurn(input)).resolves.toEqual({ status: "completed" })

    const dispatchOptions = input.dispatcher.dispatch.mock.calls[0][3]
    expect(dispatchOptions.parentDispatchId).toBeUndefined()
    expect(dispatchOptions.lineage).toMatchObject({ origin: "internal:schedule", policy: "internal" })
    expect(dispatchOptions.lineage.parentDispatchId).toBeUndefined()
  })

  it("uses the trusted Guard adapter for the same Turn identity", async () => {
    h.completeTurnWithFinalEvent.mockResolvedValueOnce(true)
    const decisionService = {
      request: vi.fn(async () => ({
        requestId: "guard-decision-1",
        status: "selected" as const,
        selectedOptionIds: ["allow-once"],
        resolvedAt: 1
      }))
    }
    const input = scheduleInput(vi.fn(async () => undefined))
    input.workspaceId = "workspace-1"
    input.schedule = {
      preset: "custom",
      label: "Review",
      steps: [{ id: "review", label: "Review", role: "reviewer", agentId: "codex" }]
    }
    input.dispatcher.dispatch.mockResolvedValue({
      status: "completed",
      results: new Map([["codex", "BLOCK: unsafe output"]]),
      errors: new Map<string, string>()
    })
    input.guardDecisionAdapter = new GuardDecisionAdapter({ decisionService })
    input.guardDecisionOwner = {
      type: "turn",
      threadId: "thread-schedule",
      turnId: "turn-schedule",
      workspaceId: "workspace-1",
      webContentsId: 7
    }

    await expect(runCustomScheduleTurn(input)).resolves.toEqual({ status: "completed" })
    expect(decisionService.request).toHaveBeenCalledWith(expect.objectContaining({
      source: "guard",
      owner: input.guardDecisionOwner,
      idempotencyKey: "guard:turn-schedule:review",
      deadlineMs: 300_000
    }))
  })
})
