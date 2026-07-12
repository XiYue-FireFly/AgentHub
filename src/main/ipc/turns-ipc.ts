import type { IpcMainInvokeEvent } from 'electron'
import type { TurnCreateInputLike, TurnCreateResultLike, TurnRetryInputLike } from '../../shared/ipc-contract'
import type { QueuedThreadSubmission } from '../runtime/types'
import type { ThreadExecutionCoordinator } from '../runtime/thread-execution-coordinator'
import { typedHandle } from './typed-ipc'

interface TurnsRuntimeStorePort {
  getTurn(turnId: string): { id: string; threadId: string; ownerWebContentsId?: number } | undefined
  listQueuedSubmissions(threadId?: string): QueuedThreadSubmission[]
  cancelAgentRun(turnId: string, agentId: string, payload?: Record<string, unknown>): Promise<boolean>
}

interface TurnsIpcDeps {
  coordinator: Pick<ThreadExecutionCoordinator,
    'enqueueCreate' | 'enqueueRetry' | 'rerunInterruptedTurn' | 'cancelTurn' | 'clearQueue'
    | 'beginTurnCancellation' | 'finishTurnCancellation'> & {
      abortTurnExecution?(turnId: string, reason?: unknown): void | Promise<void>
    }
  runtimeStore: TurnsRuntimeStorePort
  decisionService: {
    cancelTurn(turnId: string): Promise<void>
    cancelAgentDecisions(turnId: string, agentId: string): Promise<void>
  }
  dispatcher: {
    cancelTurn(turnId: string, options?: { decisionAlreadyCancelled?: boolean }): boolean | Promise<boolean>
    preCancelTurn(turnId: string): boolean
    preCancelAgentForTurn(turnId: string, agentId: string): boolean
    cancelAgentForTurn(
      turnId: string,
      agentId: string,
      options?: { decisionAlreadyCancelled?: boolean }
    ): boolean | Promise<boolean>
  } | null
}

function senderId(event: IpcMainInvokeEvent): number {
  const id = event.sender?.id
  if (!Number.isInteger(id) || id <= 0) throw new Error('Turns IPC requires a live renderer sender')
  return id
}

function ownsTurn(runtimeStore: TurnsRuntimeStorePort, turnId: string, ownerWebContentsId: number): boolean {
  const turn = runtimeStore.getTurn(turnId)
  return !!turn && turn.ownerWebContentsId === ownerWebContentsId
}

function publicSubmission(submission: QueuedThreadSubmission): Omit<QueuedThreadSubmission, 'input'> {
  const { input: _input, ...safe } = submission
  return safe
}

export function registerTurnsIpc(deps: TurnsIpcDeps): void {
  typedHandle('turns:create', (event, payload) => (
    deps.coordinator.enqueueCreate(payload as TurnCreateInputLike, senderId(event))
  ))

  typedHandle('turns:retry', (event, input) => {
    const ownerWebContentsId = senderId(event)
    const retry = input as TurnRetryInputLike
    if (!ownsTurn(deps.runtimeStore, retry.turnId, ownerWebContentsId)) {
      throw new Error('Turn is not owned by this renderer')
    }
    const retryStrategy = retry.retryStrategy === "reoptimize" ? "reoptimize" : "reuse-selection"
    return deps.coordinator.enqueueRetry({
      turnId: retry.turnId,
      retryStrategy
    }, ownerWebContentsId)
  })

  typedHandle('turns:rerunInterrupted', (event, originalTurnId) => {
    const ownerWebContentsId = senderId(event)
    if (!ownsTurn(deps.runtimeStore, originalTurnId, ownerWebContentsId)) {
      throw new Error('Turn is not owned by this renderer')
    }
    return deps.coordinator.rerunInterruptedTurn(originalTurnId, ownerWebContentsId)
  })

  typedHandle('turns:cancel', async (event, turnId) => {
    const ownerWebContentsId = senderId(event)
    if (!ownsTurn(deps.runtimeStore, turnId, ownerWebContentsId)) return false
    await deps.coordinator.beginTurnCancellation(turnId)
    try {
      deps.dispatcher?.preCancelTurn(turnId)
      await deps.coordinator.abortTurnExecution?.(turnId, 'Cancelled by user.')
      await deps.decisionService.cancelTurn(turnId)
      const dispatcherCancelled = await (deps.dispatcher?.cancelTurn(turnId, { decisionAlreadyCancelled: true }) ?? false)
      const durableCancelled = await deps.coordinator.cancelTurn(turnId, { runnerAlreadyCancelled: true })
      return durableCancelled || dispatcherCancelled
    } finally {
      await deps.coordinator.finishTurnCancellation(turnId)
    }
  })

  typedHandle('turns:cancelAgent', async (event, turnId, agentId) => {
    const ownerWebContentsId = senderId(event)
    if (!ownsTurn(deps.runtimeStore, turnId, ownerWebContentsId)) return false
    deps.dispatcher?.preCancelAgentForTurn(turnId, agentId)
    await deps.decisionService.cancelAgentDecisions(turnId, agentId)
    const runtimeCancelled = await deps.runtimeStore.cancelAgentRun(turnId, agentId, {
      error: 'Agent cancelled by user.'
    })
    const dispatcherCancelled = await (deps.dispatcher?.cancelAgentForTurn(
      turnId,
      agentId,
      { decisionAlreadyCancelled: true }
    ) ?? false)
    return runtimeCancelled || dispatcherCancelled
  })

  typedHandle('turns:listQueuedSubmissions', (event, threadId) => {
    const ownerWebContentsId = senderId(event)
    return deps.runtimeStore.listQueuedSubmissions(threadId)
      .filter(submission => submission.ownerWebContentsId === ownerWebContentsId)
      .map(publicSubmission)
  })

  typedHandle('turns:clearQueue', async (event, threadId) => {
    const ownerWebContentsId = senderId(event)
    const submissions = deps.runtimeStore.listQueuedSubmissions(threadId)
    // A shared thread may contain queues from several renderer windows. Do
    // not allow one window to clear another window's durable tail.
    if (submissions.some(submission => submission.ownerWebContentsId !== ownerWebContentsId)) return []
    return deps.coordinator.clearQueue(threadId)
  })
}
