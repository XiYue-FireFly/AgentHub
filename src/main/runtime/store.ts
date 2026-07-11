import { EventEmitter } from "node:events"
import { AsyncLocalStorage } from "node:async_hooks"
import { createLogger } from "../logger"
import { store } from "../store"
import { applyPluginActivityParsers } from "./plugin-contributions"
import { toDispatcherMode } from "./schedules"
import { deriveThreadTitleFromPrompt, maybeAutoTitle } from "./thread-auto-title"
import { isTerminalTurnStatus } from "./turn-status"
import type {
  AgentRunNode,
  ContextProjection,
  DispatchPreset,
  DurableDecisionRecord,
  ModelSelection,
  PersistedRuntime,
  QueuedThreadSubmission,
  RuntimeEvent,
  SchedulePreview,
  WorkbenchAttachment,
  WorkbenchSnapshot,
  WorkbenchThread,
  WorkbenchTurn,
  WorkbenchTurnStatus
} from "./types"

const STORAGE_KEY = "runtime.workbench.v1"
const MAX_RUNTIME_EVENTS = 5000
const log = createLogger("WorkbenchRuntimeStore")
const runtimeMutationWriterContext = new AsyncLocalStorage<symbol>()

const PROTECTED_EVENT_KINDS = new Set<RuntimeEvent["kind"]>([
  "agent:done",
  "agent:error",
  "turn:created",
  "turn:status",
  "run:created",
  "run:status",
  "route:decision",
  "guard:verdict",
  "memory:candidate"
])

type TurnCreateInput = {
  threadId?: string | null
  workspaceId?: string | null
  prompt: string
  mode: DispatchPreset
  targetAgent?: string | null
  modelSelection?: ModelSelection
  thinking?: any
  attachments?: WorkbenchAttachment[]
  contextProjection?: ContextProjection
  customSchedule?: SchedulePreview
  ownerWebContentsId?: number
}

type RunCreateInput = Omit<AgentRunNode, "id" | "startedAt" | "status"> & {
  status?: WorkbenchTurnStatus
}

type RuntimeDisposeOptions = {
  interruptReason?: string
}

export interface RuntimeMutation {
  getTurn(turnId: string): WorkbenchTurn | undefined
  listTurns(): WorkbenchTurn[]
  listRuns(turnId: string): AgentRunNode[]
  listDecisions(): DurableDecisionRecord[]
  setTurnStatus(turnId: string, status: WorkbenchTurnStatus, payload?: Record<string, unknown>): void
  setRunStatus(
    turnId: string,
    agentId: string,
    status: WorkbenchTurnStatus,
    payload?: Record<string, unknown>
  ): void
  setRunStatusById(
    runId: string,
    status: WorkbenchTurnStatus,
    payload?: Record<string, unknown>
  ): void
  appendEvent(
    threadId: string,
    turnId: string,
    kind: RuntimeEvent["kind"],
    agentId: string | undefined,
    payload: Record<string, unknown>
  ): RuntimeEvent
  upsertDecision(record: DurableDecisionRecord): void
  upsertSubmission(record: QueuedThreadSubmission): void
  removeSubmission(submissionId: string): void
}

function emptyState(): PersistedRuntime {
  return {
    version: 1,
    threads: [],
    turns: [],
    runs: [],
    events: [],
    hiddenTaskTurnIds: [],
    decisions: [],
    queuedSubmissions: [],
    activeThreadId: null,
    nextSeqByThread: {}
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function requireThreadInState(state: PersistedRuntime, threadId: string): WorkbenchThread {
  const thread = state.threads.find(candidate => candidate.id === threadId)
  if (!thread) throw new Error(`Thread not found: ${threadId}`)
  return thread
}

function requireTurnInState(state: PersistedRuntime, turnId: string): WorkbenchTurn {
  const turn = state.turns.find(candidate => candidate.id === turnId)
  if (!turn) throw new Error(`Turn not found: ${turnId}`)
  return turn
}

function createThreadInState(
  state: PersistedRuntime,
  input: { workspaceId?: string | null; title?: string }
): WorkbenchThread {
  const now = Date.now()
  const thread: WorkbenchThread = {
    id: id("thread"),
    workspaceId: input.workspaceId ?? null,
    title: input.title?.trim() || "New session",
    createdAt: now,
    updatedAt: now
  }
  state.threads.unshift(thread)
  state.activeThreadId = thread.id
  return thread
}

function appendEventInState(
  state: PersistedRuntime,
  threadId: string,
  turnId: string,
  kind: RuntimeEvent["kind"],
  agentId: string | undefined,
  payload: any
): RuntimeEvent {
  const seq = state.nextSeqByThread[threadId] ?? 1
  state.nextSeqByThread[threadId] = seq + 1
  const isolatedPayload = cloneValue(payload)
  const rawEvent: RuntimeEvent = {
    id: id("event"),
    threadId,
    turnId,
    seq,
    kind,
    agentId,
    payload: isolatedPayload,
    createdAt: Date.now()
  }
  const event = applyPluginActivityParsers(rawEvent, {
    workspaceRoot: typeof isolatedPayload?.workspaceRoot === "string"
      ? isolatedPayload.workspaceRoot
      : null
  })
  state.events.push(event)
  return event
}

function setTurnStatusInState(
  state: PersistedRuntime,
  stagedEvents: RuntimeEvent[],
  turnId: string,
  status: WorkbenchTurnStatus,
  payload: Record<string, unknown> = {}
): void {
  const turn = requireTurnInState(state, turnId)
  const now = Date.now()
  turn.status = status
  if (isTerminalTurnStatus(status)) turn.completedAt = now
  else delete turn.completedAt
  const thread = requireThreadInState(state, turn.threadId)
  thread.lastTurnStatus = status
  thread.updatedAt = now
  stagedEvents.push(appendEventInState(
    state,
    turn.threadId,
    turn.id,
    "turn:status",
    undefined,
    { ...cloneValue(payload), status }
  ))
}

function createRunInState(
  state: PersistedRuntime,
  stagedEvents: RuntimeEvent[],
  input: RunCreateInput
): AgentRunNode {
  const run: AgentRunNode = {
    ...cloneValue(input),
    id: id("run"),
    status: input.status || "running",
    startedAt: Date.now()
  }
  state.runs.push(run)
  const turn = requireTurnInState(state, run.turnId)
  stagedEvents.push(appendEventInState(state, turn.threadId, turn.id, "run:created", run.agentId, run))
  return run
}

function findRunInState(
  state: PersistedRuntime,
  turnId: string,
  agentId: string,
  payload: Record<string, unknown> = {}
): AgentRunNode | undefined {
  const candidates = [...state.runs].reverse().filter(candidate => (
    candidate.turnId === turnId && candidate.agentId === agentId
  ))
  const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined
  const scheduleStepId = typeof payload.scheduleStepId === "string"
    ? payload.scheduleStepId
    : undefined
  const role = typeof (payload.scheduleRole || payload.role) === "string"
    ? payload.scheduleRole || payload.role
    : undefined
  const unique = (pool: AgentRunNode[]): AgentRunNode | undefined => (
    pool.length === 1 ? pool[0] : undefined
  )
  const findByStepAndRole = (pool: AgentRunNode[]): AgentRunNode | undefined => {
    if (scheduleStepId) {
      const exactStep = pool.filter(candidate => candidate.scheduleStepId === scheduleStepId)
      if (exactStep.length > 0) {
        return unique(role ? exactStep.filter(candidate => candidate.role === role) : exactStep)
      }

      // A Run without a persisted step is eligible for migration only when
      // exactly one role-compatible candidate remains. Multiple partial Runs
      // are ambiguous and must not absorb a settlement arbitrarily.
      const partialStep = pool.filter(candidate => (
        !candidate.scheduleStepId && (!role || candidate.role === role)
      ))
      return unique(partialStep)
    }

    if (role) return unique(pool.filter(candidate => candidate.role === role))
    return unique(pool)
  }

  if (taskId) {
    const exactTask = candidates.filter(candidate => candidate.taskId === taskId)
    if (exactTask.length > 0) return findByStepAndRole(exactTask)

    // Only identity-less persisted Runs are eligible for the legacy fallback.
    // A different known task must never absorb a late settlement for this task.
    return findByStepAndRole(candidates.filter(candidate => !candidate.taskId))
  }

  return findByStepAndRole(candidates)
}

function findCancelledRunTombstone(
  state: PersistedRuntime,
  turnId: string,
  agentId: string,
  payload: Record<string, unknown> = {}
): AgentRunNode | undefined {
  const cancelled = [...state.runs].reverse().filter(candidate => (
    candidate.turnId === turnId
    && candidate.agentId === agentId
    && candidate.status === "cancelled"
  ))
  const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined
  if (!taskId) return findRunInState(state, turnId, agentId, payload)?.status === "cancelled"
    ? findRunInState(state, turnId, agentId, payload)
    : cancelled.find(candidate => !candidate.taskId)

  return cancelled.find(candidate => candidate.taskId === taskId)
    ?? cancelled.find(candidate => !candidate.taskId)
}

function setRunStatusInState(
  state: PersistedRuntime,
  stagedEvents: RuntimeEvent[],
  turnId: string,
  agentId: string,
  status: WorkbenchTurnStatus,
  payload: any = {}
): void {
  const run = findRunInState(state, turnId, agentId, payload)
  if (run) {
    if (!run.taskId && typeof payload.taskId === "string") run.taskId = payload.taskId
    if (!run.scheduleStepId && typeof payload.scheduleStepId === "string") {
      run.scheduleStepId = payload.scheduleStepId
    }
    run.status = status
    if (isTerminalTurnStatus(status)) run.endedAt = Date.now()
    else delete run.endedAt
  }
  const turn = requireTurnInState(state, turnId)
  stagedEvents.push(appendEventInState(
    state,
    turn.threadId,
    turn.id,
    "run:status",
    agentId,
    { ...cloneValue(payload), status }
  ))
}

function setRunStatusByIdInState(
  state: PersistedRuntime,
  stagedEvents: RuntimeEvent[],
  runId: string,
  status: WorkbenchTurnStatus,
  payload: Record<string, unknown> = {}
): void {
  const run = state.runs.find(candidate => candidate.id === runId)
  if (!run) return
  run.status = status
  if (isTerminalTurnStatus(status)) run.endedAt = Date.now()
  else delete run.endedAt
  const turn = requireTurnInState(state, run.turnId)
  stagedEvents.push(appendEventInState(
    state,
    turn.threadId,
    turn.id,
    "run:status",
    run.agentId,
    { ...cloneValue(payload), runId, status }
  ))
}

function hideTaskTurnInState(state: PersistedRuntime, turnId: string): boolean {
  if (!state.turns.some(turn => turn.id === turnId)) return false
  if (state.hiddenTaskTurnIds.includes(turnId)) return false
  state.hiddenTaskTurnIds.push(turnId)
  return true
}

function decisionRequestId(event: RuntimeEvent): string {
  const direct = event.payload?.requestId
  if (typeof direct === "string") return direct
  const nested = event.payload?.resolution?.requestId
  return typeof nested === "string" ? nested : ""
}

function decisionOwnerIsNonTerminal(
  record: DurableDecisionRecord,
  turnsById: Map<string, WorkbenchTurn>
): boolean {
  if (record.request.owner.type === "hub") return !record.resolution
  const turn = turnsById.get(record.request.owner.turnId)
  if (!turn) return !record.resolution
  return !isTerminalTurnStatus(turn.status)
}

function pruneRuntimeEvents(state: PersistedRuntime): RuntimeEvent[] {
  const events = state.events
  if (events.length <= MAX_RUNTIME_EVENTS) return events

  const turnsById = new Map(state.turns.map(turn => [turn.id, turn]))
  const decisionsById = new Map(state.decisions.map(record => [record.request.id, record]))
  const must: number[] = []
  const high: number[] = []
  const normal: number[] = []
  const low: number[] = []

  events.forEach((event, index) => {
    if (event.kind === "decision:requested" || event.kind === "decision:resolved") {
      const record = decisionsById.get(decisionRequestId(event))
      if (record && decisionOwnerIsNonTerminal(record, turnsById)) {
        must.push(index)
        return
      }
      if (event.kind === "decision:resolved") {
        high.push(index)
        return
      }
    }
    if (PROTECTED_EVENT_KINDS.has(event.kind)) {
      high.push(index)
      return
    }
    if (event.kind === "agent:delta") {
      low.push(index)
      return
    }
    normal.push(index)
  })

  const keep = new Set<number>(must)
  if (must.length > MAX_RUNTIME_EVENTS) {
    log.warn(
      `Runtime event compaction retained ${must.length} MUST events above the ${MAX_RUNTIME_EVENTS} soft cap`
    )
  }

  let remaining = Math.max(0, MAX_RUNTIME_EVENTS - must.length)
  const retainNewest = (indices: number[]): void => {
    if (remaining <= 0) return
    const start = Math.max(0, indices.length - remaining)
    for (let offset = start; offset < indices.length; offset += 1) keep.add(indices[offset])
    remaining -= indices.length - start
  }

  retainNewest(high)
  retainNewest(normal)
  retainNewest(low)
  return events.filter((_event, index) => keep.has(index))
}

function createRuntimeMutation(
  draft: PersistedRuntime,
  stagedEvents: RuntimeEvent[]
): { tx: RuntimeMutation; close: () => void } {
  let open = true
  const assertOpen = (): void => {
    if (!open) throw new Error("RuntimeMutation is closed")
  }

  const tx: RuntimeMutation = {
    getTurn(turnId) {
      assertOpen()
      const turn = draft.turns.find(candidate => candidate.id === turnId)
      return turn ? cloneValue(turn) : undefined
    },
    listTurns() {
      assertOpen()
      return cloneValue(draft.turns)
    },
    listRuns(turnId) {
      assertOpen()
      return cloneValue(draft.runs.filter(run => run.turnId === turnId))
    },
    listDecisions() {
      assertOpen()
      return cloneValue(draft.decisions)
    },
    setTurnStatus(turnId, status, payload = {}) {
      assertOpen()
      setTurnStatusInState(draft, stagedEvents, turnId, status, cloneValue(payload))
    },
    setRunStatus(turnId, agentId, status, payload = {}) {
      assertOpen()
      setRunStatusInState(draft, stagedEvents, turnId, agentId, status, cloneValue(payload))
    },
    setRunStatusById(runId, status, payload = {}) {
      assertOpen()
      setRunStatusByIdInState(draft, stagedEvents, runId, status, cloneValue(payload))
    },
    appendEvent(threadId, turnId, kind, agentId, payload) {
      assertOpen()
      const event = appendEventInState(draft, threadId, turnId, kind, agentId, cloneValue(payload))
      stagedEvents.push(event)
      return cloneValue(event)
    },
    upsertDecision(record) {
      assertOpen()
      const isolated = cloneValue(record)
      const index = draft.decisions.findIndex(candidate => candidate.request.id === isolated.request.id)
      if (index >= 0) draft.decisions[index] = isolated
      else draft.decisions.push(isolated)
    },
    upsertSubmission(record) {
      assertOpen()
      const isolated = cloneValue(record)
      const index = draft.queuedSubmissions.findIndex(candidate => candidate.id === isolated.id)
      if (index >= 0) draft.queuedSubmissions[index] = isolated
      else draft.queuedSubmissions.push(isolated)
    },
    removeSubmission(submissionId) {
      assertOpen()
      draft.queuedSubmissions = draft.queuedSubmissions.filter(candidate => candidate.id !== submissionId)
    }
  }

  return {
    tx,
    close: () => {
      open = false
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && typeof (value as PromiseLike<unknown>).then === "function"
}

function interruptActiveWorkInMutation(
  tx: RuntimeMutation,
  reason: string
): { turnIds: string[]; runIds: string[] } {
  const turnIds: string[] = []
  const runIds: string[] = []
  for (const turn of tx.listTurns()) {
    for (const run of tx.listRuns(turn.id)) {
      if (isTerminalTurnStatus(run.status)) continue
      tx.setRunStatusById(run.id, "interrupted", { reason })
      runIds.push(run.id)
    }
    if (isTerminalTurnStatus(turn.status)) continue
    tx.setTurnStatus(turn.id, "interrupted", { reason })
    turnIds.push(turn.id)
  }
  return { turnIds, runIds }
}

export class WorkbenchRuntimeStore extends EventEmitter {
  private state: PersistedRuntime | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private writerTail: Promise<void> = Promise.resolve()
  private readonly mutationWriterToken = Symbol("runtime-mutation-writer")
  private lifecycle: "open" | "closing" | "closed" = "open"
  private disposePromise: Promise<void> | null = null
  private disposeInterruptReason: string | undefined

  private load(): PersistedRuntime {
    if (this.state) return this.state
    const raw = cloneValue(store.get(STORAGE_KEY))
    if (raw && typeof raw === "object" && Array.isArray((raw as any).threads)) {
      const rawState = raw as Partial<PersistedRuntime>
      const state: PersistedRuntime = {
        ...emptyState(),
        ...rawState,
        version: 1,
        threads: Array.isArray(rawState.threads) ? rawState.threads : [],
        turns: Array.isArray(rawState.turns) ? rawState.turns : [],
        runs: Array.isArray(rawState.runs) ? rawState.runs : [],
        events: Array.isArray(rawState.events) ? rawState.events : [],
        hiddenTaskTurnIds: Array.isArray(rawState.hiddenTaskTurnIds) ? rawState.hiddenTaskTurnIds : [],
        decisions: Array.isArray(rawState.decisions) ? rawState.decisions : [],
        queuedSubmissions: Array.isArray(rawState.queuedSubmissions) ? rawState.queuedSubmissions : [],
        activeThreadId: typeof rawState.activeThreadId === "string" ? rawState.activeThreadId : null,
        nextSeqByThread: rawState.nextSeqByThread
          && typeof rawState.nextSeqByThread === "object"
          && !Array.isArray(rawState.nextSeqByThread)
          ? rawState.nextSeqByThread
          : {}
      }
      for (const [threadId, nextSeq] of Object.entries(state.nextSeqByThread)) {
        state.nextSeqByThread[threadId] = Number.isInteger(nextSeq) && nextSeq > 0 ? nextSeq : 1
      }
      for (const event of state.events) {
        if (!Number.isInteger(event.seq)) continue
        state.nextSeqByThread[event.threadId] = Math.max(
          state.nextSeqByThread[event.threadId] ?? 1,
          event.seq + 1
        )
      }
      this.state = state
    } else {
      this.state = emptyState()
    }
    return this.state
  }

  private assertPublicWriterReentrancy(): void {
    if (runtimeMutationWriterContext.getStore() === this.mutationWriterToken) {
      throw new Error("Public runtime writers are forbidden inside commitRuntimeMutation callbacks")
    }
  }

  private enqueueWriter<T>(operation: () => T | Promise<T>, allowWhileClosing = false): Promise<T> {
    this.assertPublicWriterReentrancy()
    if (!allowWhileClosing && this.lifecycle !== "open") {
      return Promise.reject(new Error(`WorkbenchRuntimeStore is ${this.lifecycle}`))
    }
    const queued = this.writerTail.then(operation)
    const exposed = queued.then(value => cloneValue(value))
    this.writerTail = exposed.then(
      () => undefined,
      () => undefined
    )
    return exposed
  }

  private enqueueClonedWriter<I, T>(
    input: I,
    operation: (isolatedInput: I, draft: PersistedRuntime) => T | Promise<T>
  ): Promise<T> {
    this.assertPublicWriterReentrancy()
    let isolatedInput: I
    try {
      isolatedInput = cloneValue(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueueWriter(() => operation(isolatedInput, cloneValue(this.load())))
  }

  private persistState(state: PersistedRuntime): void {
    store.set(STORAGE_KEY, cloneValue(state))
  }

  private scheduleSave(delayMs = 450): void {
    if (this.lifecycle !== "open") return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.enqueueWriter(() => {
        this.persistState(this.load())
      }).catch(error => {
        log.error("Debounced runtime persist failed:", error)
      })
    }, delayMs)
  }

  private publishEvents(events: RuntimeEvent[]): void {
    for (const event of events) {
      for (const listener of this.rawListeners("event")) {
        try {
          const result = (listener as (event: RuntimeEvent) => unknown).call(this, cloneValue(event))
          if (isThenable(result)) {
            void Promise.resolve(result).catch(error => {
              log.error("Async runtime event listener failed:", error)
            })
          }
        } catch (error) {
          log.error("Runtime event listener failed:", error)
        }
      }
    }
  }

  private async finishLegacyWriter(
    state: PersistedRuntime,
    stagedEvents: RuntimeEvent[]
  ): Promise<PersistedRuntime> {
    state.events = pruneRuntimeEvents(state)
    const hadBufferedSave = this.saveTimer !== null
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    let canonicalState: PersistedRuntime
    try {
      canonicalState = cloneValue(await store.commit<PersistedRuntime>(STORAGE_KEY, cloneValue(state)))
    } catch (error) {
      if (hadBufferedSave) this.scheduleSave()
      throw error
    }
    const canonicalEventsById = new Map(canonicalState.events.map(event => [event.id, event]))
    const canonicalEvents = stagedEvents
      .map(event => canonicalEventsById.get(event.id))
      .filter((event): event is RuntimeEvent => event !== undefined)
    this.state = canonicalState
    this.publishEvents(canonicalEvents)
    return canonicalState
  }

  dispose(options: RuntimeDisposeOptions = {}): Promise<void> {
    this.assertPublicWriterReentrancy()
    if (options.interruptReason) this.disposeInterruptReason ??= options.interruptReason
    if (this.disposePromise) return this.disposePromise
    this.lifecycle = "closing"
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const barrier = this.enqueueWriter(async () => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
      const interruptReason = this.disposeInterruptReason
      if (!interruptReason) {
        this.persistState(this.load())
        return
      }

      const draft = cloneValue(this.load())
      const stagedEvents: RuntimeEvent[] = []
      const { tx, close } = createRuntimeMutation(draft, stagedEvents)
      try {
        interruptActiveWorkInMutation(tx, interruptReason)
      } finally {
        close()
      }
      draft.events = pruneRuntimeEvents(draft)
      const canonicalState = cloneValue(await store.commit<PersistedRuntime>(STORAGE_KEY, cloneValue(draft)))
      const canonicalEventsById = new Map(canonicalState.events.map(event => [event.id, event]))
      const canonicalEvents = stagedEvents
        .map(event => canonicalEventsById.get(event.id))
        .filter((event): event is RuntimeEvent => event !== undefined)
      this.state = canonicalState
      this.publishEvents(canonicalEvents)
    }, true)
    const attempt = barrier.then(
      () => {
        this.lifecycle = "closed"
      },
      error => {
        if (this.disposePromise === attempt) this.disposePromise = null
        throw error
      }
    )
    this.disposePromise = attempt
    return attempt
  }

  whenIdle(): Promise<void> {
    return this.writerTail
  }

  snapshot(workspaceId?: string | null): WorkbenchSnapshot {
    const state = this.load()
    const threads = workspaceId === undefined
      ? state.threads
      : state.threads.filter(thread => thread.workspaceId === workspaceId)
    const ids = new Set(threads.map(thread => thread.id))
    const activeThreadId = state.activeThreadId && ids.has(state.activeThreadId)
      ? state.activeThreadId
      : workspaceId === undefined
        ? threads[0]?.id ?? null
        : null
    return cloneValue({
      threads: [...threads].sort((left, right) => right.updatedAt - left.updatedAt),
      turns: state.turns
        .filter(turn => ids.has(turn.threadId))
        .sort((left, right) => left.createdAt - right.createdAt),
      runs: state.runs.filter(run => state.turns.some(turn => ids.has(turn.threadId) && turn.id === run.turnId)),
      hiddenTaskTurnIds: state.hiddenTaskTurnIds.filter(turnId => state.turns.some(turn => ids.has(turn.threadId) && turn.id === turnId)),
      activeThreadId
    })
  }

  listThreads(workspaceId?: string | null): WorkbenchThread[] {
    return this.snapshot(workspaceId).threads
  }

  getThread(threadId: string): WorkbenchThread | undefined {
    const thread = this.load().threads.find(candidate => candidate.id === threadId)
    return thread ? cloneValue(thread) : undefined
  }

  getTurn(turnId: string): WorkbenchTurn | undefined {
    const turn = this.load().turns.find(candidate => candidate.id === turnId)
    return turn ? cloneValue(turn) : undefined
  }

  listDurableDecisions(): DurableDecisionRecord[] {
    return cloneValue(this.load().decisions)
  }

  listQueuedSubmissions(threadId?: string): QueuedThreadSubmission[] {
    const submissions = threadId === undefined
      ? this.load().queuedSubmissions
      : this.load().queuedSubmissions.filter(candidate => candidate.threadId === threadId)
    return cloneValue(submissions)
  }

  createThread(input: { workspaceId?: string | null; title?: string }): Promise<WorkbenchThread> {
    return this.enqueueClonedWriter(input, async (isolatedInput, state) => {
      const thread = createThreadInState(state, isolatedInput)
      const canonicalState = await this.finishLegacyWriter(state, [])
      return requireThreadInState(canonicalState, thread.id)
    })
  }

  renameThread(threadId: string, title: string): Promise<WorkbenchThread> {
    return this.enqueueClonedWriter({ threadId, title }, async (input, state) => {
      const thread = requireThreadInState(state, input.threadId)
      thread.title = input.title.trim() || thread.title
      thread.updatedAt = Date.now()
      const canonicalState = await this.finishLegacyWriter(state, [])
      return requireThreadInState(canonicalState, thread.id)
    })
  }

  deleteThread(threadId: string): Promise<boolean> {
    return this.enqueueClonedWriter(threadId, async (isolatedThreadId, state) => {
      const before = state.threads.length
      const turnIds = new Set(state.turns
        .filter(turn => turn.threadId === isolatedThreadId)
        .map(turn => turn.id))
      state.threads = state.threads.filter(thread => thread.id !== isolatedThreadId)
      state.turns = state.turns.filter(turn => turn.threadId !== isolatedThreadId)
      state.runs = state.runs.filter(run => !turnIds.has(run.turnId))
      state.events = state.events.filter(event => event.threadId !== isolatedThreadId)
      state.hiddenTaskTurnIds = state.hiddenTaskTurnIds.filter(turnId => !turnIds.has(turnId))
      state.decisions = state.decisions.filter(record => (
        record.request.owner.type !== "turn"
        || (
          record.request.owner.threadId !== isolatedThreadId
          && !turnIds.has(record.request.owner.turnId)
        )
      ))
      state.queuedSubmissions = state.queuedSubmissions.filter(submission => submission.threadId !== isolatedThreadId)
      delete state.nextSeqByThread[isolatedThreadId]
      if (state.activeThreadId === isolatedThreadId) state.activeThreadId = state.threads[0]?.id ?? null
      const changed = before !== state.threads.length
      if (changed) await this.finishLegacyWriter(state, [])
      return changed
    })
  }

  selectThread(threadId: string | null): Promise<string | null> {
    return this.enqueueClonedWriter(threadId, async (isolatedThreadId, state) => {
      if (isolatedThreadId !== null) requireThreadInState(state, isolatedThreadId)
      state.activeThreadId = isolatedThreadId
      const canonicalState = await this.finishLegacyWriter(state, [])
      return canonicalState.activeThreadId
    })
  }

  createTurn(input: TurnCreateInput): Promise<{ thread: WorkbenchThread; turn: WorkbenchTurn }> {
    return this.enqueueClonedWriter(input, async (isolatedInput, state) => {
      let thread = isolatedInput.threadId
        ? requireThreadInState(state, isolatedInput.threadId)
        : undefined
      if (!thread) {
        thread = createThreadInState(state, {
          workspaceId: isolatedInput.workspaceId ?? null,
          title: deriveThreadTitleFromPrompt(isolatedInput.prompt)
        })
      }
      const now = Date.now()
      const turn: WorkbenchTurn = {
        id: id("turn"),
        threadId: thread.id,
        prompt: isolatedInput.prompt,
        attachments: isolatedInput.attachments?.length ? isolatedInput.attachments : undefined,
        contextProjection: isolatedInput.contextProjection,
        mode: isolatedInput.mode,
        customSchedule: isolatedInput.customSchedule,
        targetAgent: isolatedInput.targetAgent || undefined,
        modelSelection: isolatedInput.modelSelection,
        thinking: isolatedInput.thinking,
        status: "running",
        taskIds: [],
        ownerWebContentsId: isolatedInput.ownerWebContentsId,
        createdAt: now
      }
      state.turns.push(turn)
      thread.updatedAt = now
      thread.lastTurnStatus = "running"
      const autoTitle = maybeAutoTitle(thread.title, isolatedInput.prompt)
      if (autoTitle) thread.title = autoTitle
      state.activeThreadId = thread.id
      const stagedEvents = [appendEventInState(
        state,
        thread.id,
        turn.id,
        "turn:created",
        undefined,
        {
          prompt: isolatedInput.prompt,
          mode: isolatedInput.mode,
          attachments: turn.attachments ?? [],
          contextProjection: turn.contextProjection,
          customSchedule: turn.customSchedule,
          modelSelection: turn.modelSelection,
          thinking: turn.thinking
        }
      )]
      const canonicalState = await this.finishLegacyWriter(state, stagedEvents)
      return {
        thread: requireThreadInState(canonicalState, thread.id),
        turn: requireTurnInState(canonicalState, turn.id)
      }
    })
  }

  setTurnTarget(turnId: string, targetAgent: string | null): Promise<WorkbenchTurn> {
    return this.enqueueClonedWriter({ turnId, targetAgent }, async (input, state) => {
      const turn = requireTurnInState(state, input.turnId)
      turn.targetAgent = input.targetAgent || undefined
      const canonicalState = await this.finishLegacyWriter(state, [])
      return requireTurnInState(canonicalState, turn.id)
    })
  }

  attachTask(turnId: string, taskId: string): Promise<void> {
    return this.enqueueClonedWriter({ turnId, taskId }, async (input, state) => {
      const turn = requireTurnInState(state, input.turnId)
      if (!turn.taskIds.includes(input.taskId)) turn.taskIds.push(input.taskId)
      await this.finishLegacyWriter(state, [])
    })
  }

  setTurnStatus(turnId: string, status: WorkbenchTurnStatus, payload: any = {}): Promise<void> {
    return this.enqueueClonedWriter({ turnId, status, payload }, async (input, state) => {
      const stagedEvents: RuntimeEvent[] = []
      setTurnStatusInState(state, stagedEvents, input.turnId, input.status, input.payload)
      await this.finishLegacyWriter(state, stagedEvents)
    })
  }

  transitionTurnStatus(
    turnId: string,
    expectedStatuses: WorkbenchTurnStatus[],
    nextStatus: WorkbenchTurnStatus,
    payload: Record<string, unknown> = {}
  ): Promise<boolean> {
    this.assertPublicWriterReentrancy()
    let input: {
      turnId: string
      expectedStatuses: WorkbenchTurnStatus[]
      nextStatus: WorkbenchTurnStatus
      payload: Record<string, unknown>
    }
    try {
      input = cloneValue({ turnId, expectedStatuses, nextStatus, payload })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(input.turnId)
      if (!turn) return false
      if (turn.status === input.nextStatus) return true
      if (!input.expectedStatuses.includes(turn.status)) return false
      tx.setTurnStatus(input.turnId, input.nextStatus, input.payload)
      return true
    })
  }

  deleteTask(taskId: string): Promise<boolean> {
    return this.enqueueClonedWriter(taskId, async (isolatedTaskId, state) => {
      const directTurn = state.turns.find(turn => turn.id === isolatedTaskId)
      const matchedTurn = directTurn ?? state.turns.find(turn => turn.taskIds.includes(isolatedTaskId))
      const changed = matchedTurn ? hideTaskTurnInState(state, matchedTurn.id) : false
      if (changed) await this.finishLegacyWriter(state, [])
      return changed
    })
  }

  clearCompletedTasks(workspaceId?: string | null): Promise<string[]> {
    return this.enqueueClonedWriter(workspaceId, async (isolatedWorkspaceId, state) => {
      const removableTurnIds = state.turns
        .filter(turn => isTerminalTurnStatus(turn.status))
        .filter(turn => isolatedWorkspaceId === undefined
          || state.threads.find(thread => thread.id === turn.threadId)?.workspaceId === isolatedWorkspaceId)
        .map(turn => turn.id)
      for (const turnId of removableTurnIds) hideTaskTurnInState(state, turnId)
      if (removableTurnIds.length > 0) await this.finishLegacyWriter(state, [])
      return removableTurnIds
    })
  }

  appendSystemEvent(
    threadId: string,
    turnId: string,
    kind: RuntimeEvent["kind"],
    agentId: string | undefined,
    payload: any
  ): Promise<RuntimeEvent> {
    return this.enqueueClonedWriter({ threadId, turnId, kind, agentId, payload }, async (input, state) => {
      const event = appendEventInState(state, input.threadId, input.turnId, input.kind, input.agentId, input.payload)
      const canonicalState = await this.finishLegacyWriter(state, [event])
      return canonicalState.events.find(candidate => candidate.id === event.id)!
    })
  }

  createRun(input: RunCreateInput): Promise<AgentRunNode> {
    return this.enqueueClonedWriter(input, async (isolatedInput, state) => {
      const stagedEvents: RuntimeEvent[] = []
      const run = createRunInState(state, stagedEvents, isolatedInput)
      const canonicalState = await this.finishLegacyWriter(state, stagedEvents)
      return canonicalState.runs.find(candidate => candidate.id === run.id)!
    })
  }

  setRunStatus(
    turnId: string,
    agentId: string,
    status: WorkbenchTurnStatus,
    payload: any = {}
  ): Promise<void> {
    return this.enqueueClonedWriter({ turnId, agentId, status, payload }, async (input, state) => {
      const stagedEvents: RuntimeEvent[] = []
      setRunStatusInState(state, stagedEvents, input.turnId, input.agentId, input.status, input.payload)
      await this.finishLegacyWriter(state, stagedEvents)
    })
  }

  /**
   * Atomically publish the final chat release and complete a still-running
   * Turn. A cancellation/interruption queued first wins and publishes nothing.
   */
  completeTurnWithFinalEvent(
    turnId: string,
    finalEvent?: { agentId?: string; payload: Record<string, unknown> }
  ): Promise<boolean> {
    this.assertPublicWriterReentrancy()
    let input: {
      turnId: string
      finalEvent?: { agentId?: string; payload: Record<string, unknown> }
    }
    try {
      input = cloneValue({ turnId, finalEvent })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(input.turnId)
      if (!turn || turn.status !== "running") return false
      if (input.finalEvent) {
        tx.appendEvent(
          turn.threadId,
          turn.id,
          "agent:done",
          input.finalEvent.agentId,
          input.finalEvent.payload
        )
      }
      tx.setTurnStatus(turn.id, "completed")
      return true
    })
  }

  cancelTurn(
    turnId: string,
    payload: Record<string, unknown> = {}
  ): Promise<boolean> {
    this.assertPublicWriterReentrancy()
    let input: { turnId: string; payload: Record<string, unknown> }
    try {
      input = cloneValue({ turnId, payload })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(input.turnId)
      if (!turn) return false
      if (isTerminalTurnStatus(turn.status) && turn.status !== "cancelled") return false
      for (const run of tx.listRuns(input.turnId)) {
        if (isTerminalTurnStatus(run.status)) continue
        tx.setRunStatusById(run.id, "cancelled", input.payload)
      }
      if (turn.status !== "cancelled") {
        tx.setTurnStatus(input.turnId, "cancelled", input.payload)
      }
      return true
    })
  }

  interruptTurn(
    turnId: string,
    payload: Record<string, unknown> = {}
  ): Promise<boolean> {
    this.assertPublicWriterReentrancy()
    let input: { turnId: string; payload: Record<string, unknown> }
    try {
      input = cloneValue({ turnId, payload })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(input.turnId)
      if (!turn) return false
      if (isTerminalTurnStatus(turn.status) && turn.status !== "interrupted") return false
      for (const run of tx.listRuns(input.turnId)) {
        if (isTerminalTurnStatus(run.status)) continue
        tx.setRunStatusById(run.id, "interrupted", input.payload)
      }
      if (turn.status !== "interrupted") {
        tx.setTurnStatus(input.turnId, "interrupted", input.payload)
      }
      return true
    })
  }

  cancelAgentRun(
    turnId: string,
    agentId: string,
    payload: Record<string, unknown> = {}
  ): Promise<boolean> {
    this.assertPublicWriterReentrancy()
    let input: {
      turnId: string
      agentId: string
      payload: Record<string, unknown>
    }
    try {
      input = cloneValue({ turnId, agentId, payload })
    } catch (error) {
      return Promise.reject(error)
    }

    return this.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(input.turnId)
      if (!turn) return false
      const matchingRuns = tx.listRuns(input.turnId)
        .filter(candidate => candidate.agentId === input.agentId)
      const activeRuns = matchingRuns
        .filter(candidate => !isTerminalTurnStatus(candidate.status))
      const alreadyCancelled = matchingRuns.some(candidate => candidate.status === "cancelled")
      if (activeRuns.length === 0 && !alreadyCancelled) return false
      for (const run of activeRuns) {
        tx.setRunStatusById(run.id, "cancelled", input.payload)
      }

      const hasActiveRun = tx.listRuns(input.turnId)
        .some(candidate => !isTerminalTurnStatus(candidate.status))
      if (!hasActiveRun && !isTerminalTurnStatus(turn.status)) {
        tx.setTurnStatus(input.turnId, "cancelled")
      }
      return true
    })
  }

  appendStreamEvent(turnId: string, stream: any): Promise<RuntimeEvent> {
    if (stream?.kind === "delta") return this.enqueueBufferedDelta({ turnId, stream })
    return this.enqueueClonedWriter({ turnId, stream }, async (input, state) => {
      const { event, stagedEvents } = this.applyStreamEvent(state, input)
      const canonicalState = await this.finishLegacyWriter(state, stagedEvents)
      return canonicalState.events.find(candidate => candidate.id === event.id)!
    })
  }

  private enqueueBufferedDelta(input: { turnId: string; stream: any }): Promise<RuntimeEvent> {
    this.assertPublicWriterReentrancy()
    let isolatedInput: { turnId: string; stream: any }
    try {
      isolatedInput = cloneValue(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueueWriter(() => {
      const state = this.load()
      const { event, stagedEvents } = this.applyStreamEvent(state, isolatedInput)
      state.events = pruneRuntimeEvents(state)
      this.scheduleSave()
      this.publishEvents(stagedEvents)
      return event
    })
  }

  private applyStreamEvent(
    state: PersistedRuntime,
    input: { turnId: string; stream: any }
  ): { event: RuntimeEvent; stagedEvents: RuntimeEvent[] } {
    const turn = requireTurnInState(state, input.turnId)
    if (turn.status === "cancelled" || turn.status === "interrupted") {
      const ignored = appendEventInState(
        state,
        turn.threadId,
        turn.id,
        "agent:activity",
        input.stream.agentId,
        {
          ignored: true,
          originalKind: input.stream.kind,
          reason: `turn-${turn.status}`
        }
      )
      return { event: ignored, stagedEvents: [ignored] }
    }
    const kind: RuntimeEvent["kind"] = input.stream.kind?.startsWith?.("orchestrate:") ? "orchestrate"
      : input.stream.kind === "start" ? "agent:start"
      : input.stream.kind === "delta" ? "agent:delta"
      : input.stream.kind === "activity" ? "agent:activity"
      : input.stream.kind === "approval" ? "agent:approval"
      : input.stream.kind === "done" ? "agent:done"
      : input.stream.kind === "error" ? "agent:error"
      : "agent:activity"
    const stagedEvents: RuntimeEvent[] = []
    const run = input.stream.agentId
      ? findCancelledRunTombstone(state, input.turnId, input.stream.agentId, input.stream)
      : undefined
    if (
      run
      && ["start", "delta", "activity", "approval", "done", "error"].includes(input.stream.kind)
    ) {
      const ignored = appendEventInState(
        state,
        turn.threadId,
        turn.id,
        "agent:activity",
        input.stream.agentId,
        {
          ignored: true,
          originalKind: input.stream.kind,
          reason: "run-cancelled",
          taskId: input.stream.taskId,
          scheduleRole: input.stream.scheduleRole,
          scheduleStepId: input.stream.scheduleStepId
        }
      )
      return { event: ignored, stagedEvents: [ignored] }
    }
    if (input.stream.kind === "start" && input.stream.agentId) {
      createRunInState(state, stagedEvents, {
        turnId: input.turnId,
        agentId: input.stream.agentId,
        role: input.stream.scheduleRole || "target",
        taskId: typeof input.stream.taskId === "string" ? input.stream.taskId : undefined,
        scheduleStepId: typeof input.stream.scheduleStepId === "string"
          ? input.stream.scheduleStepId
          : undefined
      })
    }
    if (input.stream.kind === "done" && input.stream.agentId) {
      setRunStatusInState(state, stagedEvents, input.turnId, input.stream.agentId, "completed", {
        durationMs: input.stream.durationMs,
        scheduleRole: input.stream.scheduleRole,
        scheduleStepId: input.stream.scheduleStepId,
        taskId: input.stream.taskId
      })
    }
    if (input.stream.kind === "error" && input.stream.agentId) {
      setRunStatusInState(
        state,
        stagedEvents,
        input.turnId,
        input.stream.agentId,
        input.stream.code === "AGENT_CANCELLED" ? "cancelled" : "failed",
        {
          error: input.stream.error,
          code: input.stream.code,
          durationMs: input.stream.durationMs,
          scheduleRole: input.stream.scheduleRole,
          scheduleStepId: input.stream.scheduleStepId,
          taskId: input.stream.taskId
        }
      )
    }
    const event = appendEventInState(
      state,
      turn.threadId,
      turn.id,
      kind,
      input.stream.agentId,
      input.stream
    )
    stagedEvents.push(event)
    return { event, stagedEvents }
  }

  eventsSince(threadId: string, seq = 0): RuntimeEvent[] {
    return cloneValue(this.load().events
      .filter(event => event.threadId === threadId && event.seq > seq)
      .sort((left, right) => left.seq - right.seq))
  }

  dispatcherMode(mode: DispatchPreset): "auto" | "broadcast" | "chain" | "orchestrate" {
    return toDispatcherMode(mode)
  }

  commitRuntimeMutation<T>(
    mutate: (tx: RuntimeMutation) => T & (T extends PromiseLike<unknown> ? never : unknown)
  ): Promise<T> {
    return this.enqueueWriter(async () => {
      const draft = cloneValue(this.load())
      const stagedEvents: RuntimeEvent[] = []
      const { tx, close } = createRuntimeMutation(draft, stagedEvents)
      let result: T
      try {
        result = runtimeMutationWriterContext.run(this.mutationWriterToken, () => mutate(tx))
      } catch (error) {
        close()
        throw error
      }
      close()

      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => undefined)
        throw new TypeError("Runtime mutation callback must be synchronous")
      }

      const isolatedResult = cloneValue(result)
      draft.events = pruneRuntimeEvents(draft)
      const hadBufferedSave = this.saveTimer !== null
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        this.saveTimer = null
      }
      let canonicalState: PersistedRuntime
      try {
        canonicalState = cloneValue(await store.commit<PersistedRuntime>(STORAGE_KEY, cloneValue(draft)))
      } catch (error) {
        if (hadBufferedSave) this.scheduleSave()
        throw error
      }
      const canonicalEventsById = new Map(canonicalState.events.map(event => [event.id, event]))
      const canonicalEvents = stagedEvents
        .map(event => canonicalEventsById.get(event.id))
        .filter((event): event is RuntimeEvent => event !== undefined)
      this.state = canonicalState
      this.publishEvents(canonicalEvents)
      return isolatedResult
    })
  }
}

let instance: WorkbenchRuntimeStore | null = null

export function getWorkbenchRuntimeStore(): WorkbenchRuntimeStore {
  if (!instance) instance = new WorkbenchRuntimeStore()
  return instance
}
