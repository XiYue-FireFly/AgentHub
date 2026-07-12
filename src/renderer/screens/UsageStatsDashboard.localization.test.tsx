// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang, type Lang } from '../glass/i18n'
import { UsageStatsDashboard } from './UsageStatsDashboard'

function makeStats(): UsageStats {
  return {
    range: 'all',
    view: 'overview',
    sessions: 1,
    messages: 1,
    totalTokens: 15,
    actualTokens: 15,
    estimatedTokens: 0,
    hasEstimated: false,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheSavingsTokens: 0,
    cacheSavingsUsd: null,
    billableInputTokens: 10,
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
    heatmap: [],
    models: [],
    providers: []
  }
}

function installUsageApi() {
  ;(window as any).electronAPI = {
    usage: {
      stats: vi.fn().mockResolvedValue(makeStats()),
      records: vi.fn().mockResolvedValue({ records: [], total: 0, page: 1, pageSize: 200 }),
      pricingList: vi.fn().mockResolvedValue([]),
      pricingUpsert: vi.fn(),
      pricingDelete: vi.fn()
    }
  }
}

async function renderOverview() {
  render(<UsageStatsDashboard />)
  await act(async () => {
    vi.advanceTimersByTime(220)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('UsageStatsDashboard localization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installUsageApi()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    setLang('zh')
    delete (window as any).electronAPI
    vi.restoreAllMocks()
  })

  it.each([
    ['zh', '概览', '刷新', '实际令牌数', '仅包含已报告用量'],
    ['en', 'Overview', 'Refresh', 'Actual tokens', 'Only reported usage']
  ] as Array<[Lang, string, string, string, string]>)('renders key %s copy through the active language', async (lang, tab, refresh, card, hint) => {
    setLang(lang)
    await renderOverview()

    expect(screen.getByRole('button', { name: tab })).toBeTruthy()
    expect(screen.getByRole('button', { name: refresh })).toBeTruthy()
    expect(screen.getByText(card)).toBeTruthy()
    expect(screen.getByText(hint)).toBeTruthy()
  })
})
