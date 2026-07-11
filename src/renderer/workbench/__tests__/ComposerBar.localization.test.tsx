// @vitest-environment happy-dom

import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang, type Lang } from '../../glass/i18n'
import { ComposerBar } from '../ComposerBar'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function installApi(estimate: Promise<BudgetEstimate>) {
  ;(window as any).electronAPI = {
    agentic: {
      getApprovalConfig: vi.fn().mockResolvedValue({ version: 1, preset: 'auto', default: { write: 'allow', exec: 'allow' }, overrides: {} })
    },
    commands: { list: vi.fn().mockResolvedValue([]) },
    plugins: { scan: vi.fn().mockResolvedValue([]), contributions: vi.fn().mockResolvedValue([]) },
    budget: { estimateDispatch: vi.fn().mockReturnValue(estimate) },
    notifications: { push: vi.fn().mockResolvedValue(undefined) }
  }
}

function props(): React.ComponentProps<typeof ComposerBar> {
  return {
    mode: 'auto',
    setMode: vi.fn(),
    providers: [],
    bindings: [],
    modelSelection: null,
    setModelSelection: vi.fn(),
    thinking: { mode: 'off', level: 'minimal' },
    setThinking: vi.fn(),
    schedules: [],
    scheduleForMode: () => undefined,
    sending: false,
    onSend: vi.fn().mockResolvedValue({ ok: true }),
    onCancel: vi.fn(),
    workspaceId: 'workspace-1',
    workspaces: [],
    setWorkspaceId: vi.fn(),
    onCreateProject: vi.fn(),
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
    setTargetAgent: vi.fn(),
    agents: {}
  }
}

const unpricedEstimate: BudgetEstimate = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  estimatedRequests: 1,
  estimatedCostUsd: null,
  hasUnpriced: true,
  dailySpentUsd: 0,
  monthlySpentUsd: 0,
  projectedDailyUsd: null,
  projectedMonthlyUsd: null,
  check: { allowed: true }
}

describe('ComposerBar localization', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
    ['zh', '切换 Agent 或 API 厂商', 'Agent', '估算中...', '未定价'],
    ['en', 'Switch agent or API provider', 'Agents', 'Estimating...', 'unpriced']
  ] as Array<[Lang, string, string, string, string]>)('localizes the Agent picker and budget state in %s', async (lang, pickerName, agentHeading, estimating, unpriced) => {
    setLang(lang)
    const estimate = deferred<BudgetEstimate>()
    installApi(estimate.promise)
    render(<ComposerBar {...props()} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: pickerName }))
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('.wb-agent-picker-title')?.textContent).toBe(agentHeading)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'check budget' } })
    act(() => { vi.advanceTimersByTime(450) })
    expect(screen.getByText(estimating)).toBeTruthy()

    await act(async () => {
      estimate.resolve(unpricedEstimate)
      await estimate.promise
      await vi.runAllTimersAsync()
    })
    expect(document.querySelector('.wb-budget-estimate small')?.textContent).toBe(unpriced)
  })
})
