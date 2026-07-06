import { describe, expect, it, beforeEach, vi } from 'vitest'

const memory: Record<string, any> = {}
vi.mock('../../store', () => ({ store: { get: (k: string) => memory[k], set: (k: string, v: any) => { memory[k] = v } } }))

describe('models-center', () => {
  beforeEach(() => { for (const k of Object.keys(memory)) delete memory[k]; vi.resetModules() })

  it('builds model list from providers', async () => {
    const { buildModelList } = await import('../models-center')
    const providers = [
      { id: 'openai', name: 'OpenAI', enabled: true, apiKey: 'key', models: [{ id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128000, supportsTools: true }] },
      { id: 'disabled', name: 'Disabled', enabled: false, apiKey: '', models: [] }
    ]
    const list = buildModelList(providers as any)
    expect(list).toHaveLength(1)
    expect(list[0].modelId).toBe('gpt-4o')
    expect(list[0].providerName).toBe('OpenAI')
    expect(list[0].contextWindow).toBe(128000)
  })

  it('favorites appear first in list', async () => {
    const { buildModelList, toggleModelFavorite } = await import('../models-center')
    toggleModelFavorite('openai', 'gpt-4o')
    const providers = [
      { id: 'openai', name: 'OpenAI', enabled: true, apiKey: 'k', models: [{ id: 'gpt-4o', label: 'GPT-4o' }, { id: 'gpt-3.5', label: 'GPT-3.5' }] }
    ]
    const list = buildModelList(providers as any)
    expect(list[0].modelId).toBe('gpt-4o')
    expect(list[0].isFavorite).toBe(true)
  })

  it('hidden models still appear but marked', async () => {
    const { buildModelList, toggleModelHidden } = await import('../models-center')
    toggleModelHidden('openai', 'gpt-3.5')
    const providers = [
      { id: 'openai', name: 'OpenAI', enabled: true, apiKey: 'k', models: [{ id: 'gpt-4o', label: 'GPT-4o' }, { id: 'gpt-3.5', label: 'GPT-3.5' }] }
    ]
    const list = buildModelList(providers as any)
    const hidden = list.find(m => m.modelId === 'gpt-3.5')
    expect(hidden).toBeDefined()
    expect(hidden!.isHidden).toBe(true)
  })
})

describe('budget-center', () => {
  beforeEach(() => { for (const k of Object.keys(memory)) delete memory[k]; vi.resetModules() })

  it('returns default config when none saved', async () => {
    const { getBudgetConfig } = await import('../budget-center')
    const config = getBudgetConfig()
    expect(config.dailyLimitUsd).toBeNull()
    expect(config.notifyAtPercent).toBe(80)
  })

  it('saves and loads config', async () => {
    const { updateBudgetConfig, getBudgetConfig } = await import('../budget-center')
    updateBudgetConfig({ dailyLimitUsd: 10, monthlyLimitUsd: 100 })
    const config = getBudgetConfig()
    expect(config.dailyLimitUsd).toBe(10)
    expect(config.monthlyLimitUsd).toBe(100)
  })

  it('allows request within budget', async () => {
    const { checkBudget, getBudgetConfig } = await import('../budget-center')
    const config = { ...getBudgetConfig(), dailyLimitUsd: 10 }
    const result = checkBudget(config, 5, 50, 1000)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('blocks request when daily budget exceeded and blocking enabled', async () => {
    const { checkBudget, getBudgetConfig } = await import('../budget-center')
    const config = { ...getBudgetConfig(), dailyLimitUsd: 10, blockWhenExceeded: true }
    const result = checkBudget(config, 11, 50, 1000)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Daily budget')
  })

  it('warns when approaching budget threshold', async () => {
    const { checkBudget, getBudgetConfig } = await import('../budget-center')
    const config = { ...getBudgetConfig(), dailyLimitUsd: 10, notifyAtPercent: 80 }
    const result = checkBudget(config, 8.5, 50, 1000)
    expect(result.allowed).toBe(true)
    expect(result.warning).toBeDefined()
  })

  it('blocks by estimated request cost and projected daily spend', async () => {
    const { checkBudget, getBudgetConfig } = await import('../budget-center')
    const perRequest = { ...getBudgetConfig(), perRequestMaxCostUsd: 0.05, blockWhenExceeded: true }
    expect(checkBudget(perRequest, 0, 0, 1000, 0.06).allowed).toBe(false)

    const daily = { ...getBudgetConfig(), dailyLimitUsd: 1, blockWhenExceeded: true }
    expect(checkBudget(daily, 0.95, 0.95, 1000, 0.06).allowed).toBe(false)
  })

  it('estimates dispatch requests from schedule steps', async () => {
    const { estimateDispatchBudget } = await import('../budget-center')
    const estimate = estimateDispatchBudget({
      prompt: 'Build a feature',
      customSchedule: {
        preset: 'custom',
        label: 'Test',
        description: 'Test',
        steps: [
          { id: 'a', label: 'A', agentId: 'codex', role: 'worker', mode: 'auto' },
          { id: 'b', label: 'B', agentId: 'codex', role: 'reviewer', mode: 'auto', dependsOn: ['a'] }
        ]
      }
    })

    expect(estimate.estimatedRequests).toBe(2)
    expect(estimate.totalTokens).toBeGreaterThan(0)
    expect(estimate.check.allowed).toBe(true)
  })
})
