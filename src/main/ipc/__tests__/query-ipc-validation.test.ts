import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

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

const noArgChannels = [
  'win:minimize',
  'win:maximizeToggle',
  'win:isMaximized',
  'win:close',
  'proxy:info',
  'agents:locate',
  'dialog:selectDirectory',
  'providers:get',
  'providers:healthAll',
  'workspaces:list',
  'workspaces:getActive',
  'agentLoop:getConfig',
  'agentLoop:getStatus',
  'agentLoop:getAgents',
  'agentLoop:refreshAgents',
  'models:routeSettings:get',
  'models:exportCodexCatalog',
  'models:favorites',
  'models:hidden',
  'mcp:getSystemConfig',
  'workflows:seed',
  'plugins:repositories',
  'plugins:listInstalled',
  'plugins:enabledContributions',
  'localAgents:detect',
  'localAgents:status',
  'localAgents:options',
  'settings:getRunTimeout',
  'commands:list',
  'schedules:list',
  'ecc:status',
  'ecc:update',
  'updates:status',
  'updates:openDownload',
  'logs:path',
  'diagnostics:runSuite',
  'diagnostics:run',
  'github:checkCli',
  'github:currentBranchPr',
  'release:checks',
  'terminal:history',
  'shortcuts:resetAll',
  'shortcuts:conflicts',
  'slashCommands:list',
  'notifications:unreadCount',
  'notifications:markAllRead',
  'notifications:clearAll',
  'onboarding:getState',
  'onboarding:shouldShow',
  'onboarding:skipAll',
  'onboarding:reset',
  'onboarding:nextStep',
  'backup:create',
  'backup:list',
  'usage:pricing:list',
  'prompts:slashCommands',
  'prompts:seedDefaults',
  'budget:get',
  'workflow:runHistory',
  'teams:list'
] as const

const recentLogsResult = {
  path: 'agenthub-events.log',
  entries: [],
  scannedLines: 0,
  truncated: false,
  parseWarnings: []
}

const routeInfoResult = {
  taskType: 'general',
  selectedAgent: 'claude',
  confidence: 0.5,
  reasoning: 'test',
  suggestedRole: 'orchestrator'
}

describe('query IPC runtime validation', () => {
  it('rejects unexpected arguments for zero-argument query channels', async () => {
    const handler = vi.fn(() => 'ok')
    const { typedHandle } = await import('../typed-ipc')

    for (const channel of noArgChannels) {
      typedHandle(channel, handler as never)
      expect(() => electronMock.handlers.get(channel)?.({}, 'extra')).toThrow(
        new IpcPayloadValidationError(channel, 'expected no arguments')
      )
    }

    expect(handler).not.toHaveBeenCalled()
  })

  it('passes zero-argument query channels through unchanged', async () => {
    const { typedHandle } = await import('../typed-ipc')

    for (const channel of noArgChannels) {
      const handler = vi.fn(() => channel)
      typedHandle(channel, handler as never)

      expect(electronMock.handlers.get(channel)?.({})).toBe(channel)
      expect(handler).toHaveBeenCalledWith({})
    }
  })

  it('validates small query payload channels before side effects', async () => {
    const localScanHandler = vi.fn(() => [])
    const localReadHandler = vi.fn(() => null)
    const logsHandler = vi.fn(() => recentLogsResult)
    const routeHandler = vi.fn(() => [])
    const githubHandler = vi.fn(() => [])
    const clearCompletedHandler = vi.fn(() => true)
    const agentLoopHandler = vi.fn(() => routeInfoResult)
    const parseBlocksHandler = vi.fn(() => [])
    const parsePlanHandler = vi.fn(() => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('localModels:scan', localScanHandler)
    typedHandle('localModels:readConfig', localReadHandler)
    typedHandle('logs:recent', logsHandler)
    typedHandle('routes:explain', routeHandler)
    typedHandle('github:listPrs', githubHandler)
    typedHandle('github:listIssues', githubHandler)
    typedHandle('tasks:clearCompleted', clearCompletedHandler)
    typedHandle('agentLoop:getRouteInfo', agentLoopHandler)
    typedHandle('sdd:parseBlocks', parseBlocksHandler)
    typedHandle('sdd:parsePlanCovers', parsePlanHandler)

    expect(() => electronMock.handlers.get('localModels:scan')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('localModels:scan', 'agentId must be a string')
    )
    expect(() => electronMock.handlers.get('localModels:readConfig')?.({}, '')).toThrow(
      new IpcPayloadValidationError('localModels:readConfig', 'agentId must not be empty')
    )
    expect(() => electronMock.handlers.get('logs:recent')?.({}, 0)).toThrow(
      new IpcPayloadValidationError('logs:recent', 'limit must be at least 1')
    )
    expect(() => electronMock.handlers.get('routes:explain')?.({}, '')).toThrow(
      new IpcPayloadValidationError('routes:explain', 'turnId must not be empty')
    )
    expect(() => electronMock.handlers.get('github:listPrs')?.({}, 'merged')).toThrow(
      new IpcPayloadValidationError('github:listPrs', 'state must be one of: open, closed, all')
    )
    expect(() => electronMock.handlers.get('github:listIssues')?.({}, 'open', 0)).toThrow(
      new IpcPayloadValidationError('github:listIssues', 'limit must be at least 1')
    )
    expect(() => electronMock.handlers.get('tasks:clearCompleted')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('tasks:clearCompleted', 'workspaceId must be a string')
    )
    expect(() => electronMock.handlers.get('agentLoop:getRouteInfo')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('agentLoop:getRouteInfo', 'prompt must be a string')
    )
    expect(() => electronMock.handlers.get('sdd:parseBlocks')?.({}, null)).toThrow(
      new IpcPayloadValidationError('sdd:parseBlocks', 'content must be a string')
    )
    expect(() => electronMock.handlers.get('sdd:parsePlanCovers')?.({}, null)).toThrow(
      new IpcPayloadValidationError('sdd:parsePlanCovers', 'planMarkdown must be a string')
    )

    expect(localScanHandler).not.toHaveBeenCalled()
    expect(localReadHandler).not.toHaveBeenCalled()
    expect(logsHandler).not.toHaveBeenCalled()
    expect(routeHandler).not.toHaveBeenCalled()
    expect(githubHandler).not.toHaveBeenCalled()
    expect(clearCompletedHandler).not.toHaveBeenCalled()
    expect(agentLoopHandler).not.toHaveBeenCalled()
    expect(parseBlocksHandler).not.toHaveBeenCalled()
    expect(parsePlanHandler).not.toHaveBeenCalled()
  })

  it('passes valid small query payloads through unchanged', async () => {
    const { typedHandle } = await import('../typed-ipc')
    const localScanHandler = vi.fn(() => [])
    const localReadHandler = vi.fn(() => null)
    const logsHandler = vi.fn(() => recentLogsResult)
    const routeHandler = vi.fn(() => [])
    const githubHandler = vi.fn(() => [])
    const clearCompletedHandler = vi.fn(() => true)
    const agentLoopHandler = vi.fn(() => routeInfoResult)
    const parseBlocksHandler = vi.fn(() => [])
    const parsePlanHandler = vi.fn(() => [])
    typedHandle('localModels:scan', localScanHandler)
    typedHandle('localModels:readConfig', localReadHandler)
    typedHandle('logs:recent', logsHandler)
    typedHandle('routes:explain', routeHandler)
    typedHandle('github:listPrs', githubHandler)
    typedHandle('github:listIssues', githubHandler)
    typedHandle('tasks:clearCompleted', clearCompletedHandler)
    typedHandle('agentLoop:getRouteInfo', agentLoopHandler)
    typedHandle('sdd:parseBlocks', parseBlocksHandler)
    typedHandle('sdd:parsePlanCovers', parsePlanHandler)

    expect(electronMock.handlers.get('localModels:scan')?.({}, null)).toEqual([])
    expect(electronMock.handlers.get('localModels:scan')?.({}, 'codex')).toEqual([])
    expect(electronMock.handlers.get('localModels:readConfig')?.({}, 'codex')).toBeNull()
    expect(electronMock.handlers.get('logs:recent')?.({}, 50)).toEqual(recentLogsResult)
    expect(electronMock.handlers.get('routes:explain')?.({}, 'turn-1')).toEqual([])
    expect(electronMock.handlers.get('github:listPrs')?.({}, 'open', 25)).toEqual([])
    expect(electronMock.handlers.get('github:listIssues')?.({}, undefined, undefined)).toEqual([])
    expect(electronMock.handlers.get('tasks:clearCompleted')?.({})).toBe(true)
    expect(electronMock.handlers.get('tasks:clearCompleted')?.({}, null)).toBe(true)
    expect(electronMock.handlers.get('tasks:clearCompleted')?.({}, 'ws-1')).toBe(true)
    expect(electronMock.handlers.get('agentLoop:getRouteInfo')?.({}, '')).toEqual(routeInfoResult)
    expect(electronMock.handlers.get('sdd:parseBlocks')?.({}, '')).toEqual([])
    expect(electronMock.handlers.get('sdd:parsePlanCovers')?.({}, '')).toEqual([])

    expect(localScanHandler).toHaveBeenCalledWith({}, null)
    expect(localScanHandler).toHaveBeenCalledWith({}, 'codex')
    expect(localReadHandler).toHaveBeenCalledWith({}, 'codex')
    expect(logsHandler).toHaveBeenCalledWith({}, 50)
    expect(routeHandler).toHaveBeenCalledWith({}, 'turn-1')
    expect(githubHandler).toHaveBeenCalledWith({}, 'open', 25)
    expect(githubHandler).toHaveBeenCalledWith({}, undefined, undefined)
    expect(clearCompletedHandler).toHaveBeenCalledWith({})
    expect(clearCompletedHandler).toHaveBeenCalledWith({}, null)
    expect(clearCompletedHandler).toHaveBeenCalledWith({}, 'ws-1')
    expect(agentLoopHandler).toHaveBeenCalledWith({}, '')
    expect(parseBlocksHandler).toHaveBeenCalledWith({}, '')
    expect(parsePlanHandler).toHaveBeenCalledWith({}, '')
  })
})
