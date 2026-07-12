import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: any, ...args: any[]) => any

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const sent: Array<{ channel: string; payload: any }> = []
  const webContents = {
    isDestroyed: vi.fn(() => false),
    send: vi.fn((channel: string, payload: any) => {
      sent.push({ channel, payload })
    })
  }
  return { handlers, sent, webContents }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: electronMock.webContents }])
  }
}))

class FakeProviderManager extends EventEmitter {
  upsertProvider = vi.fn()
  deleteProvider = vi.fn(() => true)
  setProviderEnabled = vi.fn()
  setProviderApiKey = vi.fn()
  fetchModels = vi.fn(async () => ({ ok: true, count: 1 }))
  reorderProvidersForClaude = vi.fn()
  checkProviderHealth = vi.fn(async () => ({ reachable: true, status: 'ok' }))
  getProviders = vi.fn(() => this.config.providers)
  upsertBinding = vi.fn()
  removeBinding = vi.fn()
  setFallbackChain = vi.fn()
  setStrategy = vi.fn()
  setBindingThinking = vi.fn()
  setProviderThinking = vi.fn()
  setActiveBinding = vi.fn()
  getProvider = vi.fn((id: string) => this.config.providers.find(provider => provider.id === id) ?? null)
  getBindings = vi.fn(() => this.config.routing.bindings)

  config = {
    providers: [{
      id: 'openai',
      name: 'OpenAI',
      apiKey: 'live-secret',
      enabled: true,
      customHeaders: {
        Authorization: 'Bearer custom-header-secret',
        'x-safe-header': 'visible'
      },
      nested: {
        refreshToken: 'nested-token-secret',
        githubToken: 'github-token-secret',
        budgetTokens: 8000
      },
      models: []
    }],
    routing: { bindings: [], fallbackChain: [], strategy: 'single' },
    activeBindingId: null
  }

  getConfig() {
    return this.config
  }

  onSecretEncryptionWarning(listener: (warning: any) => void) {
    this.on('secret-encryption-warning', listener)
    return () => this.off('secret-encryption-warning', listener)
  }
}

describe('provider IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.sent.length = 0
    electronMock.webContents.send.mockClear()
    vi.resetModules()
  })

  it('forwards provider config changes to renderer with API keys masked', async () => {
    const providerMgr = new FakeProviderManager()
    const { registerProviderIpc } = await import('../provider-ipc')

    registerProviderIpc({
      providerMgr,
      registerAgentsFromBindings: vi.fn()
    })

    providerMgr.emit('config:changed')

    expect(electronMock.sent).toHaveLength(1)
    expect(electronMock.sent[0].channel).toBe('providers:configChanged')
    expect(electronMock.sent[0].payload.providers[0].apiKey).not.toBe('live-secret')
    expect(electronMock.sent[0].payload.providers[0].apiKey).toBeTruthy()
    expect(electronMock.sent[0].payload.providers[0].customHeaders).toBeUndefined()
    expect(JSON.stringify(electronMock.sent[0].payload)).not.toContain('custom-header-secret')
    expect(JSON.stringify(electronMock.sent[0].payload)).not.toContain('nested-token-secret')
    expect(JSON.stringify(electronMock.sent[0].payload)).not.toContain('github-token-secret')
    expect(electronMock.sent[0].payload.providers[0].nested.budgetTokens).toBe(8000)
  })

  it('rejects invalid provider mutations before touching provider manager state', async () => {
    const providerMgr = new FakeProviderManager()
    const registerAgentsFromBindings = vi.fn()
    const { registerProviderIpc } = await import('../provider-ipc')

    registerProviderIpc({ providerMgr, registerAgentsFromBindings })

    expect(() => electronMock.handlers.get('providers:upsert')?.({}, {
      id: 'bad',
      kind: 'anthropic',
      baseUrl: 'file:///tmp/proxy'
    })).toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.baseUrl must use http or https'))

    expect(() => electronMock.handlers.get('providers:upsert')?.({}, {
      name: 'Missing id'
    })).toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.id must be a string'))

    expect(() => electronMock.handlers.get('providers:upsert')?.({}, {
      id: 'custom-bad',
      name: 'Bad',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      enabled: false,
      builtIn: false,
      models: [],
      capabilities: { protocol: 'chat_completions' },
      defaultThinking: { mode: 'auto', level: 'medium' }
    })).toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.capabilities.stream must be a boolean'))

    expect(() => electronMock.handlers.get('providers:upsert')?.({}, {
      id: 'openai',
      capabilities: null
    })).toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.capabilities must be an object'))

    expect(() => electronMock.handlers.get('providers:upsert')?.({}, {
      id: 'openai',
      defaultThinking: null
    })).toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.defaultThinking must be an object'))

    expect(() => electronMock.handlers.get('providers:upsert')?.({}, {
      id: 'openai',
      defaultThinking: { mode: 'auto', level: 'medium', budgetTokens: null }
    })).toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.defaultThinking.budgetTokens must be a number'))

    await expect(electronMock.handlers.get('providers:upsert')?.({}, {
      id: 'new-incomplete'
    })).rejects.toThrow(new IpcPayloadValidationError('providers:upsert', 'provider.name must not be empty'))

    expect(() => electronMock.handlers.get('providers:setEnabled')?.({}, 'openai', 'false')).toThrow(
      new IpcPayloadValidationError('providers:setEnabled', 'enabled must be a boolean')
    )

    expect(() => electronMock.handlers.get('providers:fetchModels')?.({}, 'openai', {
      kind: 'unknown-provider'
    })).toThrow(new IpcPayloadValidationError('providers:fetchModels', 'override.kind must be one of: openai, anthropic, gemini, openai-compatible, custom'))

    expect(providerMgr.upsertProvider).not.toHaveBeenCalled()
    expect(providerMgr.setProviderEnabled).not.toHaveBeenCalled()
    expect(providerMgr.fetchModels).not.toHaveBeenCalled()
    expect(registerAgentsFromBindings).not.toHaveBeenCalled()
  })

  it('allows complete custom provider creation payloads through', async () => {
    const providerMgr = new FakeProviderManager()
    const registerAgentsFromBindings = vi.fn()
    const { registerProviderIpc } = await import('../provider-ipc')

    registerProviderIpc({ providerMgr, registerAgentsFromBindings })

    const input = {
      id: 'custom-1',
      name: 'Custom',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      enabled: false,
      builtIn: false,
      models: [],
      capabilities: {
        protocol: 'chat_completions',
        stream: true,
        nativeThinking: false,
        budgetTokens: false,
        toolCalls: true,
        systemPrompt: true
      },
      defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true }
    }

    await expect(electronMock.handlers.get('providers:upsert')?.({}, input)).resolves.toMatchObject({
      providers: expect.any(Array)
    })

    expect(providerMgr.upsertProvider).toHaveBeenCalledWith(input)
    expect(registerAgentsFromBindings).toHaveBeenCalled()
  })

  it('rejects invalid routing mutations before touching provider manager state', async () => {
    const providerMgr = new FakeProviderManager()
    const registerAgentsFromBindings = vi.fn()
    const { registerProviderIpc } = await import('../provider-ipc')

    registerProviderIpc({ providerMgr, registerAgentsFromBindings })

    expect(() => electronMock.handlers.get('routing:setBinding')?.({}, {
      agentId: 'codex',
      providerId: 'openai',
      modelId: 'gpt-4o',
      protocol: 'shell',
      thinking: { mode: 'auto', level: 'medium' },
      binary: 'codex'
    })).toThrow(new IpcPayloadValidationError('routing:setBinding', 'binding.protocol must be one of: http, stdio-plain, stdio-ndjson, acp'))

    expect(() => electronMock.handlers.get('routing:setBinding')?.({}, {
      agentId: 'codex',
      providerId: 'openai',
      modelId: 'gpt-4o'
    })).toThrow(new IpcPayloadValidationError('routing:setBinding', 'binding.thinking must be an object'))

    expect(() => electronMock.handlers.get('routing:setBinding')?.({}, {
      agentId: 'codex',
      providerId: 'openai',
      modelId: 'gpt-4o',
      thinking: { mode: 'auto', level: 'medium' },
      thinkingAllow: null
    })).toThrow(new IpcPayloadValidationError('routing:setBinding', 'binding.thinkingAllow must be an array'))

    expect(() => electronMock.handlers.get('routing:setStrategy')?.({}, 'random')).toThrow(
      new IpcPayloadValidationError('routing:setStrategy', 'strategy must be one of: single, load-balance, cost-aware')
    )

    expect(() => electronMock.handlers.get('routing:setBindingThinking')?.({}, 'codex', {
      mode: 'auto',
      level: 'ultra'
    })).toThrow(new IpcPayloadValidationError('routing:setBindingThinking', 'thinking.level must be one of: minimal, low, medium, high, xhigh'))

    expect(() => electronMock.handlers.get('routing:setBindingThinking')?.({}, 'codex', {
      mode: 'auto',
      level: 'medium',
      collapseInUI: null
    })).toThrow(new IpcPayloadValidationError('routing:setBindingThinking', 'thinking.collapseInUI must be a boolean'))

    expect(providerMgr.upsertBinding).not.toHaveBeenCalled()
    expect(providerMgr.setStrategy).not.toHaveBeenCalled()
    expect(providerMgr.setBindingThinking).not.toHaveBeenCalled()
    expect(registerAgentsFromBindings).not.toHaveBeenCalled()
  })

  it('accepts controlled NDJSON local routing bindings and syncs their adapter registration', async () => {
    const providerMgr = new FakeProviderManager()
    const registerAgentsFromBindings = vi.fn()
    const { registerProviderIpc } = await import('../provider-ipc')
    registerProviderIpc({ providerMgr, registerAgentsFromBindings })

    const binding = {
      agentId: 'structured-cli',
      providerId: 'local-cli',
      modelId: 'local',
      protocol: 'stdio-ndjson',
      binary: 'C:\\Tools\\structured-cli.cmd',
      args: 'serve',
      thinking: { mode: 'auto', level: 'medium', collapseInUI: true }
    }

    await expect(electronMock.handlers.get('routing:setBinding')?.({}, binding)).resolves.toEqual([])
    expect(providerMgr.upsertBinding).toHaveBeenCalledWith(binding)
    expect(registerAgentsFromBindings).toHaveBeenCalledTimes(1)
  })
})
