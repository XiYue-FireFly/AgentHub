import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import type { DecisionOwner, DecisionRequest, DecisionResolution } from "../../../shared/decision-contract"
import type { DurableDecisionRecord } from "../types"
import {
  createAcpDecisionRequest,
  createAgentDecisionRequest,
  createPromptDecisionRequest,
  createToolDecisionRequest
} from "../decision-request-factories"
import { DECISION_SERVICE_LIMITS, DecisionService } from "../decision-service"
import { WorkbenchRuntimeStore } from "../store"

const { memory, commit } = vi.hoisted(() => {
  const persisted: Record<string, any> = {}
  const jsonCanonical = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  return {
    memory: persisted,
    commit: vi.fn(async (key: string, value: any) => {
      const canonical = jsonCanonical(value)
      persisted[key] = structuredClone(canonical)
      return structuredClone(canonical)
    })
  }
})

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = structuredClone(value) },
    commit
  }
}))

const runtimes: WorkbenchRuntimeStore[] = []
const services: DecisionService[] = []
const jsonCanonical = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function turnOwner(
  threadId: string,
  turnId: string,
  workspaceId: string | null = "workspace-a",
  webContentsId = 7
): DecisionOwner {
  return { type: "turn", threadId, turnId, workspaceId, webContentsId }
}

function agentDecision(owner: DecisionOwner, idempotencyKey: string, title = idempotencyKey) {
  return createAgentDecisionRequest({
    owner,
    title,
    kind: "single-select",
    options: [
      { id: "one", label: "One" },
      { id: "two", label: "Two" }
    ],
    idempotencyKey
  })
}

function promptDecision(owner: DecisionOwner, title: string) {
  return createPromptDecisionRequest({
    owner,
    title,
    kind: "single-select",
    options: [{ id: "one", label: "One" }]
  })
}

function toolDecision(
  owner: DecisionOwner,
  idempotencyKey: string,
  deadlineMs?: number,
  allowRemember = false,
  agentId = "codex"
) {
  return createToolDecisionRequest({
    owner,
    agentId,
    tool: "exec",
    toolName: "shell",
    action: "run command",
    target: "secret-target",
    preview: "secret-preview",
    risk: "high",
    deadlineMs,
    allowRemember,
    idempotencyKey
  })
}

function acpDecision(owner: DecisionOwner, idempotencyKey: string, agentId: string) {
  return createAcpDecisionRequest({
    owner,
    agentId,
    title: 'ACP permission',
    toolName: 'shell',
    options: [
      { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
      { optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once' }
    ],
    idempotencyKey
  })
}

async function createRuntimeTurn(input: {
  threadId?: string
  workspaceId?: string | null
  ownerWebContentsId?: number
} = {}) {
  const runtime = new WorkbenchRuntimeStore()
  runtimes.push(runtime)
  const created = await runtime.createTurn({
    threadId: input.threadId,
    workspaceId: input.workspaceId === undefined ? "workspace-a" : input.workspaceId,
    ownerWebContentsId: input.ownerWebContentsId ?? 7,
    prompt: "decision test",
    mode: "auto"
  })
  return { runtime, ...created }
}

function createService(runtimeStore: WorkbenchRuntimeStore) {
  const service = new DecisionService({ runtimeStore })
  services.push(service)
  return service
}

async function waitForRecord(
  runtime: WorkbenchRuntimeStore,
  requestId: string,
  state?: DurableDecisionRecord["state"]
): Promise<DurableDecisionRecord> {
  let record: DurableDecisionRecord | undefined
  await vi.waitFor(() => {
    record = runtime.listDurableDecisions().find(candidate => candidate.request.id === requestId)
    expect(record).toBeDefined()
    if (state) expect(record?.state).toBe(state)
  })
  return record!
}

async function resolveOne(
  service: DecisionService,
  request: DecisionRequest,
  sender = { webContentsId: 7, workspaceId: "workspace-a" as string | null }
) {
  return service.resolve({
    requestId: request.id,
    outcome: "selected",
    selectedOptionIds: [request.options[0].id]
  }, sender)
}

function terminalRecord(request: DecisionRequest, status: DecisionResolution["status"] = "selected"): DurableDecisionRecord {
  return {
    request,
    state: "terminal",
    resolution: {
      requestId: request.id,
      status,
      selectedOptionIds: status === "selected" ? [request.options[0]?.id].filter(Boolean) : undefined,
      resolvedAt: Date.now()
    }
  }
}

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key]
  commit.mockReset()
  commit.mockImplementation(async (key: string, value: any) => {
    const canonical = jsonCanonical(value)
    memory[key] = structuredClone(canonical)
    return structuredClone(canonical)
  })
  vi.useRealTimers()
})

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(service => service.shutdown()))
  await Promise.allSettled(runtimes.splice(0).map(runtime => runtime.dispose()))
  vi.useRealTimers()
})

describe("DecisionService durable lifecycle", () => {
  it("keeps a provisional request invisible until the atomic commit succeeds", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const request = agentDecision(turnOwner(thread.id, turn.id), "provisional")
    let release!: () => void
    commit.mockClear()
    commit.mockImplementationOnce((_key, value) => new Promise(resolve => {
      release = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))

    const waiting = service.request(request)
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))

    expect(runtime.listDurableDecisions()).toEqual([])
    expect(service.listPending()).toEqual([])
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
    expect(runtime.eventsSince(thread.id).some(event => event.kind === "decision:requested")).toBe(false)

    release()
    await waitForRecord(runtime, request.id, "active")
    expect(service.listPending()).toHaveLength(1)
    expect(runtime.getTurn(turn.id)?.status).toBe("awaiting-decision")
    await resolveOne(service, request)
    await expect(waiting).resolves.toMatchObject({ requestId: request.id, status: "selected" })
  })

  it("queues requests FIFO per owner and starts a queued security deadline only after promotion", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2035-01-01T00:00:00Z"))
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const first = toolDecision(owner, "first", 100)
    const second = toolDecision(owner, "second", 100)
    const firstWaiting = service.request(first)
    const secondWaiting = service.request(second)

    const firstRecord = await waitForRecord(runtime, first.id, "active")
    const secondRecord = await waitForRecord(runtime, second.id, "queued")
    expect(firstRecord.expiresAt! - firstRecord.activatedAt!).toBe(100)
    expect(secondRecord.activatedAt).toBeUndefined()
    expect(secondRecord.expiresAt).toBeUndefined()
    await expect(resolveOne(service, second)).resolves.toEqual({ accepted: false })

    await vi.advanceTimersByTimeAsync(Math.max(0, firstRecord.expiresAt! - Date.now()))
    await expect(firstWaiting).resolves.toMatchObject({ status: "timeout" })
    const promoted = runtime.listDurableDecisions().find(record => record.request.id === second.id)!
    expect(promoted.state).toBe("active")
    expect(promoted.activatedAt).toBeGreaterThanOrEqual(firstRecord.expiresAt!)
    expect(promoted.activatedAt).toBeLessThanOrEqual(Date.now())
    expect(promoted.expiresAt! - promoted.activatedAt!).toBe(100)
    expect(runtime.getTurn(turn.id)?.status).toBe("awaiting-decision")
    expect(runtime.eventsSince(thread.id).filter(event => (
      event.kind === "decision:requested" && event.payload?.requestId === second.id
    ))).toHaveLength(1)

    let secondSettled = false
    void secondWaiting.then(() => { secondSettled = true })
    await vi.advanceTimersByTimeAsync(99)
    expect(secondSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(secondWaiting).resolves.toMatchObject({ status: "timeout" })
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
  })

  it("isolates owners by Turn even when two Turns share a thread", async () => {
    const firstCreated = await createRuntimeTurn()
    const second = await firstCreated.runtime.createTurn({
      threadId: firstCreated.thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "second turn",
      mode: "auto"
    })
    const service = createService(firstCreated.runtime)
    const firstRequest = agentDecision(turnOwner(firstCreated.thread.id, firstCreated.turn.id), "same-step")
    const secondRequest = agentDecision(turnOwner(firstCreated.thread.id, second.turn.id), "same-step")
    const firstWaiting = service.request(firstRequest)
    const secondWaiting = service.request(secondRequest)

    await waitForRecord(firstCreated.runtime, firstRequest.id, "active")
    await waitForRecord(firstCreated.runtime, secondRequest.id, "active")
    expect(firstCreated.runtime.getTurn(firstCreated.turn.id)?.status).toBe("awaiting-decision")
    expect(firstCreated.runtime.getTurn(second.turn.id)?.status).toBe("awaiting-decision")

    await resolveOne(service, firstRequest)
    await expect(firstWaiting).resolves.toMatchObject({ status: "selected" })
    expect(firstCreated.runtime.getTurn(firstCreated.turn.id)?.status).toBe("running")
    expect(firstCreated.runtime.getTurn(second.turn.id)?.status).toBe("awaiting-decision")

    await resolveOne(service, secondRequest)
    await expect(secondWaiting).resolves.toMatchObject({ status: "selected" })
  })

  it("lists only visible pending decisions with stable sorting, sender filters, and isolated clones", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const firstCreated = await createRuntimeTurn({ workspaceId: "workspace-a", ownerWebContentsId: 7 })
    const secondCreated = await firstCreated.runtime.createTurn({
      workspaceId: "workspace-b",
      ownerWebContentsId: 8,
      prompt: "filtered pending",
      mode: "auto"
    })
    const service = createService(firstCreated.runtime)
    const first = agentDecision(turnOwner(firstCreated.thread.id, firstCreated.turn.id, "workspace-a", 7), "pending-first")
    vi.setSystemTime(200)
    const second = agentDecision(turnOwner(secondCreated.thread.id, secondCreated.turn.id, "workspace-b", 8), "pending-second")
    const firstWaiting = service.request(first)
    const secondWaiting = service.request(second)
    await waitForRecord(firstCreated.runtime, second.id, "active")

    expect(service.listPending().map(pending => pending.request.id)).toEqual([first.id, second.id])
    expect(service.listPending({ threadId: firstCreated.thread.id }).map(pending => pending.request.id)).toEqual([first.id])
    expect(service.listPending({ webContentsId: 8 }).map(pending => pending.request.id)).toEqual([second.id])
    expect(service.listPending({ workspaceId: "workspace-b" }).map(pending => pending.request.id)).toEqual([second.id])
    const isolated = service.listPending({ threadId: firstCreated.thread.id })[0] as any
    isolated.state = "terminal"
    isolated.request.title = "mutated"
    expect(service.listPending({ threadId: firstCreated.thread.id })[0]).toMatchObject({
      state: "active",
      request: { title: first.title }
    })

    await Promise.all([
      service.cancelTurn(firstCreated.turn.id),
      service.cancelTurn(secondCreated.turn.id)
    ])
    await Promise.all([firstWaiting, secondWaiting])
  })

  it("exports stable service limits and reports inclusive at-most failures", async () => {
    expect(DECISION_SERVICE_LIMITS).toEqual({
      unresolvedPerTurn: 8,
      createdPerTurn: 32,
      unresolvedProcess: 64,
      agentCreatedPerTurn: 4
    })
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const waiters = Array.from({ length: DECISION_SERVICE_LIMITS.unresolvedPerTurn }, (_, index) => (
      service.request(promptDecision(owner, `limit-message-${index}`))
    ))
    await expect(service.request(promptDecision(owner, "limit-message-overflow")))
      .rejects.toThrow("at most 8 unresolved")
    await service.cancelTurn(turn.id)
    await Promise.all(waiters)
  })

  it("authenticates Hub decisions by session and never leaves a supported owner unresolvable", async () => {
    const { runtime } = await createRuntimeTurn()
    const service = createService(runtime)
    service.openHubSession("hub-session")
    const request = promptDecision({ type: "hub", sessionId: "hub-session" }, "hub request")
    const waiting = service.request(request)
    await waitForRecord(runtime, request.id, "active")

    await expect(service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { sessionId: "wrong-session" })).resolves.toEqual({ accepted: false })
    await expect(service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { sessionId: "hub-session" })).resolves.toEqual({ accepted: true })
    await expect(waiting).resolves.toMatchObject({ status: "selected" })
  })

  it("retains settled Hub idempotency through retries and releases it only when the session closes", async () => {
    const { runtime } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner: DecisionOwner = { type: "hub", sessionId: "long-lived-session" }
    service.openHubSession("long-lived-session")
    const first = agentDecision(owner, "reusable-step")
    const firstWaiting = service.request(first)
    await waitForRecord(runtime, first.id, "active")
    await service.resolve({
      requestId: first.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { sessionId: "long-lived-session" })
    await firstWaiting

    const retry = agentDecision(owner, "reusable-step")
    expect(service.request(retry)).toBe(firstWaiting)

    await service.closeHubSession("long-lived-session")
    await expect(service.request(agentDecision(owner, "reusable-step"))).rejects.toThrow("not active")

    const reconnectedOwner: DecisionOwner = { type: "hub", sessionId: "reconnected-session" }
    service.openHubSession("reconnected-session")
    const second = agentDecision(reconnectedOwner, "reusable-step")
    const secondWaiting = service.request(second)
    expect(secondWaiting).not.toBe(firstWaiting)
    await waitForRecord(runtime, second.id, "active")
    await service.resolve({
      requestId: second.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { sessionId: "reconnected-session" })
    await secondWaiting
  })

  it("closes every unresolved Hub decision exactly once and clears queued session state", async () => {
    const { runtime } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner: DecisionOwner = { type: "hub", sessionId: "closing-session" }
    service.openHubSession("closing-session")
    const first = agentDecision(owner, "close-first")
    const second = agentDecision(owner, "close-second")
    const firstContinuation = vi.fn()
    const secondContinuation = vi.fn()
    const firstWaiting = service.request(first)
    const secondWaiting = service.request(second)
    void firstWaiting.then(firstContinuation)
    void secondWaiting.then(secondContinuation)
    await waitForRecord(runtime, second.id, "queued")

    await Promise.all([
      service.closeHubSession("closing-session"),
      service.closeHubSession("closing-session")
    ])
    await Promise.all([firstWaiting, secondWaiting])

    expect(firstContinuation).toHaveBeenCalledTimes(1)
    expect(secondContinuation).toHaveBeenCalledTimes(1)
    expect(runtime.listDurableDecisions().filter(record => (
      record.request.owner.type === "hub" && record.request.owner.sessionId === "closing-session"
    ))).toEqual([
      expect.objectContaining({ state: "terminal", resolution: expect.objectContaining({ status: "cancelled" }) }),
      expect.objectContaining({ state: "terminal", resolution: expect.objectContaining({ status: "cancelled" }) })
    ])

    await service.closeHubSession("closing-session")
    await expect(service.request(agentDecision(owner, "close-first"))).rejects.toThrow("not active")
    service.openHubSession("replacement-session")
    const replacementOwner: DecisionOwner = { type: "hub", sessionId: "replacement-session" }
    const replacement = agentDecision(replacementOwner, "close-first")
    const replacementWaiting = service.request(replacement)
    await waitForRecord(runtime, replacement.id, "active")
    await service.resolve({
      requestId: replacement.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { sessionId: "replacement-session" })
    await replacementWaiting
  })

  it("rejects requests synchronously once Hub close starts and never persists a late orphan", async () => {
    const { runtime } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner: DecisionOwner = { type: "hub", sessionId: "closing-gate" }
    service.openHubSession("closing-gate")
    const active = agentDecision(owner, "active-before-close")
    const activeWaiting = service.request(active)
    await waitForRecord(runtime, active.id, "active")
    let releaseClose!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise(resolve => {
      releaseClose = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))

    const closing = service.closeHubSession("closing-gate")
    await vi.waitFor(() => expect(releaseClose).toBeTypeOf("function"))
    const late = agentDecision(owner, "late-during-close")
    await expect(service.request(late)).rejects.toThrow("not active")
    expect(runtime.listDurableDecisions().some(record => record.request.id === late.id)).toBe(false)

    releaseClose()
    await closing
    await expect(activeWaiting).resolves.toMatchObject({ status: "cancelled" })
    expect(runtime.listDurableDecisions().some(record => record.request.id === late.id)).toBe(false)
  })

  it("treats a late Hub disconnect after shutdown as a local no-op without a new commit", async () => {
    const { runtime } = await createRuntimeTurn()
    const service = createService(runtime)
    service.openHubSession("shutdown-session")
    const request = agentDecision({ type: "hub", sessionId: "shutdown-session" }, "shutdown-hub")
    const waiting = service.request(request)
    await waitForRecord(runtime, request.id, "active")
    await service.shutdown()
    await waiting
    commit.mockClear()

    await service.closeHubSession("shutdown-session")

    expect(commit).not.toHaveBeenCalled()
  })

  it("promotes FIFO by request admission order even when requests were created in reverse timestamp order", async () => {
    vi.useFakeTimers()
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    vi.setSystemTime(100)
    const thirdCreated = agentDecision(owner, "third-created")
    vi.setSystemTime(200)
    const secondCreated = agentDecision(owner, "second-created")
    vi.setSystemTime(300)
    const firstAdmitted = agentDecision(owner, "first-admitted")

    const firstWaiting = service.request(firstAdmitted)
    const secondWaiting = service.request(secondCreated)
    const thirdWaiting = service.request(thirdCreated)
    await waitForRecord(runtime, thirdCreated.id, "queued")
    await resolveOne(service, firstAdmitted)
    await firstWaiting
    expect(runtime.listDurableDecisions().find(record => record.request.id === secondCreated.id)?.state).toBe("active")
    expect(runtime.listDurableDecisions().find(record => record.request.id === thirdCreated.id)?.state).toBe("queued")
    await resolveOne(service, secondCreated)
    await secondWaiting
    expect(runtime.listDurableDecisions().find(record => record.request.id === thirdCreated.id)?.state).toBe("active")
    await resolveOne(service, thirdCreated)
    await thirdWaiting
  })

  it("redacts ordinary request audit events while retaining the full durable request", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const request = toolDecision(turnOwner(thread.id, turn.id), "request-audit")
    const waiting = service.request(request)
    await waitForRecord(runtime, request.id, "active")

    const audit = runtime.eventsSince(thread.id).find(event => (
      event.kind === "decision:requested" && event.payload?.requestId === request.id
    ))
    expect(audit?.payload).toEqual({
      requestId: request.id,
      source: "tool",
      kind: "single-select",
      owner: { type: "turn", threadId: thread.id, turnId: turn.id },
      state: "active"
    })
    expect(JSON.stringify(audit)).not.toContain("secret-target")
    expect(JSON.stringify(audit)).not.toContain("secret-preview")
    expect(JSON.stringify(audit)).not.toContain(request.title)
    expect(JSON.stringify(audit)).not.toContain("Allow once")
    expect(runtime.listDurableDecisions().find(record => record.request.id === request.id)?.request)
      .toEqual(request)
    await service.cancelTurn(turn.id)
    await waiting
  })

  it("keeps selected IDs and custom text only in durable resolutions, never audit history", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const selected = createAgentDecisionRequest({
      owner,
      title: "secret selection",
      kind: "single-select",
      options: [{ id: "SECRET_OPTION_ID", label: "SECRET_OPTION_LABEL" }],
      idempotencyKey: "secret-selection"
    })
    const selectedWaiting = service.request(selected)
    await waitForRecord(runtime, selected.id, "active")
    await service.resolve({
      requestId: selected.id,
      outcome: "selected",
      selectedOptionIds: ["SECRET_OPTION_ID"]
    }, { webContentsId: 7, workspaceId: "workspace-a" })
    await selectedWaiting

    const text = createAgentDecisionRequest({
      owner,
      title: "secret text",
      kind: "text",
      options: [],
      customInput: { maxChars: 100 },
      idempotencyKey: "secret-text"
    })
    const textWaiting = service.request(text)
    await waitForRecord(runtime, text.id, "active")
    await service.resolve({
      requestId: text.id,
      outcome: "submitted",
      customText: "SECRET_CUSTOM"
    }, { webContentsId: 7, workspaceId: "workspace-a" })
    await textWaiting

    const history = JSON.stringify(runtime.eventsSince(thread.id).filter(event => (
      event.kind === "decision:requested" || event.kind === "decision:resolved"
    )))
    expect(history).not.toContain("SECRET_OPTION_ID")
    expect(history).not.toContain("SECRET_OPTION_LABEL")
    expect(history).not.toContain("SECRET_CUSTOM")
    expect(runtime.listDurableDecisions().find(record => record.request.id === selected.id)?.resolution)
      .toMatchObject({ selectedOptionIds: ["SECRET_OPTION_ID"] })
    expect(runtime.listDurableDecisions().find(record => record.request.id === text.id)?.resolution)
      .toMatchObject({ text: "SECRET_CUSTOM" })
  })

  it("rejects wrong senders, invalid selections, late and duplicate submissions", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const request = agentDecision(turnOwner(thread.id, turn.id), "validate")
    const waiting = service.request(request)
    await waitForRecord(runtime, request.id, "active")

    await expect(service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { webContentsId: 99, workspaceId: "workspace-a" })).resolves.toEqual({ accepted: false })
    await expect(service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["one"]
    }, { webContentsId: 7, workspaceId: "workspace-b" })).resolves.toEqual({ accepted: false })
    await expect(service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["unknown"]
    }, { webContentsId: 7, workspaceId: "workspace-a" })).resolves.toEqual({ accepted: false })

    await expect(resolveOne(service, request)).resolves.toEqual({ accepted: true })
    await expect(waiting).resolves.toMatchObject({ selectedOptionIds: ["one"] })
    await expect(resolveOne(service, request)).resolves.toEqual({ accepted: false })
  })

  it("enforces unique authoritative selections, exact cardinality, bounded text, and no custom permission input", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const multi = createAgentDecisionRequest({
      owner,
      title: "multi",
      kind: "multi-select",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      minSelections: 2,
      maxSelections: 2,
      idempotencyKey: "multi"
    })
    const multiWaiting = service.request(multi)
    await waitForRecord(runtime, multi.id, "active")
    for (const selectedOptionIds of [["a"], ["a", "a"], ["a", "missing"]]) {
      await expect(service.resolve({
        requestId: multi.id,
        outcome: "selected",
        selectedOptionIds
      }, { webContentsId: 7, workspaceId: "workspace-a" })).resolves.toEqual({ accepted: false })
    }
    await expect(service.resolve({
      requestId: multi.id,
      outcome: "selected",
      selectedOptionIds: ["a", "b"]
    }, { webContentsId: 7, workspaceId: "workspace-a" })).resolves.toEqual({ accepted: true })
    await multiWaiting

    const text = createAgentDecisionRequest({
      owner,
      title: "text",
      kind: "text",
      options: [],
      customInput: { maxChars: 3 },
      idempotencyKey: "text"
    })
    const textWaiting = service.request(text)
    await waitForRecord(runtime, text.id, "active")
    await expect(service.resolve({ requestId: text.id, outcome: "submitted", customText: "four" }, {
      webContentsId: 7,
      workspaceId: "workspace-a"
    })).resolves.toEqual({ accepted: false })
    await expect(service.resolve({ requestId: text.id, outcome: "submitted", customText: "ok" }, {
      webContentsId: 7,
      workspaceId: "workspace-a"
    })).resolves.toEqual({ accepted: true })
    await expect(textWaiting).resolves.toMatchObject({ text: "ok" })

    const permission = toolDecision(owner, "permission")
    const permissionWaiting = service.request(permission)
    await waitForRecord(runtime, permission.id, "active")
    await expect(service.resolve({ requestId: permission.id, outcome: "submitted", customText: "allow" }, {
      webContentsId: 7,
      workspaceId: "workspace-a"
    })).resolves.toEqual({ accepted: false })
    await service.cancelTurn(turn.id)
    await permissionWaiting
  })

  it("enforces unresolved and created limits per Turn plus the Agent-created limit", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)

    const unresolved = Array.from({ length: 8 }, (_, index) => promptDecision(owner, `unresolved-${index}`))
    const waiters = unresolved.map(request => service.request(request))
    await waitForRecord(runtime, unresolved.at(-1)!.id, "queued")
    await expect(service.request(promptDecision(owner, "unresolved-overflow"))).rejects.toThrow("unresolved")
    await service.cancelTurn(turn.id)
    await Promise.all(waiters)
    await expect(service.request(promptDecision(owner, "terminal-turn"))).rejects.toThrow("terminal")

    const createdLimitTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "created limit",
      mode: "auto"
    })
    const createdLimitOwner = turnOwner(thread.id, createdLimitTurn.turn.id)
    const terminalPrompts = Array.from({ length: 32 }, (_, index) => (
      promptDecision(createdLimitOwner, `created-${index}`)
    ))
    await runtime.commitRuntimeMutation(tx => {
      for (const request of terminalPrompts) tx.upsertDecision(terminalRecord(request))
    })
    await expect(service.request(promptDecision(createdLimitOwner, "created-overflow"))).rejects.toThrow("created")

    const agentTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "agent limit",
      mode: "auto"
    })
    const agentOwner = turnOwner(thread.id, agentTurn.turn.id)
    await runtime.commitRuntimeMutation(tx => {
      for (let index = 0; index < 4; index += 1) {
        tx.upsertDecision(terminalRecord(agentDecision(agentOwner, `agent-${index}`)))
      }
    })
    await expect(service.request(agentDecision(agentOwner, "agent-overflow"))).rejects.toThrow("Agent-created")
  })

  it("enforces the process-wide unresolved limit including durable records", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const durable = Array.from({ length: 64 }, (_, index) => promptDecision({
      type: "hub",
      sessionId: `session-${index}`
    }, `hub-${index}`))
    await runtime.commitRuntimeMutation(tx => {
      for (const request of durable) tx.upsertDecision({ request, state: "active" })
    })

    await expect(service.request(promptDecision(turnOwner(thread.id, turn.id), "process-overflow")))
      .rejects.toThrow("process")
  })

  it("deduplicates concurrent and settled requests by owner and idempotency key until the Turn is terminal", async () => {
    const firstCreated = await createRuntimeTurn()
    const second = await firstCreated.runtime.createTurn({
      threadId: firstCreated.thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "other owner",
      mode: "auto"
    })
    const service = createService(firstCreated.runtime)
    const first = agentDecision(turnOwner(firstCreated.thread.id, firstCreated.turn.id), "same-key", "first")
    const duplicate = agentDecision(turnOwner(firstCreated.thread.id, firstCreated.turn.id), "same-key", "duplicate")
    const otherOwner = agentDecision(turnOwner(firstCreated.thread.id, second.turn.id), "same-key", "other")

    const firstPromise = service.request(first)
    expect(service.request(duplicate)).toBe(firstPromise)
    const otherPromise = service.request(otherOwner)
    expect(otherPromise).not.toBe(firstPromise)
    await waitForRecord(firstCreated.runtime, first.id, "active")
    await waitForRecord(firstCreated.runtime, otherOwner.id, "active")
    await resolveOne(service, first)
    await resolveOne(service, otherOwner)
    await expect(firstPromise).resolves.toMatchObject({ requestId: first.id })
    expect(service.request(duplicate)).toBe(firstPromise)
    await otherPromise

    await firstCreated.runtime.setTurnStatus(firstCreated.turn.id, "completed")
    const afterTerminal = agentDecision(turnOwner(firstCreated.thread.id, firstCreated.turn.id), "same-key", "new")
    const afterTerminalPromise = service.request(afterTerminal)
    expect(afterTerminalPromise).not.toBe(firstPromise)
    await expect(afterTerminalPromise).rejects.toThrow("terminal")
  })

  it("rolls back a rejected head commit and promotes a concurrent follower without leaking idempotency state", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    commit.mockRejectedValueOnce(new Error("persistence failed"))
    const failed = agentDecision(owner, "retryable")
    const follower = agentDecision(owner, "follower")

    const failedWaiting = service.request(failed)
    const followerWaiting = service.request(follower)
    await expect(failedWaiting).rejects.toThrow("persistence failed")
    await waitForRecord(runtime, follower.id, "active")
    expect(runtime.listDurableDecisions().some(record => record.request.id === failed.id)).toBe(false)
    expect(runtime.getTurn(turn.id)?.status).toBe("awaiting-decision")
    expect(runtime.eventsSince(thread.id).some(event => event.payload?.requestId === failed.id)).toBe(false)

    await resolveOne(service, follower)
    await followerWaiting

    const retry = agentDecision(owner, "retryable")
    const retryWaiting = service.request(retry)
    await waitForRecord(runtime, retry.id, "active")
    await resolveOne(service, retry)
    await expect(retryWaiting).resolves.toMatchObject({ requestId: retry.id })
  })

  it("rolls back a rejected terminal commit while a concurrent request joins the owner queue", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const first = agentDecision(owner, "resolve-first")
    const firstWaiting = service.request(first)
    await waitForRecord(runtime, first.id, "active")
    let rejectCommit!: (error: Error) => void
    commit.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCommit = reject }))

    const resolving = resolveOne(service, first)
    const follower = agentDecision(owner, "resolve-follower")
    const followerWaiting = service.request(follower)
    await vi.waitFor(() => expect(rejectCommit).toBeTypeOf("function"))
    expect(runtime.listDurableDecisions().find(record => record.request.id === first.id)?.state).toBe("active")
    expect(runtime.listDurableDecisions().some(record => record.request.id === follower.id)).toBe(false)
    rejectCommit(new Error("terminal persistence failed"))

    await expect(resolving).rejects.toThrow("terminal persistence failed")
    expect(runtime.listDurableDecisions().find(record => record.request.id === first.id)?.state).toBe("active")
    await waitForRecord(runtime, follower.id, "queued")
    expect(runtime.getTurn(turn.id)?.status).toBe("awaiting-decision")
    let firstSettled = false
    void firstWaiting.then(() => { firstSettled = true })
    await Promise.resolve()
    expect(firstSettled).toBe(false)

    await resolveOne(service, first)
    await expect(firstWaiting).resolves.toMatchObject({ status: "selected" })
    await waitForRecord(runtime, follower.id, "active")
    await resolveOne(service, follower)
    await followerWaiting
  })

  it("counts concurrent provisional reservations at every exact limit boundary", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const existing = Array.from({ length: 31 }, (_, index) => promptDecision(owner, `existing-${index}`))
    await runtime.commitRuntimeMutation(tx => {
      for (const request of existing) tx.upsertDecision(terminalRecord(request))
    })
    let release!: () => void
    commit.mockClear()
    commit.mockImplementationOnce((_key, value) => new Promise(resolve => {
      release = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))
    const boundary = promptDecision(owner, "created-boundary")
    const boundaryWaiting = service.request(boundary)
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    await expect(service.request(promptDecision(owner, "created-33"))).rejects.toThrow("created")
    release()
    await waitForRecord(runtime, boundary.id, "active")
    await resolveOne(service, boundary)
    await boundaryWaiting

    const agentTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "agent provisional limit",
      mode: "auto"
    })
    const agentOwner = turnOwner(thread.id, agentTurn.turn.id)
    const agentWaiters = Array.from({ length: 4 }, (_, index) => service.request(
      agentDecision(agentOwner, `concurrent-agent-${index}`)
    ))
    await expect(service.request(agentDecision(agentOwner, "concurrent-agent-5")))
      .rejects.toThrow("Agent-created")
    await service.cancelTurn(agentTurn.turn.id)
    await Promise.all(agentWaiters)

    const processTurns = await Promise.all(Array.from({ length: 8 }, (_, index) => runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: `process-${index}`,
      mode: "auto"
    })))
    const processWaiters = processTurns.flatMap(({ turn: processTurn }, turnIndex) => (
      Array.from({ length: 8 }, (_, requestIndex) => service.request(promptDecision(
        turnOwner(thread.id, processTurn.id),
        `process-${turnIndex}-${requestIndex}`
      )))
    ))
    const overflowTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "process overflow",
      mode: "auto"
    })
    await expect(service.request(promptDecision(turnOwner(thread.id, overflowTurn.turn.id), "process-65")))
      .rejects.toThrow("process")
    await Promise.all(processTurns.map(({ turn: processTurn }) => service.cancelTurn(processTurn.id)))
    await Promise.all(processWaiters)
  })

  it("uses the same terminal path for AbortSignal, Turn cancellation, and shutdown", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const preAbortedController = new AbortController()
    preAbortedController.abort()
    const preAborted = agentDecision(owner, "pre-aborted")
    const preAbortedWaiting = service.request(preAborted, { signal: preAbortedController.signal })
    await expect(preAbortedWaiting).resolves.toMatchObject({ status: "cancelled" })
    await waitForRecord(runtime, preAborted.id, "terminal")

    const controller = new AbortController()
    const aborted = agentDecision(owner, "aborted")
    const abortedWaiting = service.request(aborted, { signal: controller.signal })
    await waitForRecord(runtime, aborted.id, "active")
    controller.abort()
    await expect(abortedWaiting).resolves.toMatchObject({ status: "cancelled" })
    await waitForRecord(runtime, aborted.id, "terminal")
    expect(runtime.getTurn(turn.id)?.status).toBe("running")

    const cancelled = agentDecision(owner, "cancelled")
    const cancelledWaiting = service.request(cancelled)
    await waitForRecord(runtime, cancelled.id, "active")
    await service.cancelTurn(turn.id)
    await expect(cancelledWaiting).resolves.toMatchObject({ status: "cancelled" })
    expect(runtime.getTurn(turn.id)?.status).toBe("cancelled")

    const shutdownTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "shutdown",
      mode: "auto"
    })
    const shutdownRequest = agentDecision(turnOwner(thread.id, shutdownTurn.turn.id), "shutdown")
    const shutdownWaiting = service.request(shutdownRequest)
    await waitForRecord(runtime, shutdownRequest.id, "active")
    await service.shutdown()
    await expect(shutdownWaiting).resolves.toMatchObject({ status: "stale" })
    await waitForRecord(runtime, shutdownRequest.id, "terminal")
  })

  it("cancels only the selected agent's pending tool decision and promotes another agent", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const codex = toolDecision(owner, "codex-pending", undefined, false, "codex")
    const claude = toolDecision(owner, "claude-pending", undefined, false, "claude")
    const codexWaiting = service.request(codex)
    const claudeWaiting = service.request(claude)
    await waitForRecord(runtime, codex.id, "active")
    await waitForRecord(runtime, claude.id, "queued")

    await service.cancelAgentDecisions(turn.id, "codex")

    await expect(codexWaiting).resolves.toMatchObject({ status: "cancelled" })
    await waitForRecord(runtime, claude.id, "active")
    expect(service.listPending({ threadId: thread.id }).map(item => item.request.id)).toEqual([claude.id])
    expect(runtime.getTurn(turn.id)?.status).toBe("awaiting-decision")
    await resolveOne(service, claude)
    await expect(claudeWaiting).resolves.toMatchObject({ status: "selected" })
    expect(runtime.getTurn(turn.id)?.status).toBe("running")
  })

  it('cancels only the selected agent ACP decision using trusted ACP agent metadata', async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const codex = acpDecision(owner, 'acp:codex:step-1', 'codex')
    const claude = acpDecision(owner, 'acp:claude:step-1', 'claude')
    const codexWaiting = service.request(codex)
    const claudeWaiting = service.request(claude)
    await waitForRecord(runtime, codex.id, 'active')
    await waitForRecord(runtime, claude.id, 'queued')

    await service.cancelAgentDecisions(turn.id, 'codex')

    await expect(codexWaiting).resolves.toMatchObject({ status: 'cancelled' })
    await waitForRecord(runtime, claude.id, 'active')
    await resolveOne(service, claude)
    await expect(claudeWaiting).resolves.toMatchObject({ status: 'selected' })
  })

  it('admits only the first durable ACP request for a duplicate idempotency key', async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const owner = turnOwner(thread.id, turn.id)
    const first = acpDecision(owner, 'acp:duplicate', 'codex')
    const duplicate = acpDecision(owner, 'acp:duplicate', 'codex')
    const admitted = vi.fn()
    const duplicateAdmitted = vi.fn()

    const firstWaiting = service.request(first, { onAdmitted: admitted } as any)
    const duplicateWaiting = service.request(duplicate, { onAdmitted: duplicateAdmitted } as any)
    await waitForRecord(runtime, first.id, 'active')

    expect(admitted).toHaveBeenCalledWith(expect.objectContaining({ id: first.id }))
    expect(duplicateAdmitted).not.toHaveBeenCalled()
    expect(runtime.listDurableDecisions().map(record => record.request.id)).toEqual([first.id])
    await resolveOne(service, first)
    await expect(firstWaiting).resolves.toMatchObject({ requestId: first.id, status: 'selected' })
    await expect(duplicateWaiting).resolves.toMatchObject({ requestId: first.id, status: 'selected' })
  })

  it.each(["completed", "failed", "interrupted"] as const)(
    "does not let a late cancel overwrite a %s Turn",
    async terminalStatus => {
      const { runtime, turn } = await createRuntimeTurn()
      const service = createService(runtime)
      await runtime.setTurnStatus(turn.id, terminalStatus)

      await service.cancelTurn(turn.id)

      expect(runtime.getTurn(turn.id)?.status).toBe(terminalStatus)
    }
  )

  it("runs remember once after the terminal commit and reports callback failure as a warning", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const request = toolDecision(turnOwner(thread.id, turn.id), "remember", undefined, true)
    const onRemember = vi.fn(async () => { throw new Error("remember failed") })
    const waiting = service.request(request, { onRemember })
    await waitForRecord(runtime, request.id, "active")

    const result = await service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["allow-once"],
      remember: true
    }, { webContentsId: 7, workspaceId: "workspace-a" })

    expect(result).toEqual({ accepted: true, warning: "remember_failed" })
    expect(onRemember).toHaveBeenCalledTimes(1)
    expect(runtime.listDurableDecisions().find(record => record.request.id === request.id)?.state).toBe("terminal")
    await expect(waiting).resolves.toMatchObject({ status: "selected" })
    await expect(service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["allow-once"],
      remember: true
    }, { webContentsId: 7, workspaceId: "workspace-a" })).resolves.toEqual({ accepted: false })
    expect(onRemember).toHaveBeenCalledTimes(1)
  })

  it("keeps the actor moving while a post-commit remember effect is pending", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    let rejectRemember!: (error: Error) => void
    const rememberGate = new Promise<void>((_resolve, reject) => { rejectRemember = reject })
    const onRemember = vi.fn(() => rememberGate)
    const remembered = toolDecision(turnOwner(thread.id, turn.id), "remember-gate", undefined, true)
    const rememberedWaiting = service.request(remembered, { onRemember })
    await waitForRecord(runtime, remembered.id, "active")

    service.openHubSession("remember-hub")
    const hubRequest = agentDecision({ type: "hub", sessionId: "remember-hub" }, "remember-hub-request")
    const hubWaiting = service.request(hubRequest)
    await waitForRecord(runtime, hubRequest.id, "active")

    const timeoutTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "timeout while remember pending",
      mode: "auto"
    })
    const timed = toolDecision(turnOwner(thread.id, timeoutTurn.turn.id), "remember-timeout", 250)
    const timedWaiting = service.request(timed)
    await waitForRecord(runtime, timed.id, "active")

    const cancelTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "cancel while remember pending",
      mode: "auto"
    })
    const cancelled = agentDecision(turnOwner(thread.id, cancelTurn.turn.id), "remember-cancel")
    const cancelledWaiting = service.request(cancelled)
    await waitForRecord(runtime, cancelled.id, "active")

    let rememberResolveSettled = false
    const resolvingRemember = service.resolve({
      requestId: remembered.id,
      outcome: "selected",
      selectedOptionIds: ["allow-once"],
      remember: true
    }, { webContentsId: 7, workspaceId: "workspace-a" }).then(result => {
      rememberResolveSettled = true
      return result
    })
    await waitForRecord(runtime, remembered.id, "terminal")
    await vi.waitFor(() => expect(onRemember).toHaveBeenCalledOnce())

    const otherTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "other owner while remember pending",
      mode: "auto"
    })
    const other = agentDecision(turnOwner(thread.id, otherTurn.turn.id), "remember-other-owner")
    const otherWaiting = service.request(other)
    const closingHub = service.closeHubSession("remember-hub")
    const cancellingTurn = service.cancelTurn(cancelTurn.turn.id)

    let assertionError: unknown
    try {
      await waitForRecord(runtime, other.id, "active")
      const resolvingOther = resolveOne(service, other)
      await Promise.all([resolvingOther, closingHub, cancellingTurn])
      await waitForRecord(runtime, hubRequest.id, "terminal")
      await waitForRecord(runtime, cancelled.id, "terminal")
      await waitForRecord(runtime, timed.id, "terminal")
      await expect(otherWaiting).resolves.toMatchObject({ status: "selected" })
      await expect(hubWaiting).resolves.toMatchObject({ status: "cancelled" })
      await expect(cancelledWaiting).resolves.toMatchObject({ status: "cancelled" })
      await expect(timedWaiting).resolves.toMatchObject({ status: "timeout" })
      expect(rememberResolveSettled).toBe(false)
      expect(onRemember).toHaveBeenCalledTimes(1)
    } catch (error) {
      assertionError = error
    } finally {
      rejectRemember(new Error("remember deferred failure"))
    }

    const rememberResult = await resolvingRemember
    await rememberedWaiting
    expect(rememberResult).toEqual({ accepted: true, warning: "remember_failed" })
    expect(onRemember).toHaveBeenCalledTimes(1)
    if (assertionError) throw assertionError
  })

  it("waits for registered post-commit remember effects during bounded shutdown", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    let rejectRemember!: (error: Error) => void
    const rememberGate = new Promise<void>((_resolve, reject) => { rejectRemember = reject })
    const onRemember = vi.fn(() => rememberGate)
    const remembered = toolDecision(turnOwner(thread.id, turn.id), "shutdown-remember", undefined, true)
    const rememberedWaiting = service.request(remembered, { onRemember })
    await waitForRecord(runtime, remembered.id, "active")

    const otherTurn = await runtime.createTurn({
      threadId: thread.id,
      workspaceId: "workspace-a",
      ownerWebContentsId: 7,
      prompt: "shutdown terminal actor",
      mode: "auto"
    })
    const other = agentDecision(turnOwner(thread.id, otherTurn.turn.id), "shutdown-other")
    const otherWaiting = service.request(other)
    await waitForRecord(runtime, other.id, "active")

    const resolving = service.resolve({
      requestId: remembered.id,
      outcome: "selected",
      selectedOptionIds: ["allow-once"],
      remember: true
    }, { webContentsId: 7, workspaceId: "workspace-a" })
    await waitForRecord(runtime, remembered.id, "terminal")
    await vi.waitFor(() => expect(onRemember).toHaveBeenCalledOnce())

    let shutdownSettled = false
    const shuttingDown = service.shutdown().then(() => { shutdownSettled = true })
    await expect(service.request(agentDecision(
      turnOwner(thread.id, otherTurn.turn.id),
      "closed-during-shutdown"
    ))).rejects.toThrow("closed")

    let assertionError: unknown
    try {
      await waitForRecord(runtime, other.id, "terminal")
      await expect(otherWaiting).resolves.toMatchObject({ status: "stale" })
      await Promise.resolve()
      expect(shutdownSettled).toBe(false)
    } catch (error) {
      assertionError = error
    } finally {
      rejectRemember(new Error("remember failed during shutdown"))
    }

    await expect(resolving).resolves.toEqual({ accepted: true, warning: "remember_failed" })
    await rememberedWaiting
    await shuttingDown
    expect(shutdownSettled).toBe(true)
    expect(onRemember).toHaveBeenCalledTimes(1)
    if (assertionError) throw assertionError
  })

  it("settles exactly once when resolve, timeout, cancel, abort, and shutdown race", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2035-02-01T00:00:00Z"))
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const controller = new AbortController()
    const request = toolDecision(turnOwner(thread.id, turn.id), "race", 1000, true)
    const onRemember = vi.fn(async () => undefined)
    const waiting = service.request(request, { signal: controller.signal, onRemember })
    const continuation = vi.fn()
    void waiting.then(continuation)
    await waitForRecord(runtime, request.id, "active")
    let releaseTerminal!: () => void
    commit.mockImplementationOnce((_key, value) => new Promise(resolve => {
      releaseTerminal = () => {
        const canonical = jsonCanonical(value)
        memory["runtime.workbench.v1"] = structuredClone(canonical)
        resolve(structuredClone(canonical))
      }
    }))

    const resolving = service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["allow-once"],
      remember: true
    }, { webContentsId: 7, workspaceId: "workspace-a" })
    await vi.waitFor(() => expect(releaseTerminal).toBeTypeOf("function"))
    controller.abort()
    const cancelling = service.cancelTurn(turn.id)
    const shuttingDown = service.shutdown()
    await vi.advanceTimersByTimeAsync(1000)
    releaseTerminal()
    await Promise.allSettled([resolving, cancelling, shuttingDown, waiting])

    expect(continuation).toHaveBeenCalledTimes(1)
    expect(onRemember).toHaveBeenCalledTimes(1)
    expect(runtime.eventsSince(thread.id).filter(event => (
      event.kind === "decision:resolved" && event.payload?.requestId === request.id
    ))).toHaveLength(1)
    expect(runtime.listDurableDecisions().find(record => record.request.id === request.id)?.state).toBe("terminal")
  })

  it("cleans every local shutdown resource even when the terminal batch commit rejects", async () => {
    vi.useFakeTimers()
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const controller = new AbortController()
    const removeAbortListener = vi.spyOn(controller.signal, "removeEventListener")
    const offRuntimeEvent = vi.spyOn(runtime, "off")
    const request = toolDecision(turnOwner(thread.id, turn.id), "shutdown-cleanup", 1000)
    const waiting = service.request(request, { signal: controller.signal })
    await waitForRecord(runtime, request.id, "active")
    void waiting.catch(() => undefined)
    commit.mockClear()
    commit.mockRejectedValueOnce(new Error("abort persistence failed"))

    controller.abort()
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), { interval: 1 })
    commit.mockRejectedValueOnce(new Error("shutdown persistence failed"))

    const shuttingDown = service.shutdown()
    await expect(shuttingDown).rejects.toThrow("shutdown persistence failed")
    expect(service.shutdown()).toBe(shuttingDown)
    expect(offRuntimeEvent).toHaveBeenCalledOnce()
    expect(removeAbortListener).toHaveBeenCalled()
    expect((service as any).entriesById.size).toBe(0)
    expect((service as any).idempotency.size).toBe(0)
    expect((service as any).ownerQueues.size).toBe(0)
    expect((service as any).hubSessionClosures.size).toBe(0)
    expect((service as any).activeHubSessions.size).toBe(0)
    expect((service as any).terminalRetries.size).toBe(0)

    const commitsAfterShutdown = commit.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(commit).toHaveBeenCalledTimes(commitsAfterShutdown)
  })

  it("drains an existing remember effect before preserving a shutdown terminal error", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const rememberEffect = deferred<void>()
    const onRemember = vi.fn(() => rememberEffect.promise)
    const offRuntimeEvent = vi.spyOn(runtime, "off")
    const request = toolDecision(turnOwner(thread.id, turn.id), "shutdown-effect-drain", undefined, true)
    const waiting = service.request(request, { onRemember })
    await waitForRecord(runtime, request.id, "active")

    const resolving = service.resolve({
      requestId: request.id,
      outcome: "selected",
      selectedOptionIds: ["allow-once"],
      remember: true
    }, { webContentsId: 7, workspaceId: "workspace-a" })
    await waitForRecord(runtime, request.id, "terminal")
    await vi.waitFor(() => expect(onRemember).toHaveBeenCalledOnce())
    await expect(waiting).resolves.toMatchObject({ status: "selected" })

    commit.mockClear()
    commit.mockRejectedValueOnce(new Error("shutdown terminal persistence failed"))
    const shuttingDown = service.shutdown()
    let shutdownSettled = false
    void shuttingDown.then(
      () => { shutdownSettled = true },
      () => { shutdownSettled = true }
    )
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce())
    await Promise.resolve()

    expect(shutdownSettled).toBe(false)
    expect(offRuntimeEvent).not.toHaveBeenCalled()
    rememberEffect.reject(new Error("remember effect failed"))

    await expect(resolving).resolves.toEqual({ accepted: true, warning: "remember_failed" })
    await expect(shuttingDown).rejects.toThrow("shutdown terminal persistence failed")
    expect(offRuntimeEvent).toHaveBeenCalledOnce()
    expect((service as any).entriesById.size).toBe(0)
    expect((service as any).idempotency.size).toBe(0)
    expect((service as any).ownerQueues.size).toBe(0)
    expect((service as any).hubSessionClosures.size).toBe(0)
    expect((service as any).pendingEffects.size).toBe(0)
    expect((service as any).terminalRetries.size).toBe(0)
  })

  it("backs off and bounds a continuously failing timeout terminal commit", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2035-03-01T00:00:00Z"))
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const request = toolDecision(turnOwner(thread.id, turn.id), "bounded-timeout", 100)
    const waiting = service.request(request)
    await waitForRecord(runtime, request.id, "active")
    void waiting.catch(() => undefined)
    const record = runtime.listDurableDecisions().find(candidate => candidate.request.id === request.id)!
    commit.mockClear()
    commit.mockRejectedValue(new Error("timeout persistence unavailable"))

    await vi.advanceTimersByTimeAsync(Math.max(0, record.expiresAt! - Date.now()))
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), { interval: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(commit.mock.calls.length).toBeGreaterThan(1)
    expect(commit.mock.calls.length).toBeLessThanOrEqual(4)
    expect(vi.getTimerCount()).toBe(0)
    expect(runtime.listDurableDecisions().find(candidate => candidate.request.id === request.id)?.state).toBe("active")

    commit.mockImplementation(async (key: string, value: any) => {
      const canonical = jsonCanonical(value)
      memory[key] = structuredClone(canonical)
      return structuredClone(canonical)
    })
    await service.shutdown()
    await expect(waiting).resolves.toMatchObject({ status: "stale" })
  })

  it("retries a failed AbortSignal terminal commit and settles the waiter", async () => {
    vi.useFakeTimers()
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const controller = new AbortController()
    const request = agentDecision(turnOwner(thread.id, turn.id), "abort-retry")
    const waiting = service.request(request, { signal: controller.signal })
    await waitForRecord(runtime, request.id, "active")
    commit.mockClear()
    commit.mockRejectedValueOnce(new Error("abort persistence unavailable"))
    commit.mockImplementation(async (key: string, value: any) => {
      const canonical = jsonCanonical(value)
      memory[key] = structuredClone(canonical)
      return structuredClone(canonical)
    })

    controller.abort()
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1), { interval: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(commit).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)

    await expect(waiting).resolves.toMatchObject({ status: "cancelled" })
    expect(commit).toHaveBeenCalledTimes(2)
    expect(runtime.listDurableDecisions().find(candidate => candidate.request.id === request.id)?.state).toBe("terminal")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("retries a failed terminal runtime-event commit and settles without overwriting the Turn", async () => {
    vi.useFakeTimers()
    const { runtime, thread, turn } = await createRuntimeTurn()
    const service = createService(runtime)
    const request = agentDecision(turnOwner(thread.id, turn.id), "runtime-event-retry")
    const waiting = service.request(request)
    await waitForRecord(runtime, request.id, "active")
    commit.mockClear()
    let rejectedTerminal = false
    commit.mockImplementation(async (key: string, value: any) => {
      const record = value.decisions.find((candidate: DurableDecisionRecord) => candidate.request.id === request.id)
      if (!rejectedTerminal && record?.state === "terminal") {
        rejectedTerminal = true
        throw new Error("runtime terminal persistence unavailable")
      }
      const canonical = jsonCanonical(value)
      memory[key] = structuredClone(canonical)
      return structuredClone(canonical)
    })

    await runtime.setTurnStatus(turn.id, "completed")
    await vi.waitFor(() => expect(rejectedTerminal).toBe(true), { interval: 1 })
    expect(runtime.listDurableDecisions().find(candidate => candidate.request.id === request.id)?.state).toBe("active")
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.listDurableDecisions().find(candidate => candidate.request.id === request.id)?.state).toBe("active")
    await vi.advanceTimersByTimeAsync(100)

    await expect(waiting).resolves.toMatchObject({ status: "cancelled" })
    expect(runtime.listDurableDecisions().find(candidate => candidate.request.id === request.id)?.state).toBe("terminal")
    expect(runtime.getTurn(turn.id)?.status).toBe("completed")
    expect(runtime.eventsSince(thread.id).filter(event => (
      event.kind === "decision:resolved" && event.payload?.requestId === request.id
    ))).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("sweeps durable orphans to stale, interrupts their Turns, and emits only redacted audit data", async () => {
    const { runtime, thread, turn } = await createRuntimeTurn()
    const baseRequest = toolDecision(turnOwner(thread.id, turn.id), "orphan")
    const request: DecisionRequest = {
      ...baseRequest,
      title: "secret-title",
      description: "secret-description",
      options: [{ id: "secret-option", label: "secret-option-label", preview: "secret-option-preview" }],
      allowCustom: true,
      customInput: { placeholder: "secret-placeholder", maxChars: 100 },
      metadata: {
        ...baseRequest.metadata,
        target: "secret-target",
        preview: "secret-preview",
        action: "secret-command"
      }
    }
    await runtime.commitRuntimeMutation(tx => {
      tx.upsertDecision({ request, state: "active", activatedAt: Date.now() })
      tx.setTurnStatus(turn.id, "awaiting-decision")
    })
    const service = createService(runtime)

    const swept = await service.sweepOrphans()

    expect(swept).toEqual([{
      kind: "rerun-turn",
      requestId: request.id,
      threadId: thread.id,
      originalTurnId: turn.id,
      source: "tool"
    }])
    expect(Object.keys(swept[0]).sort()).toEqual([
      "kind",
      "originalTurnId",
      "requestId",
      "source",
      "threadId"
    ])
    expect(runtime.getTurn(turn.id)?.status).toBe("interrupted")
    expect(runtime.listDurableDecisions().find(record => record.request.id === request.id)).toMatchObject({
      state: "terminal",
      resolution: { status: "stale" }
    })
    const audit = runtime.eventsSince(thread.id).filter(event => event.kind === "decision:resolved").at(-1)
    expect(audit?.payload).toEqual({
      requestId: request.id,
      status: "stale",
      source: "tool",
      recovery: { kind: "rerun-turn", originalTurnId: turn.id }
    })
    expect(JSON.stringify(audit)).not.toContain("secret-target")
    expect(JSON.stringify(audit)).not.toContain("secret-preview")
    expect(JSON.stringify(audit)).not.toContain("secret-title")
    expect(JSON.stringify(audit)).not.toContain("secret-description")
    expect(JSON.stringify(audit)).not.toContain("secret-option")
    expect(JSON.stringify(audit)).not.toContain("secret-placeholder")
    expect(JSON.stringify(audit)).not.toContain("secret-command")
    expect(JSON.stringify(audit)).not.toContain("selectedOptionIds")
    expect(JSON.stringify(audit)).not.toContain("resolver")

    expect(await service.sweepOrphans()).toEqual([])
    expect(runtime.eventsSince(thread.id).filter(event => (
      event.kind === "decision:resolved" && event.payload?.requestId === request.id
    ))).toHaveLength(1)
  })

  it("wires startup sweep before Turn admission and bounds decision shutdown before adapters and final flush", () => {
    const source = readFileSync("src/main/index.ts", "utf8")
    const ready = source.indexOf("app.whenReady().then")
    const sweep = source.indexOf("await decisionService.sweepOrphans()", ready)
    const initHub = source.indexOf("await initHub()", ready)
    const registerIpc = source.indexOf("registerAllIpcHandlers", ready)
    const createFirstWindow = source.indexOf("createWindow()", ready)
    expect(sweep).toBeGreaterThan(ready)
    expect(sweep).toBeLessThan(initHub)
    expect(sweep).toBeLessThan(registerIpc)
    expect(sweep).toBeLessThan(createFirstWindow)
    const disconnectedHandler = source.indexOf('hub.on("client:disconnected"')
    const closeHubSession = source.indexOf("decisionService.closeHubSession(sessionId)", disconnectedHandler)
    const connectedHandler = source.indexOf('hub.on("client:connected"')
    const openHubSession = source.indexOf("decisionService.openHubSession", connectedHandler)
    expect(connectedHandler).toBeGreaterThan(0)
    expect(openHubSession).toBeGreaterThan(connectedHandler)
    expect(disconnectedHandler).toBeGreaterThan(0)
    expect(closeHubSession).toBeGreaterThan(disconnectedHandler)

    const willQuit = source.indexOf('app.on("will-quit"')
    const serviceShutdown = source.indexOf("decisionService.shutdown()", willQuit)
    const producerClose = source.indexOf("runtimeProducers.close()", willQuit)
    const boundedShutdown = source.indexOf("runShutdownStepWithDeadline", producerClose)
    const hubStop = source.indexOf("hub?.stop()", willQuit)
    const adapterDrain = source.indexOf("drainRuntimeProducersForShutdown", serviceShutdown)
    const finalFlush = source.indexOf("finalizeRuntimePersistenceForShutdown", serviceShutdown)
    expect(serviceShutdown).toBeGreaterThan(willQuit)
    expect(serviceShutdown).toBeLessThan(producerClose)
    expect(producerClose).toBeLessThan(boundedShutdown)
    expect(serviceShutdown).toBeLessThan(hubStop)
    expect(serviceShutdown).toBeLessThan(adapterDrain)
    expect(serviceShutdown).toBeLessThan(finalFlush)
  })
})
