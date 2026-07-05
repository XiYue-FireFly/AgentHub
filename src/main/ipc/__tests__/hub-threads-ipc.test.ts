import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: any, ...args: any[]) => any

const handlers = new Map<string, IpcHandler>()
const optionalWorkbenchWorkspace = vi.fn((workspaceId?: string | null): string | null => workspaceId ?? 'active-workspace')
const buildContextProjection = vi.fn((): any => ({ blocks: [] }))
const runGitQuery = vi.fn()

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
    depOverrides: Partial<Record<'hub' | 'dispatcher' | 'registry' | 'proxy' | 'memory', any>> = {}
  ) {
    const knownTurnIds = new Set(['turn-1'])
    const runtimeStore = {
      listThreads: vi.fn(() => [thread('thread-1')]),
      createThread: vi.fn((input) => thread('created', input?.title ?? 'created')),
      renameThread: vi.fn((id, title) => thread(id, title)),
      deleteThread: vi.fn(() => true),
      selectThread: vi.fn((id) => id),
      eventsSince: vi.fn(() => []),
      appendStreamEvent: vi.fn((turnId) => {
        if (!knownTurnIds.has(turnId)) throw new Error(`Turn not found: ${turnId}`)
      }),
      snapshot: vi.fn(() => ({ threads: [thread('snapshot-thread')], turns: [], runs: [], activeThreadId: 'snapshot-thread' })),
      getThread: vi.fn(),
      createTurn: vi.fn((input) => {
        const turnId = input?.threadId === 'created' ? 'fork-turn' : 'turn-1'
        knownTurnIds.add(turnId)
        return { thread: thread(input?.threadId ?? 'git-thread'), turn: { id: turnId } }
      }),
      setTurnStatus: vi.fn(),
      ...overrides
    }
    const mod = await import('../hub-threads-ipc')
    const defaultDispatcher = { getRecentTasks: vi.fn(() => []) }
    const defaultRegistry = { getAll: vi.fn(() => []) }
    const defaultProxy = { getUrl: vi.fn(() => '') }
    mod.registerHubThreadsIpc({
      hub: 'hub' in depOverrides ? depOverrides.hub : null,
      dispatcher: 'dispatcher' in depOverrides ? depOverrides.dispatcher : defaultDispatcher,
      registry: 'registry' in depOverrides ? depOverrides.registry : defaultRegistry,
      runtimeStore,
      memory: 'memory' in depOverrides ? depOverrides.memory : () => ({ selectContextEntries: vi.fn(() => []) }),
      proxy: 'proxy' in depOverrides ? depOverrides.proxy : defaultProxy,
      getWorkspaceManager: vi.fn()
    })
    return runtimeStore
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

    expect(await handlers.get('threads:delete')?.({}, 'thread-1')).toBe(true)
    expect(runtimeStore.deleteThread).toHaveBeenCalledWith('thread-1')

    expect(await handlers.get('threads:select')?.({}, 'thread-1')).toBe('thread-1')
    expect(runtimeStore.selectThread).toHaveBeenCalledWith('thread-1')
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
    const runtimeStore = await setup({
      getThread: vi.fn(() => existingThread),
      createTurn: vi.fn((input) => ({
        thread: thread(input?.threadId ?? 'git-thread'),
        turn: { id: 'turn-1' }
      }))
    })

    const result = await handlers.get('git:query')?.({}, {
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      query: 'log --oneline'
    })

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
    expect(runtimeStore.setTurnStatus).toHaveBeenCalledWith('turn-1', 'completed')
    expect(result).toEqual({ threadId: 'thread-1', turnId: 'turn-1', result: 'clean' })
  })

  it('git:query failure appends the error with turn id, marks failed, and returns null result with error', async () => {
    runGitQuery.mockRejectedValue(new Error('git exploded'))
    const runtimeStore = await setup()

    const result = await handlers.get('git:query')?.({}, { workspaceId: 'ws-1', query: '' })

    expect(runtimeStore.createTurn).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      prompt: 'git status'
    }))
    expect(runGitQuery).toHaveBeenCalledWith('ws-1', 'status')
    expect(runtimeStore.setTurnStatus).toHaveBeenCalledWith('turn-1', 'failed')
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('turn-1', {
      turnId: 'turn-1',
      type: 'content',
      content: 'Git query failed: git exploded',
      agentId: 'git'
    })
    expect(runtimeStore.appendStreamEvent.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeStore.setTurnStatus.mock.invocationCallOrder[0]
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
    expect(runtimeStore.setTurnStatus).toHaveBeenCalledWith('fork-turn', 'failed')
    expect(result).toMatchObject({ id: 'created' })
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
