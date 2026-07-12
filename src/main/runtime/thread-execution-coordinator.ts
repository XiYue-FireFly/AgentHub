import type { TurnCreateInputLike, TurnRetryInputLike, TurnRetryStrategyLike } from '../../shared/ipc-contract'
import { isTerminalTurnStatus, type WorkbenchTurnStatus } from '../../shared/turn-status'
import { createLogger } from '../logger'
import type { QueuedThreadSubmission, WorkbenchThread, WorkbenchTurn } from './types'

const log = createLogger('ThreadExecutionCoordinator')

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/[A-Z]:\\[^\s]+/gi, '<path>')
    .replace(/\/home\/[^\s]+/g, '<path>')
}

type QueuedSubmissionCreate = {
  payload: TurnCreateInputLike
  ownerWebContentsId: number
  source: 'create' | 'retry'
  retryOfTurnId?: string
  retryStrategy?: TurnRetryStrategyLike
}

type QueuedRetrySubmissionCreate = QueuedSubmissionCreate & {
  source: 'retry'
  retryOfTurnId: string
}

type TurnCreateResult = {
  thread: WorkbenchThread
  turn: WorkbenchTurn
}

type MutationPort = {
  getTurn(turnId: string): WorkbenchTurn | undefined
  listTurns(): WorkbenchTurn[]
  listSubmissions(): QueuedThreadSubmission[]
  isThreadDeleting(threadId: string): boolean
  setTurnStatus(turnId: string, status: WorkbenchTurnStatus, payload?: Record<string, unknown>): void
  upsertSubmission(submission: QueuedThreadSubmission): void
  removeSubmission(submissionId: string): void
}

export interface ThreadExecutionRuntimeStore {
  createQueuedSubmission(input: QueuedSubmissionCreate): Promise<{
    thread: WorkbenchThread
    turn: WorkbenchTurn
    submission: QueuedThreadSubmission
  }>
  findOrCreateQueuedRetry(input: QueuedRetrySubmissionCreate): Promise<{
    thread: WorkbenchThread
    turn: WorkbenchTurn
    created: boolean
  }>
  getThread(threadId: string): WorkbenchThread | undefined
  getTurn(turnId: string): WorkbenchTurn | undefined
  listQueuedSubmissions(threadId?: string): QueuedThreadSubmission[]
  commitRuntimeMutation<T>(mutate: (tx: MutationPort) => T): Promise<T>
  cancelTurn(turnId: string, payload?: Record<string, unknown>): Promise<boolean>
  interruptTurn(turnId: string, payload?: Record<string, unknown>): Promise<boolean>
  on?(event: 'event', listener: (event: unknown) => void): unknown
  off?(event: 'event', listener: (event: unknown) => void): unknown
}

export interface WorkbenchTurnRunnerPort {
  start(submission: QueuedThreadSubmission): void | Promise<void>
  cancel(turnId: string): void | Promise<void>
  abort?(turnId: string, reason?: unknown): void | Promise<void>
}

export interface ThreadExecutionCoordinatorOptions {
  runtimeStore: ThreadExecutionRuntimeStore
  runner: WorkbenchTurnRunnerPort
}

/**
 * Serializes durable Workbench submissions per thread. A durable submission is
 * the source of truth: it is marked starting (and its Turn running) before
 * execution is handed to the runner, and is discarded only after settlement.
 */
export class ThreadExecutionCoordinator {
  private readonly draining = new Map<string, Promise<void>>()
  private readonly deferredDrainCounts = new Map<string, number>()
  private readonly retryingNormal = new Map<string, Map<TurnRetryStrategyLike, Promise<TurnCreateResult>>>()
  private readonly rerunningInterrupted = new Map<string, Promise<TurnCreateResult>>()
  private readonly eventListener: (event: unknown) => void

  constructor(
    private readonly options: ThreadExecutionCoordinatorOptions
  ) {
    this.eventListener = event => {
      const candidate = event as { kind?: string; turnId?: string; payload?: { status?: WorkbenchTurnStatus } }
      if (candidate.kind !== 'turn:status' || !candidate.turnId || !isTerminalTurnStatus(candidate.payload?.status as WorkbenchTurnStatus)) {
        return
      }
      void this.onTurnStatus(candidate.turnId, candidate.payload!.status!).catch(error => {
        log.error('Failed to process terminal Turn status:', sanitizeError(error))
      })
    }
    this.options.runtimeStore.on?.('event', this.eventListener)
  }

  dispose(): void {
    this.options.runtimeStore.off?.('event', this.eventListener)
  }

  async enqueueCreate(
    payload: TurnCreateInputLike,
    senderId: number
  ): Promise<TurnCreateResult> {
    return this.enqueue({ payload, ownerWebContentsId: senderId, source: 'create' })
  }

  async enqueueRetry(
    input: TurnRetryInputLike,
    senderId: number
  ): Promise<TurnCreateResult> {
    const original = this.options.runtimeStore.getTurn(input.turnId)
    if (!original) throw new Error(`Turn not found: ${input.turnId}`)
    if (!isTerminalTurnStatus(original.status) || original.status === 'interrupted') {
      throw new Error('Only completed, failed, or cancelled turns can be retried')
    }
    if (original.ownerWebContentsId !== undefined && original.ownerWebContentsId !== senderId) {
      throw new Error('Turn is owned by another window')
    }
    const thread = this.options.runtimeStore.getThread(original.threadId)
    if (!thread) throw new Error(`Thread not found: ${original.threadId}`)

    const retryStrategy = input.retryStrategy === 'reoptimize' ? 'reoptimize' : 'reuse-selection'
    const retryingStrategies = this.retryingNormal.get(original.id)
    const inFlight = retryingStrategies?.get(retryStrategy)
    if (inFlight) return inFlight
    const retry = this.findOrCreateNormalRetry(
      original,
      thread,
      senderId,
      retryStrategy
    )
    const activeRetries = retryingStrategies ?? new Map<TurnRetryStrategyLike, Promise<TurnCreateResult>>()
    if (!retryingStrategies) this.retryingNormal.set(original.id, activeRetries)
    activeRetries.set(retryStrategy, retry)
    try {
      return await retry
    } finally {
      if (activeRetries.get(retryStrategy) === retry) {
        activeRetries.delete(retryStrategy)
        if (activeRetries.size === 0 && this.retryingNormal.get(original.id) === activeRetries) {
          this.retryingNormal.delete(original.id)
        }
      }
    }
  }

  async rerunInterruptedTurn(
    originalTurnId: string,
    senderId: number,
    retryStrategy: TurnRetryStrategyLike = 'reuse-selection'
  ): Promise<TurnCreateResult> {
    const original = this.options.runtimeStore.getTurn(originalTurnId)
    if (!original) throw new Error(`Turn not found: ${originalTurnId}`)
    if (original.status !== 'interrupted') {
      throw new Error('Only interrupted turns can be rerun')
    }
    if (original.ownerWebContentsId !== undefined && original.ownerWebContentsId !== senderId) {
      throw new Error('Turn is owned by another window')
    }
    const thread = this.options.runtimeStore.getThread(original.threadId)
    if (!thread) throw new Error(`Thread not found: ${original.threadId}`)

    const inFlight = this.rerunningInterrupted.get(original.id)
    if (inFlight) return inFlight
    const rerun = this.findOrCreateInterruptedRetry(original, thread, senderId, retryStrategy)
    this.rerunningInterrupted.set(original.id, rerun)
    try {
      return await rerun
    } finally {
      if (this.rerunningInterrupted.get(original.id) === rerun) {
        this.rerunningInterrupted.delete(original.id)
      }
    }
  }

  async onTurnStatus(turnId: string, status: WorkbenchTurnStatus): Promise<void> {
    if (!isTerminalTurnStatus(status)) return
    const threadId = await this.options.runtimeStore.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(turnId)
      if (!turn) return undefined
      for (const submission of tx.listSubmissions()) {
        if (submission.turnId === turnId) tx.removeSubmission(submission.id)
      }
      return turn.threadId
    })
    if (threadId && !this.isDrainDeferred(threadId)) await this.drain(threadId)
  }

  /**
   * Prevents a terminal DecisionService event from starting a tail while the
   * IPC cancellation flow is still cancelling the dispatcher. This is not a
   * cancellation itself; it only preserves the required side-effect order.
   */
  async beginTurnCancellation(turnId: string): Promise<void> {
    const turn = this.options.runtimeStore.getTurn(turnId)
    if (!turn) return
    this.deferredDrainCounts.set(turn.threadId, (this.deferredDrainCounts.get(turn.threadId) ?? 0) + 1)
  }

  async finishTurnCancellation(turnId: string): Promise<void> {
    const turn = this.options.runtimeStore.getTurn(turnId)
    if (!turn) return
    const count = this.deferredDrainCounts.get(turn.threadId) ?? 0
    if (count <= 1) {
      this.deferredDrainCounts.delete(turn.threadId)
      await this.drain(turn.threadId)
      return
    }
    this.deferredDrainCounts.set(turn.threadId, count - 1)
  }

  async abortTurnExecution(turnId: string, reason: unknown = 'Turn cancelled'): Promise<void> {
    await this.options.runner.abort?.(turnId, reason)
  }

  async cancelTurn(
    turnId: string,
    options: { runnerAlreadyCancelled?: boolean } = {}
  ): Promise<boolean> {
    const turn = this.options.runtimeStore.getTurn(turnId)
    if (!turn) return false
    if (!options.runnerAlreadyCancelled) await this.options.runner.cancel(turnId)
    const cancelled = await this.options.runtimeStore.cancelTurn(turnId, { reason: 'Cancelled by user.' })
    await this.onTurnStatus(turnId, 'cancelled')
    return cancelled
  }

  async clearQueue(threadId: string): Promise<string[]> {
    const removed = await this.options.runtimeStore.commitRuntimeMutation(tx => {
      const removedTurnIds: string[] = []
      for (const submission of tx.listSubmissions()) {
        if (submission.threadId !== threadId || submission.state !== 'queued') continue
        const turn = tx.getTurn(submission.turnId)
        if (turn && turn.status === 'queued') {
          tx.setTurnStatus(turn.id, 'cancelled', { reason: 'Removed from queue.' })
        }
        tx.removeSubmission(submission.id)
        removedTurnIds.push(submission.turnId)
      }
      return removedTurnIds
    })
    await this.drain(threadId)
    return removed
  }

  /**
   * Startup recovery never replays a submission that might have crossed the
   * start boundary. It interrupts and removes every persisted starting head,
   * then resumes only its still-queued tail.
   */
  async recover(): Promise<void> {
    const recoveredThreadIds = await this.options.runtimeStore.commitRuntimeMutation(tx => {
      const threadIds = new Set<string>()
      for (const submission of tx.listSubmissions()) {
        if (submission.state === 'queued') threadIds.add(submission.threadId)
        if (submission.state === 'starting') {
          const turn = tx.getTurn(submission.turnId)
          if (turn && !isTerminalTurnStatus(turn.status)) {
            tx.setTurnStatus(turn.id, 'interrupted', { reason: 'Recovered after application restart.' })
          }
          tx.removeSubmission(submission.id)
          threadIds.add(submission.threadId)
        }
      }
      return [...threadIds]
    })
    for (const threadId of recoveredThreadIds) await this.drain(threadId)
  }

  private async findOrCreateInterruptedRetry(
    original: WorkbenchTurn,
    thread: WorkbenchThread,
    senderId: number,
    retryStrategy: TurnRetryStrategyLike
  ): Promise<TurnCreateResult> {
    const existing = await this.options.runtimeStore.commitRuntimeMutation(tx => {
      const retry = tx.listTurns().find(candidate => candidate.retryOfTurnId === original.id)
      if (!retry) return null
      if (retry.threadId !== thread.id || retry.ownerWebContentsId !== senderId) {
        throw new Error('Retry turn ownership does not match the interrupted turn')
      }
      return retry
    })
    if (existing) return { thread, turn: existing }

    return this.enqueueRetryFromOriginal(original, thread, senderId, retryStrategy)
  }

  private async findOrCreateNormalRetry(
    original: WorkbenchTurn,
    thread: WorkbenchThread,
    senderId: number,
    retryStrategy: TurnRetryStrategyLike
  ): Promise<TurnCreateResult> {
    const retry = await this.options.runtimeStore.findOrCreateQueuedRetry(
      this.retrySubmissionInput(original, thread, senderId, retryStrategy)
    )
    await this.drain(retry.thread.id)
    return { thread: retry.thread, turn: retry.turn }
  }

  private async enqueueRetryFromOriginal(
    original: WorkbenchTurn,
    thread: WorkbenchThread,
    senderId: number,
    retryStrategy: TurnRetryStrategyLike
  ): Promise<TurnCreateResult> {
    // Do not revive derived context, turn events, or any decision state. The
    // retry payload is deliberately reconstructed from the original input.
    return this.enqueue(this.retrySubmissionInput(original, thread, senderId, retryStrategy))
  }

  private retrySubmissionInput(
    original: WorkbenchTurn,
    thread: WorkbenchThread,
    senderId: number,
    retryStrategy: TurnRetryStrategyLike
  ): QueuedRetrySubmissionCreate {
    return {
      ownerWebContentsId: senderId,
      source: 'retry',
      retryOfTurnId: original.id,
      retryStrategy,
      payload: {
        threadId: thread.id,
        workspaceId: thread.workspaceId,
        prompt: original.displayOriginalPrompt || original.prompt,
        mode: original.mode,
        targetAgent: original.targetAgent ?? null,
        modelSelection: original.modelSelection,
        attachments: original.attachments ?? [],
        customSchedule: original.customSchedule,
        multiModelFusion: original.multiModelFusion
      }
    }
  }

  private async enqueue(input: QueuedSubmissionCreate): Promise<TurnCreateResult> {
    const created = await this.options.runtimeStore.createQueuedSubmission(input)
    // Acknowledge only after the combined thread/turn/submission commit, but
    // do not wait for a potentially long-running execution to settle.
    await this.drain(created.thread.id)
    return { thread: created.thread, turn: created.turn }
  }

  private async drain(threadId: string): Promise<void> {
    if (this.isDrainDeferred(threadId)) return
    const existing = this.draining.get(threadId)
    if (existing) return existing
    const current = this.drainThread(threadId).finally(() => {
      if (this.draining.get(threadId) === current) this.draining.delete(threadId)
    })
    this.draining.set(threadId, current)
    return current
  }

  private async drainThread(threadId: string): Promise<void> {
    if (this.isDrainDeferred(threadId)) return
    const submission = await this.options.runtimeStore.commitRuntimeMutation(tx => {
      if (this.isDrainDeferred(threadId)) return undefined
      if (tx.isThreadDeleting(threadId)) return undefined
      const candidates = tx.listSubmissions()
        .filter(candidate => candidate.threadId === threadId)
        .sort((left, right) => left.admissionSequence - right.admissionSequence)
      if (candidates.some(candidate => candidate.state === 'starting')) return undefined
      let queued: QueuedThreadSubmission | undefined
      for (const candidate of candidates) {
        if (candidate.state !== 'queued') continue
        const candidateTurn = tx.getTurn(candidate.turnId)
        if (candidateTurn?.status === 'queued') {
          queued = candidate
          break
        }
        // A terminal or otherwise inconsistent Turn must never be revived by
        // the durable queue. Remove its stale submission before considering
        // the following admission.
        tx.removeSubmission(candidate.id)
      }
      if (!queued) return undefined

      const hasActiveTurn = tx.listTurns().some(turn => (
        turn.threadId === threadId
        && turn.status !== 'queued'
        && !isTerminalTurnStatus(turn.status)
      ))
      if (hasActiveTurn) return undefined

      const starting = { ...queued, state: 'starting' as const }
      tx.upsertSubmission(starting)
      tx.setTurnStatus(starting.turnId, 'running')
      return starting
    })
    if (!submission) return

    try {
      void Promise.resolve(this.options.runner.start(submission))
        .catch(error => this.handleRunnerStartFailure(submission, error))
        .catch(error => {
          log.error('Failed to persist runner-start failure:', sanitizeError(error))
        })
    } catch (error) {
      await this.handleRunnerStartFailure(submission, error)
    }
  }

  private async handleRunnerStartFailure(submission: QueuedThreadSubmission, error: unknown): Promise<void> {
    await this.options.runtimeStore.commitRuntimeMutation(tx => {
      const turn = tx.getTurn(submission.turnId)
      if (turn && !isTerminalTurnStatus(turn.status)) {
        tx.setTurnStatus(turn.id, 'failed', { error: sanitizeError(error) })
      }
    })
    await this.onTurnStatus(submission.turnId, 'failed')
  }

  private isDrainDeferred(threadId: string): boolean {
    return (this.deferredDrainCounts.get(threadId) ?? 0) > 0
  }
}
