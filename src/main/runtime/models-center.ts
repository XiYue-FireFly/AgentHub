/**
 * ModelsCenter: unified model management across providers.
 *
 * Provides model health, capabilities, pricing, favorites, and usage stats
 * in a single view. Builds on existing provider/model infrastructure.
 *
 * P4-F1: Models Center.
 */

import { store } from '../store'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { buildProviderClient } from '../providers/client'
import { getProviderManager, isProviderRuntimeUsable } from '../providers/manager'
import type { ModelDefinition, ProviderDefinition, ThinkingMode } from '../providers/types'
import { canonicalProviderPayload, createDispatchEnvelope, createDispatchId } from './dispatch-envelope'
import { appendAppEventLog } from './app-event-log'

const FAVORITES_KEY = 'models.favorites.v1'
const HIDDEN_KEY = 'models.hidden.v1'

export interface ModelInfo {
  providerId: string
  providerName: string
  providerEnabled: boolean
  providerHasKey: boolean
  providerKeyLocked: boolean
  providerProtocol: string
  modelId: string
  label: string
  contextWindow: number
  enabled: boolean
  upstreamModel?: string
  timeoutMs?: number
  retryCount?: number
  reasoningEnabled?: boolean
  defaultReasoningLevel?: string
  supportedReasoningLevels?: string[]
  codexAlias?: string
  description?: string
  supportsTools: boolean
  supportsVision: boolean
  supportsThinking: boolean
  isFavorite: boolean
  isHidden: boolean
}

export function getModelFavorites(): Set<string> {
  const raw: any = store.get(FAVORITES_KEY)
  return new Set(Array.isArray(raw) ? raw : [])
}

export function toggleModelFavorite(providerId: string, modelId: string): boolean {
  const favs = getModelFavorites()
  const key = `${providerId}/${modelId}`
  if (favs.has(key)) { favs.delete(key) } else { favs.add(key) }
  store.set(FAVORITES_KEY, [...favs])
  return favs.has(key)
}

export function getModelHidden(): Set<string> {
  const raw: any = store.get(HIDDEN_KEY)
  return new Set(Array.isArray(raw) ? raw : [])
}

export function toggleModelHidden(providerId: string, modelId: string): boolean {
  const hidden = getModelHidden()
  const key = `${providerId}/${modelId}`
  if (hidden.has(key)) { hidden.delete(key) } else { hidden.add(key) }
  store.set(HIDDEN_KEY, [...hidden])
  return hidden.has(key)
}

/**
 * Build a unified model list from all providers.
 */
export function buildModelList(providers: Array<{ id: string; name: string; enabled: boolean; apiKey?: string; apiKeyLocked?: boolean; models: Array<{ id: string; label: string; contextWindow?: number; supportsTools?: boolean; supportsVision?: boolean; supportsThinking?: boolean }> }>): ModelInfo[] {
  const favs = getModelFavorites()
  const hidden = getModelHidden()
  const result: ModelInfo[] = []
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey || provider.apiKeyLocked) continue
    for (const model of provider.models) {
      const key = `${provider.id}/${model.id}`
      result.push({
        providerId: provider.id,
        providerName: provider.name,
        providerEnabled: !!provider.enabled,
        providerHasKey: !!provider.apiKey,
        providerKeyLocked: !!provider.apiKeyLocked,
        providerProtocol: protocolForProvider(provider as any),
        modelId: model.id,
        label: model.label || model.id,
        contextWindow: model.contextWindow || 258_000,
        enabled: (model as any).enabled !== false,
        upstreamModel: (model as any).upstreamModel,
        timeoutMs: (model as any).timeoutMs,
        retryCount: (model as any).retryCount,
        reasoningEnabled: (model as any).reasoningEnabled ?? model.supportsThinking,
        defaultReasoningLevel: (model as any).defaultReasoningLevel || (model as any).defaultThinkingLevel,
        supportedReasoningLevels: (model as any).supportedReasoningLevels,
        codexAlias: (model as any).codexAlias,
        description: (model as any).description,
        supportsTools: model.supportsTools || false,
        supportsVision: model.supportsVision || false,
        supportsThinking: model.supportsThinking || false,
        isFavorite: favs.has(key),
        isHidden: hidden.has(key)
      })
    }
  }
  // Sort: favorites first, then by provider+model
  return result.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    return `${a.providerName}/${a.label}`.localeCompare(`${b.providerName}/${b.label}`)
  })
}

function protocolForProvider(provider: { kind: string; protocolOverride?: string; capabilities?: { protocol?: string } }): string {
  if (provider.protocolOverride) return provider.protocolOverride
  if (provider.kind === 'anthropic') return 'anthropic_messages'
  if (provider.kind === 'gemini') return 'gemini_generate_content'
  if (provider.capabilities?.protocol === 'messages') return 'anthropic_messages'
  if (provider.capabilities?.protocol === 'generate_content') return 'gemini_generate_content'
  return 'openai_chat_completions'
}

export function listGlobalModels(): ModelInfo[] {
  return buildModelList(getProviderManager().getConfig().providers as any)
}

export function updateModelRoute(providerId: string, modelId: string, patch: Partial<ModelDefinition>): ModelDefinition | null {
  return getProviderManager().updateModelRoute(providerId, modelId, patch)
}

export async function testModelRoute(input: { providerId: string; modelId: string; upstreamModel?: string }): Promise<{
  ok: boolean
  providerId: string
  modelId: string
  upstreamModel?: string
  routeReason?: string
  latencyMs: number
  usage?: any
  contentPreview?: string
  error?: string
}> {
  const startedAt = Date.now()
  const mgr = getProviderManager()
  const routed = mgr.resolveModelRoute(input.providerId, input.modelId, { allowFallback: false })
  if (!routed) {
    return { ok: false, providerId: input.providerId, modelId: input.modelId, latencyMs: Date.now() - startedAt, error: 'Provider or model is unavailable.' }
  }
  const upstreamModel = input.upstreamModel?.trim() || routed.upstreamModelId
  const model = { ...routed.model, id: upstreamModel }
  const binding = {
    agentId: `model-test:${routed.provider.id}`,
    providerId: routed.provider.id,
    modelId: upstreamModel,
    thinkingAllow: ['off', 'auto', 'enabled'] as ThinkingMode[],
    thinking: { mode: 'off' as const, level: 'minimal' as const },
    temperature: 0,
    maxOutputTokens: 32
  }
  const client = buildProviderClient({ provider: routed.provider, model, binding, thinking: binding.thinking })
  const messages = [{ role: 'user' as const, content: 'Reply with: ok' }]
  const dispatchEnvelope = createDispatchEnvelope({
    dispatchId: createDispatchId(),
    lineage: { origin: 'internal:model-diagnostic', policy: 'internal' },
    payload: canonicalProviderPayload({
      providerId: routed.provider.id,
      modelId: model.id,
      protocol: routed.provider.capabilities.protocol,
      systemPrompt: '',
      messages,
      tools: [],
      toolChoice: null,
      thinking: binding.thinking
    })
  })
  appendAppEventLog('dispatch:prepared', {
    dispatchId: dispatchEnvelope.dispatchId,
    providerId: dispatchEnvelope.providerId,
    modelId: dispatchEnvelope.modelId,
    canonicalPayloadHash: dispatchEnvelope.canonicalPayloadHash,
    origin: dispatchEnvelope.origin,
    policy: dispatchEnvelope.policy,
    rootInputId: dispatchEnvelope.rootInputId,
    rootEnvelopeId: dispatchEnvelope.rootEnvelopeId,
    rootPreparedTextHash: dispatchEnvelope.rootPreparedTextHash,
    parentDispatchId: dispatchEnvelope.parentDispatchId
  })
  let content = ''
  let usage: any = undefined
  let timer: NodeJS.Timeout | undefined
  // MED-18: Use AbortController to cancel the underlying fetch when timeout fires
  const controller = new AbortController()
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        client.stream(
          { messages, systemPrompt: '', thinkingOverride: binding.thinking, signal: controller.signal, dispatchEnvelope },
          {
            onContent: delta => { content += delta },
            onDone: final => { usage = final.usage; resolve() },
            onError: err => reject(err)
          }
        )
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Model test timed out')) }, Math.min(routed.model.timeoutMs || 30_000, 60_000))
      })
    ])
    return {
      ok: true,
      providerId: routed.provider.id,
      modelId: routed.requestedModelId,
      upstreamModel,
      routeReason: routed.routeReason,
      latencyMs: Date.now() - startedAt,
      usage,
      contentPreview: content.slice(0, 160)
    }
  } catch (error: any) {
    return {
      ok: false,
      providerId: routed.provider.id,
      modelId: routed.requestedModelId,
      upstreamModel,
      routeReason: routed.routeReason,
      latencyMs: Date.now() - startedAt,
      error: error?.message || String(error)
    }
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

function slugFor(provider: ProviderDefinition, model: ModelDefinition, used: Set<string>): string {
  const base = (model.codexAlias || `${provider.id}-${model.id}`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model'
  let slug = base
  let index = 2
  while (used.has(slug)) slug = `${base}-${index++}`
  used.add(slug)
  return slug
}

export function buildCodexCatalog(): { models: any[] } {
  const config = getProviderManager().getConfig()
  const used = new Set<string>()
  const models: any[] = []
  for (const provider of config.providers) {
    if (!isProviderRuntimeUsable(provider as any)) continue
    for (const model of provider.models) {
      if (model.enabled === false) continue
      models.push({
        slug: slugFor(provider as any, model as any, used),
        target_model_id: model.upstreamModel || model.id,
        display_name: model.label || model.id,
        description: model.description || `${provider.name} / ${model.id}`,
        context_window: model.contextWindow || 258_000,
        max_context_window: model.contextWindow || 258_000,
        effective_context_window_percent: 100,
        auto_compact_token_limit: Math.floor((model.contextWindow || 258_000) * 0.9),
        provider_protocol: protocolForProvider(provider as any),
        reasoning_enabled: model.reasoningEnabled ?? model.supportsThinking,
        default_reasoning_level: model.defaultReasoningLevel || model.defaultThinkingLevel || 'medium',
        supported_reasoning_levels: (model.supportedReasoningLevels || []).map(level => ({ effort: level, description: String(level) })),
        supported_in_api: true,
        shell_type: 'shell_command',
        visibility: 'list',
        input_modalities: ['text', 'image']
      })
    }
  }
  return { models }
}

export function exportCodexCatalog(): { ok: boolean; path?: string; content: string; count: number; error?: string } {
  const catalog = buildCodexCatalog()
  const content = JSON.stringify(catalog, null, 2)
  try {
    const dir = join(homedir(), '.codex', 'model-catalogs')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'agenthub-neko-route.json')
    writeFileSync(filePath, content, 'utf8')
    return { ok: true, path: filePath, content, count: catalog.models.length }
  } catch (error: any) {
    return { ok: false, content, count: catalog.models.length, error: error?.message || String(error) }
  }
}
