import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

const validPricingRule = {
  modelId: 'gpt-5.4',
  providerId: 'openai',
  displayName: 'GPT 5.4',
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 8,
  cacheReadUsdPerMillion: 0.5,
  cacheCreationUsdPerMillion: 1
}

const validPricingResult = {
  id: 'openai:gpt-5.4',
  ...validPricingRule,
  createdAt: 1,
  updatedAt: 1
}

const validBudgetConfig = {
  version: 1 as const,
  dailyLimitUsd: null,
  monthlyLimitUsd: null,
  perRequestMaxTokens: null,
  perRequestMaxCostUsd: null,
  notifyAtPercent: 80,
  blockWhenExceeded: false,
  suggestCheaperModel: true
}

function usageStatsResult(range: 'all' | '90d' | '30d' | '7d', view: 'overview' | 'models' | 'requests' | 'providers' | 'pricing') {
  return {
    range,
    view,
    sessions: 0,
    messages: 0,
    totalTokens: 0,
    actualTokens: 0,
    estimatedTokens: 0,
    hasEstimated: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheSavingsTokens: 0,
    cacheSavingsUsd: null,
    billableInputTokens: 0,
    activeDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    cost: null,
    costUsd: null,
    hasUnpriced: false,
    cacheSavings: null,
    contextSavings: null,
    cacheRate: null,
    requests: 0,
    heatmap: [],
    models: [],
    providers: []
  }
}

describe('usage and budget IPC runtime validation', () => {
  it('rejects invalid usage query payloads before side effects', async () => {
    const statsHandler = vi.fn(async () => usageStatsResult('all', 'overview'))
    const recordsHandler = vi.fn(async () => ({ records: [], total: 0, page: 1, pageSize: 25 }))
    const detailHandler = vi.fn(async () => null)
    const deleteHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('usage:stats', statsHandler)
    typedHandle('usage:records', recordsHandler)
    typedHandle('usage:recordDetail', detailHandler)
    typedHandle('usage:pricing:delete', deleteHandler)

    expect(() => electronMock.handlers.get('usage:stats')?.({}, 'today', 'overview')).toThrow(
      new IpcPayloadValidationError('usage:stats', 'range must be one of: all, 90d, 30d, 7d')
    )
    expect(() => electronMock.handlers.get('usage:stats')?.({}, 'all', 'charts')).toThrow(
      new IpcPayloadValidationError('usage:stats', 'view must be one of: overview, models, requests, providers, pricing')
    )
    expect(() => electronMock.handlers.get('usage:records')?.({}, { source: 'synthetic' }, 1, 25)).toThrow(
      new IpcPayloadValidationError('usage:records', 'filter.source must be one of: actual, estimated, none, all')
    )
    expect(() => electronMock.handlers.get('usage:records')?.({}, { range: 'all' }, 0, 25)).toThrow(
      new IpcPayloadValidationError('usage:records', 'page must be at least 1')
    )
    expect(() => electronMock.handlers.get('usage:records')?.({}, { range: 'all' }, 1, 201)).toThrow(
      new IpcPayloadValidationError('usage:records', 'pageSize must be at most 200')
    )
    expect(() => electronMock.handlers.get('usage:recordDetail')?.({}, '')).toThrow(
      new IpcPayloadValidationError('usage:recordDetail', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('usage:pricing:delete')?.({}, 'gpt-5.4', 123)).toThrow(
      new IpcPayloadValidationError('usage:pricing:delete', 'providerId must be a string')
    )

    expect(statsHandler).not.toHaveBeenCalled()
    expect(recordsHandler).not.toHaveBeenCalled()
    expect(detailHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid usage pricing mutations before side effects', async () => {
    const handler = vi.fn(async () => validPricingResult)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('usage:pricing:upsert', handler)

    expect(() => electronMock.handlers.get('usage:pricing:upsert')?.({}, {
      ...validPricingRule,
      modelId: ''
    })).toThrow(
      new IpcPayloadValidationError('usage:pricing:upsert', 'rule.modelId must not be empty')
    )
    expect(() => electronMock.handlers.get('usage:pricing:upsert')?.({}, {
      ...validPricingRule,
      inputUsdPerMillion: -1
    })).toThrow(
      new IpcPayloadValidationError('usage:pricing:upsert', 'rule.inputUsdPerMillion must be at least 0')
    )
    expect(() => electronMock.handlers.get('usage:pricing:upsert')?.({}, {
      ...validPricingRule,
      cacheReadUsdPerMillion: Number.NaN
    })).toThrow(
      new IpcPayloadValidationError('usage:pricing:upsert', 'rule.cacheReadUsdPerMillion must be a finite number')
    )
    expect(() => electronMock.handlers.get('usage:pricing:upsert')?.({}, {
      ...validPricingRule,
      providerId: 'x'.repeat(513)
    })).toThrow(
      new IpcPayloadValidationError('usage:pricing:upsert', 'rule.providerId must be at most 512 characters')
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects invalid budget payloads before side effects', async () => {
    const updateHandler = vi.fn(async () => validBudgetConfig)
    const checkHandler = vi.fn(async () => ({ allowed: true }))
    const estimateHandler = vi.fn(async () => ({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedRequests: 1,
      estimatedCostUsd: null,
      hasUnpriced: true,
      dailySpentUsd: 0,
      monthlySpentUsd: 0,
      projectedDailyUsd: null,
      projectedMonthlyUsd: null,
      check: { allowed: true }
    }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('budget:update', updateHandler)
    typedHandle('budget:check', checkHandler)
    typedHandle('budget:estimateDispatch', estimateHandler)

    expect(() => electronMock.handlers.get('budget:update')?.({}, {
      dailyLimitUsd: -1
    })).toThrow(
      new IpcPayloadValidationError('budget:update', 'patch.dailyLimitUsd must be at least 0')
    )
    expect(() => electronMock.handlers.get('budget:update')?.({}, {
      perRequestMaxTokens: 1.5
    })).toThrow(
      new IpcPayloadValidationError('budget:update', 'patch.perRequestMaxTokens must be an integer')
    )
    expect(() => electronMock.handlers.get('budget:update')?.({}, {
      notifyAtPercent: 101
    })).toThrow(
      new IpcPayloadValidationError('budget:update', 'patch.notifyAtPercent must be at most 100')
    )
    expect(() => electronMock.handlers.get('budget:update')?.({}, {
      blockWhenExceeded: 'yes'
    })).toThrow(
      new IpcPayloadValidationError('budget:update', 'patch.blockWhenExceeded must be a boolean')
    )
    expect(() => electronMock.handlers.get('budget:check')?.({}, 1, 2, Number.POSITIVE_INFINITY)).toThrow(
      new IpcPayloadValidationError('budget:check', 'requestTokens must be a finite number')
    )
    expect(() => electronMock.handlers.get('budget:check')?.({}, 1, -2, 100)).toThrow(
      new IpcPayloadValidationError('budget:check', 'monthlySpent must be at least 0')
    )
    expect(() => electronMock.handlers.get('budget:estimateDispatch')?.({}, {
      prompt: '',
      mode: 'unknown'
    })).toThrow(
      new IpcPayloadValidationError('budget:estimateDispatch', 'payload.prompt must not be empty')
    )

    expect(updateHandler).not.toHaveBeenCalled()
    expect(checkHandler).not.toHaveBeenCalled()
    expect(estimateHandler).not.toHaveBeenCalled()
  })

  it('passes valid usage and budget payloads through unchanged', async () => {
    const statsHandler = vi.fn(async () => usageStatsResult('30d', 'models'))
    const recordsHandler = vi.fn(async () => ({ records: [], total: 0, page: 2, pageSize: 25 }))
    const pricingHandler = vi.fn(async () => validPricingResult)
    const budgetUpdateHandler = vi.fn(async () => validBudgetConfig)
    const budgetCheckHandler = vi.fn(async () => ({ allowed: true }))
    const budgetEstimateHandler = vi.fn(async () => ({
      inputTokens: 100,
      outputTokens: 512,
      totalTokens: 612,
      estimatedRequests: 1,
      estimatedCostUsd: 0.01,
      hasUnpriced: false,
      dailySpentUsd: 1,
      monthlySpentUsd: 2,
      projectedDailyUsd: 1.01,
      projectedMonthlyUsd: 2.01,
      check: { allowed: true }
    }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('usage:stats', statsHandler)
    typedHandle('usage:records', recordsHandler)
    typedHandle('usage:pricing:upsert', pricingHandler)
    typedHandle('budget:update', budgetUpdateHandler)
    typedHandle('budget:check', budgetCheckHandler)
    typedHandle('budget:estimateDispatch', budgetEstimateHandler)

    const filter = {
      range: '30d' as const,
      threadId: 'thread-1',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      agentId: 'provider:openai',
      source: 'actual' as const,
      status: 'completed' as const,
      query: '',
      sortBy: 'tokens' as const,
      sortDir: 'desc' as const
    }
    const patch = {
      dailyLimitUsd: null,
      monthlyLimitUsd: 100,
      perRequestMaxTokens: 200000,
      perRequestMaxCostUsd: null,
      notifyAtPercent: 80,
      blockWhenExceeded: false,
      suggestCheaperModel: true
    }

    await expect(electronMock.handlers.get('usage:stats')?.({}, '30d', 'models')).resolves.toMatchObject({ range: '30d', view: 'models' })
    await expect(electronMock.handlers.get('usage:records')?.({}, filter, 2, 25)).resolves.toMatchObject({ page: 2, pageSize: 25 })
    await expect(electronMock.handlers.get('usage:pricing:upsert')?.({}, validPricingRule)).resolves.toMatchObject({ id: 'openai:gpt-5.4' })
    await expect(electronMock.handlers.get('usage:pricing:upsert')?.({}, { modelId: 'minimal-model' })).resolves.toMatchObject({ id: 'openai:gpt-5.4' })
    await expect(electronMock.handlers.get('budget:update')?.({}, patch)).resolves.toMatchObject({ version: 1 })
    await expect(electronMock.handlers.get('budget:check')?.({}, 1.5, 20, 1000, 0.02)).resolves.toEqual({ allowed: true })
    await expect(electronMock.handlers.get('budget:estimateDispatch')?.({}, { prompt: 'hello', mode: 'auto', attachments: [] })).resolves.toMatchObject({ totalTokens: 612 })

    expect(statsHandler).toHaveBeenCalledWith({}, '30d', 'models')
    expect(recordsHandler).toHaveBeenCalledWith({}, filter, 2, 25)
    expect(pricingHandler).toHaveBeenCalledWith({}, validPricingRule)
    expect(pricingHandler).toHaveBeenCalledWith({}, { modelId: 'minimal-model' })
    expect(budgetUpdateHandler).toHaveBeenCalledWith({}, patch)
    expect(budgetCheckHandler).toHaveBeenCalledWith({}, 1.5, 20, 1000, 0.02)
    expect(budgetEstimateHandler).toHaveBeenCalledWith({}, { prompt: 'hello', mode: 'auto', attachments: [] })
  })
})
