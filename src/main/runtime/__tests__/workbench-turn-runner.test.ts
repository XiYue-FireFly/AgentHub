import { describe, expect, it, vi } from 'vitest'
import { WorkbenchTurnRunner } from '../workbench-turn-runner'
import { BudgetReservationCenter } from '../budget-reservations'
import { MultiModelLoopRunner, type LoopDispatchGateway } from '../multi-model-loop'
import type { QueuedThreadSubmission, WorkbenchThread, WorkbenchTurn } from '../types'
import type { PromptPreparationOutcome } from '../prompt-preparation-service'
import type { PromptEnvelope } from '../../../shared/prompt-contract'

const thread: WorkbenchThread = { id: 'thread-1', workspaceId: null, title: 'Thread', createdAt: 1, updatedAt: 1 }
const turn = (status: WorkbenchTurn['status']): WorkbenchTurn => ({
  id: 'turn-1', threadId: thread.id, prompt: 'prompt', mode: 'auto', status, taskIds: [], createdAt: 1
})
const submission: QueuedThreadSubmission = {
  id: 'submission-1', threadId: thread.id, turnId: 'turn-1', ownerWebContentsId: 7,
  input: { threadId: thread.id, prompt: 'prompt', mode: 'auto' }, source: 'create', state: 'starting', createdAt: 1, admissionSequence: 1
}

describe('WorkbenchTurnRunner', () => {
  it('aborts the active execution signal immediately when its Turn is cancelled', async () => {
    let executionSignal: AbortSignal | undefined
    let entered!: () => void
    const enteredExecution = new Promise<void>(resolve => { entered = resolve })
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => turn('running'),
        listQueuedSubmissions: () => [submission]
      },
      execute: async (input: any) => {
        executionSignal = input.signal
        entered()
        await new Promise<void>(resolve => executionSignal?.addEventListener('abort', () => resolve(), { once: true }))
      },
      cancel: vi.fn()
    })

    const starting = runner.start(submission)
    await enteredExecution
    ;(runner as any).abort(submission.turnId, 'cancelled by user')
    await starting

    expect(executionSignal?.aborted).toBe(true)
  })

  it('keeps the Turn signal alive until a non-settling fusion branch is cancelled and releases its budget', async () => {
    let branchStarted!: () => void
    const started = new Promise<void>(resolve => { branchStarted = resolve })
    const cancel = vi.fn(async () => {})
    const gateway: LoopDispatchGateway = {
      start: request => {
        branchStarted()
        return { taskId: request.branchId, result: new Promise(() => {}), cancel }
      }
    }
    const center = new BudgetReservationCenter(() => ({
      config: {
        version: 1, dailyLimitUsd: 100, monthlyLimitUsd: 100,
        perRequestMaxTokens: 100_000, perRequestMaxCostUsd: 100,
        notifyAtPercent: 80, blockWhenExceeded: true, suggestCheaperModel: true
      },
      dailySpentUsd: 0,
      monthlySpentUsd: 0
    }))
    const root = {
      envelopeId: 'envelope-fusion-cancel', sessionId: 'session-fusion-cancel', rootInputId: 'input-fusion-cancel',
      displayOriginalPrompt: 'Inspect', effectivePrompt: 'Inspect', origin: 'workbench:create' as const,
      policy: 'optimize' as const, status: 'optimized' as const, optimizerVersion: 'test', inputHash: 'hash',
      preparedTextHash: 'prepared', optimizationCount: 1 as const, finalizedAt: 1
    }
    const loop = new MultiModelLoopRunner({
      gateway,
      reservations: center,
      emit: () => {},
      estimateRound: () => ({ tokens: 1, costUsd: 1, requests: 4 }),
      estimateSingle: () => ({ tokens: 1, costUsd: 1, requests: 1 })
    })
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => turn('running'),
        listQueuedSubmissions: () => [submission]
      },
      execute: async input => {
        await loop.run({
        runId: 'run-fusion-cancel', envelope: root,
        lineage: {
          origin: root.origin, policy: root.policy, rootInputId: root.rootInputId,
          rootEnvelopeId: root.envelopeId, rootPreparedTextHash: root.preparedTextHash
        },
        routes: [
          { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
          { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' }
        ],
        turnId: input.turn.id, threadId: input.thread.id, signal: input.signal,
        deadline: Date.now() + 60_000, branchTimeoutMs: 60_000,
          maxCandidates: 2, maxRounds: 1, requiresExecution: false
        })
      },
      cancel: vi.fn()
    })

    const running = runner.start(submission)
    await started
    runner.abort(submission.turnId, 'cancel after fusion began')

    await expect(running).rejects.toThrow(/cancel after fusion began/)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(center.listActive()).toEqual([])
  })

  it('exposes a durable pre-dispatch guard that turns false after cancellation', async () => {
    let current = turn('running')
    const execute = vi.fn(async ({ isStillActive }: { isStillActive: () => boolean }) => {
      current = turn('cancelled')
      expect(isStillActive()).toBe(false)
    })
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => current,
        listQueuedSubmissions: () => [submission]
      },
      execute,
      cancel: vi.fn()
    })

    await runner.start(submission)

    expect(execute).toHaveBeenCalledOnce()
  })

  it('prevents a deferred preflight from launching work after cancellation', async () => {
    let current = turn('running')
    let releasePreflight!: () => void
    const preflight = new Promise<void>(resolve => { releasePreflight = resolve })
    const dispatcherLaunch = vi.fn()
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => current,
        listQueuedSubmissions: () => [submission]
      },
      execute: async ({ isStillActive }) => {
        await preflight
        if (isStillActive()) dispatcherLaunch()
      },
      cancel: vi.fn()
    })

    const starting = runner.start(submission)
    current = turn('cancelled')
    releasePreflight()
    await starting

    expect(dispatcherLaunch).not.toHaveBeenCalled()
  })

  it('waits for durable pre-dispatch approval before dispatching the same Turn', async () => {
    let releaseApproval!: () => void
    const approval = new Promise<void>(resolve => { releaseApproval = resolve })
    const execute = vi.fn(async () => undefined)
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => turn('running'),
        listQueuedSubmissions: () => [submission]
      },
      preDispatch: async () => { await approval },
      execute,
      cancel: vi.fn()
    })

    const starting = runner.start(submission)
    await Promise.resolve()
    expect(execute).not.toHaveBeenCalled()
    releaseApproval()
    await starting
    expect(execute).toHaveBeenCalledOnce()
  })

  it('carries the single canonical pre-dispatch result into execution', async () => {
    const canonicalPreDispatch = {
      prompt: '[optimized] review this change',
      pluginContext: ['Plugin context']
    }
    const execute = vi.fn(async () => undefined)
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => turn('running'),
        listQueuedSubmissions: () => [submission]
      },
      preDispatch: vi.fn(async () => canonicalPreDispatch),
      execute,
      cancel: vi.fn()
    })

    await runner.start(submission)

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      preDispatch: canonicalPreDispatch
    }))
  })

  it('prepares and attaches an envelope to the coordinator-created Turn with its trusted owner', async () => {
    const retryTurn: WorkbenchTurn = {
      ...turn('completed'),
      id: 'turn-original',
      displayOriginalPrompt: 'Fix this',
      effectivePrompt: 'Old effective prompt',
      promptEnvelope: {
        envelopeId: 'envelope-original',
        sessionId: 'session-original',
        rootInputId: 'input-original',
        displayOriginalPrompt: 'Fix this',
        effectivePrompt: 'Old effective prompt',
        origin: 'workbench:create',
        policy: 'optimize',
        status: 'candidate-selected',
        optimizerVersion: 'prompt-preparation-v1',
        inputHash: 'input-hash',
        preparedTextHash: 'prepared-hash',
        optimizationCount: 1,
        finalizedAt: 1
      }
    }
    let currentRetry: WorkbenchTurn = { ...turn('running'), id: 'turn-retry', retryOfTurnId: retryTurn.id }
    const retrySubmission: QueuedThreadSubmission = {
      ...submission,
      id: 'submission-retry',
      turnId: currentRetry.id,
      source: 'retry',
      retryOfTurnId: retryTurn.id,
      retryStrategy: 'reoptimize'
    }
    const envelope: PromptEnvelope = {
      envelopeId: 'envelope-retry',
      sessionId: 'session-retry',
      rootInputId: 'input-retry',
      displayOriginalPrompt: 'Fix this',
      effectivePrompt: 'New effective prompt',
      origin: 'workbench:retry' as const,
      policy: 'optimize' as const,
      status: 'candidate-selected' as const,
      optimizerVersion: 'prompt-preparation-v1',
      inputHash: 'input-hash',
      preparedTextHash: 'prepared-hash',
      optimizationCount: 1 as const,
      finalizedAt: 1
    }
    const preparedSession = {
      sessionId: 'session-retry',
      rootInputId: 'input-retry',
      origin: 'workbench:retry' as const,
      policy: 'optimize' as const,
      state: 'analyzing' as const,
      inputHash: 'input-hash',
      preparationCount: 1 as const,
      optimizationCount: 1 as const,
      candidateAttemptCount: 0
    }
    const prepareRoot = vi.fn(async (): Promise<PromptPreparationOutcome> => ({
      kind: 'ready', session: preparedSession, envelope, artifact: { intent: 'bugfix' }
    }))
    const attachPromptEnvelope = vi.fn((_turnId: string, next: PromptEnvelope) => {
      currentRetry = {
        ...currentRetry,
        prompt: next.displayOriginalPrompt,
        displayOriginalPrompt: next.displayOriginalPrompt,
        effectivePrompt: next.effectivePrompt,
        promptEnvelope: next
      }
      return currentRetry
    })
    const execute = vi.fn(async () => undefined)
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: (turnId: string) => turnId === retryTurn.id ? retryTurn : currentRetry,
        listQueuedSubmissions: () => [retrySubmission],
        commitRuntimeMutation: async <T,>(mutate: (tx: { attachPromptEnvelope: typeof attachPromptEnvelope }) => T): Promise<T> => mutate({ attachPromptEnvelope })
      },
      promptPreparation: {
        promptPreparationService: { prepareRoot },
        cacheContext: () => ({
          locale: 'en-US', contextSignature: 'ctx', pluginSignature: 'plugins', skillSignature: 'skills',
          attachmentSignature: 'attachments', providerId: 'openai', modelId: 'gpt'
        })
      },
      execute,
      cancel: vi.fn()
    })

    await runner.start(retrySubmission)

    expect(prepareRoot).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'workbench:retry',
      prompt: 'Fix this',
      decisionOwner: expect.objectContaining({ type: 'turn', turnId: currentRetry.id, webContentsId: 7 }),
      reuseEnvelope: retryTurn.promptEnvelope,
      retryStrategy: 'reoptimize'
    }))
    expect(attachPromptEnvelope).toHaveBeenCalledWith(currentRetry.id, envelope)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      turn: expect.objectContaining({ effectivePrompt: 'New effective prompt' })
    }))
  })

  it('waits for plugin approval before dispatching a retry Turn exactly once', async () => {
    const retrySubmission: QueuedThreadSubmission = {
      ...submission,
      id: 'retry-submission-1',
      turnId: 'retry-turn-1',
      source: 'retry',
      retryOfTurnId: 'turn-1'
    }
    const retryTurn = { ...turn('running'), id: 'retry-turn-1' }
    let releaseApproval!: () => void
    const approval = new Promise<void>(resolve => { releaseApproval = resolve })
    const execute = vi.fn(async () => undefined)
    const preDispatch = vi.fn(async () => { await approval })
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => retryTurn,
        listQueuedSubmissions: () => [retrySubmission]
      },
      preDispatch,
      execute,
      cancel: vi.fn()
    })

    const starting = runner.start(retrySubmission)
    await Promise.resolve()
    expect(execute).not.toHaveBeenCalled()
    releaseApproval()
    await starting

    expect(preDispatch).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      submission: retrySubmission,
      turn: expect.objectContaining({ id: 'retry-turn-1' })
    }))
  })

  it.each(['unavailable', 'denied'] as const)(
    'fails closed without dispatching a retry Turn when plugin approval is %s',
    async reason => {
    const retrySubmission: QueuedThreadSubmission = {
      ...submission,
      id: 'retry-submission-1',
      turnId: 'retry-turn-1',
      source: 'retry',
      retryOfTurnId: 'turn-1'
    }
    const execute = vi.fn(async () => undefined)
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {
        getThread: () => thread,
        getTurn: () => ({ ...turn('running'), id: 'retry-turn-1' }),
        listQueuedSubmissions: () => [retrySubmission]
      },
      preDispatch: async () => { throw new Error(`plugin approval ${reason}`) },
      execute,
      cancel: vi.fn()
    })

    await expect(runner.start(retrySubmission)).rejects.toThrow(`plugin approval ${reason}`)
    expect(execute).not.toHaveBeenCalled()
    }
  )
})
