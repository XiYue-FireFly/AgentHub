import { EventEmitter } from "node:events"
import { store } from "../store"
import { toDispatcherMode } from "./schedules"
import type {
  AgentRunNode,
  ContextProjection,
  DispatchPreset,
  ModelSelection,
  RuntimeEvent,
  SchedulePreview,
  WorkbenchAttachment,
  WorkbenchSnapshot,
  WorkbenchThread,
  WorkbenchTurn,
  WorkbenchTurnStatus
} from "./types"

const STORAGE_KEY = "runtime.workbench.v1"

interface PersistedRuntime {
  version: 1
  threads: WorkbenchThread[]
  turns: WorkbenchTurn[]
  runs: AgentRunNode[]
  events: RuntimeEvent[]
  activeThreadId: string | null
  nextSeqByThread: Record<string, number>
}

function emptyState(): PersistedRuntime {
  return { version: 1, threads: [], turns: [], runs: [], events: [], activeThreadId: null, nextSeqByThread: {} }
}

function shortTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim()
  return clean ? clean.slice(0, 42) : "New session"
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export class WorkbenchRuntimeStore extends EventEmitter {
  private state: PersistedRuntime | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  private load(): PersistedRuntime {
    if (this.state) return this.state
    const raw = store.get(STORAGE_KEY)
    if (raw && typeof raw === "object" && Array.isArray((raw as any).threads)) {
      this.state = {
        ...emptyState(),
        ...(raw as PersistedRuntime),
        version: 1,
        threads: Array.isArray((raw as any).threads) ? (raw as any).threads : [],
        turns: Array.isArray((raw as any).turns) ? (raw as any).turns : [],
        runs: Array.isArray((raw as any).runs) ? (raw as any).runs : [],
        events: Array.isArray((raw as any).events) ? (raw as any).events : [],
        nextSeqByThread: typeof (raw as any).nextSeqByThread === "object" ? (raw as any).nextSeqByThread : {}
      }
    } else {
      this.state = emptyState()
    }
    return this.state
  }

  private save(): void {
    store.set(STORAGE_KEY, this.load())
  }

  private scheduleSave(delayMs = 450): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, delayMs)
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
  }

  snapshot(workspaceId?: string | null): WorkbenchSnapshot {
    const state = this.load()
    const threads = workspaceId === undefined
      ? state.threads
      : state.threads.filter(t => t.workspaceId === workspaceId)
    const ids = new Set(threads.map(t => t.id))
    return {
      threads: [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
      turns: state.turns.filter(t => ids.has(t.threadId)).sort((a, b) => a.createdAt - b.createdAt),
      runs: state.runs.filter(r => state.turns.some(t => ids.has(t.threadId) && t.id === r.turnId)),
      activeThreadId: state.activeThreadId && ids.has(state.activeThreadId) ? state.activeThreadId : threads[0]?.id ?? null
    }
  }

  listThreads(workspaceId?: string | null): WorkbenchThread[] {
    return this.snapshot(workspaceId).threads
  }

  getThread(threadId: string): WorkbenchThread | undefined {
    return this.load().threads.find(t => t.id === threadId)
  }

  getTurn(turnId: string): WorkbenchTurn | undefined {
    return this.load().turns.find(t => t.id === turnId)
  }

  createThread(input: { workspaceId?: string | null; title?: string }): WorkbenchThread {
    const now = Date.now()
    const thread: WorkbenchThread = {
      id: id("thread"),
      workspaceId: input.workspaceId ?? null,
      title: input.title?.trim() || "New session",
      createdAt: now,
      updatedAt: now
    }
    const state = this.load()
    state.threads.unshift(thread)
    state.activeThreadId = thread.id
    this.save()
    return thread
  }

  renameThread(threadId: string, title: string): WorkbenchThread {
    const thread = this.requireThread(threadId)
    thread.title = title.trim() || thread.title
    thread.updatedAt = Date.now()
    this.save()
    return thread
  }

  deleteThread(threadId: string): boolean {
    const state = this.load()
    const before = state.threads.length
    state.threads = state.threads.filter(t => t.id !== threadId)
    const turnIds = new Set(state.turns.filter(t => t.threadId === threadId).map(t => t.id))
    state.turns = state.turns.filter(t => t.threadId !== threadId)
    state.runs = state.runs.filter(r => !turnIds.has(r.turnId))
    state.events = state.events.filter(e => e.threadId !== threadId)
    delete state.nextSeqByThread[threadId]
    if (state.activeThreadId === threadId) state.activeThreadId = state.threads[0]?.id ?? null
    this.save()
    return before !== state.threads.length
  }

  selectThread(threadId: string | null): string | null {
    const state = this.load()
    if (threadId !== null) this.requireThread(threadId)
    state.activeThreadId = threadId
    this.save()
    return state.activeThreadId
  }

  createTurn(input: { threadId?: string | null; workspaceId?: string | null; prompt: string; mode: DispatchPreset; targetAgent?: string | null; modelSelection?: ModelSelection; thinking?: any; attachments?: WorkbenchAttachment[]; contextProjection?: ContextProjection; customSchedule?: SchedulePreview }): { thread: WorkbenchThread; turn: WorkbenchTurn } {
    const state = this.load()
    let thread = input.threadId ? this.requireThread(input.threadId) : undefined
    if (!thread) thread = this.createThread({ workspaceId: input.workspaceId ?? null, title: shortTitle(input.prompt) })
    const now = Date.now()
    const turn: WorkbenchTurn = {
      id: id("turn"),
      threadId: thread.id,
      prompt: input.prompt,
      attachments: input.attachments?.length ? input.attachments : undefined,
      contextProjection: input.contextProjection,
      mode: input.mode,
      customSchedule: input.customSchedule,
      targetAgent: input.targetAgent || undefined,
      modelSelection: input.modelSelection,
      thinking: input.thinking,
      status: "running",
      taskIds: [],
      createdAt: now
    }
    state.turns.push(turn)
    thread.updatedAt = now
    thread.lastTurnStatus = "running"
    if (thread.title === "New session") thread.title = shortTitle(input.prompt)
    state.activeThreadId = thread.id
    this.appendEvent(thread.id, turn.id, "turn:created", undefined, { prompt: input.prompt, mode: input.mode, attachments: turn.attachments ?? [], contextProjection: turn.contextProjection, customSchedule: turn.customSchedule, modelSelection: turn.modelSelection, thinking: turn.thinking }, false)
    this.save()
    return { thread, turn }
  }

  setTurnTarget(turnId: string, targetAgent: string | null): WorkbenchTurn {
    const turn = this.requireTurn(turnId)
    turn.targetAgent = targetAgent || undefined
    this.save()
    return turn
  }

  attachTask(turnId: string, taskId: string): void {
    const turn = this.requireTurn(turnId)
    if (!turn.taskIds.includes(taskId)) turn.taskIds.push(taskId)
    this.save()
  }

  setTurnStatus(turnId: string, status: WorkbenchTurnStatus, payload: any = {}): void {
    const turn = this.requireTurn(turnId)
    turn.status = status
    if (status !== "running" && status !== "queued") turn.completedAt = Date.now()
    const thread = this.requireThread(turn.threadId)
    thread.lastTurnStatus = status
    thread.updatedAt = Date.now()
    this.appendEvent(turn.threadId, turn.id, "turn:status", undefined, { status, ...payload }, false)
    this.save()
  }

  deleteTask(taskId: string): boolean {
    const state = this.load()
    let changed = false
    const affectedTurnIds = new Set<string>()
    const affectedThreadIds = new Set<string>()
    state.turns = state.turns.flatMap(turn => {
      if (!turn.taskIds.includes(taskId)) return [turn]
      changed = true
      const remainingTaskIds = turn.taskIds.filter(id => id !== taskId)
      if (remainingTaskIds.length > 0) return [{ ...turn, taskIds: remainingTaskIds }]
      affectedTurnIds.add(turn.id)
      affectedThreadIds.add(turn.threadId)
      return []
    })
    if (affectedTurnIds.size > 0) {
      state.runs = state.runs.filter(run => !affectedTurnIds.has(run.turnId))
      state.events = state.events.filter(event => !affectedTurnIds.has(event.turnId))
      for (const thread of state.threads) {
        if (!affectedThreadIds.has(thread.id)) continue
        const latest = [...state.turns].reverse().find(turn => turn.threadId === thread.id)
        thread.lastTurnStatus = latest?.status
        thread.updatedAt = latest?.createdAt ?? thread.updatedAt
      }
    }
    if (changed) this.save()
    return changed
  }

  clearCompletedTasks(): string[] {
    const state = this.load()
    const removableTaskIds = new Set<string>()
    for (const turn of state.turns) {
      if (turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled") {
        for (const taskId of turn.taskIds) removableTaskIds.add(taskId)
      }
    }
    for (const taskId of removableTaskIds) this.deleteTask(taskId)
    return [...removableTaskIds]
  }

  appendSystemEvent(threadId: string, turnId: string, kind: RuntimeEvent["kind"], agentId: string | undefined, payload: any): RuntimeEvent {
    return this.appendEvent(threadId, turnId, kind, agentId, payload)
  }

  createRun(input: Omit<AgentRunNode, "id" | "startedAt" | "status"> & { status?: WorkbenchTurnStatus }): AgentRunNode {
    const run: AgentRunNode = {
      ...input,
      id: id("run"),
      status: input.status || "running",
      startedAt: Date.now()
    }
    this.load().runs.push(run)
    const turn = this.requireTurn(run.turnId)
    this.appendEvent(turn.threadId, turn.id, "run:created", run.agentId, run, false)
    this.save()
    return run
  }

  setRunStatus(turnId: string, agentId: string, status: WorkbenchTurnStatus, payload: any = {}): void {
    const run = [...this.load().runs].reverse().find(r => {
      if (r.turnId !== turnId || r.agentId !== agentId) return false
      const role = payload.scheduleRole || payload.role
      if (role && r.role !== role) return false
      return true
    })
    if (run) {
      run.status = status
      if (status !== "running" && status !== "queued") run.endedAt = Date.now()
    }
    const turn = this.requireTurn(turnId)
    this.appendEvent(turn.threadId, turn.id, "run:status", agentId, { status, ...payload }, false)
    this.save()
  }

  appendStreamEvent(turnId: string, stream: any): RuntimeEvent {
    const turn = this.requireTurn(turnId)
    const kind = stream.kind?.startsWith?.("orchestrate:") ? "orchestrate"
      : stream.kind === "start" ? "agent:start"
      : stream.kind === "delta" ? "agent:delta"
      : stream.kind === "activity" ? "agent:activity"
      : stream.kind === "approval" ? "agent:approval"
      : stream.kind === "done" ? "agent:done"
      : stream.kind === "error" ? "agent:error"
      : "agent:activity"
    if (stream.kind === "start" && stream.agentId) this.createRun({ turnId, agentId: stream.agentId, role: stream.scheduleRole || "target" })
    if (stream.kind === "done" && stream.agentId) this.setRunStatus(turnId, stream.agentId, "completed", { durationMs: stream.durationMs, scheduleRole: stream.scheduleRole, scheduleStepId: stream.scheduleStepId, taskId: stream.taskId })
    if (stream.kind === "error" && stream.agentId) this.setRunStatus(turnId, stream.agentId, stream.code === "AGENT_CANCELLED" ? "cancelled" : "failed", { error: stream.error, code: stream.code, durationMs: stream.durationMs, scheduleRole: stream.scheduleRole, scheduleStepId: stream.scheduleStepId, taskId: stream.taskId })
    const persistNow = kind !== "agent:delta"
    return this.appendEvent(turn.threadId, turn.id, kind, stream.agentId, stream, persistNow)
  }

  eventsSince(threadId: string, seq = 0): RuntimeEvent[] {
    return this.load().events.filter(e => e.threadId === threadId && e.seq > seq).sort((a, b) => a.seq - b.seq)
  }

  dispatcherMode(mode: DispatchPreset): "auto" | "broadcast" | "chain" | "orchestrate" {
    return toDispatcherMode(mode)
  }

  private appendEvent(threadId: string, turnId: string, kind: RuntimeEvent["kind"], agentId: string | undefined, payload: any, persist = true): RuntimeEvent {
    const state = this.load()
    const seq = state.nextSeqByThread[threadId] ?? 1
    state.nextSeqByThread[threadId] = seq + 1
    const event: RuntimeEvent = { id: id("event"), threadId, turnId, seq, kind, agentId, payload, createdAt: Date.now() }
    state.events.push(event)
    state.events = pruneRuntimeEvents(state.events)
    this.emit("event", event)
    if (persist) this.save()
    else this.scheduleSave()
    return event
  }

  private requireThread(threadId: string): WorkbenchThread {
    const thread = this.load().threads.find(t => t.id === threadId)
    if (!thread) throw new Error(`Thread not found: ${threadId}`)
    return thread
  }

  private requireTurn(turnId: string): WorkbenchTurn {
    const turn = this.load().turns.find(t => t.id === turnId)
    if (!turn) throw new Error(`Turn not found: ${turnId}`)
    return turn
  }
}

let instance: WorkbenchRuntimeStore | null = null

export function getWorkbenchRuntimeStore(): WorkbenchRuntimeStore {
  if (!instance) instance = new WorkbenchRuntimeStore()
  return instance
}

const MAX_RUNTIME_EVENTS = 5000
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

function pruneRuntimeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  if (events.length <= MAX_RUNTIME_EVENTS) return events
  const overflow = events.length - MAX_RUNTIME_EVENTS
  let removed = 0
  const withoutOldDeltas = events.filter(event => {
    if (removed >= overflow) return true
    if (event.kind !== "agent:delta") return true
    removed += 1
    return false
  })
  if (withoutOldDeltas.length <= MAX_RUNTIME_EVENTS) return withoutOldDeltas
  const secondOverflow = withoutOldDeltas.length - MAX_RUNTIME_EVENTS
  removed = 0
  const withoutOldNonCritical = withoutOldDeltas.filter(event => {
    if (removed >= secondOverflow) return true
    if (PROTECTED_EVENT_KINDS.has(event.kind)) return true
    removed += 1
    return false
  })
  return withoutOldNonCritical.length <= MAX_RUNTIME_EVENTS
    ? withoutOldNonCritical
    : withoutOldNonCritical.slice(-MAX_RUNTIME_EVENTS)
}
