/**
 * BudgetCenter: budget management for API usage.
 *
 * Tracks daily/monthly spending, enforces per-request limits,
 * and suggests cheaper alternatives when budget is exceeded.
 *
 * P4-F2: Budget Center.
 */

import { store } from '../store'
import { currentUsageSpend, estimateTokens, estimateUsageCost } from './usage-stats'
import type { BudgetEstimate, ModelSelection, SchedulePreview, UsageTokenBreakdown, WorkbenchAttachment } from './types'

const BUDGET_KEY = 'budget.config.v1'

export interface BudgetConfig {
  version: 1
  dailyLimitUsd: number | null
  monthlyLimitUsd: number | null
  perRequestMaxTokens: number | null
  perRequestMaxCostUsd: number | null
  notifyAtPercent: number // 0-100, default 80
  blockWhenExceeded: boolean
  suggestCheaperModel: boolean
}

const DEFAULT_CONFIG: BudgetConfig = {
  version: 1,
  dailyLimitUsd: null,
  monthlyLimitUsd: null,
  perRequestMaxTokens: null,
  perRequestMaxCostUsd: null,
  notifyAtPercent: 80,
  blockWhenExceeded: false,
  suggestCheaperModel: true
}

export function getBudgetConfig(): BudgetConfig {
  const raw: any = store.get(BUDGET_KEY)
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  return { ...DEFAULT_CONFIG, ...raw, version: 1 as const }
}

export function updateBudgetConfig(patch: Partial<BudgetConfig>): BudgetConfig {
  const current = getBudgetConfig()
  const next: BudgetConfig = { ...current, ...patch, version: 1 }
  store.set(BUDGET_KEY, next)
  return next
}

/**
 * Check if a request would exceed budget limits.
 */
export function checkBudget(
  config: BudgetConfig,
  dailySpentUsd: number,
  monthlySpentUsd: number,
  requestTokens: number,
  requestCostUsd?: number | null
): { allowed: boolean; reason?: string; warning?: string } {
  // Per-request token limit
  if (config.perRequestMaxTokens && requestTokens > config.perRequestMaxTokens) {
    return { allowed: !config.blockWhenExceeded, reason: `Request exceeds ${config.perRequestMaxTokens} token limit` }
  }
  if (config.perRequestMaxCostUsd && requestCostUsd != null && requestCostUsd > config.perRequestMaxCostUsd) {
    return { allowed: !config.blockWhenExceeded, reason: `Request exceeds $${config.perRequestMaxCostUsd.toFixed(2)} cost limit` }
  }
  // Daily budget
  if (config.dailyLimitUsd) {
    const projectedDaily = dailySpentUsd + (requestCostUsd ?? 0)
    if (projectedDaily >= config.dailyLimitUsd) {
      return { allowed: !config.blockWhenExceeded, reason: `Daily budget ($${config.dailyLimitUsd}) exceeded` }
    }
    if (projectedDaily >= config.dailyLimitUsd * (config.notifyAtPercent / 100)) {
      return { allowed: true, warning: `Approaching daily budget: $${projectedDaily.toFixed(2)} / $${config.dailyLimitUsd}` }
    }
  }
  // Monthly budget
  if (config.monthlyLimitUsd) {
    const projectedMonthly = monthlySpentUsd + (requestCostUsd ?? 0)
    if (projectedMonthly >= config.monthlyLimitUsd) {
      return { allowed: !config.blockWhenExceeded, reason: `Monthly budget ($${config.monthlyLimitUsd}) exceeded` }
    }
    if (projectedMonthly >= config.monthlyLimitUsd * (config.notifyAtPercent / 100)) {
      return { allowed: true, warning: `Approaching monthly budget: $${projectedMonthly.toFixed(2)} / $${config.monthlyLimitUsd}` }
    }
  }
  return { allowed: true }
}

export interface BudgetDispatchEstimateInput {
  prompt: string
  attachments?: WorkbenchAttachment[]
  customSchedule?: SchedulePreview
  modelSelection?: ModelSelection | null
  targetAgent?: string | null
}

export function estimateDispatchBudget(input: BudgetDispatchEstimateInput): BudgetEstimate {
  const attachmentText = (input.attachments || [])
    .filter(attachment => attachment.kind !== 'image')
    .map(attachment => [attachment.name, attachment.text].filter(Boolean).join('\n'))
    .join('\n')
  const scheduleSteps = input.customSchedule?.steps?.length || 1
  const estimatedRequests = Math.max(1, scheduleSteps)
  const baseInputTokens = estimateTokens([input.prompt || '', attachmentText].join('\n'))
  const inputTokens = Math.max(baseInputTokens * estimatedRequests, baseInputTokens)
  const outputTokens = Math.max(512 * estimatedRequests, Math.ceil(inputTokens * 0.35))
  const usage: UsageTokenBreakdown = {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billableInputTokens: inputTokens,
    inputSurfaceTokens: inputTokens,
    totalTokens: inputTokens + outputTokens
  }
  const providerId = input.modelSelection?.providerId || (input.targetAgent ? 'local-cli' : 'local-cli')
  const modelId = input.modelSelection?.modelId || input.targetAgent || input.customSchedule?.steps?.[0]?.agentId || 'unknown'
  const priced = estimateUsageCost(providerId, modelId, usage)
  const { dailySpentUsd, monthlySpentUsd } = currentUsageSpend()
  const config = getBudgetConfig()
  const check = checkBudget(config, dailySpentUsd, monthlySpentUsd, usage.totalTokens, priced.costUsd)
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens,
    estimatedRequests,
    estimatedCostUsd: priced.costUsd,
    hasUnpriced: priced.hasUnpriced,
    dailySpentUsd,
    monthlySpentUsd,
    projectedDailyUsd: priced.costUsd == null ? null : dailySpentUsd + priced.costUsd,
    projectedMonthlyUsd: priced.costUsd == null ? null : monthlySpentUsd + priced.costUsd,
    check
  }
}
