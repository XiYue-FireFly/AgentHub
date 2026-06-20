/**
 * Unified model capability helper.
 *
 * Single source of truth for model metadata (context window, tool support,
 * vision, thinking, pricing). Used by provider fetch, Composer picker,
 * context capacity estimation, and usage stats.
 *
 * Pure functions — no side effects, no store dependency.
 */

import type { ModelDefinition, ProviderDefinition, ThinkingLevel } from '../providers/types'

export interface ModelCapability {
  providerId: string
  providerName: string
  modelId: string
  label: string
  contextWindow: number
  supportsTools: boolean
  supportsVision: boolean
  supportsThinking: boolean
  maxThinkingLevel?: ThinkingLevel
  description?: string
}

/** Default context window when model metadata is missing. */
const DEFAULT_CONTEXT_WINDOW = 128_000

/** Well-known model context windows (fallback when provider doesn't report). */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o1-pro': 200_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'claude-3.5-sonnet': 200_000,
  'claude-3.5-haiku': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-sonnet': 200_000,
  'claude-3-haiku': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-haiku-4': 200_000,
  'claude-opus-4': 200_000,
  'deepseek-chat': 128_000,
  'deepseek-coder': 128_000,
  'deepseek-reasoner': 128_000,
  'deepseek-v3': 128_000,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576
}

/**
 * Resolve the effective context window for a model.
 * Priority: model.contextWindow > known defaults > DEFAULT_CONTEXT_WINDOW.
 */
export function resolveContextWindow(modelId: string, reported?: number): number {
  if (reported && reported > 0) return reported
  // Try exact match first, then prefix match
  const normalized = modelId.toLowerCase()
  if (KNOWN_CONTEXT_WINDOWS[normalized]) return KNOWN_CONTEXT_WINDOWS[normalized]
  for (const [key, value] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (normalized.startsWith(key) || normalized.includes(key)) return value
  }
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Build a flat list of all model capabilities across all providers.
 * Deduplicates by providerId + modelId.
 */
export function allModelCapabilities(providers: ProviderDefinition[]): ModelCapability[] {
  const seen = new Set<string>()
  const result: ModelCapability[] = []
  for (const provider of providers) {
    if (!provider.enabled) continue
    for (const model of provider.models) {
      const key = `${provider.id}::${model.id}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        label: model.label,
        contextWindow: resolveContextWindow(model.id, model.contextWindow),
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        supportsThinking: model.supportsThinking,
        maxThinkingLevel: model.maxThinkingLevel,
        description: model.description
      })
    }
  }
  return result
}

/**
 * Find a specific model's capability by provider and model ID.
 */
export function findModelCapability(
  providers: ProviderDefinition[],
  providerId: string,
  modelId: string
): ModelCapability | null {
  const provider = providers.find(p => p.id === providerId)
  if (!provider) return null
  const model = provider.models.find(m => m.id === modelId)
  if (!model) return null
  return {
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    label: model.label,
    contextWindow: resolveContextWindow(model.id, model.contextWindow),
    supportsTools: model.supportsTools,
    supportsVision: model.supportsVision,
    supportsThinking: model.supportsThinking,
    maxThinkingLevel: model.maxThinkingLevel,
    description: model.description
  }
}

/**
 * Estimate token budget for a model (used by context capacity display).
 * Returns usable tokens after reserving space for system prompt and response.
 */
export function estimateTokenBudget(contextWindow: number, reserveForResponse = 4_096): number {
  return Math.max(0, contextWindow - reserveForResponse)
}
