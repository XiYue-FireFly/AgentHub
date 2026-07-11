// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS,
  EMPTY_PROVIDER_CONFIG_RETRY_LIMIT
} from './provider-config-load-policy'

interface ObservedWorkbenchProps {
  providers: unknown[]
  configLoadError: string | null
  providerActions: {
    onReload: () => void
  }
}

const observedWorkbench = vi.hoisted(() => ({
  current: null as ObservedWorkbenchProps | null
}))

vi.mock('./workbench/WorkbenchLayout', () => ({
  WorkbenchLayout: (props: ObservedWorkbenchProps) => {
    observedWorkbench.current = {
      providers: props.providers,
      configLoadError: props.configLoadError,
      providerActions: props.providerActions
    }
    return null
  }
}))

vi.mock('./appearance', () => {
  const appearance = { motion: 'off' }
  return {
    applyAppearance: vi.fn(),
    loadAppearance: vi.fn().mockResolvedValue(appearance),
    readAppearanceLocal: vi.fn(() => appearance),
    subscribeSystemTheme: vi.fn(() => () => undefined)
  }
})

vi.mock('./glass/i18n', () => ({
  useLang: () => 'zh-CN'
}))

const readyProviderConfig = {
  providers: [{
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    enabled: true,
    builtIn: true,
    models: [],
    capabilities: {
      protocol: 'chat_completions',
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: 'auto', level: 'medium' }
  }],
  routing: {
    bindings: [],
    fallbackChain: [],
    strategy: 'single'
  },
  activeBindingId: null
}

function installElectronApi(providersGet: () => Promise<unknown>): void {
  const unsubscribe = () => undefined
  const electronApi = {
    providers: {
      get: providersGet,
      onWarning: () => unsubscribe,
      onConfigChanged: () => unsubscribe
    },
    hub: {
      getStatus: async () => ({ running: false, agents: [] })
    },
    localAgents: {
      status: async () => []
    },
    proxy: {
      info: async () => ({ url: 'http://127.0.0.1:9528', running: false })
    },
    app: {
      onDeepLink: () => unsubscribe
    }
  }

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: electronApi as unknown as Window['electronAPI']
  })
}

async function flushPendingEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advanceRetryTick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS)
  })
}

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  let rejectPromise!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

describe('App provider config load retries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    observedWorkbench.current = null
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('caps continuous provider config rejections and exposes the retry error', async () => {
    const providersGet = vi.fn<() => Promise<unknown>>()
      .mockRejectedValue(new Error('provider config unavailable'))
    installElectronApi(providersGet)

    render(<App />)
    await flushPendingEffects()

    for (let tick = 0; tick < EMPTY_PROVIDER_CONFIG_RETRY_LIMIT + 2; tick += 1) {
      await advanceRetryTick()
    }

    expect.soft(providersGet).toHaveBeenCalledTimes(EMPTY_PROVIDER_CONFIG_RETRY_LIMIT)
    expect(observedWorkbench.current?.configLoadError).toBe(
      '主进程配置暂未就绪，请检查应用日志或点击重试。'
    )
  })

  it('applies a recovered config and stops retrying after earlier rejections', async () => {
    const providersGet = vi.fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('provider config unavailable'))
      .mockRejectedValueOnce(new Error('provider config still unavailable'))
      .mockResolvedValue(readyProviderConfig)
    installElectronApi(providersGet)

    render(<App />)
    await flushPendingEffects()
    await advanceRetryTick()
    await advanceRetryTick()

    expect(providersGet).toHaveBeenCalledTimes(3)
    expect(observedWorkbench.current?.providers).toEqual(readyProviderConfig.providers)
    expect(observedWorkbench.current?.configLoadError).toBeNull()

    await advanceRetryTick()
    await advanceRetryTick()
    await advanceRetryTick()
    expect(providersGet).toHaveBeenCalledTimes(3)
  })

  it('does not let a stale rejection consume a manual reload retry budget', async () => {
    const staleRequest = createDeferred<unknown>()
    const providersGet = vi.fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => staleRequest.promise)
      .mockRejectedValue(new Error('provider config unavailable'))
    installElectronApi(providersGet)

    render(<App />)
    await flushPendingEffects()
    const workbench = observedWorkbench.current
    if (!workbench) throw new Error('Workbench did not render')

    await act(async () => {
      workbench.providerActions.onReload()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(providersGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      staleRequest.reject(new Error('stale provider config request failed'))
      await staleRequest.promise.catch(() => undefined)
    })

    expect.soft(vi.getTimerCount()).toBe(2)
    for (let tick = 0; tick < EMPTY_PROVIDER_CONFIG_RETRY_LIMIT + 2; tick += 1) {
      await advanceRetryTick()
    }

    expect.soft(providersGet).toHaveBeenCalledTimes(1 + EMPTY_PROVIDER_CONFIG_RETRY_LIMIT)
    expect(observedWorkbench.current?.configLoadError).toBe(
      '主进程配置暂未就绪，请检查应用日志或点击重试。'
    )
  })

  it('does not retry a pending provider config request after unmount', async () => {
    const pendingRequest = createDeferred<unknown>()
    const providersGet = vi.fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => pendingRequest.promise)
      .mockRejectedValue(new Error('provider config unavailable'))
    installElectronApi(providersGet)

    const view = render(<App />)
    await flushPendingEffects()
    expect(providersGet).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => {
      pendingRequest.reject(new Error('provider config request failed after unmount'))
      await pendingRequest.promise.catch(() => undefined)
    })

    expect.soft(vi.getTimerCount()).toBe(0)
    await advanceRetryTick()
    expect.soft(providersGet).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
