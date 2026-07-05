import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const runtimeMock = vi.hoisted(() => ({
  listMcpServers: vi.fn(() => []),
  scanLocalMcpServers: vi.fn(() => []),
  upsertMcpServer: vi.fn((input: any) => ({
    id: input.id || 'mcp-user-1',
    name: input.name,
    source: 'user',
    enabled: input.enabled ?? true,
    transport: input.transport || 'stdio',
    command: input.command || 'node',
    args: input.args || [],
    status: 'unknown'
  })),
  removeMcpServer: vi.fn(() => true),
  setMcpEnabled: vi.fn((id: string, enabled: boolean) => ({
    id,
    name: 'docs',
    source: 'user',
    enabled,
    transport: 'stdio',
    command: 'node',
    status: 'unknown'
  })),
  testMcpServer: vi.fn((id: string) => ({
    id,
    name: 'docs',
    source: 'user',
    enabled: true,
    transport: 'stdio',
    command: 'node',
    status: 'ok'
  })),
  listMcpServerTools: vi.fn(() => ({
    ok: true,
    tools: [{ name: 'search', description: 'Search docs', inputSchema: { type: 'object' } }],
    resources: 2,
    prompts: 1
  }))
}))

const configMock = vi.hoisted(() => ({
  getMcpSystemConfig: vi.fn(() => ({
    version: 1,
    enabled: true,
    allowedCategories: ['read', 'write', 'exec'],
    defaultPolicy: 'allow',
    timeoutMs: 120000
  })),
  setMcpSystemConfig: vi.fn(),
  setMcpEnabled: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../runtime/mcp', () => runtimeMock)
vi.mock('../../mcp/config', () => configMock)

describe('MCP IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    for (const value of Object.values(runtimeMock)) value.mockClear()
    for (const value of Object.values(configMock)) value.mockClear()
    vi.resetModules()
  })

  async function setup() {
    const { registerMcpIpc } = await import('../mcp-ipc')
    registerMcpIpc()
  }

  it('delegates server inventory and local scan requests', async () => {
    await setup()

    expect(electronMock.handlers.get('mcp:list')?.({}, 'ws-1')).toEqual([])
    expect(electronMock.handlers.get('mcp:scanLocal')?.({}, 'ws-1')).toEqual([])

    expect(runtimeMock.listMcpServers).toHaveBeenCalledWith('ws-1')
    expect(runtimeMock.scanLocalMcpServers).toHaveBeenCalledWith('ws-1')
  })

  it('delegates user server mutation requests with arguments intact', async () => {
    await setup()
    const input = { name: 'docs', command: 'node', args: ['server.js'], enabled: true }

    expect(electronMock.handlers.get('mcp:upsert')?.({}, input)).toMatchObject({
      name: 'docs',
      command: 'node',
      args: ['server.js']
    })
    expect(electronMock.handlers.get('mcp:remove')?.({}, 'mcp-user-1')).toBe(true)
    expect(electronMock.handlers.get('mcp:setEnabled')?.({}, 'mcp-user-1', false, 'ws-1')).toMatchObject({
      id: 'mcp-user-1',
      enabled: false
    })

    expect(runtimeMock.upsertMcpServer).toHaveBeenCalledWith(input)
    expect(runtimeMock.removeMcpServer).toHaveBeenCalledWith('mcp-user-1')
    expect(runtimeMock.setMcpEnabled).toHaveBeenCalledWith('mcp-user-1', false, 'ws-1')
  })

  it('delegates server test and tool listing requests', async () => {
    await setup()

    expect(electronMock.handlers.get('mcp:test')?.({}, 'mcp-user-1', 'ws-1')).toMatchObject({
      id: 'mcp-user-1',
      status: 'ok'
    })
    expect(electronMock.handlers.get('mcp:listTools')?.({}, 'mcp-user-1', 'ws-1')).toEqual({
      ok: true,
      tools: [{ name: 'search', description: 'Search docs', inputSchema: { type: 'object' } }],
      resources: 2,
      prompts: 1
    })

    expect(runtimeMock.testMcpServer).toHaveBeenCalledWith('mcp-user-1', 'ws-1')
    expect(runtimeMock.listMcpServerTools).toHaveBeenCalledWith('mcp-user-1', 'ws-1')
  })

  it('delegates system-level MCP configuration requests', async () => {
    await setup()
    const patch = { enabled: false, timeoutMs: 30000 }

    expect(electronMock.handlers.get('mcp:getSystemConfig')?.({})).toMatchObject({
      version: 1,
      enabled: true
    })
    expect(electronMock.handlers.get('mcp:setSystemConfig')?.({}, patch)).toBeUndefined()
    expect(electronMock.handlers.get('mcp:setSystemEnabled')?.({}, false)).toBeUndefined()

    expect(configMock.getMcpSystemConfig).toHaveBeenCalled()
    expect(configMock.setMcpSystemConfig).toHaveBeenCalledWith(patch)
    expect(configMock.setMcpEnabled).toHaveBeenCalledWith(false)
  })

  it('rejects invalid MCP server upserts before persisting configuration', async () => {
    await setup()

    expect(() => electronMock.handlers.get('mcp:upsert')?.({}, {
      name: 'bad',
      transport: 'stdio',
      command: '',
      env: { GOOD: 'yes', BAD: 42 }
    })).toThrow(new IpcPayloadValidationError('mcp:upsert', 'input.env.BAD must be a string'))

    expect(() => electronMock.handlers.get('mcp:upsert')?.({}, {
      name: 'bad-url',
      transport: 'http',
      url: 'file:///tmp/server'
    })).toThrow(new IpcPayloadValidationError('mcp:upsert', 'input.url must use http or https'))

    expect(() => electronMock.handlers.get('mcp:upsert')?.({}, {
      name: 'bad-timeout',
      transport: 'stdio',
      command: 'node',
      timeoutMs: 999999
    })).toThrow(new IpcPayloadValidationError('mcp:upsert', 'input.timeoutMs must be at most 120000'))

    expect(runtimeMock.upsertMcpServer).not.toHaveBeenCalled()
  })

  it('rejects invalid MCP execution requests before spawning probes', async () => {
    await setup()

    expect(() => electronMock.handlers.get('mcp:test')?.({}, '', 'ws-1')).toThrow(
      new IpcPayloadValidationError('mcp:test', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('mcp:listTools')?.({}, 'mcp-user-1', { id: 'ws-1' })).toThrow(
      new IpcPayloadValidationError('mcp:listTools', 'workspaceId must be a string')
    )

    expect(runtimeMock.testMcpServer).not.toHaveBeenCalled()
    expect(runtimeMock.listMcpServerTools).not.toHaveBeenCalled()
  })

  it('rejects invalid MCP system policy payloads before saving', async () => {
    await setup()

    expect(() => electronMock.handlers.get('mcp:setSystemConfig')?.({}, {
      defaultPolicy: 'always',
      allowedCategories: ['read']
    })).toThrow(new IpcPayloadValidationError('mcp:setSystemConfig', 'config.defaultPolicy must be one of: allow, ask, deny'))

    expect(() => electronMock.handlers.get('mcp:setSystemConfig')?.({}, {
      allowedCategories: ['read', 'network']
    })).toThrow(new IpcPayloadValidationError('mcp:setSystemConfig', 'config.allowedCategories[1] must be one of: read, write, exec'))

    expect(() => electronMock.handlers.get('mcp:setSystemEnabled')?.({}, 'true')).toThrow(
      new IpcPayloadValidationError('mcp:setSystemEnabled', 'enabled must be a boolean')
    )

    expect(configMock.setMcpSystemConfig).not.toHaveBeenCalled()
    expect(configMock.setMcpEnabled).not.toHaveBeenCalled()
  })

  it('rejects explicit nulls in MCP system config patches before saving', async () => {
    await setup()

    expect(() => electronMock.handlers.get('mcp:setSystemConfig')?.({}, {
      enabled: null
    })).toThrow(new IpcPayloadValidationError('mcp:setSystemConfig', 'config.enabled must be a boolean'))

    expect(() => electronMock.handlers.get('mcp:setSystemConfig')?.({}, {
      defaultPolicy: null
    })).toThrow(new IpcPayloadValidationError('mcp:setSystemConfig', 'config.defaultPolicy must be one of: allow, ask, deny'))

    expect(() => electronMock.handlers.get('mcp:setSystemConfig')?.({}, {
      allowedCategories: null
    })).toThrow(new IpcPayloadValidationError('mcp:setSystemConfig', 'config.allowedCategories must be an array'))

    expect(() => electronMock.handlers.get('mcp:setSystemConfig')?.({}, {
      timeoutMs: null
    })).toThrow(new IpcPayloadValidationError('mcp:setSystemConfig', 'config.timeoutMs must be a number'))

    expect(configMock.setMcpSystemConfig).not.toHaveBeenCalled()
  })
})
