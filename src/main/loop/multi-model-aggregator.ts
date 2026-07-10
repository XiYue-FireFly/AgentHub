/**
 * Multi-Model Aggregator - 多模型并行执行和结果聚合
 *
 * 实现多模型融合自循环的核心模块
 */

import type { ModelConfig, RouteDecision } from './model-router'

// ============================================================
// Types
// ============================================================

export interface ModelResult {
  modelId: string
  providerId: string
  content: string
  toolCalls?: ToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
  usage?: { promptTokens: number; completionTokens: number }
  error?: string
  durationMs: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface AggregatedResult {
  output: string
  toolCalls: ToolCall[]
  hasToolCalls: boolean
  isComplete: boolean
  needsConsensus: boolean
  consensusPrompt?: string
  modelResults: ModelResult[]
  strategy: AggregationStrategy
}

export type AggregationStrategy = 'vote' | 'merge' | 'best' | 'refine'

export interface AggregatorConfig {
  strategy: AggregationStrategy
  maxParallel: number
  timeoutMs: number
  consensusThreshold: number  // 0-1, 需要多少模型同意
}

// ============================================================
// Default Config
// ============================================================

const DEFAULT_CONFIG: AggregatorConfig = {
  strategy: 'merge',
  maxParallel: 3,
  timeoutMs: 60000,
  consensusThreshold: 0.6
}

// ============================================================
// Aggregator Implementation
// ============================================================

/**
 * 并行调用多个模型
 */
export async function callModelsInParallel(
  models: ModelConfig[],
  prompt: string,
  tools: any[],
  config: Partial<AggregatorConfig> = {}
): Promise<ModelResult[]> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  const modelsToCall = models.slice(0, fullConfig.maxParallel)

  const results = await Promise.allSettled(
    modelsToCall.map(model => callSingleModel(model, prompt, tools, fullConfig.timeoutMs))
  )

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    }
    return {
      modelId: modelsToCall[index].modelId,
      providerId: modelsToCall[index].providerId,
      content: '',
      finishReason: 'error' as const,
      error: result.reason?.message || 'Model call failed',
      durationMs: 0
    }
  })
}

/**
 * 调用单个模型
 */
async function callSingleModel(
  model: ModelConfig,
  prompt: string,
  tools: any[],
  timeoutMs: number
): Promise<ModelResult> {
  const startTime = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // TODO: 实际调用模型 — 需要接入 ProviderManager
    // 当前多模型聚合器的模型调用尚未实现，返回明确的未实现错误
    // 避免静默返回模拟数据导致下游逻辑混淆
    const error_msg = `Multi-model aggregator not yet implemented for model '${model.modelId}'.`

    return {
      modelId: model.modelId,
      providerId: model.providerId,
      content: '',
      toolCalls: [],
      finishReason: 'error' as const,
      error: error_msg,
      usage: { promptTokens: 0, completionTokens: 0 },
      durationMs: Date.now() - startTime
    }
  } catch (error: any) {
    return {
      modelId: model.modelId,
      providerId: model.providerId,
      content: '',
      finishReason: 'error',
      error: error.message,
      durationMs: Date.now() - startTime
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 聚合多个模型的结果
 */
export function aggregateResults(
  results: ModelResult[],
  strategy: AggregationStrategy = 'merge'
): AggregatedResult {
  // 过滤成功的结果
  const successfulResults = results.filter(r => r.finishReason !== 'error')

  if (successfulResults.length === 0) {
    return {
      output: 'All models failed',
      toolCalls: [],
      hasToolCalls: false,
      isComplete: true,
      needsConsensus: false,
      modelResults: results,
      strategy
    }
  }

  // 检查是否有工具调用
  const allToolCalls = successfulResults.flatMap(r => r.toolCalls || [])
  const hasToolCalls = allToolCalls.length > 0

  // 根据策略聚合
  switch (strategy) {
    case 'vote':
      return voteAggregate(successfulResults, allToolCalls, results)
    case 'merge':
      return mergeAggregate(successfulResults, allToolCalls, results)
    case 'best':
      return bestAggregate(successfulResults, allToolCalls, results)
    case 'refine':
      return refineAggregate(successfulResults, allToolCalls, results)
    default:
      return mergeAggregate(successfulResults, allToolCalls, results)
  }
}

/**
 * 投票聚合 - 多数投票选择结果
 */
function voteAggregate(
  successful: ModelResult[],
  toolCalls: ToolCall[],
  allResults: ModelResult[]
): AggregatedResult {
  // 按内容相似度分组
  const groups = groupBySimilarity(successful)

  // 选择最大的组
  const largestGroup = groups.reduce((max, group) =>
    group.length > max.length ? group : max
  , groups[0])

  const representative = largestGroup[0]
  const consensus = largestGroup.length / successful.length

  return {
    output: representative.content,
    toolCalls: deduplicateToolCalls(toolCalls),
    hasToolCalls: toolCalls.length > 0,
    isComplete: representative.finishReason === 'stop',
    needsConsensus: consensus < 0.6,
    consensusPrompt: consensus < 0.6 ? buildConsensusPrompt(successful) : undefined,
    modelResults: allResults,
    strategy: 'vote'
  }
}

/**
 * 合并聚合 - 合并所有模型的输出
 */
function mergeAggregate(
  successful: ModelResult[],
  toolCalls: ToolCall[],
  allResults: ModelResult[]
): AggregatedResult {
  // 合并所有文本输出
  const mergedContent = successful
    .map(r => r.content)
    .filter(Boolean)
    .join('\n\n---\n\n')

  // 合并工具调用（去重）
  const mergedToolCalls = deduplicateToolCalls(toolCalls)

  return {
    output: mergedContent,
    toolCalls: mergedToolCalls,
    hasToolCalls: mergedToolCalls.length > 0,
    isComplete: successful.every(r => r.finishReason === 'stop'),
    needsConsensus: false,
    modelResults: allResults,
    strategy: 'merge'
  }
}

/**
 * 最佳聚合 - 选择最佳结果
 */
function bestAggregate(
  successful: ModelResult[],
  toolCalls: ToolCall[],
  allResults: ModelResult[]
): AggregatedResult {
  // 选择最长的输出（简单启发式）
  const best = successful.reduce((max, r) =>
    r.content.length > max.content.length ? r : max
  , successful[0])

  return {
    output: best.content,
    toolCalls: deduplicateToolCalls(toolCalls),
    hasToolCalls: toolCalls.length > 0,
    isComplete: best.finishReason === 'stop',
    needsConsensus: false,
    modelResults: allResults,
    strategy: 'best'
  }
}

/**
 * 精炼聚合 - 迭代精炼
 */
function refineAggregate(
  successful: ModelResult[],
  toolCalls: ToolCall[],
  allResults: ModelResult[]
): AggregatedResult {
  // 将前一个模型的输出作为下一个模型的输入
  // 这里简化为合并
  return mergeAggregate(successful, toolCalls, allResults)
}

/**
 * 按相似度分组
 */
function groupBySimilarity(results: ModelResult[]): ModelResult[][] {
  const groups: ModelResult[][] = []

  for (const result of results) {
    let addedToGroup = false
    for (const group of groups) {
      if (isSimilar(result.content, group[0].content)) {
        group.push(result)
        addedToGroup = true
        break
      }
    }
    if (!addedToGroup) {
      groups.push([result])
    }
  }

  return groups
}

/**
 * 简单的文本相似度检查
 */
function isSimilar(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length === 0 || b.length === 0) return false

  // Tokenize: use bigrams for better CJK support
  const tokenize = (text: string): Set<string> => {
    const tokens = new Set<string>()
    // Add word tokens (split by whitespace)
    for (const word of text.split(/\s+/)) {
      if (word) tokens.add(word)
    }
    // Add character bigrams for CJK support
    for (let i = 0; i < text.length - 1; i++) {
      tokens.add(text.substring(i, i + 2))
    }
    return tokens
  }

  // 使用 Jaccard 相似度
  const setA = tokenize(a)
  const setB = tokenize(b)
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])

  return intersection.size / union.size > 0.7
}

/**
 * 去重工具调用
 */
function deduplicateToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const seen = new Set<string>()
  return toolCalls.filter(tc => {
    const key = `${tc.name}:${JSON.stringify(tc.arguments)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 构建共识提示词
 */
function buildConsensusPrompt(results: ModelResult[]): string {
  const outputs = results.map((r, i) =>
    `Model ${i + 1} (${r.modelId}):\n${r.content.slice(0, 500)}`
  ).join('\n\n')

  return `Multiple models provided different answers. Please analyze and synthesize the best solution:

${outputs}

Provide a unified, comprehensive answer that incorporates the best ideas from each model.`
}
