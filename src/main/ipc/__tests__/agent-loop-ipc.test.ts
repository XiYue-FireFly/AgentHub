import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const detectorMock = vi.hoisted(() => ({
  detectAgentsAsync: vi.fn()
}))

const integrationMock = vi.hoisted(() => ({
  getAgentLoopIntegration: vi.fn(() => ({}))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../hub/agent-detector', () => ({
  detectAgentsAsync: detectorMock.detectAgentsAsync
}))

vi.mock('../../hub/agent-loop-integration', () => ({
  getAgentLoopIntegration: integrationMock.getAgentLoopIntegration
}))

describe('agent loop IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    detectorMock.detectAgentsAsync.mockReset()
    integrationMock.getAgentLoopIntegration.mockClear()
    vi.resetModules()
  })

  async function setup() {
    const { registerAgentLoopIpc } = await import('../agent-loop-ipc')
    const registry = {}
    registerAgentLoopIpc(registry as any)
    return registry
  }

  it('returns the renderer-facing config shape', async () => {
    const registry = await setup()

    const result = electronMock.handlers.get('agentLoop:getConfig')?.({})

    expect(integrationMock.getAgentLoopIntegration).toHaveBeenCalledWith(registry)
    expect(result).toEqual({
      maxSteps: 10,
      timeoutMs: 120000,
      enableDelegation: true,
      mode: 'auto'
    })
  })

  it('returns only detected agents with role metadata and caches normal reads', async () => {
    await setup()
    detectorMock.detectAgentsAsync.mockResolvedValueOnce([
      { id: 'codex', name: 'Codex', found: true, version: '1.0.0', path: 'codex', capabilities: ['raw'] },
      { id: 'missing', name: 'Missing', found: false, capabilities: ['raw'] }
    ])

    const first = await electronMock.handlers.get('agentLoop:getAgents')?.({})
    const second = await electronMock.handlers.get('agentLoop:getAgents')?.({})

    expect(first).toEqual([{
      id: 'codex',
      name: 'Codex',
      role: 'implementer',
      capabilities: ['coding', 'implementation', 'debug'],
      version: '1.0.0',
      path: 'codex'
    }])
    expect(second).toEqual(first)
    expect(detectorMock.detectAgentsAsync).toHaveBeenCalledTimes(1)
  })

  it('refreshes detected agents without using the cache', async () => {
    await setup()
    detectorMock.detectAgentsAsync
      .mockResolvedValueOnce([{ id: 'codex', name: 'Codex', found: true, capabilities: ['raw'] }])
      .mockResolvedValueOnce([{ id: 'hermes', name: 'Hermes', found: true, capabilities: ['raw'] }])

    await electronMock.handlers.get('agentLoop:getAgents')?.({})
    const refreshed = await electronMock.handlers.get('agentLoop:refreshAgents')?.({})

    expect(refreshed).toEqual([{
      id: 'hermes',
      name: 'Hermes',
      role: 'explorer',
      capabilities: ['code-search', 'analysis', 'tools'],
      version: undefined,
      path: undefined
    }])
    expect(detectorMock.detectAgentsAsync).toHaveBeenCalledTimes(2)
  })

  it('clears the cached agents before a failed manual refresh', async () => {
    await setup()
    detectorMock.detectAgentsAsync
      .mockResolvedValueOnce([{ id: 'codex', name: 'Codex', found: true, capabilities: ['raw'] }])
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce([{ id: 'hermes', name: 'Hermes', found: true, capabilities: ['raw'] }])

    await electronMock.handlers.get('agentLoop:getAgents')?.({})
    await expect(Promise.resolve(electronMock.handlers.get('agentLoop:refreshAgents')?.({}))).rejects.toThrow('refresh failed')
    const afterFailure = await electronMock.handlers.get('agentLoop:getAgents')?.({})

    expect(afterFailure).toEqual([{
      id: 'hermes',
      name: 'Hermes',
      role: 'explorer',
      capabilities: ['code-search', 'analysis', 'tools'],
      version: undefined,
      path: undefined
    }])
    expect(detectorMock.detectAgentsAsync).toHaveBeenCalledTimes(3)
  })

  it('routes common prompts to the expected role families', async () => {
    await setup()

    expect(electronMock.handlers.get('agentLoop:getRouteInfo')?.({}, 'search project files')).toMatchObject({
      taskType: 'search',
      selectedAgent: 'hermes',
      suggestedRole: 'explorer'
    })
    expect(electronMock.handlers.get('agentLoop:getRouteInfo')?.({}, 'review the patch')).toMatchObject({
      taskType: 'review',
      selectedAgent: 'claude',
      suggestedRole: 'reviewer'
    })
    expect(electronMock.handlers.get('agentLoop:getRouteInfo')?.({}, 'implement the feature')).toMatchObject({
      taskType: 'implement',
      selectedAgent: 'codex',
      suggestedRole: 'implementer'
    })
  })
})
