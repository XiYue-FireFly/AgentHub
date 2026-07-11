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
    getConfig: () => ({ preset: "full-access" })
  })
}))

vi.mock("../guard-approval-service", () => ({
  emitGuardVerdict: vi.fn(async () => undefined),
  requestGuardApproval: vi.fn(async () => ({ requestId: "guard-1", decision: "approved" })),
  executorVerdictNeedsApproval: vi.fn(() => false)
}))

vi.mock("../guards", () => ({
  guardShouldBlockExecutor: vi.fn(() => false)
}))

import { runCustomScheduleTurn } from "../schedule-helpers"

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
})
