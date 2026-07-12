import type {
  DecisionRequest,
  PendingDecision,
  DecisionResolution,
  DecisionResolveResult,
  DecisionSubmission
} from "../../shared/decision-contract"
import { isCreatedDecisionRequest } from "./decision-request-factories"
import { isTerminalTurnStatus } from "./turn-status"
import type { RuntimeEvent } from "./types"
import type { WorkbenchRuntimeStore } from "./store"

export const DECISION_SERVICE_LIMITS = Object.freeze({
  unresolvedPerTurn: 8,
  createdPerTurn: 32,
  unresolvedProcess: 64,
  agentCreatedPerTurn: 4
})

const TERMINAL_RETRY_BASE_DELAY_MS = 100
const TERMINAL_RETRY_MAX_ATTEMPTS = 4

export interface DecisionServiceOptions {
  runtimeStore: WorkbenchRuntimeStore
}

export interface DecisionRequestOptions {
  signal?: AbortSignal
  onRemember?: (resolution: DecisionResolution) => Promise<void>
  onAdmitted?: (request: DecisionRequest) => void
}

export type DecisionSender =
  | { webContentsId: number; workspaceId: string | null }
  | { sessionId: string }

export interface StaleDecisionSummary {
  kind: "rerun-turn"
  requestId: string
  threadId: string
  originalTurnId: string
  source: DecisionRequest["source"]
}

interface DecisionEntry {
  request: DecisionRequest
  promise: Promise<DecisionResolution>
  resolve: (resolution: DecisionResolution) => void
  reject: (error: unknown) => void
  visible: boolean
  settled: boolean
  resolving: boolean
  timer: ReturnType<typeof setTimeout> | null
  signal?: AbortSignal
  abortListener?: () => void
  onRemember?: (resolution: DecisionResolution) => Promise<void>
  onAdmitted?: (request: DecisionRequest) => void
  rememberAttempted: boolean
}

interface TerminalCommitResult {
  resolution: DecisionResolution
  promotedRequestId?: string
}

interface TerminalRetryTask {
  attempt: number
  timer: ReturnType<typeof setTimeout> | null
  operation: () => Promise<unknown>
}

type ResolveCommitOutcome =
  | { accepted: false }
  | {
      accepted: true
      rememberEffect?: Promise<DecisionResolveResult>
    }

function ownerKey(request: DecisionRequest): string {
  const owner = request.owner
  return owner.type === "turn"
    ? `turn:${owner.threadId}:${owner.turnId}`
    : `hub:${owner.sessionId}`
}

function unresolved(state: { state: string }): boolean {
  return state.state !== "terminal"
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requestAudit(request: DecisionRequest, state: "queued" | "active"): Record<string, unknown> {
  const owner = request.owner.type === "turn"
    ? { type: "turn", threadId: request.owner.threadId, turnId: request.owner.turnId }
    : { type: "hub", sessionId: request.owner.sessionId }
  return {
    requestId: request.id,
    source: request.source,
    kind: request.kind,
    owner,
    state
  }
}

function resolutionAudit(
  request: DecisionRequest,
  status: DecisionResolution["status"]
): Record<string, unknown> {
  const owner = request.owner.type === "turn"
    ? { type: "turn", threadId: request.owner.threadId, turnId: request.owner.turnId }
    : { type: "hub", sessionId: request.owner.sessionId }
  return {
    requestId: request.id,
    source: request.source,
    kind: request.kind,
    owner,
    state: "terminal",
    status
  }
}

function settledPromise<T>(value: T): Promise<T> {
  return Promise.resolve(value)
}

export class DecisionService {
  private readonly runtimeStore: WorkbenchRuntimeStore
  private readonly entriesById = new Map<string, DecisionEntry>()
  private readonly idempotency = new Map<string, DecisionEntry>()
  private readonly ownerQueues = new Map<string, string[]>()
  private readonly activeHubSessions = new Set<string>()
  private readonly hubSessionClosures = new Map<string, Promise<void>>()
  private readonly pendingEffects = new Set<Promise<unknown>>()
  private readonly terminalRetries = new Map<string, TerminalRetryTask>()
  private operationTail: Promise<void> = Promise.resolve()
  private closed = false
  private shutdownPromise: Promise<void> | null = null

  constructor({ runtimeStore }: DecisionServiceOptions) {
    this.runtimeStore = runtimeStore
    this.runtimeStore.on("event", this.handleRuntimeEvent)
  }

  openHubSession(sessionId: string): boolean {
    if (this.closed || typeof sessionId !== "string" || !sessionId.trim()) return false
    this.activeHubSessions.add(sessionId)
    return true
  }

  request(request: DecisionRequest, options: DecisionRequestOptions = {}): Promise<DecisionResolution> {
    if (!isCreatedDecisionRequest(request)) {
      return Promise.reject(new Error("Decision requests must be created by a trusted factory"))
    }
    if (this.closed) return Promise.reject(new Error("DecisionService is closed"))
    if (request.owner.type === "hub" && !this.activeHubSessions.has(request.owner.sessionId)) {
      return Promise.reject(new Error("Hub decision session is not active"))
    }

    const key = ownerKey(request)
    const idempotencyKey = request.idempotencyKey ? `${key}:${request.idempotencyKey}` : undefined
    if (idempotencyKey) {
      const duplicate = this.idempotency.get(idempotencyKey)
      if (duplicate) return duplicate.promise
    }
    const duplicateId = this.entriesById.get(request.id)
    if (duplicateId) return duplicateId.promise

    const ownerError = this.validateOwner(request)
    if (ownerError) return Promise.reject(ownerError)
    const limitError = this.validateLimits(request)
    if (limitError) return Promise.reject(limitError)

    let resolve!: (resolution: DecisionResolution) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<DecisionResolution>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const entry: DecisionEntry = {
      request: clone(request),
      promise,
      resolve,
      reject,
      visible: false,
      settled: false,
      resolving: false,
      timer: null,
      signal: options.signal,
      onRemember: options.onRemember,
      onAdmitted: options.onAdmitted,
      rememberAttempted: false
    }
    this.entriesById.set(request.id, entry)
    if (idempotencyKey) this.idempotency.set(idempotencyKey, entry)
    const queue = this.ownerQueues.get(key) ?? []
    queue.push(request.id)
    this.ownerQueues.set(key, queue)

    void this.enqueueOperation(async () => {
      try {
        await this.persistRequest(entry)
      } catch (error) {
        this.removeFailedEntry(entry)
        entry.reject(error)
        throw error
      }
    }).catch(() => undefined)
    return promise
  }

  resolve(submission: DecisionSubmission, sender: DecisionSender): Promise<DecisionResolveResult> {
    if (this.closed) return settledPromise({ accepted: false })
    const entry = this.entriesById.get(submission?.requestId)
    if (
      !entry ||
      !entry.visible ||
      entry.settled ||
      entry.resolving ||
      !this.isActiveHead(entry) ||
      !this.senderMatches(entry.request, sender) ||
      !this.validateSubmission(entry.request, submission)
    ) {
      return settledPromise({ accepted: false })
    }

    const record = this.runtimeStore.listDurableDecisions()
      .find(candidate => candidate.request.id === entry.request.id)
    if (!record || record.state !== "active") return settledPromise({ accepted: false })
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      void this.enqueueOperation(() => this.commitTerminal(entry.request.id, "timeout"))
        .catch(() => undefined)
      return settledPromise({ accepted: false })
    }

    entry.resolving = true
    const committed = this.enqueueOperation<ResolveCommitOutcome>(async () => {
      try {
        const status = submission.outcome
        const result = await this.commitTerminal(entry.request.id, status, {
          selectedOptionIds: submission.selectedOptionIds,
          text: submission.customText
        })
        if (!result) {
          entry.resolving = false
          return { accepted: false }
        }
        let rememberEffect: Extract<ResolveCommitOutcome, { accepted: true }>["rememberEffect"]
        if (submission.remember === true && entry.onRemember && !entry.rememberAttempted) {
          entry.rememberAttempted = true
          rememberEffect = this.registerRememberEffect(entry.onRemember, result.resolution)
        }
        return rememberEffect ? { accepted: true, rememberEffect } : { accepted: true }
      } catch (error) {
        entry.resolving = false
        this.startTimerForEntry(entry)
        throw error
      }
    })
    return committed.then(async outcome => {
      if (!outcome.accepted || !outcome.rememberEffect) return outcome
      return outcome.rememberEffect
    })
  }

  listPending(filter: {
    threadId?: string
    webContentsId?: number
    workspaceId?: string | null
  } = {}): PendingDecision[] {
    const pending = this.runtimeStore.listDurableDecisions()
      .filter(record => unresolved(record))
      .filter(record => {
        if (filter.threadId === undefined && filter.webContentsId === undefined && filter.workspaceId === undefined) {
          return true
        }
        if (record.request.owner.type !== "turn") return false
        return (filter.threadId === undefined || record.request.owner.threadId === filter.threadId) &&
          (filter.webContentsId === undefined || record.request.owner.webContentsId === filter.webContentsId) &&
          (filter.workspaceId === undefined || record.request.owner.workspaceId === filter.workspaceId)
      })
      .sort((left, right) => (
        left.request.createdAt - right.request.createdAt ||
        left.request.id.localeCompare(right.request.id)
      ))
      .map(record => ({
        request: record.request,
        state: record.state,
        activatedAt: record.activatedAt,
        expiresAt: record.expiresAt
      }))
    return clone(pending)
  }

  cancelTurn(turnId: string): Promise<void> {
    return this.enqueueOperation(async () => {
      const resolutions = await this.commitTerminalBatch(
        record => record.request.owner.type === "turn" && record.request.owner.turnId === turnId,
        "cancelled",
        turnId
      )
      for (const resolution of resolutions) this.settleEntry(resolution)
      this.cleanupTerminalTurn(turnId)
    })
  }

  /**
   * Cancels only durable tool or ACP decisions owned by one agent on a Turn. This is
   * used before that agent's provider loop is stopped, so a pending approval
   * cannot hold the shared Turn in awaiting-decision until its deadline.
   */
  cancelAgentDecisions(turnId: string, agentId: string): Promise<void> {
    if (!turnId.trim() || !agentId.trim()) return Promise.resolve()
    return this.enqueueOperation(async () => {
      const result = await this.runtimeStore.commitRuntimeMutation(tx => {
        const decisions = tx.listDecisions()
        const targets = decisions.filter(record => (
          unresolved(record) &&
          record.request.owner.type === "turn" &&
          record.request.owner.turnId === turnId &&
          (record.request.source === "tool" || record.request.source === "acp") &&
          record.request.metadata?.agentId === agentId
        ))
        if (targets.length === 0) return { resolutions: [] as DecisionResolution[] }

        const resolutions = targets.map(record => ({
          requestId: record.request.id,
          status: "cancelled" as const,
          resolvedAt: Date.now()
        }))
        for (const [index, record] of targets.entries()) {
          const resolution = resolutions[index]
          tx.upsertDecision({ ...record, state: "terminal", resolution })
          const owner = record.request.owner
          if (owner.type === "turn") {
            tx.appendEvent(
              owner.threadId,
              owner.turnId,
              "decision:resolved",
              record.request.metadata?.agentId,
              resolutionAudit(record.request, "cancelled")
            )
          }
        }

        const remaining = decisions.filter(record => (
          unresolved(record) &&
          record.request.owner.type === "turn" &&
          record.request.owner.turnId === turnId &&
          !targets.some(target => target.request.id === record.request.id)
        ))
        let promotedRequestId: string | undefined
        if (!remaining.some(record => record.state === "active" || record.state === "resolving")) {
          const queued = remaining.filter(record => record.state === "queued")
          const ownerKeyForTurn = targets[0].request.owner.type === "turn"
            ? ownerKey(targets[0].request)
            : ""
          const next = (this.ownerQueues.get(ownerKeyForTurn) ?? [])
            .map(id => queued.find(record => record.request.id === id))
            .find((record): record is NonNullable<typeof record> => record !== undefined)
            ?? queued[0]
          if (next) {
            const activatedAt = Date.now()
            tx.upsertDecision({
              ...next,
              state: "active",
              activatedAt,
              expiresAt: next.request.deadlineMs === undefined
                ? undefined
                : activatedAt + next.request.deadlineMs
            })
            promotedRequestId = next.request.id
          }
        }

        const turn = tx.getTurn(turnId)
        if (turn && !isTerminalTurnStatus(turn.status)) {
          tx.setTurnStatus(turnId, remaining.length > 0 ? "awaiting-decision" : "running", {
            decisionStatus: "cancelled"
          })
        }
        return { resolutions, promotedRequestId }
      })
      for (const resolution of result.resolutions) this.settleEntry(resolution)
      if (result.promotedRequestId) this.activatePromoted(result.promotedRequestId)
    })
  }

  closeHubSession(sessionId: string): Promise<void> {
    const existing = this.hubSessionClosures.get(sessionId)
    if (existing) return existing
    this.activeHubSessions.delete(sessionId)
    if (this.closed) {
      return (this.shutdownPromise ?? Promise.resolve()).then(() => {
        this.cleanupHubSession(sessionId)
      })
    }
    const hasEntries = [...this.entriesById.values()].some(entry => (
      entry.request.owner.type === "hub" && entry.request.owner.sessionId === sessionId
    ))
    if (!hasEntries) {
      this.cleanupHubSession(sessionId)
      return Promise.resolve()
    }
    const closing = this.enqueueOperation(async () => {
      const resolutions = await this.commitTerminalBatch(
        record => record.request.owner.type === "hub" && record.request.owner.sessionId === sessionId,
        "cancelled"
      )
      for (const resolution of resolutions) this.settleEntry(resolution)
      this.cleanupHubSession(sessionId)
    })
    this.hubSessionClosures.set(sessionId, closing)
    void closing.then(
      () => this.hubSessionClosures.delete(sessionId),
      () => this.hubSessionClosures.delete(sessionId)
    )
    return closing
  }

  sweepOrphans(): Promise<StaleDecisionSummary[]> {
    return this.enqueueOperation(async () => {
      const summaries = await this.runtimeStore.commitRuntimeMutation(tx => {
        const results: StaleDecisionSummary[] = []
        for (const record of tx.listDecisions()) {
          if (!unresolved(record)) continue
          const resolution: DecisionResolution = {
            requestId: record.request.id,
            status: "stale",
            resolvedAt: Date.now()
          }
          tx.upsertDecision({ ...record, state: "terminal", resolution })
          if (record.request.owner.type !== "turn") continue
          const summary: StaleDecisionSummary = {
            kind: "rerun-turn",
            requestId: record.request.id,
            threadId: record.request.owner.threadId,
            originalTurnId: record.request.owner.turnId,
            source: record.request.source
          }
          results.push(summary)
          const turn = tx.getTurn(record.request.owner.turnId)
          if (turn && !isTerminalTurnStatus(turn.status)) {
            tx.setTurnStatus(turn.id, "interrupted", { reason: "stale decision recovered" })
          }
          tx.appendEvent(
            record.request.owner.threadId,
            record.request.owner.turnId,
            "decision:resolved",
            undefined,
            {
              requestId: record.request.id,
              status: "stale",
              source: record.request.source,
              recovery: {
                kind: "rerun-turn",
                originalTurnId: record.request.owner.turnId
              }
            }
          )
        }
        return results
      })
      for (const summary of summaries) {
        this.settleEntry({
          requestId: summary.requestId,
          status: "stale",
          resolvedAt: Date.now()
        })
      }
      return summaries
    })
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.closed = true
    this.activeHubSessions.clear()
    const terminal = this.enqueueOperation(async () => {
      const resolutions = await this.commitTerminalBatch(() => true, "stale")
      for (const resolution of resolutions) this.settleEntry(resolution)
    })
    this.shutdownPromise = (async () => {
      let terminalError: unknown
      let terminalFailed = false
      try {
        try {
          await terminal
        } catch (error) {
          terminalFailed = true
          terminalError = error
        }
        while (this.pendingEffects.size > 0) {
          await Promise.allSettled([...this.pendingEffects])
        }
      } finally {
        this.runtimeStore.off("event", this.handleRuntimeEvent)
        this.cancelAllTerminalRetries()
        for (const entry of this.entriesById.values()) this.detachEntryEffects(entry)
        this.entriesById.clear()
        this.idempotency.clear()
        this.ownerQueues.clear()
        this.hubSessionClosures.clear()
        this.activeHubSessions.clear()
        this.pendingEffects.clear()
      }
      if (terminalFailed) throw terminalError
    })()
    return this.shutdownPromise
  }

  private enqueueOperation<T>(operation: () => Promise<T> | T): Promise<T> {
    const queued = this.operationTail.then(operation)
    this.operationTail = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }

  private startTerminalRetry(key: string, operation: () => Promise<unknown>): void {
    if (this.closed || this.terminalRetries.has(key)) return
    const task: TerminalRetryTask = { attempt: 0, timer: null, operation }
    this.terminalRetries.set(key, task)

    const run = (): void => {
      if (this.closed || this.terminalRetries.get(key) !== task) {
        this.cancelTerminalRetry(key)
        return
      }
      task.timer = null
      task.attempt += 1
      void this.enqueueOperation(task.operation).then(
        () => this.cancelTerminalRetry(key),
        () => {
          if (
            this.closed ||
            this.terminalRetries.get(key) !== task ||
            task.attempt >= TERMINAL_RETRY_MAX_ATTEMPTS
          ) {
            this.cancelTerminalRetry(key)
            return
          }
          const delay = TERMINAL_RETRY_BASE_DELAY_MS * (2 ** (task.attempt - 1))
          task.timer = setTimeout(run, delay)
        }
      )
    }

    run()
  }

  private cancelTerminalRetry(key: string): void {
    const task = this.terminalRetries.get(key)
    if (!task) return
    if (task.timer) clearTimeout(task.timer)
    task.timer = null
    this.terminalRetries.delete(key)
  }

  private cancelAllTerminalRetries(): void {
    for (const key of [...this.terminalRetries.keys()]) this.cancelTerminalRetry(key)
  }

  private registerRememberEffect(
    callback: (resolution: DecisionResolution) => Promise<void>,
    resolution: DecisionResolution
  ): Promise<DecisionResolveResult> {
    const outcome = Promise.resolve()
      .then(() => callback(clone(resolution)))
      .then<DecisionResolveResult, DecisionResolveResult>(
        () => ({ accepted: true }),
        () => ({ accepted: true, warning: "remember_failed" })
      )
    const tracked = outcome.then(result => {
      this.pendingEffects.delete(tracked)
      return result
    })
    this.pendingEffects.add(tracked)
    return tracked
  }

  private validateOwner(request: DecisionRequest): Error | null {
    if (request.owner.type === "hub") return null
    const turn = this.runtimeStore.getTurn(request.owner.turnId)
    const thread = this.runtimeStore.getThread(request.owner.threadId)
    if (!turn || !thread || turn.threadId !== request.owner.threadId) {
      return new Error("Decision owner Turn does not exist")
    }
    if (thread.workspaceId !== request.owner.workspaceId) {
      return new Error("Decision owner workspace does not match")
    }
    if (
      turn.ownerWebContentsId !== undefined &&
      turn.ownerWebContentsId !== request.owner.webContentsId
    ) {
      return new Error("Decision owner sender does not match")
    }
    if (isTerminalTurnStatus(turn.status)) return new Error("Decision owner Turn is terminal")
    return null
  }

  private decisionUniverse(): Array<{ request: DecisionRequest; state: string }> {
    const records = new Map<string, { request: DecisionRequest; state: string }>(
      this.runtimeStore.listDurableDecisions().map(record => [record.request.id, {
        request: record.request,
        state: record.state
      }])
    )
    for (const entry of this.entriesById.values()) {
      if (!records.has(entry.request.id)) {
        records.set(entry.request.id, {
          request: entry.request,
          state: entry.settled ? "terminal" : "provisional"
        })
      }
    }
    return [...records.values()]
  }

  private validateLimits(request: DecisionRequest): Error | null {
    const universe = this.decisionUniverse()
    const processUnresolved = universe.filter(unresolved).length
    if (processUnresolved >= DECISION_SERVICE_LIMITS.unresolvedProcess) {
      return new Error(`Decision process allows at most ${DECISION_SERVICE_LIMITS.unresolvedProcess} unresolved decisions`)
    }
    if (request.owner.type !== "turn") return null
    const turnId = request.owner.turnId
    const sameTurn = universe.filter(candidate => (
      candidate.request.owner.type === "turn" &&
      candidate.request.owner.turnId === turnId
    ))
    if (sameTurn.filter(unresolved).length >= DECISION_SERVICE_LIMITS.unresolvedPerTurn) {
      return new Error(`Decision Turn allows at most ${DECISION_SERVICE_LIMITS.unresolvedPerTurn} unresolved decisions`)
    }
    if (sameTurn.length >= DECISION_SERVICE_LIMITS.createdPerTurn) {
      return new Error(`Decision Turn allows at most ${DECISION_SERVICE_LIMITS.createdPerTurn} created decisions`)
    }
    if (
      request.source === "agent" &&
      sameTurn.filter(candidate => candidate.request.source === "agent").length >= DECISION_SERVICE_LIMITS.agentCreatedPerTurn
    ) {
      return new Error(`Decision Turn allows at most ${DECISION_SERVICE_LIMITS.agentCreatedPerTurn} Agent-created decisions`)
    }
    return null
  }

  private async persistRequest(entry: DecisionEntry): Promise<void> {
    if (this.closed) throw new Error("DecisionService is closed")
    const persisted = await this.runtimeStore.commitRuntimeMutation(tx => {
      const existing = tx.listDecisions().find(record => record.request.id === entry.request.id)
      if (existing) return existing
      if (entry.request.owner.type === "turn") {
        const turn = tx.getTurn(entry.request.owner.turnId)
        if (!turn || isTerminalTurnStatus(turn.status)) {
          throw new Error("Decision owner Turn is terminal")
        }
      }
      const key = ownerKey(entry.request)
      const hasActive = tx.listDecisions().some(record => (
        unresolved(record) &&
        ownerKey(record.request) === key &&
        (record.state === "active" || record.state === "resolving")
      ))
      const now = Date.now()
      const record = hasActive
        ? { request: entry.request, state: "queued" as const }
        : {
            request: entry.request,
            state: "active" as const,
            activatedAt: now,
            expiresAt: entry.request.deadlineMs === undefined ? undefined : now + entry.request.deadlineMs
          }
      tx.upsertDecision(record)
      if (entry.request.owner.type === "turn") {
        tx.setTurnStatus(entry.request.owner.turnId, "awaiting-decision", {
          requestId: entry.request.id
        })
        tx.appendEvent(
          entry.request.owner.threadId,
          entry.request.owner.turnId,
          "decision:requested",
          entry.request.metadata?.agentId,
          requestAudit(entry.request, record.state)
        )
      }
      return record
    })
    entry.visible = true
    const onAdmitted = entry.onAdmitted
    entry.onAdmitted = undefined
    try { onAdmitted?.(clone(entry.request)) } catch { /* admission is already durable */ }
    if (persisted.state === "terminal" && persisted.resolution) {
      this.settleEntry(persisted.resolution)
      return
    }
    this.attachAbort(entry)
    if (persisted.state === "active") this.startTimerForEntry(entry, persisted.expiresAt)
  }

  private async commitTerminal(
    requestId: string,
    status: DecisionResolution["status"],
    details: Pick<DecisionResolution, "selectedOptionIds" | "text"> = {}
  ): Promise<TerminalCommitResult | null> {
    const result = await this.runtimeStore.commitRuntimeMutation(tx => {
      const decisions = tx.listDecisions()
      const current = decisions.find(record => record.request.id === requestId)
      if (!current || !unresolved(current)) return null
      const resolution: DecisionResolution = {
        requestId,
        status,
        selectedOptionIds: details.selectedOptionIds ? clone(details.selectedOptionIds) : undefined,
        text: details.text,
        resolvedAt: Date.now()
      }
      tx.upsertDecision({ ...current, state: "terminal", resolution })

      const key = ownerKey(current.request)
      const remaining = decisions.filter(record => (
        record.request.id !== requestId &&
        unresolved(record) &&
        ownerKey(record.request) === key
      ))
      let promotedRequestId: string | undefined
      if (
        (current.state === "active" || current.state === "resolving") &&
        !remaining.some(record => record.state === "active" || record.state === "resolving")
      ) {
        const queued = remaining.filter(record => record.state === "queued")
        const admissionOrder = this.ownerQueues.get(key) ?? []
        const next = admissionOrder
          .map(id => queued.find(record => record.request.id === id))
          .find((record): record is NonNullable<typeof record> => record !== undefined)
          ?? queued[0]
        if (next) {
          const activatedAt = Date.now()
          const promoted = {
            ...next,
            state: "active" as const,
            activatedAt,
            expiresAt: next.request.deadlineMs === undefined
              ? undefined
              : activatedAt + next.request.deadlineMs
          }
          tx.upsertDecision(promoted)
          promotedRequestId = next.request.id
        }
      }

      if (current.request.owner.type === "turn") {
        const turn = tx.getTurn(current.request.owner.turnId)
        if (turn && !isTerminalTurnStatus(turn.status)) {
          tx.setTurnStatus(
            turn.id,
            remaining.length > 0 ? "awaiting-decision" : "running",
            { requestId, decisionStatus: status }
          )
        }
        tx.appendEvent(
          current.request.owner.threadId,
          current.request.owner.turnId,
          "decision:resolved",
          current.request.metadata?.agentId,
          resolutionAudit(current.request, status)
        )
      }
      return { resolution, promotedRequestId }
    })

    if (!result) return null
    this.settleEntry(result.resolution)
    if (result.promotedRequestId) this.activatePromoted(result.promotedRequestId)
    return result
  }

  private async commitTerminalBatch(
    predicate: (record: { request: DecisionRequest; state: string }) => boolean,
    status: DecisionResolution["status"],
    cancelledTurnId?: string
  ): Promise<DecisionResolution[]> {
    return this.runtimeStore.commitRuntimeMutation(tx => {
      const decisions = tx.listDecisions()
      const resolutions: DecisionResolution[] = []
      for (const record of decisions) {
        if (!unresolved(record) || !predicate(record)) continue
        const resolution: DecisionResolution = {
          requestId: record.request.id,
          status,
          resolvedAt: Date.now()
        }
        resolutions.push(resolution)
        tx.upsertDecision({ ...record, state: "terminal", resolution })
        if (record.request.owner.type === "turn") {
          tx.appendEvent(
            record.request.owner.threadId,
            record.request.owner.turnId,
            "decision:resolved",
            record.request.metadata?.agentId,
            resolutionAudit(record.request, status)
          )
        }
      }

      const affectedTurnIds = new Set(resolutions.map(resolution => {
        const record = decisions.find(candidate => candidate.request.id === resolution.requestId)
        return record?.request.owner.type === "turn" ? record.request.owner.turnId : undefined
      }).filter((turnId): turnId is string => turnId !== undefined))
      if (cancelledTurnId) affectedTurnIds.add(cancelledTurnId)
      for (const turnId of affectedTurnIds) {
        const turn = tx.getTurn(turnId)
        if (!turn) continue
        if (cancelledTurnId === turnId) {
          if (!isTerminalTurnStatus(turn.status)) {
            tx.setTurnStatus(turnId, "cancelled", { reason: "Decision cancelled" })
          }
        } else if (!isTerminalTurnStatus(turn.status) && turn.status === "awaiting-decision") {
          tx.setTurnStatus(turnId, "running", { decisionStatus: status })
        }
      }
      return resolutions
    })
  }

  private settleEntry(resolution: DecisionResolution): void {
    const entry = this.entriesById.get(resolution.requestId)
    if (!entry || entry.settled) return
    entry.settled = true
    entry.resolving = false
    this.detachEntryEffects(entry)
    const key = ownerKey(entry.request)
    const queue = this.ownerQueues.get(key)?.filter(id => id !== entry.request.id) ?? []
    if (queue.length > 0) this.ownerQueues.set(key, queue)
    else this.ownerQueues.delete(key)
    entry.resolve(clone(resolution))
  }

  private activatePromoted(requestId: string): void {
    const entry = this.entriesById.get(requestId)
    if (!entry || entry.settled) return
    const record = this.runtimeStore.listDurableDecisions()
      .find(candidate => candidate.request.id === requestId)
    if (record?.state === "active") this.startTimerForEntry(entry, record.expiresAt)
  }

  private startTimerForEntry(entry: DecisionEntry, expiresAt?: number): void {
    if (entry.settled || !entry.visible) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    const record = this.runtimeStore.listDurableDecisions()
      .find(candidate => candidate.request.id === entry.request.id)
    const deadline = expiresAt ?? record?.expiresAt
    if (record?.state !== "active" || deadline === undefined) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      this.startTerminalRetry(
        `request:${entry.request.id}`,
        () => this.commitTerminal(entry.request.id, "timeout")
      )
    }, Math.max(0, deadline - Date.now()))
  }

  private attachAbort(entry: DecisionEntry): void {
    if (!entry.signal || entry.abortListener) return
    const abort = (): void => {
      this.startTerminalRetry(
        `request:${entry.request.id}`,
        () => this.commitTerminal(entry.request.id, "cancelled")
      )
    }
    entry.abortListener = abort
    entry.signal.addEventListener("abort", abort, { once: true })
    if (entry.signal.aborted) abort()
  }

  private detachEntryEffects(entry: DecisionEntry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    if (entry.signal && entry.abortListener) {
      entry.signal.removeEventListener("abort", entry.abortListener)
    }
    entry.abortListener = undefined
    this.cancelTerminalRetry(`request:${entry.request.id}`)
  }

  private removeFailedEntry(entry: DecisionEntry): void {
    this.detachEntryEffects(entry)
    this.entriesById.delete(entry.request.id)
    const key = ownerKey(entry.request)
    if (entry.request.idempotencyKey) {
      const idempotencyKey = `${key}:${entry.request.idempotencyKey}`
      if (this.idempotency.get(idempotencyKey) === entry) this.idempotency.delete(idempotencyKey)
    }
    const queue = this.ownerQueues.get(key)?.filter(id => id !== entry.request.id) ?? []
    if (queue.length > 0) this.ownerQueues.set(key, queue)
    else this.ownerQueues.delete(key)
  }

  private isActiveHead(entry: DecisionEntry): boolean {
    const record = this.runtimeStore.listDurableDecisions()
      .find(candidate => candidate.request.id === entry.request.id)
    return record?.state === "active"
  }

  private senderMatches(request: DecisionRequest, sender: DecisionSender): boolean {
    if (request.owner.type === "hub") {
      return "sessionId" in sender && request.owner.sessionId === sender.sessionId
    }
    return "webContentsId" in sender &&
      request.owner.webContentsId === sender.webContentsId &&
      request.owner.workspaceId === sender.workspaceId
  }

  private validateSubmission(request: DecisionRequest, submission: DecisionSubmission): boolean {
    if (!submission || submission.requestId !== request.id) return false
    const selected = submission.selectedOptionIds
    const custom = submission.customText
    const permission = request.source === "tool" || request.source === "guard" || request.source === "acp"
    if (submission.remember === true && !request.allowRemember) return false
    if (submission.outcome === "denied" || submission.outcome === "cancelled") {
      return selected === undefined && custom === undefined && submission.remember !== true
    }
    if (submission.outcome === "submitted") {
      return !permission &&
        request.allowCustom &&
        selected === undefined &&
        typeof custom === "string" &&
        custom.length <= (request.customInput?.maxChars ?? 0) &&
        submission.remember !== true
    }
    if (submission.outcome !== "selected" || custom !== undefined || !Array.isArray(selected)) return false
    if (selected.some(id => typeof id !== "string") || new Set(selected).size !== selected.length) return false
    const authoritative = new Set(request.options.map(option => option.id))
    if (selected.some(id => !authoritative.has(id))) return false
    return selected.length >= request.minSelections && selected.length <= request.maxSelections
  }

  private cleanupTerminalTurn(turnId: string): void {
    for (const [id, entry] of this.entriesById) {
      if (entry.request.owner.type !== "turn" || entry.request.owner.turnId !== turnId || !entry.settled) continue
      this.entriesById.delete(id)
      if (entry.request.idempotencyKey) {
        this.idempotency.delete(`${ownerKey(entry.request)}:${entry.request.idempotencyKey}`)
      }
    }
  }

  private cleanupHubSession(sessionId: string): void {
    for (const [id, entry] of this.entriesById) {
      if (entry.request.owner.type !== "hub" || entry.request.owner.sessionId !== sessionId) continue
      this.detachEntryEffects(entry)
      this.entriesById.delete(id)
      if (entry.request.idempotencyKey) {
        this.idempotency.delete(`${ownerKey(entry.request)}:${entry.request.idempotencyKey}`)
      }
    }
    this.ownerQueues.delete(`hub:${sessionId}`)
  }

  private readonly handleRuntimeEvent = (event: RuntimeEvent): void => {
    if (event.kind !== "turn:status" || !isTerminalTurnStatus(event.payload?.status)) return
    this.cleanupTerminalTurn(event.turnId)
    const hasUnresolved = [...this.entriesById.values()].some(entry => (
      entry.request.owner.type === "turn" &&
      entry.request.owner.turnId === event.turnId &&
      !entry.settled
    ))
    if (!hasUnresolved) return
    this.startTerminalRetry(`turn:${event.turnId}`, async () => {
      const resolutions = await this.commitTerminalBatch(
        record => record.request.owner.type === "turn" && record.request.owner.turnId === event.turnId,
        "cancelled"
      )
      for (const resolution of resolutions) this.settleEntry(resolution)
      this.cleanupTerminalTurn(event.turnId)
    })
  }
}
