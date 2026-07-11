// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

interface TestProvider {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  builtIn: boolean
  models: unknown[]
  capabilities: {
    protocol: string
    stream: boolean
    nativeThinking: boolean
    budgetTokens: boolean
    toolCalls: boolean
    systemPrompt: boolean
  }
  defaultThinking: { mode: string; level: string }
}

interface TestBinding {
  agentId: string
  providerId: string
  modelId: string
  thinking: { mode: 'off' | 'auto' | 'enabled'; level: string }
  protocol: 'http'
}

interface TestConfig {
  providers: TestProvider[]
  routing: {
    bindings: TestBinding[]
    fallbackChain: string[]
    strategy: 'single'
  }
  activeBindingId: string | null
}

interface ObservedWorkbenchProps {
  providers: TestProvider[]
  bindings: TestBinding[]
  fallbackChain: string[]
  providerActions: {
    onSetEnabled: (id: string, enabled: boolean) => Promise<void>
    onSetKey: (id: string, key: string) => Promise<void>
    onSetBinding: (binding: TestBinding) => Promise<void>
    onSetFallback: (chain: string[]) => Promise<void>
    onReorderProvidersForClaude: (orderedIds: string[]) => Promise<void>
  }
}

const observedWorkbench = vi.hoisted(() => ({
  current: null as ObservedWorkbenchProps | null
}))

vi.mock('./workbench/WorkbenchLayout', () => ({
  WorkbenchLayout: (props: ObservedWorkbenchProps) => {
    observedWorkbench.current = {
      providers: props.providers,
      bindings: props.bindings,
      fallbackChain: props.fallbackChain,
      providerActions: props.providerActions
    }
    return null
  }
}))

vi.mock('./appearance', async importOriginal => {
  const actual = await importOriginal<typeof import('./appearance')>()
  return {
    ...actual,
    applyAppearance: vi.fn(),
    loadAppearance: vi.fn().mockResolvedValue(actual.DEFAULT_APPEARANCE),
    readAppearanceLocal: vi.fn(() => actual.DEFAULT_APPEARANCE),
    subscribeSystemTheme: vi.fn(() => () => undefined)
  }
})

vi.mock('./glass/i18n', () => ({
  setLang: vi.fn(),
  useLang: () => 'zh'
}))

function provider(id: string, overrides: Partial<TestProvider> = {}): TestProvider {
  return {
    id,
    name: id.toUpperCase(),
    kind: 'openai',
    baseUrl: `https://${id}.example.test/v1`,
    apiKey: 'old-key',
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
    defaultThinking: { mode: 'auto', level: 'medium' },
    ...overrides
  }
}

function binding(modelId: string): TestBinding {
  return {
    agentId: 'codex',
    providerId: 'openai',
    modelId,
    thinking: { mode: 'auto', level: 'medium' },
    protocol: 'http'
  }
}

function config(options: {
  providers?: TestProvider[]
  bindings?: TestBinding[]
  fallbackChain?: string[]
} = {}): TestConfig {
  return {
    providers: options.providers ?? [provider('openai')],
    routing: {
      bindings: options.bindings ?? [binding('model-initial')],
      fallbackChain: options.fallbackChain ?? ['initial-fallback'],
      strategy: 'single'
    },
    activeBindingId: null
  }
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

function installElectronApi(initialConfig: TestConfig) {
  const unsubscribe = () => undefined
  let configChangedListener: ((nextConfig: TestConfig) => void) | null = null
  const providersGet = vi.fn<() => Promise<unknown>>().mockResolvedValue(initialConfig)
  const providersSetEnabled = vi.fn<(id: string, enabled: boolean) => Promise<unknown>>()
    .mockResolvedValue(initialConfig)
  const providersSetKey = vi.fn<(id: string, key: string) => Promise<unknown>>()
    .mockResolvedValue(initialConfig)
  const providersReorder = vi.fn<(orderedIds: string[]) => Promise<unknown>>()
    .mockResolvedValue(initialConfig)
  const routingSetBinding = vi.fn<(nextBinding: TestBinding) => Promise<unknown>>()
    .mockResolvedValue(undefined)
  const routingSetFallback = vi.fn<(chain: string[]) => Promise<unknown>>()
    .mockResolvedValue(undefined)
  const electronApi = {
    providers: {
      get: providersGet,
      setEnabled: providersSetEnabled,
      setKey: providersSetKey,
      reorderForClaude: providersReorder,
      onWarning: () => unsubscribe,
      onConfigChanged: (listener: (nextConfig: TestConfig) => void) => {
        configChangedListener = listener
        return unsubscribe
      }
    },
    routing: {
      setBinding: routingSetBinding,
      setFallback: routingSetFallback
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

  return {
    providersGet,
    providersSetEnabled,
    providersSetKey,
    providersReorder,
    routingSetBinding,
    routingSetFallback,
    emitConfigChanged(nextConfig: TestConfig) {
      if (!configChangedListener) throw new Error('Provider config listener was not registered')
      configChangedListener(nextConfig)
    }
  }
}

async function flushPendingEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function beginMutation(start: () => Promise<void>): Promise<{ completion: Promise<void> }> {
  let completion: Promise<void> | undefined
  await act(async () => {
    completion = start()
    await Promise.resolve()
  })
  if (!completion) throw new Error('Mutation did not start')
  return { completion }
}

async function resolveMutation<T>(
  deferred: ReturnType<typeof createDeferred<T>>,
  value: T,
  completion: Promise<void>
): Promise<void> {
  await act(async () => {
    deferred.resolve(value)
    await completion
    await Promise.resolve()
  })
}

async function rejectMutation<T>(
  deferred: ReturnType<typeof createDeferred<T>>,
  completion: Promise<void>
): Promise<void> {
  await act(async () => {
    deferred.reject(new Error('mutation failed'))
    await completion
    await Promise.resolve()
  })
}

function workbench(): ObservedWorkbenchProps {
  if (!observedWorkbench.current) throw new Error('Workbench did not render')
  return observedWorkbench.current
}

describe('App provider and routing mutation races', () => {
  let originalElectronApi: PropertyDescriptor | undefined

  beforeEach(() => {
    originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
    observedWorkbench.current = null
  })

  afterEach(() => {
    cleanup()
    if (originalElectronApi) Object.defineProperty(window, 'electronAPI', originalElectronApi)
    else Reflect.deleteProperty(window, 'electronAPI')
  })

  it('keeps the newer provider intent when two successful responses arrive in reverse order', async () => {
    const initial = config()
    const firstResponse = createDeferred<unknown>()
    const secondResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersSetEnabled
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const first = await beginMutation(() => workbench().providerActions.onSetEnabled('openai', false))
    const second = await beginMutation(() => workbench().providerActions.onSetEnabled('openai', true))
    await resolveMutation(
      secondResponse,
      config({ providers: [provider('openai', { enabled: true })], fallbackChain: ['newer-response'] }),
      second.completion
    )
    await resolveMutation(
      firstResponse,
      config({ providers: [provider('openai', { enabled: false })], fallbackChain: ['stale-response'] }),
      first.completion
    )

    expect.soft(workbench().providers[0].enabled).toBe(true)
    expect(workbench().fallbackChain).toEqual(['newer-response'])
  })

  it('ignores an older provider failure after a newer provider success', async () => {
    const initial = config()
    const firstResponse = createDeferred<unknown>()
    const secondResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersSetKey
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const first = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'first-key'))
    const second = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'second-key'))
    await resolveMutation(
      secondResponse,
      config({ providers: [provider('openai', { apiKey: 'second-key' })] }),
      second.completion
    )
    await rejectMutation(firstResponse, first.completion)

    expect(workbench().providers[0].apiKey).toBe('second-key')
  })

  it('reloads authoritative config when the latest provider mutation fails', async () => {
    const initial = config({ providers: [provider('openai', { apiKey: 'old-key' })] })
    const authoritative = config({ providers: [provider('openai', { apiKey: 'authoritative-key' })] })
    const response = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersGet
      .mockReset()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(authoritative)
    ipc.providersSetKey.mockImplementationOnce(() => response.promise)
    render(<App />)
    await flushPendingEffects()

    const mutation = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'rejected-key'))
    await rejectMutation(response, mutation.completion)
    await flushPendingEffects()

    expect.soft(ipc.providersGet).toHaveBeenCalledTimes(2)
    expect(workbench().providers[0].apiKey).toBe('authoritative-key')
  })

  it('does not let a stale provider config overwrite a newer routing intent', async () => {
    const initial = config()
    const providerResponse = createDeferred<unknown>()
    const fallbackResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersSetEnabled.mockImplementationOnce(() => providerResponse.promise)
    ipc.routingSetFallback.mockImplementationOnce(() => fallbackResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const providerMutation = await beginMutation(() => workbench().providerActions.onSetEnabled('openai', false))
    const fallbackMutation = await beginMutation(() => workbench().providerActions.onSetFallback(['newer-fallback']))
    await resolveMutation(fallbackResponse, undefined, fallbackMutation.completion)
    await resolveMutation(
      providerResponse,
      config({ providers: [provider('openai', { enabled: false })], fallbackChain: ['stale-fallback'] }),
      providerMutation.completion
    )

    expect.soft(workbench().providers[0].enabled).toBe(false)
    expect(workbench().fallbackChain).toEqual(['newer-fallback'])
  })

  it('does not let a newer provider response overwrite an older pending routing intent', async () => {
    const initial = config()
    const fallbackResponse = createDeferred<unknown>()
    const providerResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.routingSetFallback.mockImplementationOnce(() => fallbackResponse.promise)
    ipc.providersSetEnabled.mockImplementationOnce(() => providerResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const fallbackMutation = await beginMutation(() => workbench().providerActions.onSetFallback(['pending-fallback']))
    const providerMutation = await beginMutation(() => workbench().providerActions.onSetEnabled('openai', false))
    await resolveMutation(
      providerResponse,
      config({ providers: [provider('openai', { enabled: false })], fallbackChain: ['stale-fallback'] }),
      providerMutation.completion
    )
    await resolveMutation(fallbackResponse, undefined, fallbackMutation.completion)

    expect.soft(workbench().providers[0].enabled).toBe(false)
    expect(workbench().fallbackChain).toEqual(['pending-fallback'])
  })

  it('reloads a failed provider after newer routing and keeps a later provider mutation', async () => {
    const initial = config({ providers: [provider('openai', { apiKey: 'old-key' })] })
    const failedProviderResponse = createDeferred<unknown>()
    const fallbackResponse = createDeferred<unknown>()
    const reloadResponse = createDeferred<unknown>()
    const laterProviderResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersGet
      .mockReset()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => reloadResponse.promise)
    ipc.providersSetKey
      .mockImplementationOnce(() => failedProviderResponse.promise)
      .mockImplementationOnce(() => laterProviderResponse.promise)
    ipc.routingSetFallback.mockImplementationOnce(() => fallbackResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const failedProvider = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'failed-key'))
    const fallback = await beginMutation(() => workbench().providerActions.onSetFallback(['newer-fallback']))
    await resolveMutation(fallbackResponse, undefined, fallback.completion)
    await rejectMutation(failedProviderResponse, failedProvider.completion)
    expect.soft(ipc.providersGet).toHaveBeenCalledTimes(2)

    const laterProvider = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'latest-key'))
    await resolveMutation(
      laterProviderResponse,
      config({
        providers: [provider('openai', { apiKey: 'latest-key' })],
        fallbackChain: ['newer-fallback']
      }),
      laterProvider.completion
    )
    await act(async () => {
      reloadResponse.resolve(config({
        providers: [provider('openai', { apiKey: 'old-key' })],
        fallbackChain: ['newer-fallback']
      }))
      await reloadResponse.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect.soft(workbench().providers[0].apiKey).toBe('latest-key')
    expect(workbench().fallbackChain).toEqual(['newer-fallback'])
  })

  it('restarts a failed provider reload after a later routing mutation invalidates it', async () => {
    const initial = config({ providers: [provider('openai', { apiKey: 'old-key' })] })
    const failedProviderResponse = createDeferred<unknown>()
    const staleReloadResponse = createDeferred<unknown>()
    const fallbackResponse = createDeferred<unknown>()
    const authoritative = config({
      providers: [provider('openai', { apiKey: 'old-key' })],
      fallbackChain: ['newer-fallback']
    })
    const ipc = installElectronApi(initial)
    ipc.providersGet
      .mockReset()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => staleReloadResponse.promise)
      .mockResolvedValue(authoritative)
    ipc.providersSetKey.mockImplementationOnce(() => failedProviderResponse.promise)
    ipc.routingSetFallback.mockImplementationOnce(() => fallbackResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const failedProvider = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'failed-key'))
    await rejectMutation(failedProviderResponse, failedProvider.completion)
    expect.soft(ipc.providersGet).toHaveBeenCalledTimes(2)

    const fallback = await beginMutation(() => workbench().providerActions.onSetFallback(['newer-fallback']))
    await act(async () => {
      staleReloadResponse.reject(new Error('stale authoritative reload failed'))
      await staleReloadResponse.promise.catch(() => undefined)
      await Promise.resolve()
    })
    await resolveMutation(fallbackResponse, undefined, fallback.completion)
    await flushPendingEffects()

    expect.soft(ipc.providersGet).toHaveBeenCalledTimes(3)
    expect.soft(workbench().providers[0].apiKey).toBe('old-key')
    expect(workbench().fallbackChain).toEqual(['newer-fallback'])
  })

  it('treats a delayed config-changed payload as a reload signal instead of applying its stale snapshot', async () => {
    const initial = config({
      providers: [provider('openai', { apiKey: 'old-key' })],
      fallbackChain: ['old-fallback']
    })
    const authoritative = config({
      providers: [provider('openai', { apiKey: 'latest-key' })],
      fallbackChain: ['latest-fallback']
    })
    const ipc = installElectronApi(initial)
    ipc.providersGet
      .mockReset()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(authoritative)
    ipc.providersSetKey.mockResolvedValueOnce(authoritative)
    ipc.routingSetFallback.mockResolvedValueOnce(undefined)
    render(<App />)
    await flushPendingEffects()

    const providerMutation = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'latest-key'))
    await providerMutation.completion
    const fallbackMutation = await beginMutation(() => workbench().providerActions.onSetFallback(['latest-fallback']))
    await fallbackMutation.completion

    await act(async () => {
      ipc.emitConfigChanged(initial)
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushPendingEffects()

    expect.soft(ipc.providersGet).toHaveBeenCalledTimes(2)
    expect.soft(workbench().providers[0].apiKey).toBe('latest-key')
    expect(workbench().fallbackChain).toEqual(['latest-fallback'])
  })

  it('does not start an authoritative reload when a pending mutation fails after unmount', async () => {
    const initial = config({ providers: [provider('openai', { apiKey: 'old-key' })] })
    const mutationResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersSetKey.mockImplementationOnce(() => mutationResponse.promise)
    const view = render(<App />)
    await flushPendingEffects()

    const mutation = await beginMutation(() => workbench().providerActions.onSetKey('openai', 'failed-key'))
    view.unmount()
    await rejectMutation(mutationResponse, mutation.completion)
    await flushPendingEffects()

    expect(ipc.providersGet).toHaveBeenCalledTimes(1)
  })

  it('ignores an older binding failure after a newer binding success', async () => {
    const initial = config()
    const firstResponse = createDeferred<unknown>()
    const secondResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.routingSetBinding
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const first = await beginMutation(() => workbench().providerActions.onSetBinding(binding('model-first')))
    const second = await beginMutation(() => workbench().providerActions.onSetBinding(binding('model-second')))
    await resolveMutation(secondResponse, undefined, second.completion)
    await rejectMutation(firstResponse, first.completion)

    expect(workbench().bindings[0].modelId).toBe('model-second')
  })

  it('reloads authoritative config when the latest fallback mutation fails', async () => {
    const initial = config({ fallbackChain: ['old-fallback'] })
    const authoritative = config({ fallbackChain: ['authoritative-fallback'] })
    const response = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersGet
      .mockReset()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(authoritative)
    ipc.routingSetFallback.mockImplementationOnce(() => response.promise)
    render(<App />)
    await flushPendingEffects()

    const mutation = await beginMutation(() => workbench().providerActions.onSetFallback(['rejected-fallback']))
    await rejectMutation(response, mutation.completion)
    await flushPendingEffects()

    expect.soft(ipc.providersGet).toHaveBeenCalledTimes(2)
    expect(workbench().fallbackChain).toEqual(['authoritative-fallback'])
  })

  it('keeps the newer provider order when reorder responses arrive in reverse order', async () => {
    const initial = config({ providers: [provider('alpha'), provider('beta')] })
    const firstResponse = createDeferred<unknown>()
    const secondResponse = createDeferred<unknown>()
    const ipc = installElectronApi(initial)
    ipc.providersReorder
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    render(<App />)
    await flushPendingEffects()

    const first = await beginMutation(() => workbench().providerActions.onReorderProvidersForClaude(['beta', 'alpha']))
    const second = await beginMutation(() => workbench().providerActions.onReorderProvidersForClaude(['alpha', 'beta']))
    await resolveMutation(
      secondResponse,
      config({ providers: [provider('alpha'), provider('beta')], fallbackChain: ['newer-order'] }),
      second.completion
    )
    await resolveMutation(
      firstResponse,
      config({ providers: [provider('beta'), provider('alpha')], fallbackChain: ['stale-order'] }),
      first.completion
    )

    expect.soft(workbench().providers.map(item => item.id)).toEqual(['alpha', 'beta'])
    expect(workbench().fallbackChain).toEqual(['newer-order'])
  })
})
