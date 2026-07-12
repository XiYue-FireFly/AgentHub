// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { DEFAULT_APPEARANCE, type AppearancePreferences } from './appearance'
import { getLang, setLang, type Lang } from './glass/i18n'

vi.mock('./workbench/WorkbenchLayout', () => ({
  WorkbenchLayout: () => null
}))

class AppearanceErrorBoundary extends Component<{
  children: ReactNode
  onError: (error: Error) => void
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError(error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const readyProviderConfig = {
  providers: [{
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    enabled: true,
    builtIn: true,
    models: []
  }],
  routing: { bindings: [], fallbackChain: [], strategy: 'single' },
  activeBindingId: null
}

function appearance(overrides: Partial<AppearancePreferences>): AppearancePreferences {
  return { ...DEFAULT_APPEARANCE, ...overrides }
}

function writeLocalAppearance(preferences: AppearancePreferences): void {
  localStorage.setItem('ah-appearance', JSON.stringify(preferences))
  localStorage.setItem('ah-motion', preferences.motion)
  localStorage.setItem('ah-lang', preferences.language)
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

function installElectronApi(storeGet: () => Promise<unknown>): void {
  const unsubscribe = () => undefined
  const electronApi = {
    store: { get: storeGet },
    providers: {
      get: async () => readyProviderConfig,
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

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<EventListenerOrEventListenerObject>()
  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'change') listeners.add(listener)
  })
  const removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'change') listeners.delete(listener)
  })
  const mediaQueryList = {
    get matches() { return matches },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  } as unknown as MediaQueryList

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQueryList) as typeof window.matchMedia
  })

  return {
    addCount: () => addEventListener.mock.calls.length,
    removeCount: () => removeEventListener.mock.calls.length,
    listenerCount: () => listeners.size,
    emit(nextMatches: boolean) {
      matches = nextMatches
      const event = new Event('change')
      Object.defineProperty(event, 'matches', { value: matches })
      Object.defineProperty(event, 'media', { value: mediaQueryList.media })
      for (const listener of [...listeners]) {
        if (typeof listener === 'function') listener.call(mediaQueryList, event)
        else listener.handleEvent(event)
      }
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

async function dispatchAppearanceChange(detail: unknown): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('agenthub:appearance-change', { detail }))
    await Promise.resolve()
  })
}

const appearanceRootAttributes = [
  'data-theme',
  'data-theme-mode',
  'data-motion',
  'data-diff-marker',
  'data-pointer-cursor',
  'data-translucent-sidebar',
  'data-ui-style',
  'data-uistyle',
  'style'
]

function captureAppearanceRoot(): Map<string, string | null> {
  return new Map(appearanceRootAttributes.map(name => [name, document.documentElement.getAttribute(name)]))
}

function restoreAppearanceRoot(snapshot: Map<string, string | null>): void {
  for (const [name, value] of snapshot) {
    if (value === null) document.documentElement.removeAttribute(name)
    else document.documentElement.setAttribute(name, value)
  }
}

function captureLocalStorage(): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key !== null) entries.push([key, localStorage.getItem(key) ?? ''])
  }
  return entries
}

function restoreWindowProperty(name: 'matchMedia' | 'electronAPI', descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(window, name, descriptor)
  else Reflect.deleteProperty(window, name)
}

describe('App appearance lifecycle', () => {
  let originalMatchMedia: PropertyDescriptor | undefined
  let originalElectronApi: PropertyDescriptor | undefined
  let originalLanguage: Lang
  let originalStorage: Array<[string, string]>
  let originalRoot: Map<string, string | null>

  beforeEach(() => {
    originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')
    originalLanguage = getLang()
    originalStorage = captureLocalStorage()
    originalRoot = captureAppearanceRoot()
    cleanup()
    setLang('zh')
    localStorage.clear()
    restoreAppearanceRoot(new Map(appearanceRootAttributes.map(name => [name, null])))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    setLang(originalLanguage)
    localStorage.clear()
    for (const [key, value] of originalStorage) localStorage.setItem(key, value)
    restoreAppearanceRoot(originalRoot)
    restoreWindowProperty('matchMedia', originalMatchMedia)
    restoreWindowProperty('electronAPI', originalElectronApi)
  })

  it('applies deferred store theme, motion, and language when no local appearance exists', async () => {
    installMatchMedia(false)
    const storedAppearance = createDeferred<unknown>()
    installElectronApi(() => storedAppearance.promise)
    render(<App />)

    const restored = appearance({ themeMode: 'dark', motion: 'off', language: 'en' })
    await act(async () => {
      storedAppearance.resolve(restored)
      await storedAppearance.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect.soft(document.documentElement.dataset.themeMode).toBe('dark')
    expect.soft(document.documentElement.dataset.theme).toBe('dark')
    expect.soft(document.documentElement.dataset.motion).toBe('off')
    expect(getLang()).toBe('en')
  })

  it('applies a system preference change and uses it for later media changes', async () => {
    const initial = appearance({ themeMode: 'light', motion: 'rich', language: 'zh' })
    writeLocalAppearance(initial)
    const media = installMatchMedia(false)
    const ignoredStoreFallback = appearance({ themeMode: 'dark', motion: 'off', language: 'en' })
    installElectronApi(async () => ignoredStoreFallback)
    render(<App />)
    await flushPendingEffects()

    expect(document.documentElement.dataset.themeMode).toBe('light')
    expect(document.documentElement.dataset.motion).toBe('rich')
    expect(getLang()).toBe('zh')
    const addCountBeforeChange = media.addCount()
    const removeCountBeforeChange = media.removeCount()

    const system = appearance({ themeMode: 'system', motion: 'subtle', language: 'en' })
    await dispatchAppearanceChange(system)

    expect.soft(document.documentElement.dataset.themeMode).toBe('system')
    expect.soft(document.documentElement.dataset.theme).toBe('light')
    expect.soft(document.documentElement.dataset.motion).toBe('subtle')
    expect.soft(getLang()).toBe('en')
    expect.soft(media.addCount()).toBe(addCountBeforeChange + 1)
    expect.soft(media.removeCount()).toBe(removeCountBeforeChange + 1)
    expect(media.listenerCount()).toBe(1)

    await act(async () => media.emit(true))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('replaces appearance media listeners and removes the last listener on unmount', async () => {
    const initial = appearance({ themeMode: 'light' })
    writeLocalAppearance(initial)
    const media = installMatchMedia(false)
    installElectronApi(async () => initial)
    const view = render(<App />)
    await flushPendingEffects()
    const addCountBeforeChanges = media.addCount()
    const removeCountBeforeChanges = media.removeCount()

    await dispatchAppearanceChange(appearance({ themeMode: 'dark', motion: 'subtle' }))
    await dispatchAppearanceChange(appearance({ themeMode: 'system', motion: 'off' }))

    expect.soft(media.addCount()).toBe(addCountBeforeChanges + 2)
    expect.soft(media.removeCount()).toBe(removeCountBeforeChanges + 2)
    expect(media.listenerCount()).toBe(1)

    view.unmount()
    expect.soft(media.listenerCount()).toBe(0)
    expect(media.removeCount()).toBe(media.addCount())
  })

  it('normalizes a partial appearance event before applying it', async () => {
    const initial = appearance({ themeMode: 'light', motion: 'subtle', language: 'en' })
    writeLocalAppearance(initial)
    const media = installMatchMedia(false)
    installElectronApi(async () => initial)
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <AppearanceErrorBoundary onError={onError}>
        <App />
      </AppearanceErrorBoundary>
    )
    await flushPendingEffects()
    const addCountBeforeChange = media.addCount()
    const removeCountBeforeChange = media.removeCount()

    await dispatchAppearanceChange({ themeMode: 'dark' })

    expect.soft(onError).not.toHaveBeenCalled()
    expect.soft(document.documentElement.dataset.themeMode).toBe('dark')
    expect.soft(document.documentElement.dataset.theme).toBe('dark')
    expect.soft(document.documentElement.dataset.motion).toBe(DEFAULT_APPEARANCE.motion)
    expect.soft(document.documentElement.dataset.diffMarker).toBe(DEFAULT_APPEARANCE.diffMarker)
    expect.soft(getLang()).toBe(DEFAULT_APPEARANCE.language)
    expect.soft(media.addCount()).toBe(addCountBeforeChange + 1)
    expect.soft(media.removeCount()).toBe(removeCountBeforeChange + 1)
    expect(media.listenerCount()).toBe(1)
  })

  it('ignores non-object and array appearance event details', async () => {
    const initial = appearance({ themeMode: 'dark', motion: 'off', language: 'en' })
    writeLocalAppearance(initial)
    const media = installMatchMedia(false)
    installElectronApi(async () => initial)
    render(<App />)
    await flushPendingEffects()
    const rootBeforeInvalidEvents = captureAppearanceRoot()
    const addCountBeforeInvalidEvents = media.addCount()
    const removeCountBeforeInvalidEvents = media.removeCount()

    const functionDetail = Object.assign(
      () => undefined,
      appearance({ themeMode: 'light', motion: 'rich', language: 'zh' })
    )
    const arrayDetail = Object.assign(
      [],
      appearance({ themeMode: 'system', motion: 'subtle', language: 'zh' })
    )
    await dispatchAppearanceChange(functionDetail)
    await dispatchAppearanceChange(arrayDetail)

    expect.soft(captureAppearanceRoot()).toEqual(rootBeforeInvalidEvents)
    expect.soft(getLang()).toBe('en')
    expect.soft(media.addCount()).toBe(addCountBeforeInvalidEvents)
    expect.soft(media.removeCount()).toBe(removeCountBeforeInvalidEvents)
    expect(media.listenerCount()).toBe(1)
  })

  it('does not apply a deferred store appearance after unmount', async () => {
    const media = installMatchMedia(false)
    const storedAppearance = createDeferred<unknown>()
    installElectronApi(() => storedAppearance.promise)
    const view = render(<App />)
    await flushPendingEffects()

    view.unmount()
    document.documentElement.dataset.theme = 'sentinel'
    document.documentElement.dataset.motion = 'sentinel'
    const restored = appearance({ themeMode: 'dark', motion: 'off', language: 'en' })
    await act(async () => {
      storedAppearance.resolve(restored)
      await storedAppearance.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect.soft(document.documentElement.dataset.theme).toBe('sentinel')
    expect.soft(document.documentElement.dataset.motion).toBe('sentinel')
    expect.soft(getLang()).toBe('zh')
    expect(media.listenerCount()).toBe(0)
  })
})
