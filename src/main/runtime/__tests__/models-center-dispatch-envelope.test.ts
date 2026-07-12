import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ streamOptions: [] as any[], auditEvents: [] as any[] }))

vi.mock('../../store', () => ({ store: { get: vi.fn(), set: vi.fn() } }))

vi.mock('../../providers/manager', () => ({
  getProviderManager: () => ({
    resolveModelRoute: () => ({
      provider: {
        id: 'provider-1',
        name: 'Provider',
        kind: 'openai-compatible',
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-key',
        enabled: true,
        models: [],
        capabilities: { protocol: 'chat_completions', stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
        defaultThinking: { mode: 'off', level: 'low' }
      },
      model: { id: 'model-1', label: 'Model', contextWindow: 128000, supportsTools: false, supportsVision: false, supportsThinking: false },
      requestedModelId: 'model-1',
      upstreamModelId: 'model-upstream',
      routeReason: 'direct'
    })
  }),
  isProviderRuntimeUsable: () => true
}))

vi.mock('../../providers/client', () => ({
  buildProviderClient: () => ({
    stream: async (options: any, callbacks: any) => {
      h.streamOptions.push(options)
      callbacks.onDone?.({ content: 'ok' })
    }
  })
}))

vi.mock('../app-event-log', () => ({
  appendAppEventLog: (...args: any[]) => h.auditEvents.push(args)
}))

describe('model test dispatch envelope', () => {
  beforeEach(() => { h.streamOptions = []; h.auditEvents = [] })

  it('uses an internal diagnostic envelope before testing a provider model', async () => {
    const { testModelRoute } = await import('../models-center')

    await expect(testModelRoute({ providerId: 'provider-1', modelId: 'model-1' })).resolves.toMatchObject({ ok: true })

    expect(h.streamOptions).toHaveLength(1)
    expect(h.streamOptions[0].dispatchEnvelope).toMatchObject({
      origin: 'internal:model-diagnostic',
      policy: 'internal',
      providerId: 'provider-1',
      modelId: 'model-upstream'
    })
    expect(h.auditEvents).toEqual([['dispatch:prepared', expect.objectContaining({
      dispatchId: h.streamOptions[0].dispatchEnvelope.dispatchId,
      providerId: 'provider-1',
      modelId: 'model-upstream',
      canonicalPayloadHash: expect.any(String),
      origin: 'internal:model-diagnostic',
      policy: 'internal',
      rootInputId: undefined,
      rootEnvelopeId: undefined,
      rootPreparedTextHash: undefined,
      parentDispatchId: undefined
    })]])
    expect(h.auditEvents[0][1]).not.toHaveProperty('messages')
    expect(h.auditEvents[0][1]).not.toHaveProperty('apiKey')
  })
})
