import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  manager: {
    getBinding: vi.fn(),
    resolveBinding: vi.fn()
  }
}))

vi.mock('../../providers/manager', () => ({
  getProviderManager: () => h.manager
}))
import { Dispatcher } from '../dispatcher'
import type {
  AgentDecisionCheckpointResult,
  AgentDecisionCheckpointState
} from '../../agentic/user-decision-transport'

describe('Dispatcher decision checkpoint continuation', () => {
  it('blocks read-only dispatch before starting an unenforceable stdio-plain adapter', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.localAgentQueues = new Map()
    dispatcher.registry = {
      get: () => ({ adapter: { protocol: 'stdio-plain' } }),
      setStatus: vi.fn()
    }
    dispatcher.isAgentCancelled = () => false
    dispatcher.localAgentAvailability = () => ({ usable: true })
    dispatcher.sendToAgentStdio = vi.fn(async () => ({ content: 'must not run' }))
    h.manager.getBinding.mockReturnValue({ protocol: 'stdio-plain', providerId: 'local-cli' })
    h.manager.resolveBinding.mockReturnValue(null)

    await expect(dispatcher.sendToAgent({} as any, 'claude', 'inspect the project', {
      capabilityMode: 'read-only'
    })).rejects.toMatchObject({ code: 'READ_ONLY_TRANSPORT_UNSUPPORTED' })

    expect(dispatcher.sendToAgentStdio).not.toHaveBeenCalled()
  })

  it.each([
    ['stdio-ndjson', { protocol: 'stdio-ndjson', providerId: 'local-cli' }],
    ['local-cli without a protocol', { providerId: 'local-cli' }]
  ])('blocks read-only %s dispatch before the local adapter starts', async (_label, binding) => {
    const start = vi.fn()
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.localAgentQueues = new Map()
    dispatcher.registry = {
      get: () => ({ adapter: { protocol: 'stdio-ndjson', start } }),
      setStatus: vi.fn()
    }
    dispatcher.isAgentCancelled = () => false
    dispatcher.localAgentAvailability = () => ({ usable: true })
    dispatcher.sendToAgentStdio = vi.fn(async () => ({ content: 'must not run' }))
    h.manager.getBinding.mockReturnValue(binding)
    h.manager.resolveBinding.mockReturnValue(null)

    await expect(dispatcher.sendToAgent({} as any, 'structured-cli', 'inspect the project', {
      capabilityMode: 'read-only'
    })).rejects.toMatchObject({ code: 'READ_ONLY_TRANSPORT_UNSUPPORTED' })

    expect(dispatcher.sendToAgentStdio).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('cancels ACP permission requests in read-only mode without opening the approval path', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    const requestAcpPermission = vi.fn(async () => ({ outcome: 'selected', optionId: 'allow' }))
    let resolution: unknown
    const adapter = {
      cancel: vi.fn(),
      runPrompt: vi.fn(async (_prompt: string, _cwd: string, handlers: any) => {
        resolution = await handlers.onRequestPermission({ tool: 'exec' })
        return 'end_turn'
      })
    }
    dispatcher.registry = { setStatus: vi.fn() }
    dispatcher.pipeline = { process: vi.fn(async () => undefined) }
    dispatcher.isAgentCancelled = () => false
    dispatcher.throwIfAgentCancelled = () => undefined
    dispatcher.localPromptText = (_task: unknown, text: string) => text
    dispatcher.promptForAgent = (_agentId: string, text: string) => text
    dispatcher.withAgentTimeout = async (_task: unknown, _agentId: string, work: () => Promise<unknown>) => work()
    dispatcher.requestAcpPermission = requestAcpPermission
    dispatcher.emit = vi.fn(() => true)

    await expect(dispatcher.sendToAgentAcp({
      id: 'task-read-only-acp',
      results: new Map(),
      errors: new Map()
    }, 'claude', 'inspect the project', {
      capabilityMode: 'read-only',
      lineage: { origin: 'workbench:create', policy: 'optimize' }
    }, adapter)).resolves.toEqual({ content: '' })

    expect(resolution).toEqual({ outcome: 'cancelled' })
    expect(requestAcpPermission).not.toHaveBeenCalled()
  })

  it('releases the local Agent queue before checkpoint re-dispatch', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.localAgentQueues = new Map()
    dispatcher.registry = {
      get: () => ({ adapter: {} }),
      setStatus: vi.fn()
    }
    dispatcher.isAgentCancelled = () => false
    dispatcher.localAgentAvailability = () => ({ usable: true })
    dispatcher.sendToAgentStdio = vi.fn(async () => ({
      content: '',
      decisionCheckpoint: {
        state: { turnId: 'turn-1' },
        result: { sessionId: 'session-1' }
      }
    }))
    dispatcher.redispatchDecisionCheckpoint = vi.fn(async () => {
      expect(dispatcher.localAgentQueues.has('claude')).toBe(false)
      return { content: 'continued' }
    })
    h.manager.getBinding.mockReturnValue({ protocol: 'stdio-plain', providerId: 'local-cli' })
    h.manager.resolveBinding.mockReturnValue(null)

    await expect(dispatcher.sendToAgent({} as any, 'claude', 'resume', {})).resolves.toEqual({ content: 'continued' })
    expect(dispatcher.redispatchDecisionCheckpoint).toHaveBeenCalledOnce()
  })

  it('routes a controlled stdio-ndjson binding through the local adapter', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.localAgentQueues = new Map()
    dispatcher.registry = {
      get: () => ({ adapter: { protocol: 'stdio-ndjson' } }),
      setStatus: vi.fn()
    }
    dispatcher.isAgentCancelled = () => false
    dispatcher.localAgentAvailability = () => ({ usable: true })
    dispatcher.sendToAgentStdio = vi.fn(async () => ({ content: 'structured result' }))
    h.manager.getBinding.mockReturnValue({ protocol: 'stdio-ndjson', providerId: 'local-cli' })
    h.manager.resolveBinding.mockReturnValue(null)

    await expect(dispatcher.sendToAgent({} as any, 'structured-cli', 'continue', {}))
      .resolves.toEqual({ content: 'structured result' })
    expect(dispatcher.sendToAgentStdio).toHaveBeenCalledOnce()
  })

  it('requires a matching registered protocol for controlled stdio-ndjson bindings', () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.registry = {
      get: () => ({
        status: 'idle',
        adapter: {
          binary: 'structured-cli',
          getLifecycle: () => ({
            protocol: 'stdio-plain', mode: 'oneshot', status: 'idle', running: false,
            exitCode: null, lastStderr: ''
          })
        }
      })
    }

    expect(dispatcher.localAgentAvailability('structured-cli', {
      agentId: 'structured-cli', providerId: 'local-cli', modelId: 'local', protocol: 'stdio-ndjson'
    })).toMatchObject({ usable: false, code: 'LOCAL_AGENT_PROTOCOL_MISMATCH' })
  })

  it('does not prompt when an NDJSON adapter lacks a matching continuation capability', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    const requestUserDecision = vi.fn()
    const adapter: any = {
      protocol: 'stdio-ndjson',
      decisionContinuation: 'none',
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      send: vi.fn(() => adapter.onProtocolEvent?.({
        type: 'decision_request',
        version: 1,
        requestId: 'request-1',
        sessionId: 'session-1',
        continuation: { mode: 'live' },
        request: {
          idempotencyKey: 'scope-step',
          title: 'Choose scope',
          options: [{ id: 'focused', label: 'Focused repair' }]
        }
      })),
      getLifecycle: () => ({
        protocol: 'stdio-ndjson', mode: 'oneshot', status: 'idle', running: false,
        exitCode: null, lastStderr: ''
      })
    }
    dispatcher.registry = { setStatus: vi.fn() }
    dispatcher.pipeline = { process: vi.fn(async () => undefined) }
    dispatcher.isAgentCancelled = () => false
    dispatcher.throwIfAgentCancelled = () => undefined
    dispatcher.withAgentTimeout = async (_task: unknown, _agentId: string, work: () => Promise<unknown>) => work()
    dispatcher.localPromptText = () => 'prompt'
    dispatcher.promptForAgent = () => 'prompt'
    const task = {
      id: 'task-1', results: new Map(), errors: new Map(), usage: new Map(), thinking: new Map(), thinkingSummary: new Map()
    } as any

    await expect(dispatcher.sendToAgentStdio(task, 'claude', 'prompt', {
      userDecisionAdapter: { forAgent: vi.fn(() => requestUserDecision) }
    }, null, adapter)).resolves.toEqual({ content: '' })

    expect(requestUserDecision).not.toHaveBeenCalled()
    expect(adapter.stop).toHaveBeenCalled()
  })

  it('re-dispatches the same Agent with the same turnId and a child dispatch lineage', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.sendToAgent = vi.fn(async () => ({ content: 'continued' }))
    const task = { id: 'task-1' } as any
    const state: AgentDecisionCheckpointState = {
      version: 1,
      turnId: 'turn-1',
      threadId: 'thread-1',
      agentId: 'claude',
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      requestId: 'request-1',
      lineage: {
        origin: 'workbench:create',
        policy: 'optimize',
        rootInputId: 'input-1',
        rootEnvelopeId: 'envelope-1',
        rootPreparedTextHash: 'prepared-hash'
      },
      dispatchEnvelope: {
        origin: 'workbench:create',
        policy: 'optimize',
        rootInputId: 'input-1',
        rootEnvelopeId: 'envelope-1',
        rootPreparedTextHash: 'prepared-hash',
        dispatchId: 'dispatch-1',
        providerId: 'local-cli',
        modelId: 'claude',
        canonicalPayloadHash: 'payload-hash',
        optimizationCount: 0
      },
      context: {
        prompt: 'repair it',
        conversationText: 'repair it'
      }
    }
    const result: AgentDecisionCheckpointResult = {
      type: 'decision_result',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      resolution: {
        status: 'selected',
        selectedOptionIds: ['focused'],
        resolvedAt: 20
      }
    }

    await dispatcher.redispatchDecisionCheckpoint({
      task,
      state,
      result,
      opts: {
        turnId: 'turn-1',
        threadId: 'thread-1',
        lineage: state.lineage,
        parentDispatchId: 'stale-parent',
        conversationText: 'old conversation',
        messages: [{ role: 'user', content: 'old conversation' }]
      }
    })

    expect(dispatcher.sendToAgent).toHaveBeenCalledWith(
      task,
      'claude',
      expect.stringContaining('"checkpointId":"checkpoint-1"'),
      expect.objectContaining({
        turnId: 'turn-1',
        threadId: 'thread-1',
        parentDispatchId: 'dispatch-1',
        messages: undefined,
        conversationText: expect.stringContaining('"decision_checkpoint_resume"'),
        lineage: expect.objectContaining({
          origin: 'internal:agentic-round',
          rootInputId: 'input-1',
          rootEnvelopeId: 'envelope-1',
          rootPreparedTextHash: 'prepared-hash',
          parentDispatchId: 'dispatch-1'
        })
      })
    )
  })

  it('aborts a pending stdio Agent decision when the dispatch is stopped', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.activeAgentStops = new Map()
    dispatcher.sourceOperations = new Set()
    dispatcher.registry = { setStatus: vi.fn() }
    dispatcher.pipeline = { process: vi.fn(async () => undefined) }
    dispatcher.isAgentCancelled = () => false
    dispatcher.throwIfAgentCancelled = () => undefined
    dispatcher.localPromptText = () => 'prompt'
    dispatcher.promptForAgent = () => 'prompt'

    let running = true
    let decisionSignal: AbortSignal | undefined
    const adapter: any = {
      protocol: 'stdio-ndjson',
      decisionContinuation: 'live',
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => { running = false }),
      resumeDecision: vi.fn(async () => undefined),
      send: vi.fn(() => adapter.onProtocolEvent?.({
        type: 'decision_request',
        version: 1,
        requestId: 'request-1',
        sessionId: 'session-1',
        continuation: { mode: 'live' },
        request: {
          idempotencyKey: 'scope-step',
          title: 'Choose scope',
          options: [{ id: 'focused', label: 'Focused repair' }]
        }
      })),
      getLifecycle: () => ({
        protocol: 'stdio-ndjson', mode: 'oneshot', status: running ? 'busy' : 'idle', running,
        exitCode: null, lastStderr: ''
      })
    }
    const requestUserDecision = vi.fn(async () => new Promise(resolve => {
      decisionSignal?.addEventListener('abort', () => resolve({
        status: 'cancelled',
        resolvedAt: 1
      }), { once: true })
    }))
    const task = {
      id: 'task-1', results: new Map(), errors: new Map(), usage: new Map(), thinking: new Map(), thinkingSummary: new Map()
    } as any

    const pending = dispatcher.sendToAgentStdio(task, 'claude', 'prompt', {
      userDecisionAdapter: {
        forAgent: vi.fn((_agentId: string, signal?: AbortSignal) => {
          decisionSignal = signal
          return requestUserDecision
        })
      }
    }, null, adapter)

    await vi.waitFor(() => expect(requestUserDecision).toHaveBeenCalledOnce())
    expect(decisionSignal).toBeDefined()
    for (const stop of dispatcher.activeAgentStops.get('task-1:claude')) stop()

    await expect(pending).resolves.toMatchObject({ error: '已暂停该 Agent。' })
    expect(decisionSignal?.aborted).toBe(true)
  })

  it('keeps a checkpoint decision alive after its structured process exits until the user responds', async () => {
    const dispatcher = Object.create(Dispatcher.prototype) as any
    dispatcher.activeAgentStops = new Map()
    dispatcher.sourceOperations = new Set()
    dispatcher.registry = { setStatus: vi.fn() }
    dispatcher.pipeline = { process: vi.fn(async () => undefined) }
    dispatcher.isAgentCancelled = () => false
    dispatcher.throwIfAgentCancelled = () => undefined
    dispatcher.localPromptText = () => 'prompt'
    dispatcher.promptForAgent = () => 'prompt'

    let decisionSignal: AbortSignal | undefined
    let resolveDecision!: (value: any) => void
    const requestUserDecision = vi.fn(async () => new Promise(resolve => { resolveDecision = resolve }))
    const adapter: any = {
      protocol: 'stdio-ndjson',
      decisionContinuation: 'checkpoint',
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      send: vi.fn(() => adapter.onProtocolEvent?.({
        type: 'decision_request',
        version: 1,
        requestId: 'request-1',
        sessionId: 'session-1',
        continuation: { mode: 'checkpoint', checkpointId: 'checkpoint-1' },
        request: {
          idempotencyKey: 'scope-step',
          title: 'Choose scope',
          options: [{ id: 'focused', label: 'Focused repair' }]
        }
      })),
      getLifecycle: () => ({
        protocol: 'stdio-ndjson', mode: 'oneshot', status: 'idle', running: false,
        exitCode: null, lastStderr: ''
      })
    }
    const task = {
      id: 'task-1', results: new Map(), errors: new Map(), usage: new Map(), thinking: new Map(), thinkingSummary: new Map()
    } as any
    const pending = dispatcher.sendToAgentStdio(task, 'claude', 'prompt', {
      turnId: 'turn-1',
      threadId: 'thread-1',
      userDecisionAdapter: {
        forAgent: vi.fn((_agentId: string, signal?: AbortSignal) => {
          decisionSignal = signal
          return requestUserDecision
        })
      }
    }, null, adapter)

    await vi.waitFor(() => expect(requestUserDecision).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 300))
    const wasAbortedBeforeSelection = decisionSignal?.aborted
    resolveDecision({ status: 'selected', selectedOptionIds: ['focused'], resolvedAt: 1 })

    await expect(pending).resolves.toMatchObject({
      decisionCheckpoint: { state: { checkpointId: 'checkpoint-1' } }
    })
    expect(wasAbortedBeforeSelection).toBe(false)
  })
})
