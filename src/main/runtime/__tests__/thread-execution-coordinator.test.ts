import { describe, expect, it, vi } from 'vitest'
import { ThreadExecutionCoordinator } from '../thread-execution-coordinator'
import type { QueuedThreadSubmission, WorkbenchThread, WorkbenchTurn, WorkbenchTurnStatus } from '../types'
import type { TurnCreateInputLike } from '../../../shared/ipc-contract'
import { isTerminalTurnStatus } from '../../../shared/turn-status'

type CreatePayload = TurnCreateInputLike

class RuntimeStoreDouble {
  readonly threads: WorkbenchThread[] = []
  readonly turns: WorkbenchTurn[] = []
  readonly submissions: QueuedThreadSubmission[] = []
  readonly deletingThreadIds = new Set<string>()
  private sequence = 0
  private readonly listeners = new Set<(event: unknown) => void>()
  readonly statusPayloads: Array<Record<string, unknown> | undefined> = []
  failNextMutation: Error | null = null
  createdAt = 0

  async createQueuedSubmission(input: {
    payload: CreatePayload
    ownerWebContentsId: number
    source: 'create' | 'retry'
    retryOfTurnId?: string
    retryStrategy?: 'reuse-selection' | 'reoptimize'
  }): Promise<{ thread: WorkbenchThread; turn: WorkbenchTurn; submission: QueuedThreadSubmission }> {
    const thread = input.payload.threadId
      ? this.threads.find(candidate => candidate.id === input.payload.threadId)!
      : {
          id: `thread-${++this.sequence}`,
          workspaceId: input.payload.workspaceId ?? null,
          title: input.payload.prompt,
          createdAt: this.sequence,
          updatedAt: this.sequence
        }
    if (!this.threads.includes(thread)) this.threads.push(thread)
    const turn: WorkbenchTurn = {
      id: `turn-${++this.sequence}`,
      threadId: thread.id,
      prompt: input.payload.prompt,
      attachments: input.payload.attachments,
      mode: input.payload.mode || 'auto',
      customSchedule: input.payload.customSchedule,
      multiModelFusion: input.payload.multiModelFusion,
      targetAgent: input.payload.targetAgent,
      modelSelection: input.payload.modelSelection,
      thinking: input.payload.thinking,
      retryOfTurnId: input.retryOfTurnId,
      status: 'queued',
      taskIds: [],
      ownerWebContentsId: input.ownerWebContentsId,
      createdAt: this.sequence
    }
    const submission: QueuedThreadSubmission = {
      id: `submission-${this.sequence}`,
      threadId: thread.id,
      turnId: turn.id,
      ownerWebContentsId: input.ownerWebContentsId,
      input: structuredClone({ ...input.payload, threadId: thread.id, workspaceId: thread.workspaceId }),
      source: input.source,
      retryOfTurnId: input.retryOfTurnId,
      retryStrategy: input.source === 'retry' ? input.retryStrategy ?? 'reuse-selection' : undefined,
      state: 'queued',
      createdAt: this.createdAt || this.sequence,
      admissionSequence: this.sequence
    }
    this.turns.push(turn)
    this.submissions.push(submission)
    return structuredClone({ thread, turn, submission })
  }

  async findOrCreateQueuedRetry(input: {
    payload: CreatePayload
    ownerWebContentsId: number
    source: 'retry'
    retryOfTurnId: string
    retryStrategy?: 'reuse-selection' | 'reoptimize'
  }): Promise<{ thread: WorkbenchThread; turn: WorkbenchTurn; created: boolean }> {
    const retryStrategy = input.retryStrategy === 'reoptimize' ? 'reoptimize' : 'reuse-selection'
    const existing = this.turns.find(turn => (
      turn.retryOfTurnId === input.retryOfTurnId
      && !isTerminalTurnStatus(turn.status)
      && (this.submissions.find(submission => submission.turnId === turn.id)?.retryStrategy ?? 'reuse-selection') === retryStrategy
    ))
    if (existing) {
      if (existing.ownerWebContentsId !== input.ownerWebContentsId) {
        throw new Error('Retry turn ownership does not match the original turn')
      }
      return {
        thread: structuredClone(this.threads.find(thread => thread.id === existing.threadId)!),
        turn: structuredClone(existing),
        created: false
      }
    }
    const created = await this.createQueuedSubmission({ ...input, retryStrategy })
    return { thread: created.thread, turn: created.turn, created: true }
  }

  getThread(threadId: string): WorkbenchThread | undefined {
    const thread = this.threads.find(candidate => candidate.id === threadId)
    return thread && structuredClone(thread)
  }

  getTurn(turnId: string): WorkbenchTurn | undefined {
    const turn = this.turns.find(candidate => candidate.id === turnId)
    return turn && structuredClone(turn)
  }

  listQueuedSubmissions(threadId?: string): QueuedThreadSubmission[] {
    return structuredClone(this.submissions.filter(submission => threadId === undefined || submission.threadId === threadId))
  }

  async commitRuntimeMutation<T>(mutate: (tx: any) => T): Promise<T> {
    if (this.failNextMutation) {
      const error = this.failNextMutation
      this.failNextMutation = null
      throw error
    }
    return mutate({
      getTurn: (turnId: string) => this.getTurn(turnId),
      listTurns: () => structuredClone(this.turns),
      listSubmissions: () => structuredClone(this.submissions),
      isThreadDeleting: (threadId: string) => this.deletingThreadIds.has(threadId),
      setTurnStatus: (turnId: string, status: WorkbenchTurnStatus, payload?: Record<string, unknown>) => {
        const turn = this.turns.find(candidate => candidate.id === turnId)!
        turn.status = status
        this.statusPayloads.push(payload)
      },
      upsertSubmission: (submission: QueuedThreadSubmission) => {
        const index = this.submissions.findIndex(candidate => candidate.id === submission.id)
        this.submissions[index] = structuredClone(submission)
      },
      removeSubmission: (submissionId: string) => {
        const index = this.submissions.findIndex(candidate => candidate.id === submissionId)
        if (index >= 0) this.submissions.splice(index, 1)
      }
    })
  }

  async cancelTurn(turnId: string): Promise<boolean> {
    const turn = this.turns.find(candidate => candidate.id === turnId)
    if (!turn) return false
    turn.status = 'cancelled'
    return true
  }

  async interruptTurn(turnId: string): Promise<boolean> {
    const turn = this.turns.find(candidate => candidate.id === turnId)
    if (!turn) return false
    turn.status = 'interrupted'
    return true
  }

  on(_event: 'event', listener: (event: unknown) => void): void {
    this.listeners.add(listener)
  }

  off(_event: 'event', listener: (event: unknown) => void): void {
    this.listeners.delete(listener)
  }

  emitTurnStatus(turnId: string, status: WorkbenchTurnStatus): void {
    const turn = this.turns.find(candidate => candidate.id === turnId)!
    turn.status = status
    for (const listener of this.listeners) listener({ kind: 'turn:status', turnId, payload: { status } })
  }
}

const payload = (threadId?: string): CreatePayload => ({ threadId, prompt: 'Run the durable workbench turn', mode: 'auto' })

describe('ThreadExecutionCoordinator', () => {
  it.each([
    ['completed', 'reoptimize', 'reoptimize'],
    ['failed', undefined, 'reuse-selection'],
    ['cancelled', undefined, 'reuse-selection']
  ] as const)('creates a new queued retry Turn for a %s Turn', async (status, retryStrategy, expectedStrategy) => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const original = await coordinator.enqueueCreate(payload(), 11)
    runtimeStore.turns.find(turn => turn.id === original.turn.id)!.status = status

    await expect(coordinator.rerunInterruptedTurn(original.turn.id, 11))
      .rejects.toThrow('Only interrupted turns can be rerun')

    const retry = await coordinator.enqueueRetry({
      turnId: original.turn.id,
      ...(retryStrategy ? { retryStrategy } : {})
    }, 11)

    const submission = runtimeStore.submissions.find(candidate => candidate.turnId === retry.turn.id)
    expect(retry.turn).toMatchObject({
      id: expect.any(String),
      threadId: original.thread.id,
      retryOfTurnId: original.turn.id,
      ownerWebContentsId: 11,
      status: 'queued'
    })
    expect(retry.turn.id).not.toBe(original.turn.id)
    expect(runtimeStore.getTurn(original.turn.id)?.status).toBe(status)
    expect(submission).toMatchObject({
      source: 'retry',
      retryOfTurnId: original.turn.id,
      retryStrategy: expectedStrategy,
      ownerWebContentsId: 11,
      state: 'queued'
    })
  })

  it('persists normalized retry strategy on a normal coordinator-created retry submission', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const original = await coordinator.enqueueCreate(payload(), 11)
    runtimeStore.turns.find(turn => turn.id === original.turn.id)!.status = 'completed'

    const reoptimized = await coordinator.enqueueRetry({
      turnId: original.turn.id,
      retryStrategy: 'reoptimize'
    }, 11)
    const defaultOriginal = await coordinator.enqueueCreate(payload(original.thread.id), 11)
    runtimeStore.turns.find(turn => turn.id === defaultOriginal.turn.id)!.status = 'failed'
    const defaulted = await coordinator.enqueueRetry({ turnId: defaultOriginal.turn.id }, 11)

    expect(runtimeStore.submissions.find(submission => submission.turnId === reoptimized.turn.id))
      .toMatchObject({ retryOfTurnId: original.turn.id, retryStrategy: 'reoptimize' })
    expect(runtimeStore.submissions.find(submission => submission.turnId === defaulted.turn.id))
      .toMatchObject({ retryStrategy: 'reuse-selection' })
  })

  it.each(['completed', 'failed'] as const)(
    'deduplicates concurrent normal retries for a %s original Turn',
    async status => {
      const runtimeStore = new RuntimeStoreDouble()
      const runner = { start: vi.fn(), cancel: vi.fn() }
      const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
      const original = await coordinator.enqueueCreate(payload(), 11)
      runtimeStore.turns.find(turn => turn.id === original.turn.id)!.status = status
      await coordinator.onTurnStatus(original.turn.id, status)
      runner.start.mockClear()

      const [first, second] = await Promise.all([
        coordinator.enqueueRetry({ turnId: original.turn.id }, 11),
        coordinator.enqueueRetry({ turnId: original.turn.id }, 11)
      ])

      expect(first.turn.id).toBe(second.turn.id)
      expect(first.turn.status).toBe('queued')
      expect(runtimeStore.turns.filter(turn => turn.retryOfTurnId === original.turn.id)).toHaveLength(1)
      expect(runtimeStore.getTurn(original.turn.id)?.status).toBe(status)

      runtimeStore.turns.find(turn => turn.id === first.turn.id)!.status = 'completed'
      await coordinator.onTurnStatus(first.turn.id, 'completed')
      expect(runner.start).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['completed', 'failed'] as const)(
    'deduplicates normal retries for a %s Turn across coordinators sharing one store',
    async status => {
      const runtimeStore = new RuntimeStoreDouble()
      const runner = { start: vi.fn(), cancel: vi.fn() }
      const firstCoordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
      const secondCoordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
      const original = await firstCoordinator.enqueueCreate(payload(), 11)
      runtimeStore.turns.find(turn => turn.id === original.turn.id)!.status = status
      await firstCoordinator.onTurnStatus(original.turn.id, status)
      runner.start.mockClear()

      const [first, second] = await Promise.all([
        firstCoordinator.enqueueRetry({ turnId: original.turn.id }, 11),
        secondCoordinator.enqueueRetry({ turnId: original.turn.id }, 11)
      ])

      expect(first.turn.id).toBe(second.turn.id)
      expect(runtimeStore.turns.filter(turn => turn.retryOfTurnId === original.turn.id)).toHaveLength(1)
      expect(runtimeStore.getTurn(original.turn.id)?.status).toBe(status)
      expect(runner.start).toHaveBeenCalledTimes(1)
    }
  )

  it('admits a fresh normal retry after its prior child terminalizes', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const original = await coordinator.enqueueCreate(payload(), 11)
    runtimeStore.turns.find(turn => turn.id === original.turn.id)!.status = 'completed'
    await coordinator.onTurnStatus(original.turn.id, 'completed')
    const first = await coordinator.enqueueRetry({ turnId: original.turn.id }, 11)
    runtimeStore.turns.find(turn => turn.id === first.turn.id)!.status = 'failed'
    await coordinator.onTurnStatus(first.turn.id, 'failed')

    const second = await coordinator.enqueueRetry({ turnId: original.turn.id }, 11)

    expect(second.turn.id).not.toBe(first.turn.id)
    expect(runtimeStore.getTurn(first.turn.id)?.status).toBe('failed')
    expect(runtimeStore.turns.filter(turn => turn.retryOfTurnId === original.turn.id)).toHaveLength(2)
  })

  it('keeps concurrent normal retry strategies distinct', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const original = await coordinator.enqueueCreate(payload(), 11)
    runtimeStore.turns.find(turn => turn.id === original.turn.id)!.status = 'completed'
    await coordinator.onTurnStatus(original.turn.id, 'completed')

    const [reuse, reoptimize] = await Promise.all([
      coordinator.enqueueRetry({ turnId: original.turn.id }, 11),
      coordinator.enqueueRetry({ turnId: original.turn.id, retryStrategy: 'reoptimize' }, 11)
    ])

    expect(reuse.turn.id).not.toBe(reoptimize.turn.id)
    expect(runtimeStore.submissions
      .filter(submission => submission.retryOfTurnId === original.turn.id)
      .map(submission => submission.retryStrategy).sort())
      .toEqual(['reoptimize', 'reuse-selection'])
  })

  it('acknowledges durable submissions and runs one FIFO head per thread', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })

    const first = await coordinator.enqueueCreate(payload(), 11)
    const second = await coordinator.enqueueCreate(payload(first.thread.id), 11)

    expect(first.turn.status).toBe('queued')
    expect(runtimeStore.listQueuedSubmissions(first.thread.id)).toHaveLength(2)
    expect(runner.start).toHaveBeenCalledTimes(1)
    expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: first.turn.id, state: 'starting' }))
    expect(runtimeStore.getTurn(first.turn.id)?.status).toBe('running')
    expect(runtimeStore.getTurn(second.turn.id)?.status).toBe('queued')

    runtimeStore.turns.find(turn => turn.id === first.turn.id)!.status = 'completed'
    await coordinator.onTurnStatus(first.turn.id, 'completed')

    expect(runner.start).toHaveBeenCalledTimes(2)
    expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: second.turn.id, state: 'starting' }))
  })

  it('keeps an awaiting-decision head and its tail durable', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await coordinator.enqueueCreate(payload(), 11)
    const second = await coordinator.enqueueCreate(payload(first.thread.id), 11)

    await coordinator.onTurnStatus(first.turn.id, 'awaiting-decision')

    expect(runner.start).toHaveBeenCalledTimes(1)
    expect(runtimeStore.getTurn(second.turn.id)?.status).toBe('queued')
    expect(runtimeStore.listQueuedSubmissions(first.thread.id)).toEqual([
      expect.objectContaining({ turnId: first.turn.id, state: 'starting' }),
      expect.objectContaining({ turnId: second.turn.id, state: 'queued' })
    ])
  })

  it('cancels only the head and then drains queued tails', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await coordinator.enqueueCreate(payload(), 11)
    const second = await coordinator.enqueueCreate(payload(first.thread.id), 11)

    await coordinator.cancelTurn(first.turn.id)

    expect(runner.cancel).toHaveBeenCalledWith(first.turn.id)
    expect(runtimeStore.getTurn(first.turn.id)?.status).toBe('cancelled')
    expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: second.turn.id }))
  })

  it('clears queued tails without cancelling an active head', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await coordinator.enqueueCreate(payload(), 11)
    const second = await coordinator.enqueueCreate(payload(first.thread.id), 11)

    await coordinator.clearQueue(first.thread.id)

    expect(runtimeStore.getTurn(first.turn.id)?.status).toBe('running')
    expect(runtimeStore.getTurn(second.turn.id)?.status).toBe('cancelled')
    expect(runtimeStore.listQueuedSubmissions(first.thread.id)).toEqual([
      expect.objectContaining({ turnId: first.turn.id, state: 'starting' })
    ])
  })

  it('recovers a persisted starting head without replaying it and drains its queued tail', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const initial = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await initial.enqueueCreate(payload(), 11)
    const second = await initial.enqueueCreate(payload(first.thread.id), 11)
    runner.start.mockClear()

    const recovered = new ThreadExecutionCoordinator({ runtimeStore, runner })
    await recovered.recover()

    expect(runtimeStore.getTurn(first.turn.id)?.status).toBe('interrupted')
    expect(runtimeStore.listQueuedSubmissions(first.thread.id)).not.toContainEqual(expect.objectContaining({ turnId: first.turn.id }))
    expect(runner.start).toHaveBeenCalledOnce()
    expect(runner.start).toHaveBeenCalledWith(expect.objectContaining({ turnId: second.turn.id }))
  })

  it('recovers and starts a thread that contains only durable queued submissions', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const initial = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const queued = await initial.enqueueCreate(payload(), 11)
    runtimeStore.turns.find(turn => turn.id === queued.turn.id)!.status = 'queued'
    runtimeStore.submissions.find(submission => submission.turnId === queued.turn.id)!.state = 'queued'
    runner.start.mockClear()

    const recovered = new ThreadExecutionCoordinator({ runtimeStore, runner })
    await recovered.recover()

    expect(runner.start).toHaveBeenCalledWith(expect.objectContaining({ turnId: queued.turn.id }))
  })

  it('does not start a terminal queued tail left by a cancellation race', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const head = await coordinator.enqueueCreate(payload(), 11)
    const tail = await coordinator.enqueueCreate(payload(head.thread.id), 11)
    runtimeStore.turns.find(turn => turn.id === tail.turn.id)!.status = 'cancelled'
    runtimeStore.turns.find(turn => turn.id === head.turn.id)!.status = 'completed'

    await coordinator.onTurnStatus(head.turn.id, 'completed')

    expect(runner.start).toHaveBeenCalledOnce()
    expect(runtimeStore.listQueuedSubmissions(head.thread.id)).not.toContainEqual(
      expect.objectContaining({ turnId: tail.turn.id })
    )
  })

  it('uses durable admission order when submissions share a timestamp', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    runtimeStore.createdAt = 1
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const first = await coordinator.enqueueCreate(payload(), 11)
    const admissions = [first]
    for (let index = 0; index < 10; index += 1) {
      admissions.push(await coordinator.enqueueCreate(payload(first.thread.id), 11))
    }
    runtimeStore.turns.find(turn => turn.id === first.turn.id)!.status = 'completed'

    await coordinator.onTurnStatus(first.turn.id, 'completed')

    expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: admissions[1].turn.id }))
  })

  it('defers a terminal event drain until cancellation sequencing is complete', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const head = await coordinator.enqueueCreate(payload(), 11)
    const tail = await coordinator.enqueueCreate(payload(head.thread.id), 11)

    await coordinator.beginTurnCancellation(head.turn.id)
    runtimeStore.emitTurnStatus(head.turn.id, 'cancelled')
    await Promise.resolve()

    expect(runner.start).toHaveBeenCalledOnce()
    await coordinator.cancelTurn(head.turn.id)
    await coordinator.finishTurnCancellation(head.turn.id)

    expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: tail.turn.id }))
  })

  it('does not let a concurrent enqueue drain a cancelled head before cancellation finishes', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const head = await coordinator.enqueueCreate(payload(), 11)
    const tail = await coordinator.enqueueCreate(payload(head.thread.id), 11)

    await coordinator.beginTurnCancellation(head.turn.id)
    runtimeStore.emitTurnStatus(head.turn.id, 'cancelled')
    await Promise.resolve()
    await coordinator.enqueueCreate(payload(head.thread.id), 11)

    expect(runner.start).toHaveBeenCalledOnce()
    await coordinator.finishTurnCancellation(head.turn.id)
    expect(runner.start).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: tail.turn.id }))
  })

  it('does not start a queued tail after its thread enters durable deletion', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const head = await coordinator.enqueueCreate(payload(), 11)
    const tail = await coordinator.enqueueCreate(payload(head.thread.id), 11)

    runtimeStore.deletingThreadIds.add(head.thread.id)
    runtimeStore.turns.find(turn => turn.id === head.turn.id)!.status = 'cancelled'
    await coordinator.onTurnStatus(head.turn.id, 'cancelled')

    expect(runner.start).toHaveBeenCalledOnce()
    expect(runtimeStore.getTurn(tail.turn.id)?.status).toBe('queued')
  })

  it('sanitizes runner-start failures before persisting a terminal error', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = {
      start: vi.fn(async () => { throw new Error('Cannot read C:\\secret\\private.txt') }),
      cancel: vi.fn()
    }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })

    const created = await coordinator.enqueueCreate(payload(), 11)
    await vi.waitFor(() => expect(runtimeStore.getTurn(created.turn.id)?.status).toBe('failed'))

    expect(runtimeStore.statusPayloads.at(-1)?.error).not.toContain('C:\\secret\\private.txt')
  })

  it('contains event-driven drain failures instead of leaving a rejection unhandled', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const created = await coordinator.enqueueCreate(payload(), 11)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runtimeStore.failNextMutation = new Error('cannot persist C:\\secret\\queue.json')

    runtimeStore.emitTurnStatus(created.turn.id, 'completed')
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled())

    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('C:\\secret\\queue.json')
    errorSpy.mockRestore()
  })

  it('contains persistence failures raised while handling a runner-start rejection', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    let rejectStart!: (error: Error) => void
    const runner = {
      start: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStart = reject })),
      cancel: vi.fn()
    }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    await coordinator.enqueueCreate(payload(), 11)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runtimeStore.failNextMutation = new Error('cannot persist C:\\secret\\runner.json')

    rejectStart(new Error('runner failed'))
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled())

    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('C:\\secret\\runner.json')
    errorSpy.mockRestore()
  })

  it('reruns only an interrupted owned turn from immutable original direct input', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const customSchedule = {
      preset: 'firefly-custom' as const,
      label: 'Five role',
      description: 'Five role schedule',
      steps: [{ id: 'lead', label: 'Lead', agentId: 'codex', role: 'lead' as const, mode: 'auto' as const }]
    }
    const attachments = [{ id: 'attachment-1', kind: 'text' as const, name: 'context.md', text: 'original context' }]
    const modelSelection = { providerId: 'deepseek', modelId: 'deepseek-chat', source: 'provider' as const }
    const multiModelFusion = { enabled: true, maxCandidates: 3 as const, maxRounds: 3 as const, allowExecutor: true }
    const original = await coordinator.enqueueCreate({
      prompt: 'Run the original provider turn',
      mode: 'firefly-custom',
      modelSelection,
      attachments,
      customSchedule,
      multiModelFusion
    }, 11)
    await coordinator.cancelTurn(original.turn.id)
    await runtimeStore.interruptTurn(original.turn.id)
    const internal = runtimeStore.turns.find(turn => turn.id === original.turn.id)!
    internal.thinking = { staleDecision: { answer: 'do not reuse' } }

    const retry = await coordinator.rerunInterruptedTurn(original.turn.id, 11)
    const durable = runtimeStore.listQueuedSubmissions(retry.thread.id).find(item => item.turnId === retry.turn.id)!
    ;(durable.input as any).prompt = 'mutated return value'

    expect(retry.turn.id).not.toBe(original.turn.id)
    expect(retry.turn.prompt).toBe(original.turn.prompt)
    expect(retry.turn.thinking).toBeUndefined()
    expect(retry.turn).toMatchObject({
      mode: 'firefly-custom',
      modelSelection,
      attachments,
      customSchedule,
      multiModelFusion
    })
    expect(runtimeStore.listQueuedSubmissions(retry.thread.id).find(item => item.turnId === retry.turn.id)?.input).toEqual({
      threadId: retry.thread.id,
      workspaceId: retry.thread.workspaceId,
      prompt: original.turn.prompt,
      mode: original.turn.mode,
      targetAgent: original.turn.targetAgent ?? null,
      modelSelection: original.turn.modelSelection,
      attachments,
      customSchedule,
      multiModelFusion
    })
    await expect(coordinator.rerunInterruptedTurn(original.turn.id, 22)).rejects.toThrow('owned by another window')
  })

  it('deduplicates concurrent, active, and terminal reruns for one interrupted original turn', async () => {
    const runtimeStore = new RuntimeStoreDouble()
    const runner = { start: vi.fn(), cancel: vi.fn() }
    const coordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const original = await coordinator.enqueueCreate(payload(), 11)
    await coordinator.cancelTurn(original.turn.id)
    await runtimeStore.interruptTurn(original.turn.id)

    const [first, second] = await Promise.all([
      coordinator.rerunInterruptedTurn(original.turn.id, 11),
      coordinator.rerunInterruptedTurn(original.turn.id, 11)
    ])
    const activeRetry = await coordinator.rerunInterruptedTurn(original.turn.id, 11)
    runtimeStore.turns.find(turn => turn.id === first.turn.id)!.status = 'failed'
    await coordinator.onTurnStatus(first.turn.id, 'failed')
    const reloadedCoordinator = new ThreadExecutionCoordinator({ runtimeStore, runner })
    const terminalRetry = await reloadedCoordinator.rerunInterruptedTurn(original.turn.id, 11)

    expect(first.turn.id).toBe(second.turn.id)
    expect(activeRetry.turn.id).toBe(first.turn.id)
    expect(terminalRetry.turn.id).toBe(first.turn.id)
    expect(runtimeStore.listQueuedSubmissions(original.thread.id).filter(submission => (
      submission.retryOfTurnId === original.turn.id
    ))).toHaveLength(0)
    expect(runtimeStore.turns.filter(turn => turn.retryOfTurnId === original.turn.id)).toHaveLength(1)
  })
})
