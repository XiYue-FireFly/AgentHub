import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'
import { RuntimeProducerTracker } from '../../runtime/producer-tracker'

type IpcHandler = (event: any, ...args: any[]) => any

const handlers = new Map<string, IpcHandler>()
const optionalWorkbenchWorkspace = vi.fn((workspaceId?: string | null): string | null => workspaceId ?? 'active-workspace')
const buildContextProjection = vi.fn((): any => ({ blocks: [] }))
const runGitQuery = vi.fn()

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler)
  }
}))

vi.mock('../../runtime/workspace-helpers', () => ({
  optionalWorkbenchWorkspace
}))

vi.mock('../../runtime/context-ledger', () => ({
  buildContextProjection
}))

vi.mock('../../runtime/git', () => ({
  runGitQuery
}))

function thread(id: string, title = id) {
  return {
    id,
    workspaceId: 'ws-1',
    title,
    createdAt: 1,
    updatedAt: 2
  }
}

describe('Hub threads IPC', () => {
  beforeEach(() => {
    handlers.clear()
    optionalWorkbenchWorkspace.mockClear()
    buildContextProjection.mockClear()
    buildContextProjection.mockReturnValue({ blocks: [] })
    runGitQuery.mockReset()
    vi.resetModules()
  })

  async function setup(
    overrides: Partial<Record<string, any>> = {},
    depOverrides: Partial<Record<'hub' | 'dispatcher' | 'registry' | 'proxy' | 'memory' | 'runtimeProducers' | 'decisionService' | 'isDeletionOwnerLive', any>> = {}
  ) {
    const knownTurnIds = new Set(['turn-1'])
    const runtimeStore = {
      listThreads: vi.fn(() => [thread('thread-1')]),
      createThread: vi.fn(async (input) => thread('created', input?.title ?? 'created')),
      renameThread: vi.fn(async (id, title) => thread(id, title)),
      deleteThread: vi.fn(async () => true),
      beginThreadDeletion: vi.fn(async () => ({ status: 'started', work: { turns: [], decisionTurnIds: [] } })),
      finalizeThreadDeletion: vi.fn(async () => ({ status: 'deleted', work: { turns: [], decisionTurnIds: [] } })),
      selectThread: vi.fn(async (id) => id),
      eventsSince: vi.fn(() => []),
      appendStreamEvent: vi.fn(async (turnId) => {
        if (!knownTurnIds.has(turnId)) throw new Error(`Turn not found: ${turnId}`)
      }),
      snapshot: vi.fn(() => ({ threads: [thread('snapshot-thread')], turns: [], runs: [], activeThreadId: 'snapshot-thread' })),
      getThread: vi.fn(),
      createTurn: vi.fn(async (input) => {
        const turnId = input?.threadId === 'created' ? 'fork-turn' : 'turn-1'
        knownTurnIds.add(turnId)
        return { thread: thread(input?.threadId ?? 'git-thread'), turn: { id: turnId } }
      }),
      setTurnStatus: vi.fn(async () => undefined),
      transitionTurnStatus: vi.fn(async () => true),
      cancelTurn: vi.fn(async () => true),
      interruptTurn: vi.fn(async () => true),
      ...overrides
    }
    const mod = await import('../hub-threads-ipc')
    const defaultDispatcher = { getRecentTasks: vi.fn(() => []) }
    const defaultDecisionService = { cancelTurn: vi.fn(async () => undefined) }
    const defaultRegistry = { getAll: vi.fn(() => []) }
    const defaultProxy = { getUrl: vi.fn(() => '') }
    const runtimeProducers = 'runtimeProducers' in depOverrides
      ? depOverrides.runtimeProducers
      : new RuntimeProducerTracker()
    mod.registerHubThreadsIpc({
      hub: 'hub' in depOverrides ? depOverrides.hub : null,
      dispatcher: 'dispatcher' in depOverrides ? depOverrides.dispatcher : defaultDispatcher,
      registry: 'registry' in depOverrides ? depOverrides.registry : defaultRegistry,
      runtimeStore,
      memory: 'memory' in depOverrides ? depOverrides.memory : () => ({ selectContextEntries: vi.fn(() => []) }),
      proxy: 'proxy' in depOverrides ? depOverrides.proxy : defaultProxy,
      getWorkspaceManager: vi.fn(),
      runtimeProducers,
      decisionService: 'decisionService' in depOverrides ? depOverrides.decisionService : defaultDecisionService,
      isDeletionOwnerLive: 'isDeletionOwnerLive' in depOverrides
        ? depOverrides.isDeletionOwnerLive
        : () => true
    })
    return Object.assign(runtimeStore, { runtimeProducers })
  }

  it('registers thread handlers through the typed IPC path', async () => {
    await setup()

    expect([...handlers.keys()].sort()).toEqual([
      'context:projection',
      'git:query',
      'hub:status',
      'runtime:eventsSince',
      'runtime:snapshot',
      'threads:create',
      'threads:delete',
      'threads:fork',
      'threads:list',
      'threads:rename',
      'threads:select'
    ])
  })

  it('returns hub status with agent and task summaries', async () => {
    const createdAt = new Date('2026-07-05T12:00:00.000Z')
    const hub = {
      getUrl: vi.fn(() => 'http://127.0.0.1:3911'),
      getClientCount: vi.fn(() => 3)
    }
    const proxy = { getUrl: vi.fn(() => 'http://127.0.0.1:3922') }
    const registry = {
      getAll: vi.fn(() => [
        {
          id: 'codex',
          name: 'Codex CLI',
          status: 'busy',
          capabilities: ['coding', 'debug'],
          providerId: 'openai',
          modelId: 'gpt-4o',
          errorCount: 2
        }
      ])
    }
    const dispatcher = {
      getRecentTasks: vi.fn(() => [
        {
          id: 'task-1',
          text: 'x'.repeat(60),
          mode: 'broadcast',
          status: 'running',
          createdAt
        }
      ])
    }

    await setup({}, { hub, proxy, registry, dispatcher })

    const status = await handlers.get('hub:status')?.({})

    expect(status).toEqual({
      running: true,
      url: 'http://127.0.0.1:3911',
      proxyUrl: 'http://127.0.0.1:3922',
      clientCount: 3,
      agents: [
        {
          id: 'codex',
          name: 'Codex CLI',
          status: 'busy',
          capabilities: ['coding', 'debug'],
          providerId: 'openai',
          modelId: 'gpt-4o',
          errorCount: 2
        }
      ],
      tasks: [
        {
          id: 'task-1',
          text: 'x'.repeat(50),
          mode: 'broadcast',
          status: 'running',
          createdAt
        }
      ]
    })
    expect(dispatcher.getRecentTasks).toHaveBeenCalledWith(10)
  })

  it('returns default status values when the hub is null', async () => {
    await setup()

    await expect(Promise.resolve(handlers.get('hub:status')?.({}))).resolves.toEqual({
      running: false,
      url: '',
      proxyUrl: '',
      clientCount: 0,
      agents: [],
      tasks: []
    })
  })

  it('rejects invalid hub, thread, runtime, and context payloads before side effects', async () => {
    const runtimeStore = await setup()

    expect(() => handlers.get('hub:status')?.({}, 'extra')).toThrow(
      new IpcPayloadValidationError('hub:status', 'expected no arguments')
    )
    expect(() => handlers.get('threads:list')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('threads:list', 'workspaceId must be a string')
    )
    expect(() => handlers.get('threads:create')?.({}, null)).toThrow(
      new IpcPayloadValidationError('threads:create', 'input must be an object')
    )
    expect(() => handlers.get('threads:rename')?.({}, '', 'Title')).toThrow(
      new IpcPayloadValidationError('threads:rename', 'threadId must not be empty')
    )
    expect(() => handlers.get('threads:delete')?.({}, '')).toThrow(
      new IpcPayloadValidationError('threads:delete', 'threadId must not be empty')
    )
    expect(() => handlers.get('threads:select')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('threads:select', 'threadId must be a string')
    )
    expect(() => handlers.get('threads:fork')?.({}, {
      sourceThreadId: 'source',
      sourceTurnId: 'turn-a',
      message: ''
    })).toThrow(new IpcPayloadValidationError('threads:fork', 'input.message must not be empty'))
    expect(() => handlers.get('runtime:snapshot')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('runtime:snapshot', 'workspaceId must be a string')
    )
    expect(() => handlers.get('runtime:eventsSince')?.({}, 'thread-1', -1)).toThrow(
      new IpcPayloadValidationError('runtime:eventsSince', 'seq must be at least 0')
    )
    expect(() => handlers.get('context:projection')?.({}, {
      prompt: 'Summarize',
      attachments: [{ id: 'bad', kind: 'file', name: 'x', size: -1 }]
    })).toThrow(new IpcPayloadValidationError('context:projection', 'input.attachments[0].size must be at least 0'))
    expect(() => handlers.get('context:projection')?.({}, {
      prompt: 'Summarize',
      pinnedBlocks: [{ id: 'pin-1', kind: 'unknown', title: 'Pinned', participation: 'selected', createdAt: 1 }]
    })).toThrow(
      new IpcPayloadValidationError(
        'context:projection',
        'input.pinnedBlocks[0].kind must be one of: recent_turns, compaction_summary, attachment, memory, browser, skill, write_draft, workspace_file, workspace_state'
      )
    )

    expect(runtimeStore.listThreads).not.toHaveBeenCalled()
    expect(runtimeStore.createThread).not.toHaveBeenCalled()
    expect(runtimeStore.renameThread).not.toHaveBeenCalled()
    expect(runtimeStore.deleteThread).not.toHaveBeenCalled()
    expect(runtimeStore.selectThread).not.toHaveBeenCalled()
    expect(runtimeStore.snapshot).not.toHaveBeenCalled()
    expect(runtimeStore.eventsSince).not.toHaveBeenCalled()
    expect(buildContextProjection).not.toHaveBeenCalled()
  })

  it('returns an empty task list when the dispatcher is absent', async () => {
    await setup({}, { dispatcher: null })

    const status = await handlers.get('hub:status')?.({})

    expect(status).toMatchObject({ tasks: [] })
  })

  it('delegates thread list, rename, delete, and select calls', async () => {
    const runtimeStore = await setup()

    expect(await handlers.get('threads:list')?.({}, 'ws-1')).toEqual([thread('thread-1')])
    expect(runtimeStore.listThreads).toHaveBeenCalledWith('ws-1')

    expect(await handlers.get('threads:rename')?.({}, 'thread-1', 'Renamed')).toMatchObject({ id: 'thread-1', title: 'Renamed' })
    expect(runtimeStore.renameThread).toHaveBeenCalledWith('thread-1', 'Renamed')

    expect(await handlers.get('threads:delete')?.({ sender: { id: 7 } }, 'thread-1')).toBe(true)
    expect(runtimeStore.beginThreadDeletion).toHaveBeenCalledWith('thread-1', 7, expect.any(Function))
    expect(runtimeStore.finalizeThreadDeletion).toHaveBeenCalledWith('thread-1', 7)
    expect(runtimeStore.deleteThread).not.toHaveBeenCalled()

    expect(await handlers.get('threads:select')?.({}, 'thread-1')).toBe('thread-1')
    expect(runtimeStore.selectThread).toHaveBeenCalledWith('thread-1')
  })

  it('cancels a pending decision waiter before deleting its live Turn', async () => {
    const calls: string[] = []
    const decisionWaiter = deferred<'cancelled'>()
    let continuationObservedCancellation = false
    const decisionService = {
      cancelTurn: vi.fn(async (turnId: string) => {
        calls.push(`decision:${turnId}`)
        decisionWaiter.resolve('cancelled')
      })
    }
    const dispatcher = {
      getRecentTasks: vi.fn(() => []),
      preCancelTurn: vi.fn((turnId: string) => {
        calls.push(`tombstone:${turnId}`)
        return true
      }),
      cancelTurn: vi.fn(async (turnId: string) => {
        calls.push(`dispatcher:${turnId}`)
        await decisionWaiter.promise
        continuationObservedCancellation = true
        return true
      })
    }
    const runtimeStore = await setup({
      beginThreadDeletion: vi.fn(async () => ({
        status: 'started',
        work: {
          turns: [{
            id: 'turn-1',
            threadId: 'thread-1',
            ownerWebContentsId: 7,
            status: 'awaiting-decision'
          }],
          decisionTurnIds: ['turn-1']
        }
      })),
      cancelTurn: vi.fn(async (turnId: string) => {
        calls.push(`runtime:${turnId}`)
        return true
      }),
      finalizeThreadDeletion: vi.fn(async (threadId: string) => {
        calls.push(`delete:${threadId}`)
        return { status: 'deleted', work: { turns: [], decisionTurnIds: [] } }
      })
    }, { dispatcher, decisionService })

    await expect(handlers.get('threads:delete')?.({ sender: { id: 7 } }, 'thread-1')).resolves.toBe(true)

    expect(continuationObservedCancellation).toBe(true)
    expect(calls).toEqual([
      'tombstone:turn-1',
      'decision:turn-1',
      'dispatcher:turn-1',
      'runtime:turn-1',
      'delete:thread-1'
    ])
  })

  it('does not delete a thread containing a live Turn owned by another renderer', async () => {
    const dispatcher = {
      getRecentTasks: vi.fn(() => []),
      preCancelTurn: vi.fn(),
      cancelTurn: vi.fn(async () => true)
    }
    const decisionService = { cancelTurn: vi.fn(async () => undefined) }
    const runtimeStore = await setup({
      beginThreadDeletion: vi.fn(async () => ({ status: 'forbidden', work: { turns: [], decisionTurnIds: [] } }))
    }, { dispatcher, decisionService })

    await expect(handlers.get('threads:delete')?.({ sender: { id: 7 } }, 'thread-1')).resolves.toBe(false)

    expect(dispatcher.preCancelTurn).not.toHaveBeenCalled()
    expect(decisionService.cancelTurn).not.toHaveBeenCalled()
    expect(runtimeStore.finalizeThreadDeletion).not.toHaveBeenCalled()
  })

  it('passes the main-process owner liveness predicate into the deletion reservation', async () => {
    const isDeletionOwnerLive = vi.fn((ownerWebContentsId: number) => ownerWebContentsId === 8)
    const beginThreadDeletion = vi.fn(async (_threadId: string, _senderId: number, isOwnerLive: (id: number) => boolean) => {
      expect(isOwnerLive(8)).toBe(true)
      expect(isOwnerLive(9)).toBe(false)
      return { status: 'not-found', work: { turns: [], decisionTurnIds: [] } }
    })
    const runtimeStore = await setup({ beginThreadDeletion }, { isDeletionOwnerLive })

    await expect(handlers.get('threads:delete')?.({ sender: { id: 7 } }, 'thread-1')).resolves.toBe(false)

    expect(beginThreadDeletion).toHaveBeenCalledWith('thread-1', 7, isDeletionOwnerLive)
    expect(isDeletionOwnerLive).toHaveBeenCalledWith(8)
    expect(isDeletionOwnerLive).toHaveBeenCalledWith(9)
  })

  it('keeps the durable deletion gate when cancellation cleanup fails', async () => {
    const calls: string[] = []
    const decisionService = {
      cancelTurn: vi.fn(async (turnId: string) => {
        calls.push(`decision:${turnId}`)
        if (turnId === 'turn-1') throw new Error('decision database unavailable')
      })
    }
    const dispatcher = {
      getRecentTasks: vi.fn(() => []),
      preCancelTurn: vi.fn((turnId: string) => {
        calls.push(`tombstone:${turnId}`)
        return true
      }),
      cancelTurn: vi.fn(async (turnId: string) => {
        calls.push(`dispatcher:${turnId}`)
        return true
      })
    }
    const runtimeStore = await setup({
      beginThreadDeletion: vi.fn(async () => ({
        status: 'started',
        work: {
          turns: [
            { id: 'turn-1', threadId: 'thread-1', ownerWebContentsId: 7, status: 'awaiting-decision' },
            { id: 'turn-2', threadId: 'thread-1', ownerWebContentsId: 7, status: 'running' }
          ],
          decisionTurnIds: ['turn-1', 'turn-2']
        }
      })),
      cancelTurn: vi.fn(async (turnId: string) => {
        calls.push(`runtime:${turnId}`)
        return true
      })
    }, { dispatcher, decisionService })

    await expect(handlers.get('threads:delete')?.({ sender: { id: 7 } }, 'thread-1'))
      .rejects.toThrow(/deletion.*progress/i)

    expect(calls).toEqual([
      'tombstone:turn-1',
      'tombstone:turn-2',
      'decision:turn-1',
      'decision:turn-2',
      'dispatcher:turn-1',
      'dispatcher:turn-2',
      'runtime:turn-1',
      'runtime:turn-2'
    ])
    expect(runtimeStore.finalizeThreadDeletion).not.toHaveBeenCalled()
  })

  it('delegates runtime snapshot and eventsSince queries', async () => {
    const runtimeStore = await setup()

    expect(await handlers.get('runtime:snapshot')?.({}, 'ws-1')).toEqual({
      threads: [thread('snapshot-thread')],
      turns: [],
      runs: [],
      activeThreadId: 'snapshot-thread'
    })
    expect(runtimeStore.snapshot).toHaveBeenCalledWith('ws-1')

    await handlers.get('runtime:eventsSince')?.({}, 'thread-1')
    expect(runtimeStore.eventsSince).toHaveBeenCalledWith('thread-1', 0)

    await handlers.get('runtime:eventsSince')?.({}, 'thread-1', 42)
    expect(runtimeStore.eventsSince).toHaveBeenCalledWith('thread-1', 42)
  })

  it('normalizes workspace ids before creating a thread', async () => {
    const runtimeStore = await setup()

    const result = await handlers.get('threads:create')?.({}, { title: 'New thread' })

    expect(optionalWorkbenchWorkspace).toHaveBeenCalledWith(undefined)
    expect(runtimeStore.createThread).toHaveBeenCalledWith({ title: 'New thread', workspaceId: 'active-workspace' })
    expect(result).toMatchObject({ id: 'created', title: 'New thread' })
  })

  it('context:projection passes thread, workspace, snapshot, events, memories, attachments, draft, and pinned blocks into buildContextProjection', async () => {
    const knownThread = thread('thread-1')
    const snapshot = { threads: [knownThread], turns: [], runs: [], activeThreadId: 'thread-1' }
    const events = [{ id: 'event-1', turnId: 'turn-1' }]
    const memories = [{ id: 'memory-1', content: 'remember this' }]
    const selectContextEntries = vi.fn(() => memories)
    const attachments = [{ id: 'attachment-1', kind: 'text', name: 'note.txt', text: 'hello' }]
    const writeDraft = { title: 'Draft', content: 'body' }
    const pinnedBlocks = [{ id: 'pin-1', kind: 'memory', title: 'Pinned', participation: 'selected', createdAt: 1 }]
    const projection = { threadId: 'thread-1', workspaceId: 'ws-1', blocks: pinnedBlocks, totalEstimateTokens: 1, compacted: false, createdAt: 3 }
    buildContextProjection.mockReturnValue(projection)
    const runtimeStore = await setup({
      getThread: vi.fn(() => knownThread),
      snapshot: vi.fn(() => snapshot),
      eventsSince: vi.fn(() => events)
    }, {
      memory: () => ({ selectContextEntries })
    })

    const result = await handlers.get('context:projection')?.({}, {
      threadId: 'thread-1',
      workspaceId: 'ignored-workspace',
      prompt: 'Summarize',
      attachments,
      writeDraft,
      pinnedBlocks
    })

    expect(result).toBe(projection)
    expect(runtimeStore.getThread).toHaveBeenCalledWith('thread-1')
    expect(runtimeStore.snapshot).toHaveBeenCalledWith(undefined)
    expect(runtimeStore.eventsSince).toHaveBeenCalledWith('thread-1', 0)
    expect(selectContextEntries).toHaveBeenCalledWith('Summarize', { limit: 8, tokenBudget: 3_000 })
    expect(buildContextProjection).toHaveBeenCalledWith({
      thread: knownThread,
      workspaceId: 'ws-1',
      prompt: 'Summarize',
      attachments,
      snapshot,
      events,
      memories,
      pinnedBlocks,
      writeDraft
    })
  })

  it('accepts valid context projection write draft and pinned block payloads', async () => {
    buildContextProjection.mockReturnValue({ blocks: [], totalEstimateTokens: 0, compacted: false, createdAt: 5 })
    await setup()

    expect(handlers.get('context:projection')?.({}, {
      workspaceId: null,
      prompt: '',
      attachments: [{ id: 'attachment-1', kind: 'text', name: 'note.txt', text: '', createdAt: 1 }],
      writeDraft: { title: '', content: '' },
      pinnedBlocks: [{
        id: 'pin-1',
        kind: 'memory',
        title: 'Pinned',
        content: '',
        participation: 'selected',
        pinned: true,
        createdAt: 1
      }]
    })).toEqual({ blocks: [], totalEstimateTokens: 0, compacted: false, createdAt: 5 })

    expect(buildContextProjection).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '',
      attachments: [{ id: 'attachment-1', kind: 'text', name: 'note.txt', text: '', createdAt: 1 }],
      pinnedBlocks: [expect.objectContaining({ id: 'pin-1', kind: 'memory' })],
      writeDraft: { title: '', content: '' }
    }))
  })

  it('context:projection falls back to normalized workspace and empty events for a missing or unknown thread', async () => {
    const snapshot = { threads: [], turns: [], runs: [], activeThreadId: null }
    const runtimeStore = await setup({
      getThread: vi.fn(() => undefined),
      snapshot: vi.fn(() => snapshot),
      eventsSince: vi.fn(() => [{ id: 'should-not-load' }])
    })

    await handlers.get('context:projection')?.({}, { threadId: 'missing-thread', workspaceId: 'ws-input' })

    expect(optionalWorkbenchWorkspace).toHaveBeenCalledWith('ws-input')
    expect(runtimeStore.eventsSince).not.toHaveBeenCalled()
    expect(buildContextProjection).toHaveBeenCalledWith(expect.objectContaining({
      thread: undefined,
      workspaceId: 'ws-input',
      snapshot,
      events: []
    }))
  })

  it('git:query success creates a turn, runs the query, appends with turn id, completes, and returns result', async () => {
    runGitQuery.mockResolvedValue('clean')
    const existingThread = thread('thread-1')
    let releaseAppend!: () => void
    const runtimeStore = await setup({
      getThread: vi.fn(() => existingThread),
      createTurn: vi.fn((input) => ({
        thread: thread(input?.threadId ?? 'git-thread'),
        turn: { id: 'turn-1' }
      })),
      appendStreamEvent: vi.fn(() => new Promise<void>(resolve => {
        releaseAppend = resolve
      }))
    })

    const operation = handlers.get('git:query')?.({}, {
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      query: 'log --oneline'
    })
    await vi.waitFor(() => expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce())
    expect(runtimeStore.transitionTurnStatus).not.toHaveBeenCalled()
    releaseAppend()
    const result = await operation

    expect(runtimeStore.createTurn).toHaveBeenCalledWith({
      threadId: 'thread-1',
      workspaceId: 'ws-1',
      prompt: 'log --oneline',
      mode: 'auto',
      targetAgent: null,
      attachments: [],
      modelSelection: undefined,
      thinking: { mode: 'off', level: 'minimal' }
    })
    expect(runGitQuery).toHaveBeenCalledWith('ws-1', 'log --oneline')
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('turn-1', {
      turnId: 'turn-1',
      type: 'content',
      content: 'clean',
      agentId: 'git'
    })
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('turn-1', ['running'], 'completed')
    expect(result).toEqual({ threadId: 'thread-1', turnId: 'turn-1', result: 'clean' })
  })

  it('tracks an admitted git query until its final runtime write completes', async () => {
    const query = deferred<string>()
    runGitQuery.mockReturnValue(query.promise)
    const runtimeStore = await setup()

    const operation = handlers.get('git:query')?.({}, { workspaceId: 'ws-1', query: 'status' })
    await vi.waitFor(() => expect(runGitQuery).toHaveBeenCalledOnce())
    runtimeStore.runtimeProducers.close()
    let drained = false
    const draining = runtimeStore.runtimeProducers.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)

    query.resolve('clean')
    await operation
    await draining
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('turn-1', ['running'], 'completed')
  })

  it('does not resurrect a cancelled Turn when a deferred git query completes', async () => {
    const query = deferred<string>()
    runGitQuery.mockReturnValue(query.promise)
    let status = 'running'
    const runtimeStore = await setup({
      setTurnStatus: vi.fn(async (_turnId, nextStatus) => { status = nextStatus }),
      transitionTurnStatus: vi.fn(async (_turnId, expectedStatuses, nextStatus) => {
        if (!expectedStatuses.includes(status)) return false
        status = nextStatus
        return true
      })
    })

    const operation = handlers.get('git:query')?.({}, { workspaceId: 'ws-1', query: 'status' })
    await vi.waitFor(() => expect(runGitQuery).toHaveBeenCalledOnce())
    status = 'cancelled'
    query.resolve('clean')
    await operation

    expect(status).toBe('cancelled')
    expect(runtimeStore.setTurnStatus).not.toHaveBeenCalled()
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('turn-1', ['running'], 'completed')
  })

  it('git:query failure appends the error with turn id, marks failed, and returns null result with error', async () => {
    runGitQuery.mockRejectedValue(new Error('git exploded'))
    let releaseAppend!: () => void
    const runtimeStore = await setup({
      appendStreamEvent: vi.fn(() => new Promise<void>(resolve => {
        releaseAppend = resolve
      }))
    })

    const operation = handlers.get('git:query')?.({}, { workspaceId: 'ws-1', query: '' })
    await vi.waitFor(() => expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce())
    expect(runtimeStore.transitionTurnStatus).not.toHaveBeenCalled()
    releaseAppend()
    const result = await operation

    expect(runtimeStore.createTurn).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      prompt: 'git status'
    }))
    expect(runGitQuery).toHaveBeenCalledWith('ws-1', 'status')
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('turn-1', ['running'], 'failed')
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('turn-1', {
      turnId: 'turn-1',
      type: 'content',
      content: 'Git query failed: git exploded',
      agentId: 'git'
    })
    expect(runtimeStore.appendStreamEvent.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeStore.transitionTurnStatus.mock.invocationCallOrder[0]
    )
    expect(result).toEqual({ threadId: 'git-thread', turnId: 'turn-1', result: null, error: 'git exploded' })
  })

  it('git:query rejects before creating a turn when no workspace can be normalized', async () => {
    optionalWorkbenchWorkspace.mockReturnValueOnce(null)
    const runtimeStore = await setup()

    await expect(handlers.get('git:query')?.({}, { workspaceId: null })).rejects.toThrow('Git query requires a workspace')
    expect(runtimeStore.createTurn).not.toHaveBeenCalled()
  })

  it('forks only source turn events into a new thread', async () => {
    const sourceEvents = [
      {
        id: 'event-1',
        threadId: 'source',
        turnId: 'turn-a',
        kind: 'agent:delta',
        agentId: 'codex',
        payload: { kind: 'delta', content: 'keep' }
      },
      {
        id: 'event-3',
        threadId: 'source',
        turnId: 'turn-a',
        kind: 'turn:status',
        payload: { status: 'failed' }
      },
      { id: 'event-2', threadId: 'source', turnId: 'turn-b', kind: 'agent:delta', payload: { content: 'skip' } }
    ]
    const runtimeStore = await setup({
      eventsSince: vi.fn(() => sourceEvents)
    })

    const result = await handlers.get('threads:fork')?.({}, {
      sourceThreadId: 'source',
      sourceTurnId: 'turn-a',
      message: 'Investigate this branch'
    })

    expect(runtimeStore.createThread).toHaveBeenCalledWith({ title: 'Fork: Investigate this branch' })
    expect(runtimeStore.createTurn).toHaveBeenCalledWith({
      threadId: 'created',
      workspaceId: 'ws-1',
      prompt: 'Investigate this branch',
      mode: 'auto',
      targetAgent: null,
      attachments: [],
      modelSelection: undefined,
      thinking: { mode: 'off', level: 'minimal' }
    })
    expect(runtimeStore.eventsSince).toHaveBeenCalledWith('source', 0)
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('fork-turn', {
      kind: 'delta',
      content: 'keep',
      agentId: 'codex',
      turnId: 'fork-turn'
    })
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('fork-turn', ['running'], 'failed')
    expect(result).toMatchObject({ id: 'created' })
  })

  it('tracks an admitted fork until its final runtime write completes', async () => {
    const created = deferred<ReturnType<typeof thread>>()
    const runtimeStore = await setup({
      createThread: vi.fn(() => created.promise)
    })

    const operation = handlers.get('threads:fork')?.({}, {
      sourceThreadId: 'source',
      sourceTurnId: 'turn-a',
      message: 'Tracked fork'
    })
    await vi.waitFor(() => expect(runtimeStore.createThread).toHaveBeenCalledOnce())
    runtimeStore.runtimeProducers.close()
    let drained = false
    const draining = runtimeStore.runtimeProducers.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)

    created.resolve(thread('created'))
    await operation
    await draining
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('fork-turn', ['running'], 'completed')
  })

  it('does not resurrect a cancelled fork while deferred events finish copying', async () => {
    const append = deferred<void>()
    let status = 'running'
    const runtimeStore = await setup({
      eventsSince: vi.fn(() => [{
        id: 'event-1',
        threadId: 'source',
        turnId: 'turn-a',
        kind: 'agent:delta',
        agentId: 'codex',
        payload: { kind: 'delta', content: 'copy me' }
      }]),
      appendStreamEvent: vi.fn(() => append.promise),
      setTurnStatus: vi.fn(async (_turnId, nextStatus) => { status = nextStatus }),
      transitionTurnStatus: vi.fn(async (_turnId, expectedStatuses, nextStatus) => {
        if (!expectedStatuses.includes(status)) return false
        status = nextStatus
        return true
      })
    })

    const operation = handlers.get('threads:fork')?.({}, {
      sourceThreadId: 'source',
      sourceTurnId: 'turn-a',
      message: 'Cancelled fork'
    })
    await vi.waitFor(() => expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce())
    status = 'cancelled'
    append.resolve()
    await operation

    expect(status).toBe('cancelled')
    expect(runtimeStore.setTurnStatus).not.toHaveBeenCalled()
    expect(runtimeStore.transitionTurnStatus).toHaveBeenCalledWith('fork-turn', ['running'], 'completed')
  })

  it.each(['cancelled', 'interrupted'] as const)(
    'terminalizes copied Runs when the source Turn is %s',
    async terminalStatus => {
      let turnStatus = 'running'
      const runStatuses: string[] = []
      const terminalize = async (status: typeof terminalStatus) => {
        turnStatus = status
        for (let index = 0; index < runStatuses.length; index += 1) {
          if (runStatuses[index] === 'running') runStatuses[index] = status
        }
        return true
      }
      const runtimeStore = await setup({
        eventsSince: vi.fn(() => [
          {
            id: 'event-start',
            threadId: 'source',
            turnId: 'turn-a',
            kind: 'agent:start',
            agentId: 'codex',
            payload: { kind: 'start', agentId: 'codex' }
          },
          {
            id: 'event-status',
            threadId: 'source',
            turnId: 'turn-a',
            kind: 'turn:status',
            payload: { status: terminalStatus }
          }
        ]),
        appendStreamEvent: vi.fn(async (_turnId, stream) => {
          if (stream.kind === 'start') runStatuses.push('running')
        }),
        transitionTurnStatus: vi.fn(async (_turnId, expectedStatuses, nextStatus) => {
          if (!expectedStatuses.includes(turnStatus)) return false
          turnStatus = nextStatus
          return true
        }),
        cancelTurn: vi.fn(async () => terminalize('cancelled')),
        interruptTurn: vi.fn(async () => terminalize('interrupted'))
      })

      await handlers.get('threads:fork')?.({}, {
        sourceThreadId: 'source',
        sourceTurnId: 'turn-a',
        message: `Fork ${terminalStatus}`
      })

      expect(turnStatus).toBe(terminalStatus)
      expect(runStatuses).toEqual([terminalStatus])
      const terminalizer = terminalStatus === 'cancelled' ? runtimeStore.cancelTurn : runtimeStore.interruptTurn
      expect(terminalizer).toHaveBeenCalledWith('fork-turn')
    }
  )

  it.each([
    ['git:query', { workspaceId: 'ws-1', query: 'status' }, 'createTurn'],
    ['threads:fork', { sourceThreadId: 'source', sourceTurnId: 'turn-a', message: 'Too late' }, 'createThread']
  ] as const)('rejects new %s work after producer admission closes', async (channel, input, sideEffect) => {
    const runtimeStore = await setup()
    runtimeStore.runtimeProducers.close()

    await expect(handlers.get(channel)?.({}, input)).rejects.toThrow('Runtime producers are shutting down')
    expect(runtimeStore[sideEffect]).not.toHaveBeenCalled()
  })

  it('preserves an interrupted terminal status when forking a turn', async () => {
    const runtimeStore = await setup({
      eventsSince: vi.fn(() => [{
        id: 'event-1',
        threadId: 'source',
        turnId: 'turn-a',
        kind: 'turn:status',
        payload: { status: 'interrupted' }
      }])
    })

    await handlers.get('threads:fork')?.({}, {
      sourceThreadId: 'source',
      sourceTurnId: 'turn-a',
      message: 'Resume interrupted work'
    })

    expect(runtimeStore.interruptTurn).toHaveBeenCalledWith('fork-turn')
  })

  it('rejects fork input without a non-empty message', async () => {
    await setup()

    expect(() => handlers.get('threads:fork')?.({}, {
      sourceThreadId: 'source',
      sourceTurnId: 'turn-a',
      message: '   '
    })).toThrow(new IpcPayloadValidationError('threads:fork', 'input.message must not be empty'))
  })
})
