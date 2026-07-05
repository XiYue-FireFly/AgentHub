import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const modelsMock = vi.hoisted(() => ({
  buildModelList: vi.fn((providers: any[]) => providers.flatMap(provider =>
    provider.models.map((model: any) => ({
      providerId: provider.id,
      providerName: provider.name,
      providerEnabled: provider.enabled,
      providerHasKey: Boolean(provider.apiKey),
      providerProtocol: 'openai_chat_completions',
      modelId: model.id,
      label: model.label || model.id,
      contextWindow: model.contextWindow || 258000,
      enabled: model.enabled !== false,
      supportsTools: Boolean(model.supportsTools),
      supportsVision: Boolean(model.supportsVision),
      supportsThinking: Boolean(model.supportsThinking),
      isFavorite: false,
      isHidden: false
    }))
  )),
  listGlobalModels: vi.fn(() => []),
  updateModelRoute: vi.fn(() => ({ id: 'gpt-4o', label: 'GPT-4o' })),
  testModelRoute: vi.fn(() => ({ ok: true, providerId: 'openai', modelId: 'gpt-4o', latencyMs: 1 })),
  exportCodexCatalog: vi.fn(() => ({ ok: true, content: '{"models":[]}', count: 0 })),
  toggleModelFavorite: vi.fn(() => true),
  toggleModelHidden: vi.fn(() => false),
  getModelFavorites: vi.fn(() => new Set(['openai/gpt-4o'])),
  getModelHidden: vi.fn(() => new Set(['openai/old-model']))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../runtime/models-center', () => modelsMock)

describe('models IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    for (const value of Object.values(modelsMock)) {
      if (typeof value === 'function') value.mockClear()
    }
    vi.resetModules()
  })

  async function setup() {
    const providerMgr = {
      getModelRouteSettings: vi.fn(() => ({
        codexInjectionMode: 'third_party_api',
        codexInternalModelLock: false,
        codexSlots: []
      })),
      setModelRouteSettings: vi.fn((patch: unknown) => ({
        codexInjectionMode: 'third_party_api',
        codexInternalModelLock: false,
        codexSlots: [],
        ...(patch as Record<string, unknown>)
      }))
    }

    const { registerModelsIpc } = await import('../models-ipc')
    registerModelsIpc({ providerMgr })
    return providerMgr
  }

  it('builds model lists from explicit providers and falls back to globals', async () => {
    await setup()
    const providers = [{
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      apiKey: 'key',
      models: [{ id: 'gpt-4o', label: 'GPT-4o', supportsTools: true }]
    }]

    expect(electronMock.handlers.get('models:list')?.({}, providers)).toEqual([expect.objectContaining({
      providerId: 'openai',
      modelId: 'gpt-4o',
      supportsTools: true
    })])
    expect(electronMock.handlers.get('models:list')?.({})).toEqual([])
    expect(modelsMock.buildModelList).toHaveBeenCalledWith(providers)
    expect(modelsMock.listGlobalModels).toHaveBeenCalled()
  })

  it('accepts read-only model list providers with future kinds and partial capabilities', async () => {
    await setup()
    const providers = [{
      id: 'opencode',
      name: 'OpenCode',
      kind: 'future-provider-kind',
      enabled: true,
      apiKey: 'key',
      capabilities: { protocol: 'responses' },
      models: [{
        id: 'mini-max-code',
        label: 'MiniMax Code',
        defaultReasoningLevel: 'adaptive',
        supportedReasoningLevels: ['adaptive'],
        supportsTools: true
      }]
    }]

    expect(electronMock.handlers.get('models:list')?.({}, providers)).toEqual([expect.objectContaining({
      providerId: 'opencode',
      modelId: 'mini-max-code',
      supportsTools: true
    })])
    expect(modelsMock.buildModelList).toHaveBeenCalledWith(providers)
  })

  it('rejects invalid explicit model providers before building model list', async () => {
    await setup()

    expect(() => electronMock.handlers.get('models:list')?.({}, {
      id: 'openai',
      models: []
    })).toThrow(new IpcPayloadValidationError('models:list', 'providers must be an array'))

    expect(() => electronMock.handlers.get('models:list')?.({}, [{
      id: 'openai',
      kind: 'openai',
      models: [{ id: '' }]
    }])).toThrow(new IpcPayloadValidationError('models:list', 'providers[0].models[0].id must not be empty'))

    expect(() => electronMock.handlers.get('models:list')?.({}, [{
      id: 'openai',
      name: 'OpenAI',
      enabled: true
    }])).toThrow(new IpcPayloadValidationError('models:list', 'providers[0].models must be an array'))

    expect(() => electronMock.handlers.get('models:list')?.({}, [{
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      models: 'gpt-4o'
    }])).toThrow(new IpcPayloadValidationError('models:list', 'providers[0].models must be an array'))

    expect(() => electronMock.handlers.get('models:list')?.({}, [{
      id: 'openai',
      name: 'OpenAI',
      enabled: true,
      models: [{ id: 'gpt-4o', timeoutMs: 100 }]
    }])).toThrow(new IpcPayloadValidationError('models:list', 'providers[0].models[0].timeoutMs must be at least 250'))

    expect(modelsMock.buildModelList).not.toHaveBeenCalled()
  })

  it('delegates route settings and model route updates', async () => {
    const providerMgr = await setup()

    expect(electronMock.handlers.get('models:routeSettings:get')?.({})).toMatchObject({
      codexInjectionMode: 'third_party_api'
    })
    expect(electronMock.handlers.get('models:routeSettings:set')?.({}, { codexInternalModelLock: true })).toMatchObject({
      codexInternalModelLock: true
    })
    expect(electronMock.handlers.get('models:updateRoute')?.({}, 'openai', 'gpt-4o', { upstreamModel: 'real-model' }))
      .toEqual({ id: 'gpt-4o', label: 'GPT-4o' })

    expect(providerMgr.setModelRouteSettings).toHaveBeenCalledWith({ codexInternalModelLock: true })
    expect(modelsMock.updateModelRoute).toHaveBeenCalledWith('openai', 'gpt-4o', { upstreamModel: 'real-model' })
  })

  it('delegates model tests, catalog export, favorites, and hidden sets', async () => {
    await setup()

    expect(electronMock.handlers.get('models:test')?.({}, { providerId: 'openai', modelId: 'gpt-4o' }))
      .toEqual({ ok: true, providerId: 'openai', modelId: 'gpt-4o', latencyMs: 1 })
    expect(electronMock.handlers.get('models:exportCodexCatalog')?.({})).toEqual({
      ok: true,
      content: '{"models":[]}',
      count: 0
    })
    expect(electronMock.handlers.get('models:toggleFavorite')?.({}, 'openai', 'gpt-4o')).toBe(true)
    expect(electronMock.handlers.get('models:toggleHidden')?.({}, 'openai', 'old-model')).toBe(false)
    expect(electronMock.handlers.get('models:favorites')?.({})).toEqual(['openai/gpt-4o'])
    expect(electronMock.handlers.get('models:hidden')?.({})).toEqual(['openai/old-model'])
  })

  it('rejects invalid model route settings before persisting them', async () => {
    const providerMgr = await setup()

    expect(() => electronMock.handlers.get('models:routeSettings:set')?.({}, {
      codexInjectionMode: 'random'
    })).toThrow(new IpcPayloadValidationError('models:routeSettings:set', 'patch.codexInjectionMode must be one of: official_account, third_party_api, lan_share'))

    expect(() => electronMock.handlers.get('models:routeSettings:set')?.({}, {
      codexSlots: [{ slot: 'main', targetModelId: 'gpt-4o', mode: 'random', source: 'manual' }]
    })).toThrow(new IpcPayloadValidationError('models:routeSettings:set', 'patch.codexSlots[0].mode must be one of: official_account, third_party_api, lan_share'))

    expect(providerMgr.setModelRouteSettings).not.toHaveBeenCalled()
  })

  it('rejects invalid model route mutations before updating runtime config', async () => {
    await setup()

    expect(() => electronMock.handlers.get('models:updateRoute')?.({}, 'openai', 'gpt-4o', {
      timeoutMs: 100
    })).toThrow(new IpcPayloadValidationError('models:updateRoute', 'patch.timeoutMs must be at least 250'))

    expect(() => electronMock.handlers.get('models:test')?.({}, {
      providerId: 'openai',
      modelId: ''
    })).toThrow(new IpcPayloadValidationError('models:test', 'input.modelId must not be empty'))

    expect(() => electronMock.handlers.get('models:toggleFavorite')?.({}, 'openai', '')).toThrow(
      new IpcPayloadValidationError('models:toggleFavorite', 'modelId must not be empty')
    )

    expect(modelsMock.updateModelRoute).not.toHaveBeenCalled()
    expect(modelsMock.testModelRoute).not.toHaveBeenCalled()
    expect(modelsMock.toggleModelFavorite).not.toHaveBeenCalled()
  })
})
