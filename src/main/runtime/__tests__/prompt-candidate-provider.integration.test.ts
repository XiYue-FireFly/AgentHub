import { describe, expect, it, vi } from 'vitest'
import { canonicalProviderPayload, verifyDispatchEnvelope } from '../dispatch-envelope'
import { createPromptCandidateProviderInvoker } from '../prompt-candidate-provider'
import { createPromptPreparationComposition } from '../prompt-preparation-composition'
import { promptCacheContext } from '../prompt-cache-context'

describe('production prompt candidate provider invocation', () => {
  it('feeds validated no-tools model candidates into a vague workbench preparation with an internal envelope', async () => {
    const provider = {
      id: 'provider-1',
      name: 'Provider',
      kind: 'openai-compatible',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'test-key',
      enabled: true,
      builtIn: false,
      capabilities: { protocol: 'chat_completions', stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: 'off', level: 'medium' },
      models: []
    } as any
    const model = {
      id: 'model-1',
      label: 'Model',
      contextWindow: 128000,
      supportsTools: false,
      supportsVision: false,
      supportsThinking: false
    } as any
    const resolved = {
      provider,
      model,
      binding: {
        agentId: 'prompt-candidate-generator',
        providerId: provider.id,
        modelId: model.id,
        thinkingAllow: ['off'],
        thinking: { mode: 'off', level: 'medium' },
        maxOutputTokens: 2048,
        temperature: 0.2,
        protocol: 'http'
      },
      thinking: { mode: 'off', level: 'medium' }
    } as any
    const sent: any[] = []
    const audit = vi.fn()
    const response = JSON.stringify({
      schemaVersion: 'prompt-candidates-v1',
      candidates: [
        { text: 'Fix it by identifying the affected behavior and applying the smallest safe change.' },
        { text: 'Fix it with a minimal implementation and a concise explanation of the result.' }
      ]
    })
    const resolve = vi.fn((_identity: { providerId: string; modelId: string }) => resolved)
    const invokeCandidateModel = createPromptCandidateProviderInvoker({
      resolve,
      buildClient: () => ({
        stream: async (options: any, callbacks: any) => {
          sent.push(options)
          callbacks.onContent?.(response)
          callbacks.onDone?.({ content: response })
        }
      }) as any,
      createId: () => 'candidate-dispatch-1',
      audit
    })
    const composition = createPromptPreparationComposition({
      decisionService: {
        request: vi.fn(async () => ({
          requestId: 'decision-1',
          status: 'selected' as const,
          selectedOptionIds: ['candidate-1'],
          resolvedAt: 1
        }))
      },
      hubDecisionPort: { decide: vi.fn(async () => ({ kind: 'original' as const })) },
      invokeCandidateModel,
      audit: vi.fn()
    })

    const prepared = await composition.promptPreparationService.prepareRoot({
      origin: 'workbench:create',
      prompt: 'Fix it',
      decisionOwner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: null, webContentsId: 1 },
      cacheContext: promptCacheContext({
        locale: 'en-US',
        workspaceRoot: null,
        contextProjection: {},
        plugins: [],
        skills: [],
        attachments: [],
        providerId: provider.id,
        modelId: model.id
      })
    })

    expect(prepared).toMatchObject({ kind: 'ready', envelope: { status: 'candidate-selected' } })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      tools: [],
      toolChoice: 'none',
      dispatchEnvelope: expect.objectContaining({
        origin: 'internal:prompt-candidate',
        policy: 'internal'
      })
    })
    expect(resolve).toHaveBeenCalledWith({ providerId: provider.id, modelId: model.id })
    verifyDispatchEnvelope(sent[0].dispatchEnvelope, canonicalProviderPayload({
      providerId: provider.id,
      modelId: model.id,
      protocol: provider.capabilities.protocol,
      systemPrompt: sent[0].systemPrompt,
      messages: sent[0].messages,
      tools: [],
      toolChoice: null,
      thinking: resolved.thinking
    }))
    expect(audit).toHaveBeenCalledWith('dispatch:prepared', expect.objectContaining({
      dispatchId: 'candidate-dispatch-1',
      providerId: provider.id,
      modelId: model.id,
      origin: 'internal:prompt-candidate',
      policy: 'internal',
      canonicalPayloadHash: expect.any(String)
    }))
    expect(audit.mock.calls[0][1]).not.toHaveProperty('messages')
    expect(audit.mock.calls[0][1]).not.toHaveProperty('prompt')
    expect(audit.mock.calls[0][1]).not.toHaveProperty('apiKey')
  })
})
