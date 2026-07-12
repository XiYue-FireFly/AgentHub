import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DecisionRequest, DecisionResolution } from "../../../shared/decision-contract"
import type { DurableDecisionRecord, QueuedThreadSubmission } from "../types"
import type { RuntimeMutation } from "../store"

const memory: Record<string, any> = {}
let setCount = 0
const jsonCanonical = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const commit = vi.fn(async (key: string, value: any) => {
  const canonical = jsonCanonical(value)
  memory[key] = structuredClone(canonical)
  return structuredClone(canonical)
})
const runtimes: Array<{ dispose?: () => void | Promise<void> }> = []

function decisionRecord(
  id: string,
  owner: DecisionRequest["owner"],
  resolution?: DecisionResolution
): DurableDecisionRecord {
  return {
    request: {
      schemaVersion: 1,
      id,
      owner,
      source: "agent",
      kind: "confirm",
      title: `Decision ${id}`,
      options: [],
      minSelections: 0,
      maxSelections: 1,
      allowCustom: false,
      allowRemember: false,
      createdAt: Date.now()
    },
    state: resolution ? "terminal" : "active",
    resolution
  }
}

function queuedSubmission(id: string, threadId: string, turnId: string): QueuedThreadSubmission {
  return {
    id,
    threadId,
    turnId,
    ownerWebContentsId: 7,
    input: { threadId, prompt: `Prompt ${id}`, mode: "auto" },
    source: "create",
    state: "queued",
    createdAt: Date.now(),
    admissionSequence: 1
  }
}

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { setCount++; memory[key] = value },
    commit
  }
}))

describe("WorkbenchRuntimeStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    setCount = 0
    commit.mockReset()
    commit.mockImplementation(async (key: string, value: any) => {
      const canonical = jsonCanonical(value)
      memory[key] = structuredClone(canonical)
      return structuredClone(canonical)
    })
    vi.resetModules()
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose?.()))
    vi.useRealTimers()
  })

  it("creates threads, turns, and replayable events", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "Read the project", mode: "parallel-review", workspaceId: "ws-1" })

    expect(thread.title).toBe("Read the project")
    expect(turn.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0).map(e => e.kind)).toContain("turn:created")

    await runtime.setTurnStatus(turn.id, "completed")
    expect(runtime.snapshot("ws-1").threads[0].lastTurnStatus).toBe("completed")
    expect(runtime.eventsSince(thread.id, 1).some(e => e.kind === "turn:status")).toBe(true)
  })

  it("persists the immutable multi-model fusion snapshot on a Workbench Turn", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const multiModelFusion = {
      enabled: true,
      maxCandidates: 3 as const,
      maxRounds: 3 as const,
      allowExecutor: true
    }
    const created = await runtime.createQueuedSubmission({
      payload: {
        prompt: "Compare independent solutions",
        mode: "auto",
        multiModelFusion
      } as any,
      ownerWebContentsId: 7,
      source: "create"
    })

    expect(created.turn.multiModelFusion).toEqual(multiModelFusion)
    expect(runtime.eventsSince(created.thread.id, 0).find(event => event.kind === "turn:created")?.payload)
      .toMatchObject({ multiModelFusion })
    expect(runtime.listQueuedSubmissions(created.thread.id)[0]?.input).toMatchObject({ multiModelFusion })

    const reloaded = new WorkbenchRuntimeStore()
    runtimes.push(reloaded)
    expect(reloaded.getTurn(created.turn.id)?.multiModelFusion).toEqual(multiModelFusion)
  })

  it("atomically persists queued admissions with a durable monotonic sequence", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const first = await runtime.createQueuedSubmission({
      payload: { prompt: "first queued", mode: "auto" },
      ownerWebContentsId: 7,
      source: "create"
    })
    const second = await runtime.createQueuedSubmission({
      payload: { threadId: first.thread.id, prompt: "second queued", mode: "auto" },
      ownerWebContentsId: 7,
      source: "create"
    })

    expect([first.turn.status, second.turn.status]).toEqual(["queued", "queued"])
    expect(runtime.listQueuedSubmissions(first.thread.id).map(submission => submission.admissionSequence))
      .toEqual([1, 2])
    expect(runtime.eventsSince(first.thread.id, 0).filter(event => event.kind === "turn:created"))
      .toHaveLength(2)

    const reloaded = new WorkbenchRuntimeStore()
    runtimes.push(reloaded)
    expect(reloaded.listQueuedSubmissions(first.thread.id).map(submission => submission.admissionSequence))
      .toEqual([1, 2])
  })

  it("persists retry identity on a retry Turn across runtime store reload", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const original = await runtime.createQueuedSubmission({
      payload: { prompt: "interrupted original", mode: "auto" },
      ownerWebContentsId: 7,
      source: "create"
    })
    const retry = await runtime.createQueuedSubmission({
      payload: { threadId: original.thread.id, prompt: original.turn.prompt, mode: original.turn.mode },
      ownerWebContentsId: 7,
      source: "retry",
      retryOfTurnId: original.turn.id
    })
    await runtime.setTurnStatus(retry.turn.id, "failed")

    const reloaded = new WorkbenchRuntimeStore()
    runtimes.push(reloaded)
    expect(runtime.getTurn(retry.turn.id)?.retryOfTurnId).toBe(original.turn.id)
    expect(reloaded.getTurn(retry.turn.id)?.retryOfTurnId).toBe(original.turn.id)
  })

  it("atomically finds or creates one durable normal retry admission", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const original = await runtime.createQueuedSubmission({
      payload: { prompt: "completed original", mode: "auto" },
      ownerWebContentsId: 7,
      source: "create"
    })
    await runtime.setTurnStatus(original.turn.id, "completed")
    const retryInput = {
      payload: { threadId: original.thread.id, prompt: original.turn.prompt, mode: original.turn.mode },
      ownerWebContentsId: 7,
      source: "retry" as const,
      retryOfTurnId: original.turn.id,
      retryStrategy: "reuse-selection" as const
    }

    const [first, second] = await Promise.all([
      runtime.findOrCreateQueuedRetry(retryInput),
      runtime.findOrCreateQueuedRetry(retryInput)
    ])

    expect(first.turn.id).toBe(second.turn.id)
    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(runtime.listQueuedSubmissions(original.thread.id)
      .filter(submission => submission.retryOfTurnId === original.turn.id)).toHaveLength(1)
  })

  it("admits a fresh normal retry after the prior child reaches a terminal state", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const original = await runtime.createQueuedSubmission({
      payload: { prompt: "completed original", mode: "auto" },
      ownerWebContentsId: 7,
      source: "create"
    })
    await runtime.setTurnStatus(original.turn.id, "completed")
    const retryInput = {
      payload: { threadId: original.thread.id, prompt: original.turn.prompt, mode: original.turn.mode },
      ownerWebContentsId: 7,
      source: "retry" as const,
      retryOfTurnId: original.turn.id,
      retryStrategy: "reuse-selection" as const
    }
    const first = await runtime.findOrCreateQueuedRetry(retryInput)
    await runtime.setTurnStatus(first.turn.id, "failed")

    const second = await runtime.findOrCreateQueuedRetry(retryInput)

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.turn.id).not.toBe(first.turn.id)
    expect(runtime.getTurn(first.turn.id)?.status).toBe("failed")
  })

  it("deduplicates active normal retries by normalized strategy only", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const original = await runtime.createQueuedSubmission({
      payload: { prompt: "completed original", mode: "auto" },
      ownerWebContentsId: 7,
      source: "create"
    })
    await runtime.setTurnStatus(original.turn.id, "completed")
    const base = {
      payload: { threadId: original.thread.id, prompt: original.turn.prompt, mode: original.turn.mode },
      ownerWebContentsId: 7,
      source: "retry" as const,
      retryOfTurnId: original.turn.id
    }

    const [reuse, reoptimize] = await Promise.all([
      runtime.findOrCreateQueuedRetry({ ...base, retryStrategy: "reuse-selection" }),
      runtime.findOrCreateQueuedRetry({ ...base, retryStrategy: "reoptimize" })
    ])
    const repeatedReuse = await runtime.findOrCreateQueuedRetry({ ...base, retryStrategy: "reuse-selection" })

    expect(reuse.turn.id).not.toBe(reoptimize.turn.id)
    expect(repeatedReuse).toMatchObject({ turn: { id: reuse.turn.id }, created: false })
    expect(runtime.listQueuedSubmissions(original.thread.id)
      .filter(submission => submission.retryOfTurnId === original.turn.id)
      .map(submission => submission.retryStrategy).sort())
      .toEqual(["reoptimize", "reuse-selection"])
  })

  it("persists original/effective Prompt and a write-once root envelope", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const envelope = Object.freeze({
      envelopeId: "envelope-1",
      sessionId: "session-1",
      rootInputId: "input-1",
      displayOriginalPrompt: "Fix this",
      effectivePrompt: "Reproduce the failure, make a minimal fix, and run focused tests.",
      origin: "workbench:create" as const,
      policy: "optimize" as const,
      status: "candidate-selected" as const,
      optimizerVersion: "prompt-preparation-v1",
      inputHash: "input-hash",
      preparedTextHash: "prepared-hash",
      optimizationCount: 1 as const,
      finalizedAt: 1
    })
    const created = await runtime.createQueuedSubmission({
      payload: { prompt: envelope.displayOriginalPrompt, mode: "auto", workspaceId: null },
      ownerWebContentsId: 7,
      source: "create"
    })

    await runtime.commitRuntimeMutation(tx => {
      tx.attachPromptEnvelope(created.turn.id, envelope)
    })

    const turn = runtime.getTurn(created.turn.id)!
    expect(turn).toMatchObject({
      prompt: envelope.displayOriginalPrompt,
      displayOriginalPrompt: envelope.displayOriginalPrompt,
      effectivePrompt: envelope.effectivePrompt,
      promptEnvelope: envelope
    })
    await expect(runtime.commitRuntimeMutation(tx => {
      tx.attachPromptEnvelope(created.turn.id, { ...envelope, envelopeId: "replacement" })
    })).rejects.toThrow("already has a PromptEnvelope")
  })

  it("interrupts active work at shutdown while preserving durable queued tails", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const running = await runtime.createTurn({ prompt: "running", mode: "auto", workspaceId: "ws-1" })
    const queued = await runtime.createQueuedSubmission({
      payload: {
        threadId: running.thread.id,
        prompt: "queued",
        mode: "auto",
        workspaceId: "ws-1"
      },
      ownerWebContentsId: 7,
      source: "create"
    })
    const awaiting = await runtime.createTurn({
      threadId: running.thread.id,
      prompt: "awaiting",
      mode: "auto",
      workspaceId: "ws-1"
    })
    const completed = await runtime.createTurn({
      threadId: running.thread.id,
      prompt: "completed",
      mode: "auto",
      workspaceId: "ws-1"
    })
    await runtime.setTurnStatus(awaiting.turn.id, "awaiting-decision")
    await runtime.setTurnStatus(completed.turn.id, "completed")
    const runningRun = await runtime.createRun({ turnId: running.turn.id, agentId: "codex", role: "target" })
    const awaitingRun = await runtime.createRun({ turnId: awaiting.turn.id, agentId: "gemini", role: "target", status: "awaiting-decision" })
    const completedRun = await runtime.createRun({
      turnId: completed.turn.id,
      agentId: "codex",
      role: "target",
      status: "completed"
    })

    commit.mockClear()
    await runtime.dispose({ interruptReason: "Shutdown deadline exceeded" })

    expect(commit).toHaveBeenCalledOnce()
    const snapshot = runtime.snapshot(undefined)
    expect(snapshot.turns.find(turn => turn.id === running.turn.id)?.status).toBe("interrupted")
    expect(snapshot.turns.find(turn => turn.id === queued.turn.id)?.status).toBe("queued")
    expect(snapshot.turns.find(turn => turn.id === awaiting.turn.id)?.status).toBe("interrupted")
    expect(snapshot.turns.find(turn => turn.id === completed.turn.id)?.status).toBe("completed")
    expect(snapshot.runs.find(run => run.id === runningRun.id)?.status).toBe("interrupted")
    expect(snapshot.runs.find(run => run.id === awaitingRun.id)?.status).toBe("interrupted")
    expect(snapshot.runs.find(run => run.id === completedRun.id)?.status).toBe("completed")
    expect(runtime.eventsSince(running.thread.id, 0).filter(event => (
      event.payload?.status === "interrupted" && event.payload?.reason === "Shutdown deadline exceeded"
    ))).toHaveLength(4)
    expect(runtime.listQueuedSubmissions(running.thread.id)).toEqual([
      expect.objectContaining({ turnId: queued.turn.id, state: "queued" })
    ])
  })

  it("atomically interrupts one Turn and its non-terminal Runs without touching siblings", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const target = await runtime.createTurn({ prompt: "target", mode: "auto", workspaceId: "ws-1" })
    const sibling = await runtime.createTurn({ prompt: "sibling", mode: "auto", workspaceId: "ws-2" })
    const runningRun = await runtime.createRun({ turnId: target.turn.id, agentId: "codex", role: "worker" })
    const queuedRun = await runtime.createRun({
      turnId: target.turn.id,
      agentId: "claude",
      role: "reviewer",
      status: "queued"
    })
    const completedRun = await runtime.createRun({
      turnId: target.turn.id,
      agentId: "gemini",
      role: "reviewer",
      status: "completed"
    })
    const siblingRun = await runtime.createRun({ turnId: sibling.turn.id, agentId: "codex", role: "worker" })

    commit.mockClear()
    const interrupted = await (runtime as any).interruptTurn(target.turn.id, {
      reason: "Forked from interrupted Turn"
    })

    expect(interrupted).toBe(true)
    expect(commit).toHaveBeenCalledOnce()
    const snapshot = runtime.snapshot(undefined)
    expect(snapshot.turns.find(turn => turn.id === target.turn.id)?.status).toBe("interrupted")
    expect(snapshot.runs.find(run => run.id === runningRun.id)?.status).toBe("interrupted")
    expect(snapshot.runs.find(run => run.id === queuedRun.id)?.status).toBe("interrupted")
    expect(snapshot.runs.find(run => run.id === completedRun.id)?.status).toBe("completed")
    expect(snapshot.turns.find(turn => turn.id === sibling.turn.id)?.status).toBe("running")
    expect(snapshot.runs.find(run => run.id === siblingRun.id)?.status).toBe("running")
  })

  it("closes writer admission and interrupts previously admitted work in one dispose barrier", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const existing = await runtime.createTurn({ prompt: "existing", mode: "auto", workspaceId: null })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const preceding = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(existing.thread.id, existing.turn.id, "agent:activity", "system", {
        phase: "preceding"
      })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())

    const admitted = runtime.createTurn({
      threadId: existing.thread.id,
      prompt: "admitted before close",
      mode: "auto",
      workspaceId: null
    })
    const disposal = runtime.dispose({ interruptReason: "Application shutdown deadline exceeded" })
    const rejected = runtime.createTurn({ prompt: "too late", mode: "auto", workspaceId: null })
    releaseCommit()

    const [, created] = await Promise.all([preceding, admitted])
    await expect(rejected).rejects.toThrow(/closing|closed/)
    await disposal
    expect(runtime.getTurn(existing.turn.id)?.status).toBe("interrupted")
    expect(runtime.getTurn(created.turn.id)?.status).toBe("interrupted")
    expect(memory["runtime.workbench.v1"].turns.map((turn: any) => turn.status))
      .toEqual(["interrupted", "interrupted"])
    expect(runtime.dispose()).toBe(disposal)
  })

  it("retries a failed interrupted disposal while keeping writer admission closed", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({
      prompt: "retry interrupted dispose",
      mode: "auto",
      workspaceId: null
    })
    const run = await runtime.createRun({ turnId: turn.id, agentId: "codex", role: "target" })
    commit.mockClear()
    const commitError = new Error("interrupted commit failed")
    commit.mockRejectedValueOnce(commitError)

    const firstDisposal = runtime.dispose({ interruptReason: "Application shutdown deadline exceeded" })
    await expect(firstDisposal).rejects.toBe(commitError)
    await expect(runtime.createTurn({
      prompt: "writer remains closed",
      mode: "auto",
      workspaceId: null
    })).rejects.toThrow(/closing|closed/)

    const retryDisposal = runtime.dispose()
    expect(retryDisposal).not.toBe(firstDisposal)
    await retryDisposal

    expect(commit).toHaveBeenCalledTimes(2)
    expect(runtime.getTurn(turn.id)?.status).toBe("interrupted")
    expect(runtime.snapshot(undefined).runs.find(candidate => candidate.id === run.id)?.status)
      .toBe("interrupted")
    expect(runtime.eventsSince(turn.threadId, 0).filter(event => (
      event.payload?.status === "interrupted"
      && event.payload?.reason === "Application shutdown deadline exceeded"
    ))).toHaveLength(2)
    expect(runtime.dispose()).toBe(retryDisposal)
  })

  it("gates a live deletion without permanently blocking admission after a restart", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "delete with gate",
      mode: "auto",
      workspaceId: "ws-1",
      ownerWebContentsId: 7
    })

    await expect(runtime.beginThreadDeletion(thread.id, 7)).resolves.toMatchObject({
      status: "started",
      work: {
        turns: [expect.objectContaining({ id: turn.id, ownerWebContentsId: 7 })]
      }
    })
    await expect(runtime.finalizeThreadDeletion(thread.id, 7)).resolves.toMatchObject({
      status: "in-progress",
      work: {
        turns: [expect.objectContaining({ id: turn.id })]
      }
    })

    await expect(runtime.createQueuedSubmission({
      payload: { threadId: thread.id, workspaceId: thread.workspaceId, prompt: "foreign create", mode: "auto" },
      ownerWebContentsId: 8,
      source: "create"
    })).rejects.toThrow(/deletion.*progress/i)
    await expect(runtime.createQueuedSubmission({
      payload: { threadId: thread.id, workspaceId: thread.workspaceId, prompt: "foreign retry", mode: "auto" },
      ownerWebContentsId: 8,
      source: "retry",
      retryOfTurnId: turn.id
    })).rejects.toThrow(/deletion.*progress/i)

    const reloaded = new WorkbenchRuntimeStore()
    runtimes.push(reloaded)
    await expect(reloaded.createQueuedSubmission({
      payload: { threadId: thread.id, workspaceId: thread.workspaceId, prompt: "reloaded create", mode: "auto" },
      ownerWebContentsId: 8,
      source: "create"
    })).resolves.toMatchObject({
      thread: { id: thread.id },
      turn: { ownerWebContentsId: 8, status: "queued" }
    })
  })

  it("reclaims a deletion gate from a closed owner but denies a live foreign owner", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "reclaim deletion gate",
      mode: "auto",
      workspaceId: "ws-1",
      ownerWebContentsId: 7
    })
    await runtime.beginThreadDeletion(thread.id, 7)

    await expect(runtime.beginThreadDeletion(thread.id, 8, () => true)).resolves.toMatchObject({
      status: "forbidden"
    })
    await expect(runtime.beginThreadDeletion(thread.id, 8, () => false)).resolves.toMatchObject({
      status: "reclaimed",
      work: { turns: [expect.objectContaining({ id: turn.id })] }
    })
    await expect(runtime.finalizeThreadDeletion(thread.id, 7)).resolves.toMatchObject({
      status: "forbidden"
    })
  })

  it("removes hidden-task and decision ledger entries owned by a deleted thread", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const target = await runtime.createTurn({ prompt: "delete ledger", mode: "auto", workspaceId: "ws-1" })
    const sibling = await runtime.createTurn({
      threadId: target.thread.id,
      prompt: "same thread",
      mode: "auto",
      workspaceId: "ws-1"
    })
    const other = await runtime.createTurn({ prompt: "keep ledger", mode: "auto", workspaceId: "ws-2" })
    await runtime.deleteTask(target.turn.id)
    await runtime.cancelTurn(target.turn.id)
    await runtime.cancelTurn(sibling.turn.id)
    await runtime.commitRuntimeMutation(tx => {
      tx.upsertDecision(decisionRecord("delete-by-turn", {
        type: "turn",
        threadId: other.thread.id,
        turnId: target.turn.id,
        workspaceId: "ws-2",
        webContentsId: 7
      }, { requestId: "delete-by-turn", status: "cancelled", resolvedAt: Date.now() }))
      tx.upsertDecision(decisionRecord("delete-by-thread", {
        type: "turn",
        threadId: target.thread.id,
        turnId: other.turn.id,
        workspaceId: "ws-1",
        webContentsId: 7
      }, { requestId: "delete-by-thread", status: "cancelled", resolvedAt: Date.now() }))
      tx.upsertDecision(decisionRecord("keep-other", {
        type: "turn",
        threadId: other.thread.id,
        turnId: other.turn.id,
        workspaceId: "ws-2",
        webContentsId: 7
      }))
    })

    await expect(runtime.beginThreadDeletion(target.thread.id, 7)).resolves.toMatchObject({ status: "started" })
    await expect(runtime.finalizeThreadDeletion(target.thread.id, 7)).resolves.toMatchObject({ status: "deleted" })
    expect(runtime.getTurn(target.turn.id)).toBeUndefined()
    expect(runtime.getTurn(sibling.turn.id)).toBeUndefined()
    expect(memory["runtime.workbench.v1"].hiddenTaskTurnIds).toEqual([])
    expect(runtime.listDurableDecisions().map(record => record.request.id)).toEqual(["keep-other"])
  })

  it("keeps an atomic mutation invisible until commit and then publishes staged events in order", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "atomic", mode: "auto", workspaceId: null })
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))
    commit.mockClear()

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))

    const mutation = runtime.commitRuntimeMutation(tx => {
      tx.setTurnStatus(turn.id, "awaiting-decision")
      tx.appendEvent(thread.id, turn.id, "decision:requested", undefined, {
        requestId: "decision-1",
        source: "agent"
      })
    })

    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
    expect(published).toEqual([])

    releaseCommit()
    await mutation

    expect(runtime.getTurn(turn.id)?.status).toBe("awaiting-decision")
    expect(published).toEqual(["turn:status", "decision:requested"])
  })

  it("swaps and publishes the exact JSON-canonical state returned by atomic persistence", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "canonical", mode: "auto", workspaceId: null })
    const published: any[] = []
    runtime.on("event", event => published.push(event))

    await runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", {
        nan: Number.NaN,
        omitted: undefined,
        date: new Date("2030-01-02T03:04:05.000Z")
      })
    })

    const expectedPayload = {
      nan: null,
      date: "2030-01-02T03:04:05.000Z"
    }
    const runtimeEvent = runtime.eventsSince(thread.id, 0).at(-1)
    const appStoreEvent = memory["runtime.workbench.v1"].events.at(-1)
    const reloaded = new WorkbenchRuntimeStore()
    runtimes.push(reloaded)
    const reloadedEvent = reloaded.eventsSince(thread.id, 0).at(-1)

    expect(published.at(-1)?.payload).toEqual(expectedPayload)
    expect(runtimeEvent?.payload).toEqual(expectedPayload)
    expect(appStoreEvent.payload).toEqual(expectedPayload)
    expect(reloadedEvent?.payload).toEqual(expectedPayload)
    expect(published.at(-1)).toEqual(runtimeEvent)
    expect(runtimeEvent).toEqual(appStoreEvent)
    expect(reloadedEvent).toEqual(appStoreEvent)
  })

  it("rolls back status, events, sequence, and ledgers after commit rejection and keeps the actor usable", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "rollback", mode: "auto", workspaceId: null })
    const beforeEvents = runtime.eventsSince(thread.id, 0)
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))
    commit.mockRejectedValueOnce(new Error("disk full"))

    await expect(runtime.commitRuntimeMutation(tx => {
      tx.setTurnStatus(turn.id, "awaiting-decision")
      tx.upsertDecision(decisionRecord("decision-rejected", {
        type: "turn",
        threadId: thread.id,
        turnId: turn.id,
        workspaceId: null,
        webContentsId: 7
      }))
      tx.upsertSubmission(queuedSubmission("submission-rejected", thread.id, turn.id))
      tx.appendEvent(thread.id, turn.id, "decision:requested", undefined, {
        requestId: "decision-rejected"
      })
    })).rejects.toThrow("disk full")

    expect(runtime.getTurn(turn.id)?.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0)).toEqual(beforeEvents)
    expect(runtime.listDurableDecisions()).toEqual([])
    expect(runtime.listQueuedSubmissions()).toEqual([])
    expect(published).toEqual([])

    const legacyEvent = await runtime.appendSystemEvent(
      thread.id,
      turn.id,
      "agent:activity",
      "codex",
      { message: "legacy survived" }
    )
    await runtime.commitRuntimeMutation(tx => {
      tx.upsertDecision(decisionRecord("decision-after-rejection", {
        type: "turn",
        threadId: thread.id,
        turnId: turn.id,
        workspaceId: null,
        webContentsId: 7
      }))
    })

    expect(legacyEvent.seq).toBe(beforeEvents.at(-1)!.seq + 1)
    expect(runtime.listDurableDecisions().map(record => record.request.id))
      .toEqual(["decision-after-rejection"])
  })

  it("rejects createTurn without changing or publishing live state when persistence fails", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const existing = await runtime.createTurn({ prompt: "existing", mode: "auto", workspaceId: null })
    const beforeSnapshot = runtime.snapshot(undefined)
    const beforeEvents = runtime.eventsSince(existing.thread.id, 0)
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))
    commit.mockRejectedValueOnce(new Error("create persistence failed"))

    await expect(runtime.createTurn({
      threadId: existing.thread.id,
      prompt: "must roll back",
      mode: "auto"
    })).rejects.toThrow("create persistence failed")

    expect(runtime.snapshot(undefined)).toEqual(beforeSnapshot)
    expect(runtime.eventsSince(existing.thread.id, 0)).toEqual(beforeEvents)
    expect(memory["runtime.workbench.v1"].turns).toHaveLength(1)
    expect(memory["runtime.workbench.v1"].events).toEqual(beforeEvents)
    expect(published).toEqual([])
  })

  it("rejects terminal stream append without changing or publishing live state when persistence fails", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "stream rollback", mode: "auto", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-1", agentId: "codex" })
    const beforeSnapshot = runtime.snapshot(undefined)
    const beforeEvents = runtime.eventsSince(thread.id, 0)
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))
    commit.mockRejectedValueOnce(new Error("terminal persistence failed"))

    await expect(runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-1",
      agentId: "codex",
      content: "must roll back",
      durationMs: 1
    })).rejects.toThrow("terminal persistence failed")

    expect(runtime.snapshot(undefined)).toEqual(beforeSnapshot)
    expect(runtime.eventsSince(thread.id, 0)).toEqual(beforeEvents)
    expect(memory["runtime.workbench.v1"].events).toEqual(beforeEvents)
    expect(published).toEqual([])
  })

  it("keeps a legacy writer invisible until commit and returns the persisted canonical value", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const existing = await runtime.createTurn({ prompt: "existing", mode: "auto", workspaceId: null })
    const beforeSnapshot = runtime.snapshot(undefined)
    const published: any[] = []
    runtime.on("event", event => published.push(event))
    commit.mockClear()

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        const createdTurn = canonical.turns.at(-1)
        createdTurn.prompt = "canonical prompt"
        canonical.events.at(-1).payload.prompt = "canonical prompt"
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))

    const creation = runtime.createTurn({
      threadId: existing.thread.id,
      prompt: "draft prompt",
      mode: "auto"
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1))

    expect(runtime.snapshot(undefined)).toEqual(beforeSnapshot)
    expect(published).toEqual([])

    releaseCommit()
    const created = await creation
    expect(created.turn.prompt).toBe("canonical prompt")
    expect(runtime.getTurn(created.turn.id)?.prompt).toBe("canonical prompt")
    expect(memory["runtime.workbench.v1"].turns.at(-1).prompt).toBe("canonical prompt")
    expect(published).toEqual([
      expect.objectContaining({ kind: "turn:created", payload: expect.objectContaining({ prompt: "canonical prompt" }) })
    ])
  })

  it("blocks a same-thread legacy writer behind a pending atomic commit", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "serialize", mode: "auto", workspaceId: null })
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const atomic = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "decision:requested", undefined, { requestId: "decision-gate" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())

    let streamSettled = false
    const stream = runtime.appendStreamEvent(turn.id, {
      kind: "delta",
      agentId: "codex",
      text: "queued",
      channel: "content"
    }).then(event => {
      streamSettled = true
      return event
    })
    await Promise.resolve()

    expect(streamSettled).toBe(false)
    expect(runtime.eventsSince(thread.id, 0).some(event => event.kind === "agent:delta")).toBe(false)

    releaseCommit()
    const [, streamEvent] = await Promise.all([atomic, stream])
    const events = runtime.eventsSince(thread.id, 0)
    expect(events.map(event => event.seq)).toEqual(events.map(event => event.seq).sort((a, b) => a - b))
    expect(new Set(events.map(event => event.seq)).size).toBe(events.length)
    expect(events.some(event => event.id === streamEvent.id)).toBe(true)
    expect(published.slice(-2)).toEqual(["decision:requested", "agent:delta"])
  })

  it("serializes a pending atomic writer with a legacy writer for another thread", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const first = await runtime.createTurn({ prompt: "first", mode: "auto", workspaceId: null })
    const second = await runtime.createTurn({ prompt: "second", mode: "auto", workspaceId: null })
    const setCountBeforeAtomic = setCount

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const atomic = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(first.thread.id, first.turn.id, "decision:requested", undefined, {
        requestId: "cross-thread"
      })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())
    const legacy = runtime.appendSystemEvent(
      second.thread.id,
      second.turn.id,
      "agent:activity",
      "claude",
      { message: "thread two" }
    )
    await Promise.resolve()

    expect(setCount).toBe(setCountBeforeAtomic)
    releaseCommit()
    await Promise.all([atomic, legacy])

    const persisted = memory["runtime.workbench.v1"]
    expect(persisted.events.some((event: any) => event.payload?.requestId === "cross-thread")).toBe(true)
    expect(persisted.events.some((event: any) => event.payload?.message === "thread two")).toBe(true)
  })

  it("runs atomic mutations FIFO and recovers the queue when the first commit fails", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "fifo", mode: "auto", workspaceId: null })
    const callbackOrder: string[] = []
    let rejectFirst!: (error: Error) => void
    commit.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    }))

    const first = runtime.commitRuntimeMutation(tx => {
      callbackOrder.push("first")
      tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", { operation: "first" })
    })
    const second = runtime.commitRuntimeMutation(tx => {
      callbackOrder.push("second")
      tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", { operation: "second" })
    })

    await vi.waitFor(() => expect(commit).toHaveBeenCalled())
    expect(callbackOrder).toEqual(["first"])
    rejectFirst(new Error("first failed"))
    await expect(first).rejects.toThrow("first failed")
    await expect(second).resolves.toBeUndefined()
    expect(callbackOrder).toEqual(["first", "second"])
    expect(runtime.eventsSince(thread.id, 0).some(event => event.payload?.operation === "first")).toBe(false)
    expect(runtime.eventsSince(thread.id, 0).some(event => event.payload?.operation === "second")).toBe(true)
  })

  it("keeps cancellation when a later runner settlement was queued behind the same actor gate", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "cancel wins", mode: "auto", workspaceId: null })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const preceding = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", { phase: "preceding" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())

    let cancel!: Promise<boolean>
    let settle!: Promise<boolean>
    try {
      cancel = runtime.transitionTurnStatus(
        turn.id,
        ["queued", "running", "awaiting-decision"],
        "cancelled"
      )
      settle = runtime.transitionTurnStatus(turn.id, ["running"], "completed")
    } finally {
      releaseCommit()
    }

    const [, cancelled, settled] = await Promise.all([preceding, cancel, settle])
    expect(cancelled).toBe(true)
    expect(settled).toBe(false)
    expect(runtime.getTurn(turn.id)?.status).toBe("cancelled")
    const statuses = runtime.eventsSince(thread.id, 0)
      .filter(event => event.kind === "turn:status")
      .map(event => event.payload.status)
    expect(statuses.at(-1)).toBe("cancelled")
    expect(statuses).not.toContain("completed")
  })

  it("cancels the Turn when the last active agent is cancelled behind an actor gate", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "last active", mode: "broadcast", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-a", agentId: "agent-a" })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-b", agentId: "agent-b" })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const preceding = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "system", { phase: "preceding" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())

    let agentBDone!: Promise<any>
    let cancelAgentA!: Promise<boolean>
    let completedSettlement!: Promise<boolean>
    let failedSettlement!: Promise<boolean>
    try {
      agentBDone = runtime.appendStreamEvent(turn.id, {
        kind: "done",
        taskId: "task-b",
        agentId: "agent-b",
        content: "B completed"
      })
      cancelAgentA = runtime.cancelAgentRun(turn.id, "agent-a", { error: "cancelled by user" })
      completedSettlement = runtime.transitionTurnStatus(turn.id, ["running"], "completed")
      failedSettlement = runtime.transitionTurnStatus(turn.id, ["running"], "failed")
    } finally {
      releaseCommit()
    }

    const [, , cancelled, completed, failed] = await Promise.all([
      preceding,
      agentBDone,
      cancelAgentA,
      completedSettlement,
      failedSettlement
    ])
    expect(cancelled).toBe(true)
    expect(completed).toBe(false)
    expect(failed).toBe(false)
    expect(runtime.getTurn(turn.id)?.status).toBe("cancelled")
    expect(runtime.snapshot(undefined).runs.filter(run => run.turnId === turn.id)).toEqual([
      expect.objectContaining({ agentId: "agent-a", status: "cancelled" }),
      expect.objectContaining({ agentId: "agent-b", status: "completed" })
    ])
  })

  it("keeps the Turn running when another agent remains active after cancellation", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "one continues", mode: "broadcast", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-a", agentId: "agent-a" })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-b", agentId: "agent-b" })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const preceding = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "system", { phase: "preceding" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())

    let cancelAgentA!: Promise<boolean>
    let agentBDone!: Promise<any>
    let completedSettlement!: Promise<boolean>
    try {
      cancelAgentA = runtime.cancelAgentRun(turn.id, "agent-a")
      agentBDone = runtime.appendStreamEvent(turn.id, {
        kind: "done",
        taskId: "task-b",
        agentId: "agent-b",
        content: "B completed"
      })
      completedSettlement = runtime.transitionTurnStatus(turn.id, ["running"], "completed")
    } finally {
      releaseCommit()
    }

    const [, cancelled, , completed] = await Promise.all([
      preceding,
      cancelAgentA,
      agentBDone,
      completedSettlement
    ])
    expect(cancelled).toBe(true)
    expect(completed).toBe(true)
    expect(runtime.getTurn(turn.id)?.status).toBe("completed")
  })

  it("does not publish a final release when cancellation is queued first", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "cancel before final release",
      mode: "firefly-custom",
      workspaceId: null
    })

    const cancellation = runtime.cancelTurn(turn.id, { reason: "cancelled before release" })
    const completion = runtime.completeTurnWithFinalEvent(turn.id, {
      agentId: "codex",
      payload: {
        content: "cancelled final release secret",
        visibility: "chat",
        synthetic: true
      }
    })

    expect(await cancellation).toBe(true)
    expect(await completion).toBe(false)
    expect(runtime.getTurn(turn.id)?.status).toBe("cancelled")
    expect(runtime.eventsSince(thread.id, 0).some(event => (
      event.kind === "agent:done" && event.payload?.content === "cancelled final release secret"
    ))).toBe(false)
    expect(JSON.stringify(memory["runtime.workbench.v1"])).not.toContain("cancelled final release secret")
  })

  it("keeps a cancelled run cancelled and sanitizes its late done stream", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "late done", mode: "auto", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-a",
      agentId: "agent-a"
    })
    await runtime.cancelAgentRun(turn.id, "agent-a")

    const late = await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-a",
      agentId: "agent-a",
      content: "late secret content",
      usage: { input_tokens: 12, output_tokens: 34 }
    })

    expect(runtime.snapshot(undefined).runs.find(run => run.agentId === "agent-a")?.status).toBe("cancelled")
    expect(late).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "done", reason: "turn-cancelled" }
    })
    expect(JSON.stringify(late)).not.toContain("late secret content")
    const events = runtime.eventsSince(thread.id, 0)
    expect(events.some(event => event.kind === "agent:done" && event.agentId === "agent-a")).toBe(false)
    expect(JSON.stringify(events)).not.toContain("late secret content")
    expect(JSON.stringify(memory["runtime.workbench.v1"])).not.toContain("late secret content")
  })

  it("does not create a new role Run from a late start after scoped agent cancellation", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "late scoped start", mode: "broadcast", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-a",
      agentId: "agent-a",
      scheduleRole: "worker"
    })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-b",
      agentId: "agent-b",
      scheduleRole: "worker"
    })
    await runtime.cancelAgentRun(turn.id, "agent-a")
    expect(runtime.getTurn(turn.id)?.status).toBe("running")

    const lateStart = await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-a",
      agentId: "agent-a",
      scheduleRole: "reviewer",
      content: "late scoped start secret"
    })

    const agentARuns = runtime.snapshot(undefined).runs.filter(run => (
      run.turnId === turn.id && run.agentId === "agent-a"
    ))
    expect(agentARuns).toHaveLength(1)
    expect(agentARuns[0].status).toBe("cancelled")
    expect(runtime.snapshot(undefined).runs.find(run => run.agentId === "agent-b")?.status).toBe("running")
    expect(lateStart).toMatchObject({
      kind: "agent:activity",
      payload: {
        ignored: true,
        originalKind: "start",
        reason: "run-cancelled",
        taskId: "task-a",
        scheduleRole: "reviewer"
      }
    })
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("late scoped start secret")
    expect(JSON.stringify(memory["runtime.workbench.v1"])).not.toContain("late scoped start secret")
  })

  it("matches late same-role settlements by task identity after scoped cancellation", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "task identity", mode: "broadcast", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-old",
      agentId: "agent-a",
      scheduleRole: "worker"
    })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-other-agent",
      agentId: "agent-b",
      scheduleRole: "worker"
    })
    await runtime.cancelAgentRun(turn.id, "agent-a")

    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-new",
      agentId: "agent-a",
      scheduleRole: "worker"
    })
    const lateOldDone = await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-old",
      agentId: "agent-a",
      scheduleRole: "worker",
      content: "old task secret"
    })
    const lateOldError = await runtime.appendStreamEvent(turn.id, {
      kind: "error",
      taskId: "task-old",
      agentId: "agent-a",
      scheduleRole: "worker",
      error: "old task failure secret"
    })

    const beforeNewDone = runtime.snapshot(undefined).runs.filter(run => (
      run.turnId === turn.id && run.agentId === "agent-a"
    ))
    expect(beforeNewDone.map(run => run.status)).toEqual(["cancelled", "running"])
    expect(lateOldDone).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "done", reason: "run-cancelled", taskId: "task-old" }
    })
    expect(lateOldError).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "error", reason: "run-cancelled", taskId: "task-old" }
    })
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("old task secret")
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("old task failure secret")

    await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-new",
      agentId: "agent-a",
      scheduleRole: "worker",
      content: "new task result"
    })
    expect(runtime.snapshot(undefined).runs.filter(run => (
      run.turnId === turn.id && run.agentId === "agent-a"
    )).map(run => run.status)).toEqual(["cancelled", "completed"])
  })

  it("migrates legacy Runs onto task and step identity when settling by role", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "legacy identity", mode: "orchestrate", workspaceId: null })
    const worker = await runtime.createRun({ turnId: turn.id, agentId: "agent-a", role: "worker" })
    const reviewer = await runtime.createRun({ turnId: turn.id, agentId: "agent-a", role: "reviewer" })

    await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-reviewer",
      agentId: "agent-a",
      scheduleRole: "reviewer",
      scheduleStepId: "review-step",
      content: "review complete"
    })
    await runtime.appendStreamEvent(turn.id, {
      kind: "error",
      taskId: "task-worker",
      agentId: "agent-a",
      scheduleRole: "worker",
      scheduleStepId: "worker-step",
      error: "worker failed"
    })

    const runs = runtime.snapshot(undefined).runs
    expect(runs.find(run => run.id === reviewer.id)).toMatchObject({
      status: "completed",
      taskId: "task-reviewer",
      scheduleStepId: "review-step"
    })
    expect(runs.find(run => run.id === worker.id)).toMatchObject({
      status: "failed",
      taskId: "task-worker",
      scheduleStepId: "worker-step"
    })
  })

  it("prefers an exact task step over a newer same-task Run without a step", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "exact step", mode: "orchestrate", workspaceId: null })
    const exact = await runtime.createRun({
      turnId: turn.id,
      agentId: "agent-a",
      role: "reviewer",
      taskId: "shared-task",
      scheduleStepId: "review-step"
    })
    const partial = await runtime.createRun({
      turnId: turn.id,
      agentId: "agent-a",
      role: "reviewer",
      taskId: "shared-task"
    })

    await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "shared-task",
      agentId: "agent-a",
      scheduleRole: "reviewer",
      scheduleStepId: "review-step",
      content: "review complete"
    })

    const runs = runtime.snapshot(undefined).runs
    expect(runs.find(run => run.id === exact.id)?.status).toBe("completed")
    expect(runs.find(run => run.id === partial.id)?.status).toBe("running")
  })

  it("does not settle same-task Runs whose known step and role identities conflict", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "identity conflict", mode: "orchestrate", workspaceId: null })
    const stepMismatch = await runtime.createRun({
      turnId: turn.id,
      agentId: "agent-a",
      role: "reviewer",
      taskId: "shared-task",
      scheduleStepId: "other-step"
    })
    const roleMismatch = await runtime.createRun({
      turnId: turn.id,
      agentId: "agent-a",
      role: "worker",
      taskId: "shared-task",
      scheduleStepId: "review-step"
    })

    await runtime.appendStreamEvent(turn.id, {
      kind: "error",
      taskId: "shared-task",
      agentId: "agent-a",
      scheduleRole: "reviewer",
      scheduleStepId: "review-step",
      error: "review failed"
    })

    const runs = runtime.snapshot(undefined).runs
    expect(runs.find(run => run.id === stepMismatch.id)?.status).toBe("running")
    expect(runs.find(run => run.id === roleMismatch.id)?.status).toBe("running")
  })

  it("fails closed for multiple same-task Runs without enough step identity", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "ambiguous identity", mode: "orchestrate", workspaceId: null })
    const first = await runtime.createRun({
      turnId: turn.id,
      agentId: "agent-a",
      role: "reviewer",
      taskId: "shared-task"
    })
    const second = await runtime.createRun({
      turnId: turn.id,
      agentId: "agent-a",
      role: "reviewer",
      taskId: "shared-task"
    })

    await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "shared-task",
      agentId: "agent-a",
      scheduleRole: "reviewer",
      scheduleStepId: "review-step",
      content: "ambiguous result"
    })

    const runs = runtime.snapshot(undefined).runs
    expect(runs.find(run => run.id === first.id)?.status).toBe("running")
    expect(runs.find(run => run.id === second.id)?.status).toBe("running")
  })

  it("fails closed when a cancelled legacy Run cannot prove a new task identity", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "legacy tombstone", mode: "broadcast", workspaceId: null })
    await runtime.createRun({ turnId: turn.id, agentId: "agent-a", role: "worker" })
    await runtime.createRun({ turnId: turn.id, agentId: "agent-b", role: "worker" })
    await runtime.cancelAgentRun(turn.id, "agent-a")

    const lateStart = await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-after-upgrade",
      agentId: "agent-a",
      scheduleRole: "reviewer",
      content: "unprovable legacy start secret"
    })

    expect(runtime.snapshot(undefined).runs.filter(run => run.agentId === "agent-a")).toHaveLength(1)
    expect(lateStart).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "start", reason: "run-cancelled" }
    })
    expect(JSON.stringify(runtime.snapshot(undefined))).not.toContain("unprovable legacy start secret")
  })

  it("atomically cancels every active run before a queued late Turn stream is persisted", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "cancel all", mode: "broadcast", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-a", agentId: "agent-a" })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-b", agentId: "agent-b" })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const preceding = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "system", { phase: "preceding" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())

    let cancellation!: Promise<boolean>
    let lateDelta!: Promise<any>
    try {
      cancellation = runtime.cancelTurn(turn.id, { reason: "cancelled by user" })
      lateDelta = runtime.appendStreamEvent(turn.id, {
        kind: "delta",
        taskId: "task-a",
        agentId: "agent-a",
        text: "late full-turn secret"
      })
    } finally {
      releaseCommit()
    }

    const [, cancelled, late] = await Promise.all([preceding, cancellation, lateDelta])
    expect(cancelled).toBe(true)
    expect(runtime.getTurn(turn.id)?.status).toBe("cancelled")
    expect(runtime.snapshot(undefined).runs.filter(run => run.turnId === turn.id).map(run => run.status))
      .toEqual(["cancelled", "cancelled"])
    expect(late).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "delta", reason: "turn-cancelled" }
    })
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("late full-turn secret")
    expect(JSON.stringify(memory["runtime.workbench.v1"])).not.toContain("late full-turn secret")
  })

  it("does not create a run from a late start after the Turn was cancelled", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "late start", mode: "auto", workspaceId: null })
    await runtime.cancelTurn(turn.id)

    const lateStart = await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "unattached-task",
      agentId: "agent-a",
      content: "late start secret"
    })

    expect(runtime.snapshot(undefined).runs.filter(run => run.turnId === turn.id)).toEqual([])
    expect(lateStart).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "start", reason: "turn-cancelled" }
    })
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("late start secret")
    expect(JSON.stringify(memory["runtime.workbench.v1"])).not.toContain("late start secret")
  })

  it("sanitizes a late stream after the Turn was interrupted", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "late interrupted", mode: "auto", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-a",
      agentId: "agent-a"
    })
    const run = runtime.snapshot(undefined).runs.find(candidate => candidate.turnId === turn.id)
    expect(run).toBeDefined()
    await runtime.commitRuntimeMutation(tx => {
      tx.setRunStatusById(run!.id, "interrupted", { reason: "Shutdown deadline exceeded" })
      tx.setTurnStatus(turn.id, "interrupted", { reason: "Shutdown deadline exceeded" })
    })

    const lateDelta = await runtime.appendStreamEvent(turn.id, {
      kind: "delta",
      taskId: "task-a",
      agentId: "agent-a",
      text: "late interrupted secret"
    })

    expect(runtime.snapshot(undefined).runs.find(run => run.turnId === turn.id)?.status).toBe("interrupted")
    expect(lateDelta).toMatchObject({
      kind: "agent:activity",
      payload: { ignored: true, originalKind: "delta", reason: "turn-interrupted" }
    })
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("late interrupted secret")
    expect(JSON.stringify(memory["runtime.workbench.v1"])).not.toContain("late interrupted secret")
  })

  it("cancels every active repeated same-agent run and sanitizes each role's late completion", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "same agent roles", mode: "firefly-custom", workspaceId: null })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-worker",
      agentId: "claude",
      scheduleRole: "worker"
    })
    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      taskId: "task-reviewer",
      agentId: "claude",
      scheduleRole: "reviewer"
    })

    expect(await runtime.cancelAgentRun(turn.id, "claude")).toBe(true)
    const workerLate = await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-worker",
      agentId: "claude",
      scheduleRole: "worker",
      content: "late worker secret"
    })
    const reviewerLate = await runtime.appendStreamEvent(turn.id, {
      kind: "done",
      taskId: "task-reviewer",
      agentId: "claude",
      scheduleRole: "reviewer",
      content: "late reviewer secret"
    })

    expect(runtime.snapshot(undefined).runs.filter(run => run.turnId === turn.id).map(run => run.status))
      .toEqual(["cancelled", "cancelled"])
    expect(workerLate.kind).toBe("agent:activity")
    expect(reviewerLate.kind).toBe("agent:activity")
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("late worker secret")
    expect(JSON.stringify(runtime.eventsSince(thread.id, 0))).not.toContain("late reviewer secret")
  })

  it("rejects asynchronous callbacks, closes captured transactions, and skips commit after callback errors", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "closed", mode: "auto", workspaceId: null })
    commit.mockClear()

    await expect(runtime.commitRuntimeMutation(tx => {
      tx.setTurnStatus(turn.id, "awaiting-decision")
      throw new Error("callback failed")
    })).rejects.toThrow("callback failed")
    expect(commit).not.toHaveBeenCalled()
    expect(runtime.getTurn(turn.id)?.status).toBe("running")

    let captured!: RuntimeMutation
    await runtime.commitRuntimeMutation(tx => {
      captured = tx
    })
    expect(() => captured.getTurn(turn.id)).toThrow("RuntimeMutation is closed")

    const asyncCallback = (async (tx: RuntimeMutation) => {
      tx.setTurnStatus(turn.id, "awaiting-decision")
      await Promise.resolve()
      tx.getTurn(turn.id)
    }) as unknown as (tx: RuntimeMutation) => void
    const callsBeforeAsync = commit.mock.calls.length
    await expect(runtime.commitRuntimeMutation(asyncCallback))
      .rejects.toThrow("Runtime mutation callback must be synchronous")
    expect(commit).toHaveBeenCalledTimes(callsBeforeAsync)
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
  })

  it("synchronously rejects a public writer from a throwing atomic callback", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "writer escape throw", mode: "auto", workspaceId: null })
    const published: any[] = []
    runtime.on("event", event => published.push(event))
    let callbackContinued = false

    await expect(runtime.commitRuntimeMutation(() => {
      void runtime.appendSystemEvent(
        thread.id,
        turn.id,
        "agent:activity",
        "codex",
        { escaped: "throw" }
      )
      callbackContinued = true
      throw new Error("rollback callback")
    })).rejects.toThrow("forbidden inside commitRuntimeMutation")

    expect(callbackContinued).toBe(false)
    await runtime.whenIdle()
    expect(runtime.eventsSince(thread.id, 0).some(event => event.payload?.escaped === "throw")).toBe(false)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.payload?.escaped === "throw")).toBe(false)
    expect(published).toEqual([])
  })

  it("synchronously rejects non-cloneable public writer input before an atomic callback can continue", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "non-cloneable reentry", mode: "auto", workspaceId: null })
    const published: any[] = []
    runtime.on("event", event => published.push(event))
    const commitsBefore = commit.mock.calls.length
    let callbackContinued = false

    await expect(runtime.commitRuntimeMutation(tx => {
      tx.setTurnStatus(turn.id, "awaiting-decision")
      void runtime.appendSystemEvent(
        thread.id,
        turn.id,
        "agent:activity",
        "codex",
        { cannotClone: () => "function" }
      ).catch(() => undefined)
      callbackContinued = true
    })).rejects.toThrow("forbidden inside commitRuntimeMutation")

    expect(callbackContinued).toBe(false)
    expect(commit).toHaveBeenCalledTimes(commitsBefore)
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0).some(event => event.payload?.cannotClone)).toBe(false)
    expect(published).toEqual([])

    await expect(runtime.appendSystemEvent(
      thread.id,
      turn.id,
      "agent:activity",
      "codex",
      { recovered: true }
    )).resolves.toMatchObject({ payload: { recovered: true } })
  })

  it("synchronously aborts an atomic callback that attempts a fire-and-forget public writer", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "writer escape fire and forget",
      mode: "auto",
      workspaceId: null
    })
    const published: any[] = []
    runtime.on("event", event => published.push(event))
    const commitsBefore = commit.mock.calls.length

    await expect(runtime.commitRuntimeMutation(tx => {
      void runtime.appendSystemEvent(
        thread.id,
        turn.id,
        "agent:activity",
        "codex",
        { escaped: "fire-and-forget" }
      ).catch(() => undefined)
      tx.setTurnStatus(turn.id, "awaiting-decision")
    })).rejects.toThrow("forbidden inside commitRuntimeMutation")

    await runtime.whenIdle()
    expect(commit).toHaveBeenCalledTimes(commitsBefore)
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0).some(event => (
      event.payload?.escaped === "fire-and-forget"
    ))).toBe(false)
    expect(published).toEqual([])
  })

  it("rejects a public writer escaped from an asynchronous callback continuation", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "writer escape async", mode: "auto", workspaceId: null })
    const published: any[] = []
    runtime.on("event", event => published.push(event))
    let continuationAttempted = false
    let continuationError: unknown
    const asyncCallback = (async () => {
      await Promise.resolve()
      continuationAttempted = true
      try {
        void runtime.appendSystemEvent(
          thread.id,
          turn.id,
          "agent:activity",
          "codex",
          { escaped: "async" }
        )
      } catch (error) {
        continuationError = error
        throw error
      }
    }) as unknown as (tx: RuntimeMutation) => void

    await expect(runtime.commitRuntimeMutation(asyncCallback))
      .rejects.toThrow("Runtime mutation callback must be synchronous")
    await vi.waitFor(() => expect(continuationAttempted).toBe(true))
    expect(continuationError).toBeInstanceOf(Error)
    expect((continuationError as Error).message).toContain("forbidden inside commitRuntimeMutation")
    await runtime.whenIdle()
    expect(runtime.eventsSince(thread.id, 0).some(event => event.payload?.escaped === "async")).toBe(false)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.payload?.escaped === "async")).toBe(false)
    expect(published).toEqual([])
  })

  it("rolls back when cloning the mutation result fails", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "clone rollback", mode: "auto", workspaceId: null })
    const beforeEvents = runtime.eventsSince(thread.id, 0)
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))
    commit.mockClear()

    await expect(runtime.commitRuntimeMutation(tx => {
      tx.setTurnStatus(turn.id, "awaiting-decision")
      tx.upsertDecision(decisionRecord("decision-clone-failure", {
        type: "turn",
        threadId: thread.id,
        turnId: turn.id,
        workspaceId: null,
        webContentsId: 7
      }))
      tx.upsertSubmission(queuedSubmission("submission-clone-failure", thread.id, turn.id))
      return { cannotClone: () => "function" }
    })).rejects.toThrow()

    expect(commit).not.toHaveBeenCalled()
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0)).toEqual(beforeEvents)
    expect(runtime.listDurableDecisions()).toEqual([])
    expect(runtime.listQueuedSubmissions()).toEqual([])
    expect(published).toEqual([])
  })

  it("isolates queued inputs, writer results, reads, transaction reads, and listener event copies", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)

    const threadInput = { workspaceId: null, title: "Original title" }
    const threadPromise = runtime.createThread(threadInput)
    threadInput.title = "Mutated before dequeue"
    const thread = await threadPromise
    expect(thread.title).toBe("Original title")

    thread.title = "Mutated writer result"
    expect(runtime.getThread(thread.id)?.title).toBe("Original title")

    const { turn } = await runtime.createTurn({
      threadId: thread.id,
      prompt: "Original prompt",
      mode: "auto"
    })
    turn.prompt = "Mutated writer result"
    expect(runtime.getTurn(turn.id)?.prompt).toBe("Original prompt")

    const snapshot = runtime.snapshot(undefined)
    snapshot.turns[0].prompt = "Mutated snapshot"
    expect(runtime.getTurn(turn.id)?.prompt).toBe("Original prompt")

    await runtime.commitRuntimeMutation(tx => {
      const txTurn = tx.getTurn(turn.id)!
      txTurn.status = "completed"
    })
    expect(runtime.getTurn(turn.id)?.status).toBe("running")

    const secondListenerValues: string[] = []
    runtime.on("event", event => {
      event.payload.nested.value = "mutated by first listener"
    })
    runtime.on("event", event => {
      secondListenerValues.push(event.payload.nested.value)
    })
    const payload = { nested: { value: "original listener value" } }
    const eventPromise = runtime.appendSystemEvent(
      thread.id,
      turn.id,
      "agent:activity",
      "codex",
      payload
    )
    payload.nested.value = "mutated after enqueue"
    const event = await eventPromise

    expect(secondListenerValues).toEqual(["original listener value"])
    expect(event.payload.nested.value).toBe("original listener value")
    event.payload.nested.value = "mutated writer event"
    expect(runtime.eventsSince(thread.id, 0).at(-1)?.payload.nested.value)
      .toBe("original listener value")

    memory["runtime.workbench.v1"].turns.find((candidate: any) => candidate.id === turn.id).prompt = "mutated persisted clone"
    expect(runtime.getTurn(turn.id)?.prompt).toBe("Original prompt")
  })

  it("contains listener failures so durable success, later listeners, and the writer queue continue", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "listeners", mode: "auto", workspaceId: null })
    const received: string[] = []
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    runtime.on("event", () => {
      throw new Error("listener exploded")
    })
    runtime.on("event", async () => {
      throw new Error("async listener exploded")
    })
    runtime.on("event", event => {
      received.push(event.payload.message)
    })

    try {
      await expect(runtime.appendSystemEvent(
        thread.id,
        turn.id,
        "agent:activity",
        "codex",
        { message: "durable" }
      )).resolves.toMatchObject({ kind: "agent:activity" })
      await expect(runtime.commitRuntimeMutation(tx => {
        tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", { message: "atomic durable" })
      })).resolves.toBeUndefined()
      await expect(runtime.createThread({ title: "queue continues" })).resolves.toMatchObject({
        title: "queue continues"
      })
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(4))
    } finally {
      errorSpy.mockRestore()
    }

    expect(received).toEqual(["durable", "atomic durable"])
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.payload?.message === "durable"))
      .toBe(true)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.payload?.message === "atomic durable"))
      .toBe(true)
  })

  it("migrates old state, repairs sequences, and isolates durable ledger upserts", async () => {
    const oldThread = {
      id: "thread-old",
      workspaceId: null,
      title: "Old",
      createdAt: 1,
      updatedAt: 1
    }
    const oldTurn = {
      id: "turn-old",
      threadId: oldThread.id,
      prompt: "Old prompt",
      mode: "auto",
      status: "running",
      taskIds: [],
      createdAt: 1
    }
    memory["runtime.workbench.v1"] = {
      version: 1,
      threads: [oldThread],
      turns: [oldTurn],
      runs: [],
      events: [{
        id: "event-old",
        threadId: oldThread.id,
        turnId: oldTurn.id,
        seq: 9,
        kind: "turn:created",
        payload: {},
        createdAt: 1
      }],
      hiddenTaskTurnIds: [],
      activeThreadId: oldThread.id,
      nextSeqByThread: { [oldThread.id]: 2 }
    }

    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    expect(runtime.listDurableDecisions()).toEqual([])
    expect(runtime.listQueuedSubmissions()).toEqual([])
    memory["runtime.workbench.v1"].turns[0].prompt = "mutated source"
    expect(runtime.getTurn(oldTurn.id)?.prompt).toBe("Old prompt")

    const nextEvent = await runtime.appendSystemEvent(
      oldThread.id,
      oldTurn.id,
      "agent:activity",
      "codex",
      { message: "next" }
    )
    expect(nextEvent.seq).toBe(10)

    const record = decisionRecord("decision-upsert", {
      type: "turn",
      threadId: oldThread.id,
      turnId: oldTurn.id,
      workspaceId: null,
      webContentsId: 7
    })
    const submission = queuedSubmission("submission-upsert", oldThread.id, oldTurn.id)
    await runtime.commitRuntimeMutation(tx => {
      tx.upsertDecision(record)
      tx.upsertSubmission(submission)
    })
    record.request = { ...record.request, title: "mutated external record" }
    submission.input.prompt = "mutated external submission"

    expect(runtime.listDurableDecisions()[0].request.title).toBe("Decision decision-upsert")
    expect(runtime.listQueuedSubmissions(oldThread.id)[0].input.prompt).toBe("Prompt submission-upsert")

    await runtime.commitRuntimeMutation(tx => {
      tx.upsertSubmission({ ...submission, state: "starting", input: { ...submission.input, prompt: "replacement" } })
      tx.removeSubmission(submission.id)
    })
    expect(runtime.listQueuedSubmissions()).toEqual([])
  })

  it("keeps rapid start, delta, and done stream updates in one ordered actor history", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "rapid", mode: "auto", workspaceId: null })
    const published: string[] = []
    runtime.on("event", event => published.push(event.kind))

    await runtime.appendStreamEvent(turn.id, { kind: "start", agentId: "codex" })
    await runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "codex", text: "hello" })
    await runtime.appendStreamEvent(turn.id, { kind: "done", agentId: "codex", content: "hello", durationMs: 4 })

    expect(published).toEqual([
      "run:created",
      "agent:start",
      "agent:delta",
      "run:status",
      "agent:done"
    ])
    expect(runtime.snapshot(undefined).runs).toEqual([
      expect.objectContaining({ turnId: turn.id, agentId: "codex", status: "completed", endedAt: expect.any(Number) })
    ])
    const events = runtime.eventsSince(thread.id, 0)
    expect(events.map(event => event.seq)).toEqual(events.map(event => event.seq).sort((a, b) => a - b))
  })

  it("keeps all decision events while their Turn runs, then restores the cap with resolved tombstones first", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "compact decisions", mode: "auto", workspaceId: null })
    const requestId = "decision-compaction"
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    try {
      await runtime.commitRuntimeMutation(tx => {
        tx.upsertDecision(decisionRecord(requestId, {
          type: "turn",
          threadId: thread.id,
          turnId: turn.id,
          workspaceId: null,
          webContentsId: 7
        }))
        for (let index = 0; index < 2501; index += 1) {
          tx.appendEvent(thread.id, turn.id, "decision:requested", undefined, { requestId, index })
          tx.appendEvent(thread.id, turn.id, "decision:resolved", undefined, { requestId, index })
        }
      })
    } finally {
      warningSpy.mockRestore()
    }

    const runningEvents = runtime.eventsSince(thread.id, 0)
    expect(runningEvents).toHaveLength(5002)
    expect(runningEvents.filter(event => event.kind === "decision:requested")).toHaveLength(2501)
    expect(runningEvents.filter(event => event.kind === "decision:resolved")).toHaveLength(2501)

    await runtime.setTurnStatus(turn.id, "completed")
    const terminalEvents = runtime.eventsSince(thread.id, 0)
    expect(terminalEvents.length).toBeLessThanOrEqual(5000)
    expect(terminalEvents.filter(event => event.kind === "decision:resolved")).toHaveLength(2501)
    expect(terminalEvents.filter(event => event.kind === "decision:requested").length).toBeLessThan(2501)
    const persistedSeqs = memory["runtime.workbench.v1"].events.map((event: any) => event.seq)
    expect(persistedSeqs).toEqual([...persistedSeqs].sort((left, right) => left - right))
  })

  it("fails safe for unresolved hub decisions and decisions whose owning Turn is missing", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "missing owner", mode: "auto", workspaceId: null })
    const hubRequestId = "decision-hub"
    const missingTurnRequestId = "decision-missing-turn"

    await runtime.commitRuntimeMutation(tx => {
      tx.upsertDecision(decisionRecord(hubRequestId, {
        type: "hub",
        sessionId: "hub-session"
      }))
      tx.upsertDecision(decisionRecord(missingTurnRequestId, {
        type: "turn",
        threadId: "missing-thread",
        turnId: "missing-turn",
        workspaceId: null,
        webContentsId: 7
      }))
      tx.appendEvent(thread.id, turn.id, "decision:requested", undefined, { requestId: hubRequestId })
      tx.appendEvent(thread.id, turn.id, "decision:resolved", undefined, { requestId: hubRequestId })
      tx.appendEvent(thread.id, turn.id, "decision:requested", undefined, { requestId: missingTurnRequestId })
      tx.appendEvent(thread.id, turn.id, "decision:resolved", undefined, { requestId: missingTurnRequestId })
      for (let index = 0; index < 5100; index += 1) {
        tx.appendEvent(thread.id, turn.id, "agent:done", "codex", { index })
      }
    })

    const decisionEvents = runtime.eventsSince(thread.id, 0)
      .filter(event => event.kind === "decision:requested" || event.kind === "decision:resolved")
    expect(decisionEvents.map(event => event.payload.requestId)).toEqual([
      hubRequestId,
      hubRequestId,
      missingTurnRequestId,
      missingTurnRequestId
    ])
    expect(runtime.eventsSince(thread.id, 0).length).toBeLessThanOrEqual(5000)
  })

  it("clears completedAt when a Turn returns to a non-terminal decision state", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "approval", mode: "auto", workspaceId: null })
    await runtime.setTurnStatus(turn.id, "completed")
    expect(runtime.getTurn(turn.id)?.completedAt).toEqual(expect.any(Number))
    await runtime.setTurnStatus(turn.id, "awaiting-decision")
    expect(runtime.getTurn(turn.id)?.completedAt).toBeUndefined()
    expect(await runtime.clearCompletedTasks()).not.toContain(turn.id)
  })

  it("clears endedAt when an agent run returns to a non-terminal decision state", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "approval", mode: "auto", workspaceId: null })
    await runtime.createRun({ turnId: turn.id, agentId: "codex", role: "target" })
    await runtime.setRunStatus(turn.id, "codex", "completed")
    expect(runtime.snapshot(undefined).runs[0]?.endedAt).toEqual(expect.any(Number))
    await runtime.setRunStatus(turn.id, "codex", "awaiting-decision")
    expect(runtime.snapshot(undefined).runs[0]?.endedAt).toBeUndefined()
  })

  it("auto-titles New chat / 新对话 placeholders on first turn (IT-1)", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const en = await runtime.createThread({ title: "New chat" })
    const zh = await runtime.createThread({ title: "新对话" })
    const named = await runtime.createThread({ title: "My notes" })

    expect((await runtime.createTurn({ threadId: en.id, prompt: "Explain React hooks", mode: "auto" })).thread.title)
      .toBe("Explain React hooks")
    expect((await runtime.createTurn({ threadId: zh.id, prompt: "修复登录 bug", mode: "auto" })).thread.title)
      .toBe("修复登录 bug")
    expect((await runtime.createTurn({ threadId: named.id, prompt: "other prompt", mode: "auto" })).thread.title)
      .toBe("My notes")
  })

  it("allows personal threads and turns without a workspace", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const thread = await runtime.createThread({ workspaceId: null, title: "个人会话" })
    const { turn } = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: null,
      prompt: "不绑定目录也能聊天",
      mode: "auto"
    })

    expect(thread.workspaceId).toBeNull()
    expect(turn.threadId).toBe(thread.id)
    expect(runtime.snapshot(null).threads).toHaveLength(1)
    expect(runtime.snapshot(null).turns[0].prompt).toBe("不绑定目录也能聊天")
    expect(runtime.snapshot(undefined).threads[0].workspaceId).toBeNull()
  })

  it("does not substitute a workspace thread when the active thread belongs elsewhere", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)

    const workspaceThread = await runtime.createThread({ workspaceId: "ws-1", title: "Workspace thread" })
    const personalThread = await runtime.createThread({ workspaceId: null, title: "Personal thread" })

    expect(runtime.snapshot(undefined).activeThreadId).toBe(personalThread.id)
    expect(runtime.snapshot("ws-1").threads.map(thread => thread.id)).toContain(workspaceThread.id)
    expect(runtime.snapshot("ws-1").activeThreadId).toBeNull()
  })

  it("maps extended scheduling presets to existing dispatcher modes", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)

    expect(runtime.dispatcherMode("lead-workers")).toBe("orchestrate")
    expect(runtime.dispatcherMode("parallel-review")).toBe("broadcast")
    expect(runtime.dispatcherMode("chain")).toBe("chain")
  })

  it("persists direct target agents so retries keep the selected agent", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "只让 Claude 回答",
      mode: "lead-workers",
      targetAgent: "claude",
      workspaceId: "ws-1"
    })

    expect(turn.targetAgent).toBe("claude")
    expect(runtime.snapshot("ws-1").turns[0].targetAgent).toBe("claude")
    expect(runtime.eventsSince(thread.id, 0)[0].payload).toEqual(expect.objectContaining({
      prompt: "只让 Claude 回答",
      mode: "lead-workers"
    }))
  })

  it("persists attachments and custom schedule graphs on turns", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({
      prompt: "分析图片和文件",
      mode: "custom",
      workspaceId: "ws-1",
      attachments: [{ id: "att-1", kind: "image", name: "screen.png", path: "C:/tmp/screen.png", mime: "image/png", size: 12 }],
      customSchedule: {
        preset: "custom",
        label: "自定义调度",
        description: "test",
        steps: [
          { id: "a", label: "A", agentId: "codex", role: "worker", mode: "auto" },
          { id: "b", label: "B", agentId: "claude", role: "reviewer", mode: "auto", dependsOn: ["a"] }
        ]
      }
    })

    const saved = runtime.snapshot("ws-1").turns[0]
    expect(saved.attachments?.[0].name).toBe("screen.png")
    expect(saved.customSchedule?.steps[1].dependsOn).toEqual(["a"])
    expect(runtime.eventsSince(thread.id, 0).find(e => e.kind === "turn:created")?.payload.attachments[0].path).toBe("C:/tmp/screen.png")
    expect(turn.mode).toBe("custom")
  })

  it("debounces delta persistence but saves a following terminal event immediately in actor order", async () => {
    vi.useFakeTimers()
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "stream", mode: "auto", workspaceId: null })
    commit.mockClear()
    const beforeSetCount = setCount

    const deltas = await Promise.all([
      runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "gemini", text: "hel", channel: "content" }),
      runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "gemini", text: "lo", channel: "content" })
    ])
    expect(commit).not.toHaveBeenCalled()
    expect(setCount).toBe(beforeSetCount)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.kind === "agent:delta"))
      .toBe(false)
    expect(deltas.map(event => event.seq)).toEqual([...deltas.map(event => event.seq)].sort((a, b) => a - b))

    await vi.advanceTimersByTimeAsync(451)
    await runtime.whenIdle()
    expect(setCount).toBe(beforeSetCount + 1)
    expect(memory["runtime.workbench.v1"].events.filter((event: any) => event.kind === "agent:delta"))
      .toHaveLength(2)

    await runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "gemini", text: "!", channel: "content" })
    await runtime.appendStreamEvent(turn.id, { kind: "done", agentId: "gemini", content: "hello", durationMs: 1 })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.kind === "agent:done")).toBe(true)
    const persistedKinds = memory["runtime.workbench.v1"].events.map((event: any) => event.kind)
    expect(persistedKinds.lastIndexOf("agent:delta")).toBeLessThan(persistedKinds.lastIndexOf("agent:done"))
    expect(runtime.eventsSince(thread.id, 0).some(event => event.kind === "agent:done")).toBe(true)
  })

  it("drains a durable delta batch queued before dispose without leaving a timer", async () => {
    vi.useFakeTimers()
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "dispose queue", mode: "auto", workspaceId: null })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const atomic = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", { phase: "atomic" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())
    const delta = runtime.appendStreamEvent(turn.id, {
      kind: "delta",
      agentId: "codex",
      text: "queued before dispose"
    })
    const disposal = runtime.dispose()

    releaseCommit()
    await Promise.all([atomic, delta, disposal])
    const setCountAfterDispose = setCount
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(451)
    await runtime.whenIdle()
    expect(setCount).toBe(setCountAfterDispose)
  })

  it("drains writers queued before dispose and rejects writers during and after closing", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "closing", mode: "auto", workspaceId: null })

    let releaseCommit!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise<any>(resolve => {
      releaseCommit = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const atomicBeforeDispose = runtime.commitRuntimeMutation(tx => {
      tx.appendEvent(thread.id, turn.id, "agent:activity", "codex", { phase: "atomic-before-dispose" })
    })
    await vi.waitFor(() => expect(commit).toHaveBeenCalled())
    const queuedBeforeDispose = runtime.appendSystemEvent(
      thread.id,
      turn.id,
      "agent:activity",
      "codex",
      { phase: "queued-before-dispose" }
    )
    const disposal = runtime.dispose()
    const duringDispose = runtime.appendSystemEvent(
      thread.id,
      turn.id,
      "agent:activity",
      "codex",
      { phase: "during-dispose" }
    )

    releaseCommit()
    await expect(duringDispose).rejects.toThrow("closing")
    await Promise.all([atomicBeforeDispose, queuedBeforeDispose, disposal])
    await expect(runtime.appendSystemEvent(
      thread.id,
      turn.id,
      "agent:activity",
      "codex",
      { phase: "after-dispose" }
    )).rejects.toThrow("closed")

    const phases = memory["runtime.workbench.v1"].events
      .map((event: any) => event.payload?.phase)
      .filter(Boolean)
    expect(phases).toEqual(["atomic-before-dispose", "queued-before-dispose"])
  })

  it("persists custom schedule stream roles on run nodes", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "guarded run", mode: "firefly-custom", workspaceId: null })

    await runtime.appendStreamEvent(turn.id, {
      kind: "start",
      agentId: "reviewer-agent",
      providerId: "local-cli",
      modelId: "reviewer-agent",
      mode: "content",
      scheduleRole: "reviewer",
      visibility: "run"
    })

    expect(runtime.snapshot(undefined).runs[0]).toMatchObject({
      agentId: "reviewer-agent",
      role: "reviewer"
    })
    expect(runtime.eventsSince(turn.threadId, 0).find(event => event.kind === "agent:start")?.payload).toMatchObject({
      scheduleRole: "reviewer",
      visibility: "run"
    })
  })

  it("updates repeated same-agent schedule runs by role instead of overwriting the latest run", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = await runtime.createTurn({ prompt: "five role", mode: "firefly-custom", workspaceId: null })

    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "router-task", agentId: "claude", providerId: "local-cli", modelId: "claude", mode: "content", scheduleRole: "router", scheduleStepId: "router" })
    await runtime.appendStreamEvent(turn.id, { kind: "done", taskId: "router-task", agentId: "claude", providerId: "local-cli", modelId: "claude", content: "{}", durationMs: 1, scheduleRole: "router", scheduleStepId: "router" })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "lead-task", agentId: "claude", providerId: "local-cli", modelId: "claude", mode: "content", scheduleRole: "lead", scheduleStepId: "main" })
    await runtime.appendStreamEvent(turn.id, { kind: "done", taskId: "lead-task", agentId: "claude", providerId: "local-cli", modelId: "claude", content: "answer", durationMs: 2, scheduleRole: "lead", scheduleStepId: "main" })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "review-task", agentId: "claude", providerId: "local-cli", modelId: "claude", mode: "content", scheduleRole: "reviewer", scheduleStepId: "reviewer" })
    await runtime.appendStreamEvent(turn.id, { kind: "error", taskId: "review-task", agentId: "claude", providerId: "local-cli", modelId: "claude", error: "exit 1", durationMs: 3, scheduleRole: "reviewer", scheduleStepId: "reviewer" })

    const runs = runtime.snapshot(undefined).runs.filter(run => run.turnId === turn.id)
    expect(runs.map(run => [run.role, run.status])).toEqual([
      ["router", "completed"],
      ["lead", "completed"],
      ["reviewer", "failed"]
    ])
    const reviewStatus = runtime.eventsSince(turn.threadId, 0).filter(event => event.kind === "run:status").at(-1)
    expect(reviewStatus?.payload).toMatchObject({ status: "failed", scheduleRole: "reviewer", scheduleStepId: "reviewer" })
  })

  it("hides a runtime task card by turn id without deleting conversation data", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "delete me", mode: "auto", workspaceId: "ws-1" })
    await runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-1", agentId: "codex" })
    await runtime.attachTask(turn.id, "task-1")
    await runtime.setTurnStatus(turn.id, "completed", { taskId: "task-1" })

    expect(await runtime.deleteTask(turn.id)).toBe(true)
    expect(runtime.snapshot("ws-1").turns).toHaveLength(1)
    expect(runtime.snapshot("ws-1").runs).toHaveLength(1)
    expect(runtime.eventsSince(thread.id, 0).length).toBeGreaterThan(0)
    expect(runtime.snapshot("ws-1").hiddenTaskTurnIds).toEqual([turn.id])
  })

  it("hides completed runtime task cards for one workspace only", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const done = (await runtime.createTurn({ prompt: "done", mode: "custom", workspaceId: "ws-1" })).turn
    const failed = (await runtime.createTurn({ prompt: "failed", mode: "custom", workspaceId: "ws-1" })).turn
    const running = (await runtime.createTurn({ prompt: "running", mode: "custom", workspaceId: "ws-1" })).turn
    const other = (await runtime.createTurn({ prompt: "other", mode: "custom", workspaceId: "ws-2" })).turn

    await runtime.setTurnStatus(done.id, "completed")
    await runtime.setTurnStatus(failed.id, "failed")
    await runtime.setTurnStatus(other.id, "completed")

    expect((await runtime.clearCompletedTasks("ws-1")).sort()).toEqual([done.id, failed.id].sort())
    expect(runtime.snapshot("ws-1").turns.map(turn => turn.id)).toEqual([done.id, failed.id, running.id])
    expect(runtime.snapshot("ws-1").hiddenTaskTurnIds?.sort()).toEqual([done.id, failed.id].sort())
    expect(runtime.snapshot("ws-2").hiddenTaskTurnIds).toEqual([])
  })

  it("prunes old stream deltas before completion events", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = await runtime.createTurn({ prompt: "long stream", mode: "auto", workspaceId: null })
    await runtime.appendSystemEvent(thread.id, turn.id, "agent:done", "codex", {
      providerId: "openai",
      modelId: "gpt-4o",
      content: "old usage",
      usage: { input_tokens: 1, output_tokens: 1 }
    })

    await Promise.all(Array.from({ length: 5100 }, () => (
      runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "codex", text: "x", channel: "content" })
    )))

    const events = runtime.eventsSince(thread.id, 0)
    expect(events.length).toBeLessThanOrEqual(5000)
    expect(events.some(event => event.kind === "agent:done" && event.payload?.usage)).toBe(true)
  })
})
