import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'
import type { TurnCreateInputLike, TurnCreateResultLike } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

const validTurnPayload: TurnCreateInputLike = {
  threadId: null,
  workspaceId: null,
  prompt: 'Implement the selected requirement',
  mode: 'custom',
  targetAgent: '',
  thinking: { mode: 'auto', level: 'medium', collapseInUI: true },
  modelSelection: {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    source: 'provider'
  },
  attachments: [
    {
      id: 'att-1',
      kind: 'text',
      name: 'notes.md',
      text: 'context',
      createdAt: 1
    }
  ],
  customSchedule: {
    preset: 'custom',
    label: 'Review then execute',
    description: '',
    steps: [
      { id: 'review', label: 'Review', agentId: 'codex', role: 'reviewer', mode: 'auto' },
      { id: 'execute', label: 'Execute', agentId: 'opencode', role: 'executor', mode: 'auto', dependsOn: ['review'] }
    ]
  },
  multiModelFusion: {
    enabled: true,
    maxCandidates: 3,
    maxRounds: 3,
    allowExecutor: true
  }
}

const turnResult: TurnCreateResultLike = {
  thread: {
    id: 'thread-1',
    workspaceId: null,
    title: 'Thread',
    createdAt: 1,
    updatedAt: 1
  },
  turn: {
    id: 'turn-1',
    threadId: 'thread-1',
    prompt: validTurnPayload.prompt,
    mode: 'custom',
    status: 'queued',
    taskIds: [],
    createdAt: 1,
    attachments: validTurnPayload.attachments,
    customSchedule: validTurnPayload.customSchedule,
    multiModelFusion: validTurnPayload.multiModelFusion,
    modelSelection: validTurnPayload.modelSelection,
    thinking: validTurnPayload.thinking
  }
}

describe('turns IPC runtime validation', () => {
  it('rejects invalid turn creation payloads before side effects', async () => {
    const createHandler = vi.fn(async () => turnResult)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('turns:create', createHandler)

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      prompt: ''
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.prompt must not be empty'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      mode: 'manual'
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.mode must be one of: auto, broadcast, chain, orchestrate, lead-workers, parallel-review, firefly-custom, custom'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      modelSelection: { providerId: 'deepseek', modelId: 'deepseek-chat', source: 'shell' }
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.modelSelection.source must be one of: provider, local-cli'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      attachments: [{ id: 'att-1', kind: 'binary', name: 'bad.bin' }]
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.attachments[0].kind must be one of: file, image, text'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      customSchedule: {
        ...validTurnPayload.customSchedule,
        steps: [
          { id: 'review', label: 'Review', agentId: 'codex', role: 'reviewer', mode: 'auto' },
          { id: 'review', label: 'Again', agentId: 'codex', role: 'executor', mode: 'auto' }
        ]
      }
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.customSchedule.steps must not contain duplicate step id review'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      multiModelFusion: { enabled: true, maxCandidates: 4, maxRounds: 3, allowExecutor: true }
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.multiModelFusion.maxCandidates must be one of: 2, 3'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      multiModelFusion: { enabled: true, maxCandidates: 3, maxRounds: 3, allowExecutor: true, extra: true }
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.multiModelFusion.extra is not allowed'))

    expect(createHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid turn action payloads before side effects', async () => {
    const retryHandler = vi.fn(async () => turnResult)
    const cancelHandler = vi.fn(async () => true)
    const cancelAgentHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('turns:retry', retryHandler)
    typedHandle('turns:cancel', cancelHandler)
    typedHandle('turns:cancelAgent', cancelAgentHandler)

    expect(() => electronMock.handlers.get('turns:retry')?.({}, { turnId: '', retryStrategy: 'reuse-selection' })).toThrow(
      new IpcPayloadValidationError('turns:retry', 'input.turnId must not be empty')
    )
    expect(() => electronMock.handlers.get('turns:retry')?.({}, { turnId: 'turn-1', retryStrategy: 'retry' })).toThrow(
      new IpcPayloadValidationError('turns:retry', 'input.retryStrategy must be one of: reuse-selection, reoptimize')
    )
    expect(() => electronMock.handlers.get('turns:cancel')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('turns:cancel', 'turnId must be a string')
    )
    expect(() => electronMock.handlers.get('turns:cancelAgent')?.({}, 'turn-1', '')).toThrow(
      new IpcPayloadValidationError('turns:cancelAgent', 'agentId must not be empty')
    )
    expect(retryHandler).not.toHaveBeenCalled()
    expect(cancelHandler).not.toHaveBeenCalled()
    expect(cancelAgentHandler).not.toHaveBeenCalled()
  })

  it('passes valid turn payloads through unchanged', async () => {
    const createHandler = vi.fn(async () => turnResult)
    const retryHandler = vi.fn(async () => turnResult)
    const cancelHandler = vi.fn(async () => true)
    const cancelAgentHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('turns:create', createHandler)
    typedHandle('turns:retry', retryHandler)
    typedHandle('turns:cancel', cancelHandler)
    typedHandle('turns:cancelAgent', cancelAgentHandler)

    await expect(electronMock.handlers.get('turns:create')?.({}, validTurnPayload)).resolves.toBe(turnResult)
    await expect(electronMock.handlers.get('turns:retry')?.({}, { turnId: 'turn-1', retryStrategy: 'reoptimize' })).resolves.toBe(turnResult)
    await expect(electronMock.handlers.get('turns:cancel')?.({}, 'turn-1')).resolves.toBe(true)
    await expect(electronMock.handlers.get('turns:cancelAgent')?.({}, 'turn-1', 'codex')).resolves.toBe(true)

    expect(createHandler).toHaveBeenCalledWith({}, validTurnPayload)
    expect(retryHandler).toHaveBeenCalledWith({}, { turnId: 'turn-1', retryStrategy: 'reoptimize' })
    expect(cancelHandler).toHaveBeenCalledWith({}, 'turn-1')
    expect(cancelAgentHandler).toHaveBeenCalledWith({}, 'turn-1', 'codex')
  })

  it('binds durable admissions and queue inspection to the invoking sender', async () => {
    const calls: string[] = []
    const coordinator = {
      enqueueCreate: vi.fn(async () => turnResult),
      enqueueRetry: vi.fn(async () => turnResult),
      rerunInterruptedTurn: vi.fn(async () => turnResult),
      cancelTurn: vi.fn(async () => true),
      beginTurnCancellation: vi.fn(async () => undefined),
      abortTurnExecution: vi.fn(async () => { calls.push('abort-root') }),
      finishTurnCancellation: vi.fn(async () => undefined),
      clearQueue: vi.fn(async () => ['turn-queued'])
    }
    const runtimeStore = {
      getTurn: vi.fn((turnId: string) => turnId === 'turn-1'
        ? { id: turnId, threadId: 'thread-1', ownerWebContentsId: 41 }
        : undefined),
      cancelAgentRun: vi.fn(async () => true),
      listQueuedSubmissions: vi.fn(() => [
        { id: 'submission-1', threadId: 'thread-1', turnId: 'turn-queued', ownerWebContentsId: 41, source: 'create' as const, state: 'queued' as const, createdAt: 1, admissionSequence: 1, input: validTurnPayload },
        { id: 'submission-2', threadId: 'thread-1', turnId: 'foreign-turn', ownerWebContentsId: 42, source: 'create' as const, state: 'queued' as const, createdAt: 2, admissionSequence: 2, input: validTurnPayload }
      ])
    }
    const dispatcher = {
      preCancelTurn: vi.fn(() => { calls.push('tombstone'); return true }),
      cancelTurn: vi.fn(() => { calls.push('dispatcher'); return true }),
      preCancelAgentForTurn: vi.fn(() => { calls.push('tombstone'); return true }),
      cancelAgentForTurn: vi.fn(() => true)
    }
    const { registerTurnsIpc } = await import('../turns-ipc')
    registerTurnsIpc({
      coordinator,
      runtimeStore,
      decisionService: {
        cancelTurn: vi.fn(async () => { calls.push('decision') }),
        cancelAgentDecisions: vi.fn(async () => { calls.push('decision-agent') })
      },
      dispatcher
    })

    const sender41 = { sender: { id: 41 } }
    const sender42 = { sender: { id: 42 } }
    await expect(electronMock.handlers.get('turns:create')?.(sender41, validTurnPayload)).resolves.toBe(turnResult)
    await expect(electronMock.handlers.get('turns:retry')?.(sender41, { turnId: 'turn-1', retryStrategy: 'reoptimize' })).resolves.toBe(turnResult)
    await expect(electronMock.handlers.get('turns:rerunInterrupted')?.(sender41, 'turn-1')).resolves.toBe(turnResult)
    expect(electronMock.handlers.get('turns:listQueuedSubmissions')?.(sender41, 'thread-1')).toEqual([
      expect.objectContaining({ turnId: 'turn-queued', ownerWebContentsId: 41 })
    ])
    await expect(electronMock.handlers.get('turns:clearQueue')?.(sender41, 'thread-1')).resolves.toEqual([])
    await expect(electronMock.handlers.get('turns:cancel')?.(sender41, 'turn-1')).resolves.toBe(true)
    await expect(electronMock.handlers.get('turns:cancel')?.(sender42, 'turn-1')).resolves.toBe(false)

    expect(coordinator.enqueueCreate).toHaveBeenCalledWith(validTurnPayload, 41)
    expect(coordinator.enqueueRetry).toHaveBeenCalledWith({ turnId: 'turn-1', retryStrategy: 'reoptimize' }, 41)
    expect(coordinator.rerunInterruptedTurn).toHaveBeenCalledWith('turn-1', 41)
    expect(coordinator.clearQueue).not.toHaveBeenCalled()
    expect(calls).toEqual(['tombstone', 'abort-root', 'decision', 'dispatcher'])
    expect(coordinator.abortTurnExecution).toHaveBeenCalledWith('turn-1', 'Cancelled by user.')
    expect(dispatcher.cancelTurn).toHaveBeenCalledTimes(1)
    expect(coordinator.cancelTurn).toHaveBeenCalledWith('turn-1', { runnerAlreadyCancelled: true })
  })

  it('routes a completed Turn retry through the normal retry path', async () => {
    const coordinator = {
      enqueueCreate: vi.fn(),
      enqueueRetry: vi.fn(async () => turnResult),
      rerunInterruptedTurn: vi.fn(),
      cancelTurn: vi.fn(),
      beginTurnCancellation: vi.fn(),
      finishTurnCancellation: vi.fn(),
      clearQueue: vi.fn()
    }
    const { registerTurnsIpc } = await import('../turns-ipc')
    registerTurnsIpc({
      coordinator,
      runtimeStore: {
        getTurn: () => ({ id: 'turn-completed', threadId: 'thread-1', ownerWebContentsId: 41, status: 'completed' }),
        listQueuedSubmissions: () => [],
        cancelAgentRun: vi.fn()
      },
      decisionService: { cancelTurn: vi.fn(), cancelAgentDecisions: vi.fn() },
      dispatcher: {
        preCancelTurn: vi.fn(), cancelTurn: vi.fn(), preCancelAgentForTurn: vi.fn(), cancelAgentForTurn: vi.fn()
      }
    })

    await expect(electronMock.handlers.get('turns:retry')?.(
      { sender: { id: 41 } },
      { turnId: 'turn-completed' }
    )).resolves.toBe(turnResult)

    expect(coordinator.enqueueRetry).toHaveBeenCalledWith({
      turnId: 'turn-completed',
      retryStrategy: 'reuse-selection'
    }, 41)
    expect(coordinator.rerunInterruptedTurn).not.toHaveBeenCalled()
  })

  it('waits for dispatcher cancellation before releasing a deferred terminal drain', async () => {
    const calls: string[] = []
    let releaseDispatcher!: (cancelled: boolean) => void
    const coordinator = {
      enqueueCreate: vi.fn(),
      enqueueRetry: vi.fn(),
      rerunInterruptedTurn: vi.fn(),
      clearQueue: vi.fn(),
      beginTurnCancellation: vi.fn(async () => { calls.push('defer') }),
      cancelTurn: vi.fn(async () => { calls.push('durable'); return true }),
      finishTurnCancellation: vi.fn(async () => { calls.push('drain') })
    }
    const { registerTurnsIpc } = await import('../turns-ipc')
    registerTurnsIpc({
      coordinator,
      runtimeStore: {
        getTurn: () => ({ id: 'turn-1', threadId: 'thread-1', ownerWebContentsId: 41 }),
        listQueuedSubmissions: () => [],
        cancelAgentRun: vi.fn(async () => false)
      },
      decisionService: {
        cancelTurn: vi.fn(async () => { calls.push('decision') }),
        cancelAgentDecisions: vi.fn(async () => { calls.push('decision-agent') })
      },
      dispatcher: {
        preCancelTurn: vi.fn(() => { calls.push('tombstone'); return true }),
        cancelTurn: vi.fn(() => {
          calls.push('dispatcher')
          return new Promise<boolean>(resolve => { releaseDispatcher = resolve })
        }),
        preCancelAgentForTurn: vi.fn(() => true),
        cancelAgentForTurn: vi.fn(() => false)
      }
    })

    const cancellation = electronMock.handlers.get('turns:cancel')?.({ sender: { id: 41 } }, 'turn-1') as Promise<boolean>
    await vi.waitFor(() => expect(calls).toEqual(['defer', 'tombstone', 'decision', 'dispatcher']))
    expect(coordinator.cancelTurn).not.toHaveBeenCalled()
    expect(coordinator.finishTurnCancellation).not.toHaveBeenCalled()

    releaseDispatcher(true)
    await expect(cancellation).resolves.toBe(true)
    expect(calls).toEqual(['defer', 'tombstone', 'decision', 'dispatcher', 'durable', 'drain'])
  })

  it('cancels an agent-scoped durable decision before stopping that agent provider loop', async () => {
    const calls: string[] = []
    let tombstoned = false
    let resolveToolDecision!: () => void
    const toolDecision = new Promise<void>(resolve => { resolveToolDecision = resolve })
    let nextProviderRound = 0
    const toolLoop = toolDecision.then(() => {
      if (!tombstoned) nextProviderRound += 1
    })
    const { registerTurnsIpc } = await import('../turns-ipc')
    registerTurnsIpc({
      coordinator: {
        enqueueCreate: vi.fn(), enqueueRetry: vi.fn(), rerunInterruptedTurn: vi.fn(),
        cancelTurn: vi.fn(), clearQueue: vi.fn(), beginTurnCancellation: vi.fn(), finishTurnCancellation: vi.fn()
      },
      runtimeStore: {
        getTurn: () => ({ id: 'turn-1', threadId: 'thread-1', ownerWebContentsId: 41 }),
        listQueuedSubmissions: () => [],
        cancelAgentRun: vi.fn(async () => { calls.push('runtime'); return true })
      },
      decisionService: {
        cancelTurn: vi.fn(),
        cancelAgentDecisions: vi.fn(async () => {
          calls.push('decision')
          resolveToolDecision()
        })
      },
      dispatcher: {
        cancelTurn: vi.fn(),
        preCancelTurn: vi.fn(),
        preCancelAgentForTurn: vi.fn(() => {
          tombstoned = true
          calls.push('tombstone')
          return true
        }),
        cancelAgentForTurn: vi.fn(async () => { calls.push('dispatcher'); return true })
      }
    })

    await expect(electronMock.handlers.get('turns:cancelAgent')?.(
      { sender: { id: 41 } }, 'turn-1', 'codex'
    )).resolves.toBe(true)
    await toolLoop
    await Promise.resolve()
    expect(nextProviderRound).toBe(0)
    expect(calls).toEqual(['tombstone', 'decision', 'runtime', 'dispatcher'])
  })

  it('tombstones a whole turn before a settled tool decision can start another provider round', async () => {
    const calls: string[] = []
    let tombstoned = false
    let resolveToolDecision!: () => void
    const toolDecision = new Promise<void>(resolve => { resolveToolDecision = resolve })
    let nextProviderRound = 0
    const toolContinuation = toolDecision.then(() => {
      if (!tombstoned) nextProviderRound += 1
    })
    const { registerTurnsIpc } = await import('../turns-ipc')
    registerTurnsIpc({
      coordinator: {
        enqueueCreate: vi.fn(), enqueueRetry: vi.fn(), rerunInterruptedTurn: vi.fn(), clearQueue: vi.fn(),
        beginTurnCancellation: vi.fn(async () => { calls.push('defer') }),
        cancelTurn: vi.fn(async () => { calls.push('durable'); return true }),
        finishTurnCancellation: vi.fn(async () => { calls.push('drain') })
      },
      runtimeStore: {
        getTurn: () => ({ id: 'turn-1', threadId: 'thread-1', ownerWebContentsId: 41 }),
        listQueuedSubmissions: () => [],
        cancelAgentRun: vi.fn(async () => false)
      },
      decisionService: {
        cancelTurn: vi.fn(async () => {
          calls.push('decision')
          resolveToolDecision()
        }),
        cancelAgentDecisions: vi.fn()
      },
      dispatcher: {
        preCancelTurn: vi.fn(() => {
          tombstoned = true
          calls.push('tombstone')
          return true
        }),
        cancelTurn: vi.fn(async () => { calls.push('dispatcher'); return true }),
        preCancelAgentForTurn: vi.fn(),
        cancelAgentForTurn: vi.fn()
      }
    })

    await expect(electronMock.handlers.get('turns:cancel')?.(
      { sender: { id: 41 } }, 'turn-1'
    )).resolves.toBe(true)
    await toolContinuation
    await Promise.resolve()

    expect(nextProviderRound).toBe(0)
    expect(calls).toEqual(['defer', 'tombstone', 'decision', 'dispatcher', 'durable', 'drain'])
  })
})
