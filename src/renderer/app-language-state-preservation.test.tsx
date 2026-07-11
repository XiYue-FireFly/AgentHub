// @vitest-environment happy-dom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { DEFAULT_APPEARANCE } from './appearance'
import { getLang, setLang } from './glass/i18n'

const layoutLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))

vi.mock('./workbench/WorkbenchLayout', async () => {
  const ReactModule = await import('react')
  const { ComposerBar } = await import('./workbench/ComposerBar')
  const { UsageStatsDashboard } = await import('./screens/UsageStatsDashboard')

  const attachment: WorkbenchAttachment = {
    id: 'language-state-attachment',
    kind: 'file',
    name: 'language-state.md',
    path: 'E:\\repo\\language-state.md',
    createdAt: 1
  }

  function WorkbenchStateProbe() {
    const [sending, setSending] = ReactModule.useState(false)
    const [externalAttachments, setExternalAttachments] = ReactModule.useState<WorkbenchAttachment[]>([])

    ReactModule.useEffect(() => {
      layoutLifecycle.mounts += 1
      return () => { layoutLifecycle.unmounts += 1 }
    }, [])

    return ReactModule.createElement(
      ReactModule.Fragment,
      null,
      ReactModule.createElement('button', {
        type: 'button',
        'data-testid': 'simulate-composer-busy',
        onClick: () => setSending(true)
      }, 'Simulate composer busy'),
      ReactModule.createElement('button', {
        type: 'button',
        'data-testid': 'inject-composer-attachment',
        onClick: () => setExternalAttachments([attachment])
      }, 'Inject composer attachment'),
      ReactModule.createElement(ComposerBar, {
        mode: 'auto',
        setMode: () => undefined,
        providers: [],
        bindings: [],
        modelSelection: null,
        setModelSelection: () => undefined,
        thinking: { mode: 'off', level: 'minimal' },
        setThinking: () => undefined,
        schedules: [],
        scheduleForMode: () => undefined,
        sending,
        onSend: async () => ({ ok: true as const }),
        onCancel: () => undefined,
        workspaceId: 'workspace-language-state',
        workspaces: [],
        setWorkspaceId: () => undefined,
        onCreateProject: () => undefined,
        localAgents: [{
          agentId: 'codex',
          label: 'Codex',
          installed: true,
          configured: true,
          loginState: 'ready',
          candidates: [],
          workspaceSession: 'per-dispatch'
        }],
        targetAgent: null,
        setTargetAgent: () => undefined,
        agents: {},
        externalAttachments,
        onExternalAttachmentsConsumed: () => setExternalAttachments([])
      }),
      ReactModule.createElement(UsageStatsDashboard)
    )
  }

  return { WorkbenchLayout: WorkbenchStateProbe }
})

function usageStats(range: UsageRange, view: UsageView): UsageStats {
  return {
    range,
    view,
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

function usageRecord(page: number): UsageRequestRecord {
  return {
    id: `usage-page-${page}`,
    eventId: `usage-event-${page}`,
    threadId: 'thread-language-state',
    turnId: 'turn-language-state',
    agentId: 'codex',
    providerId: 'provider-language-state',
    modelId: 'model-language-state',
    requestModelId: 'model-language-state',
    source: 'actual',
    status: 'completed',
    createdAt: 1,
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
    promptPreview: 'prompt',
    responsePreview: 'response',
    rawUsage: {}
  }
}

function installElectronApi(): void {
  const unsubscribe = () => undefined
  const providerConfig = {
    providers: [{
      id: 'provider-language-state',
      name: 'Language state provider',
      kind: 'openai-compatible',
      baseUrl: 'https://example.invalid',
      apiKey: 'test-key',
      enabled: true,
      builtIn: false,
      models: []
    }],
    routing: { bindings: [], fallbackChain: [], strategy: 'single' },
    activeBindingId: null
  }

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      agentic: {
        getApprovalConfig: vi.fn(async () => ({
          version: 1,
          preset: 'auto',
          default: { write: 'allow', exec: 'allow' },
          overrides: {}
        }))
      },
      app: {
        onDeepLink: vi.fn(() => unsubscribe)
      },
      budget: {
        estimateDispatch: vi.fn(async () => ({
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          estimatedRequests: 1,
          estimatedCostUsd: 0,
          hasUnpriced: false,
          dailySpentUsd: 0,
          monthlySpentUsd: 0,
          projectedDailyUsd: 0,
          projectedMonthlyUsd: 0,
          check: { allowed: true }
        }))
      },
      commands: { list: vi.fn(async () => []) },
      hub: { getStatus: vi.fn(async () => ({ running: false, agents: [] })) },
      localAgents: { status: vi.fn(async () => []) },
      notifications: { push: vi.fn(async () => undefined) },
      plugins: {
        scan: vi.fn(async () => []),
        contributions: vi.fn(async () => [])
      },
      providers: {
        get: vi.fn(async () => providerConfig),
        onWarning: vi.fn(() => unsubscribe),
        onConfigChanged: vi.fn(() => unsubscribe)
      },
      proxy: { info: vi.fn(async () => ({ url: 'http://127.0.0.1:9528', running: false })) },
      store: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined)
      },
      usage: {
        stats: vi.fn(async (range: UsageRange, view: UsageView) => usageStats(range, view)),
        records: vi.fn(async (_filter: UsageRecordFilter, page: number, pageSize: number) => ({
          records: [usageRecord(page)],
          total: pageSize === 25 ? 50 : 1,
          page,
          pageSize
        })),
        recordDetail: vi.fn(async () => null),
        pricingList: vi.fn(async () => []),
        pricingUpsert: vi.fn(),
        pricingDelete: vi.fn()
      }
    } as unknown as Window['electronAPI']
  })
}

function composerEditor(): HTMLTextAreaElement {
  const editor = document.querySelector<HTMLTextAreaElement>('.wb-composer-input')
  if (!editor) throw new Error('Expected the real ComposerBar editor to be mounted')
  return editor
}

function queueCountText(): string | undefined {
  return [...document.querySelectorAll('span')]
    .map(element => element.textContent?.trim())
    .find(text => /^1\s/.test(text || ''))
}

describe('App live language state preservation', () => {
  beforeEach(() => {
    layoutLifecycle.mounts = 0
    layoutLifecycle.unmounts = 0
    localStorage.clear()
    const initialAppearance = { ...DEFAULT_APPEARANCE, themeMode: 'light' as const, motion: 'off' as const, language: 'en' as const }
    localStorage.setItem('ah-appearance', JSON.stringify(initialAppearance))
    localStorage.setItem('ah-motion', initialAppearance.motion)
    localStorage.setItem('ah-lang', initialAppearance.language)
    setLang('en')
    installElectronApi()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'electronAPI')
    localStorage.clear()
    setLang('zh')
  })

  it('updates copy without remounting or losing Composer and Usage local state', async () => {
    render(<App />)
    await screen.findByText('Actual tokens')

    fireEvent.click(screen.getByTestId('simulate-composer-busy'))
    fireEvent.change(composerEditor(), { target: { value: 'queued before language switch' } })
    fireEvent.keyDown(composerEditor(), { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(queueCountText()).toBe('1 queued'))

    fireEvent.click(screen.getByTestId('inject-composer-attachment'))
    await screen.findByText('language-state.md')
    fireEvent.change(composerEditor(), { target: { value: 'draft survives language switch' } })

    fireEvent.click(screen.getByRole('button', { name: 'Requests' }))
    const usageQuery = await screen.findByPlaceholderText('Search provider, model, agent, thread, or preview')
    fireEvent.change(usageQuery, { target: { value: 'filter survives language switch' } })
    const nextPage = await screen.findByRole('button', { name: 'Next' })
    fireEvent.click(nextPage)
    await waitFor(() => expect(document.querySelector('.wb-usage-pager span')?.textContent).toBe('2 / 2'))

    const nextAppearance = { ...DEFAULT_APPEARANCE, themeMode: 'light' as const, motion: 'off' as const, language: 'zh' as const }
    await act(async () => {
      window.dispatchEvent(new CustomEvent('agenthub:appearance-change', { detail: nextAppearance }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await waitFor(() => expect(getLang()).toBe('zh'))

    expect.soft(layoutLifecycle.mounts).toBe(1)
    expect.soft(layoutLifecycle.unmounts).toBe(0)
    expect.soft(composerEditor().value).toBe('draft survives language switch')
    expect.soft(screen.queryByText('language-state.md')).not.toBeNull()
    expect.soft(queueCountText()).toBe('1 排队')
    expect.soft(document.querySelector<HTMLInputElement>('.wb-usage-wide input.ah-input')?.value).toBe('filter survives language switch')
    expect.soft(document.querySelector('.wb-usage-pager span')?.textContent).toBe('2 / 2')
    expect.soft(screen.getByRole('button', { name: '请求' }).className).toContain('active')
    expect(screen.getByRole('button', { name: '添加文件或图片' })).toBeTruthy()
  })
})
