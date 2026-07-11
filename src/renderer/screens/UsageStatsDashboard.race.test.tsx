// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../glass/i18n'
import { UsageStatsDashboard } from './UsageStatsDashboard'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeStats(range: UsageRange, view: UsageView, actualTokens: number): UsageStats {
  return {
    range,
    view,
    sessions: 1,
    messages: 1,
    totalTokens: actualTokens,
    actualTokens,
    estimatedTokens: 0,
    hasEstimated: false,
    inputTokens: actualTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheSavingsTokens: 0,
    cacheSavingsUsd: null,
    billableInputTokens: actualTokens,
    activeDays: 1,
    currentStreak: 1,
    longestStreak: 1,
    cost: 0,
    costUsd: 0,
    hasUnpriced: false,
    cacheSavings: null,
    contextSavings: null,
    cacheRate: null,
    requests: 1,
    heatmap: [{
      date: `2026-01-${String((actualTokens % 28) + 1).padStart(2, '0')}`,
      turns: 1,
      tokens: actualTokens + 1,
      actualTokens: actualTokens + 1,
      estimatedTokens: 0,
      hasEstimated: false,
      inputTokens: actualTokens + 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheSavingsTokens: 0,
      cacheSavingsUsd: null,
      costUsd: 0,
      hasUnpriced: false,
      level: 1,
      selected: true
    }],
    models: [],
    providers: [{
      providerId: `stats-${actualTokens}-provider`,
      turns: 1,
      requests: 1,
      tokens: actualTokens,
      actualTokens,
      estimatedTokens: 0,
      hasEstimated: false,
      inputTokens: actualTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheSavingsTokens: 0,
      cacheSavingsUsd: null,
      costUsd: 0,
      hasUnpriced: false
    }]
  }
}

function makeRecord(id: string, providerId: string, modelId = `${providerId}-model`): UsageRequestRecord {
  return {
    id,
    eventId: `${id}-event`,
    threadId: `${id}-thread`,
    turnId: `${id}-turn`,
    agentId: `${id}-agent`,
    providerId,
    modelId,
    requestModelId: modelId,
    source: 'actual',
    status: 'completed',
    createdAt: Date.UTC(2026, 0, 1),
    latencyMs: 10,
    firstTokenMs: 5,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    billableInputTokens: 10,
    inputSurfaceTokens: 10,
    totalTokens: 15,
    actualTokens: 15,
    estimatedTokens: 0,
    hasEstimated: false,
    reasoningTokens: 0,
    cacheHitRate: null,
    costUsd: 0,
    hasUnpriced: false,
    cacheSavingsUsd: null,
    promptPreview: `${id} prompt`,
    responsePreview: `${id} response`,
    rawUsage: {}
  }
}

function makePage(records: UsageRequestRecord[], page = 1, total = records.length, pageSize = 25): PaginatedUsageRecords {
  return { records, total, page, pageSize }
}

function makeDay(date: string, tokens: number, selected = false): UsageHeatmapDay {
  return {
    date,
    turns: 1,
    tokens,
    actualTokens: tokens,
    estimatedTokens: 0,
    hasEstimated: false,
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheSavingsTokens: 0,
    cacheSavingsUsd: null,
    costUsd: 0,
    hasUnpriced: false,
    level: 1,
    selected
  }
}

function makeModel(modelId: string, tokens: number): UsageModelRow {
  return {
    modelId,
    providerId: 'test-provider',
    agentId: 'test-agent',
    turns: 1,
    requests: 1,
    tokens,
    actualTokens: tokens,
    estimatedTokens: 0,
    hasEstimated: false,
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheSavingsTokens: 0,
    cacheSavingsUsd: null,
    costUsd: 0,
    hasUnpriced: false
  }
}

function makePricingRule(modelId: string): UsagePricingRule {
  return {
    id: `test-provider:${modelId}`,
    providerId: 'test-provider',
    modelId,
    displayName: modelId,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
    cacheReadUsdPerMillion: 0.5,
    cacheCreationUsdPerMillion: 1,
    createdAt: 1,
    updatedAt: 1
  }
}

function installUsageApi(overrides: {
  stats: (range: UsageRange, view: UsageView) => Promise<UsageStats>
  records: (filter: UsageRecordFilter, page: number, pageSize: number) => Promise<PaginatedUsageRecords>
  pricingList?: () => Promise<UsagePricingRule[]>
  pricingUpsert?: (rule: Partial<UsagePricingRule> & { modelId: string }) => Promise<UsagePricingRule>
  pricingDelete?: (idOrModelId: string, providerId?: string) => Promise<boolean>
}) {
  const usage = {
    stats: vi.fn(overrides.stats),
    records: vi.fn(overrides.records),
    recordDetail: vi.fn(async () => null),
    pricingList: vi.fn(overrides.pricingList || (async () => [] as UsagePricingRule[])),
    pricingUpsert: vi.fn(overrides.pricingUpsert || (async rule => makePricingRule(rule.modelId))),
    pricingDelete: vi.fn(overrides.pricingDelete || (async () => true))
  }
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { usage } as unknown as Window['electronAPI']
  })
  return usage
}

async function advanceRefreshDelay(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220)
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value)
    await pending.promise
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('UsageStatsDashboard request ownership', () => {
  let originalElectronApi: PropertyDescriptor | undefined

  beforeEach(() => {
    originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
    vi.useFakeTimers()
    setLang('en')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (originalElectronApi) Object.defineProperty(window, 'electronAPI', originalElectronApi)
    else Reflect.deleteProperty(window, 'electronAPI')
    setLang('zh')
  })

  it('keeps the latest range facets when a previously started facet request resolves last', async () => {
    const slowStats = deferred<UsageStats>()
    const fastStats = deferred<UsageStats>()
    const slowFacets = deferred<PaginatedUsageRecords>()
    const fastFacets = deferred<PaginatedUsageRecords>()
    const usage = installUsageApi({
      stats: (range, view) => {
        if (range === '90d') return slowStats.promise
        if (range === '7d') return fastStats.promise
        return Promise.resolve(makeStats(range, view, 10))
      },
      records: (filter, page, pageSize) => {
        if (pageSize === 200 && filter.range === '90d') return slowFacets.promise
        if (pageSize === 200 && filter.range === '7d') return fastFacets.promise
        if (pageSize === 200) return Promise.resolve(makePage([makeRecord('baseline-facet', 'baseline-facet-provider')], 1, 1, 200))
        return Promise.resolve(makePage([makeRecord(`request-${filter.range}`, `request-${filter.range}`)], page))
      }
    })
    const view = render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }))
    await advanceRefreshDelay()

    fireEvent.click(screen.getByRole('button', { name: '90 days' }))
    await advanceRefreshDelay()
    await settle(slowStats, makeStats('90d', 'requests', 900))
    expect(usage.records).toHaveBeenCalledWith(
      { range: '90d', sortBy: 'createdAt', sortDir: 'desc' },
      1,
      200
    )

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await advanceRefreshDelay()

    await settle(fastStats, makeStats('7d', 'requests', 700))
    await settle(fastFacets, makePage([makeRecord('fresh-facet', 'fresh-facet-provider')], 1, 1, 200))
    expect(view.container.querySelector('datalist option[value="stats-700-provider"]')).not.toBeNull()
    expect(view.container.querySelector('datalist option[value="fresh-facet-provider"]')).not.toBeNull()

    await settle(slowFacets, makePage([makeRecord('stale-facet', 'stale-facet-provider')], 1, 1, 200))

    expect.soft(view.container.querySelector('datalist option[value="stats-700-provider"]')).not.toBeNull()
    expect.soft(view.container.querySelector('datalist option[value="stats-900-provider"]')).toBeNull()
    expect.soft(view.container.querySelector('datalist option[value="fresh-facet-provider"]')).not.toBeNull()
    expect(view.container.querySelector('datalist option[value="stale-facet-provider"]')).toBeNull()
    expect(usage.stats).toHaveBeenCalledWith('7d', 'requests')
  })

  it('keeps latest filtered page records when an older page resolves last', async () => {
    const stalePage = deferred<PaginatedUsageRecords>()
    const freshPage = deferred<PaginatedUsageRecords>()
    installUsageApi({
      stats: async (range, view) => makeStats(range, view, 20),
      records: (filter, page, pageSize) => {
        if (pageSize === 200) return Promise.resolve(makePage([makeRecord('facet', 'facet-provider')], 1, 1, 200))
        if (page === 2 && !filter.query) return stalePage.promise
        if (filter.query === 'fresh-filter') return freshPage.promise
        return Promise.resolve(makePage([makeRecord('baseline', 'baseline-provider')], 1, 50))
      }
    })
    const view = render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }))
    await advanceRefreshDelay()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await advanceRefreshDelay()
    fireEvent.change(screen.getByPlaceholderText('Search provider, model, agent, thread, or preview'), {
      target: { value: 'fresh-filter' }
    })
    await advanceRefreshDelay()
    await settle(freshPage, makePage([
      makeRecord('fresh-record', 'fresh-provider'),
      makeRecord('fresh-selected-record', 'fresh-selected-provider')
    ], 1, 50))

    expect(view.container.querySelector('.wb-usage-table')?.textContent).toContain('fresh-provider / fresh-provider-model')
    const selectedRow = screen.getByText('fresh-selected-provider / fresh-selected-provider-model').closest('button')
    if (!selectedRow) throw new Error('Expected the latest record row to render')
    fireEvent.click(selectedRow)
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('fresh-selected-provider / fresh-selected-provider-model')
    await settle(stalePage, makePage([makeRecord('stale-record', 'stale-provider')], 2, 50))

    expect.soft(view.container.querySelector('.wb-usage-table')?.textContent).toContain('fresh-provider / fresh-provider-model')
    expect.soft(view.container.querySelector('.wb-usage-table')?.textContent).not.toContain('stale-provider / stale-provider-model')
    expect.soft(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('fresh-selected-provider / fresh-selected-provider-model')
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).not.toContain('stale-provider / stale-provider-model')
  })

  it('does not let stale stats replace the selected heatmap day', async () => {
    const staleStats = deferred<UsageStats>()
    const currentStats = deferred<UsageStats>()
    installUsageApi({
      stats: (range) => range === 'all' ? staleStats.promise : currentStats.promise,
      records: async () => makePage([], 1, 0, 200)
    })
    const view = render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await advanceRefreshDelay()

    await settle(currentStats, {
      ...makeStats('7d', 'overview', 70),
      heatmap: [
        makeDay('2026-02-01', 111, true),
        makeDay('2026-02-02', 222)
      ]
    })
    fireEvent.click(screen.getByTitle('2026-02-02 / 1 turns / 222 tokens'))
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('2026-02-02')
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('222 tokens')

    await settle(staleStats, {
      ...makeStats('all', 'overview', 90),
      heatmap: [makeDay('2025-12-31', 999, true)]
    })

    expect.soft(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('2026-02-02')
    expect.soft(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('222 tokens')
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).not.toContain('2025-12-31')
  })

  it('does not let stale stats replace the selected model', async () => {
    const staleStats = deferred<UsageStats>()
    const currentStats = deferred<UsageStats>()
    installUsageApi({
      stats: (range, view) => {
        if (view !== 'models') return Promise.resolve(makeStats(range, view, 10))
        return range === 'all' ? staleStats.promise : currentStats.promise
      },
      records: async () => makePage([], 1, 0, 200)
    })
    const view = render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await advanceRefreshDelay()

    await settle(currentStats, {
      ...makeStats('7d', 'models', 70),
      models: [makeModel('fresh-model-one', 111), makeModel('fresh-model-two', 222)]
    })
    const selectedModel = screen.getByText('fresh-model-two').closest('button')
    if (!selectedModel) throw new Error('Expected the latest model row to render')
    fireEvent.click(selectedModel)
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('fresh-model-two')

    await settle(staleStats, {
      ...makeStats('all', 'models', 90),
      models: [makeModel('stale-model', 999)]
    })

    expect.soft(view.container.querySelector('.wb-usage-detail')?.textContent).toContain('fresh-model-two')
    expect(view.container.querySelector('.wb-usage-detail')?.textContent).not.toContain('stale-model')
  })

  it('keeps pricing mutation and reload state owned by the latest generation', async () => {
    const staleUpsert = deferred<UsagePricingRule>()
    const deleteMutation = deferred<boolean>()
    const staleDeletePricing = deferred<UsagePricingRule[]>()
    const currentUpsert = deferred<UsagePricingRule>()
    const currentPricing = deferred<UsagePricingRule[]>()
    const staleStatsReload = deferred<UsageStats>()
    const latestRefreshStats = deferred<UsageStats>()
    let statsCall = 0
    let pricingCall = 0
    let upsertCall = 0
    const usage = installUsageApi({
      stats: (range, view) => {
        statsCall += 1
        if (statsCall === 3) return staleStatsReload.promise
        if (statsCall === 4) return latestRefreshStats.promise
        return Promise.resolve(makeStats(range, view, statsCall * 10))
      },
      records: async () => makePage([], 1, 0, 200),
      pricingList: () => {
        pricingCall += 1
        if (pricingCall === 1) return Promise.resolve([makePricingRule('baseline-pricing-model')])
        if (pricingCall === 2) return staleDeletePricing.promise
        if (pricingCall === 3) return currentPricing.promise
        return Promise.resolve([makePricingRule('latest-pricing-model')])
      },
      pricingUpsert: () => {
        upsertCall += 1
        return upsertCall === 1 ? staleUpsert.promise : currentUpsert.promise
      },
      pricingDelete: () => deleteMutation.promise
    })
    const view = render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: 'Pricing' }))
    await advanceRefreshDelay()
    expect(screen.getByText('test-provider / baseline-pricing-model')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Model ID'), { target: { value: 'candidate-model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      staleUpsert.reject(new Error('stale upsert failure'))
      await staleUpsert.promise.catch(() => undefined)
      await Promise.resolve()
    })
    expect.soft(screen.queryByText('stale upsert failure')).toBeNull()
    expect(screen.getByText('Loading...')).toBeTruthy()

    await settle(deleteMutation, true)
    expect(usage.pricingList).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Save pricing' }))
    await settle(currentUpsert, makePricingRule('candidate-model'))
    expect(usage.pricingList).toHaveBeenCalledTimes(3)
    await settle(currentPricing, [makePricingRule('fresh-pricing-model')])
    expect.soft(screen.getByText('test-provider / fresh-pricing-model')).toBeTruthy()
    expect(screen.getByText('Loading...')).toBeTruthy()

    await settle(staleDeletePricing, [makePricingRule('stale-delete-pricing-model')])
    expect.soft(screen.getByText('test-provider / fresh-pricing-model')).toBeTruthy()
    expect.soft(screen.queryByText('test-provider / stale-delete-pricing-model')).toBeNull()
    expect(screen.getByText('Loading...')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await advanceRefreshDelay()
    await settle(staleStatsReload, makeStats('all', 'pricing', 999))
    expect(screen.getByText('Loading...')).toBeTruthy()
    await settle(latestRefreshStats, makeStats('7d', 'pricing', 777))

    expect.soft(screen.getByText('test-provider / latest-pricing-model')).toBeTruthy()
    expect.soft(screen.queryByText('test-provider / stale-delete-pricing-model')).toBeNull()
    expect.soft(screen.queryByText('stale upsert failure')).toBeNull()
    expect.soft(view.container.querySelector('.wb-usage-state')?.textContent || '').not.toContain('stale')
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(usage.stats).toHaveBeenCalledWith('7d', 'pricing')
  })

  it('ignores an older rejection after a newer range request starts', async () => {
    const staleStats = deferred<UsageStats>()
    const currentStats = deferred<UsageStats>()
    installUsageApi({
      stats: (range) => range === 'all' ? staleStats.promise : currentStats.promise,
      records: async () => makePage([], 1, 0, 200)
    })
    render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await advanceRefreshDelay()

    await act(async () => {
      staleStats.reject(new Error('stale usage failure'))
      await staleStats.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(screen.queryByText('stale usage failure')).toBeNull()
  })

  it('does not let an older finally clear loading for the current request', async () => {
    const staleStats = deferred<UsageStats>()
    const currentStats = deferred<UsageStats>()
    installUsageApi({
      stats: (range) => range === 'all' ? staleStats.promise : currentStats.promise,
      records: async () => makePage([], 1, 0, 200)
    })
    render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await advanceRefreshDelay()

    await settle(staleStats, makeStats('all', 'overview', 30))

    expect(screen.getByText('Loading...')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('invalidates an in-flight refresh when unmounted', async () => {
    const pendingStats = deferred<UsageStats>()
    const usage = installUsageApi({
      stats: () => pendingStats.promise,
      records: async () => makePage([], 1, 0, 200)
    })
    const view = render(<UsageStatsDashboard />)
    await advanceRefreshDelay()
    view.unmount()

    await settle(pendingStats, makeStats('all', 'overview', 40))

    expect(usage.records).not.toHaveBeenCalled()
  })
})
