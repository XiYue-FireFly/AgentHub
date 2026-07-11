import { describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  shell: { openExternal: electronMock.openExternal }
}))

describe('webview guards', () => {
  it('allows only http and https browser URLs', async () => {
    const { safeBrowserUrl } = await import('../webview-guards')

    expect(safeBrowserUrl('https://example.com')).toBe(true)
    expect(safeBrowserUrl('http://example.com')).toBe(true)
    expect(safeBrowserUrl('file:///C:/Users/test/.ssh/id_rsa')).toBe(false)
    expect(safeBrowserUrl('javascript:alert(1)')).toBe(false)
    expect(safeBrowserUrl('')).toBe(false)
  })

  it('strips privileged webview preferences and pins the browser partition', async () => {
    const { WEBVIEW_PARTITION, sanitizeWebviewPreferences } = await import('../webview-guards')
    const preferences: any = {
      preload: 'unsafe.js',
      preloadURL: 'file:///unsafe.js',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      allowRunningInsecureContent: true,
      partition: 'persist:shared'
    }

    sanitizeWebviewPreferences(preferences)

    expect(preferences.preload).toBeUndefined()
    expect(preferences.preloadURL).toBeUndefined()
    expect(preferences.nodeIntegration).toBe(false)
    expect(preferences.nodeIntegrationInSubFrames).toBe(false)
    expect(preferences.nodeIntegrationInWorker).toBe(false)
    expect(preferences.contextIsolation).toBe(true)
    expect(preferences.sandbox).toBe(true)
    expect(preferences.allowRunningInsecureContent).toBe(false)
    expect(preferences.partition).toBe(WEBVIEW_PARTITION)
  })

  it('prevents attaching unsafe webviews and denies window opens', async () => {
    const { installWebviewGuards } = await import('../webview-guards')
    const listeners = new Map<string, (...args: any[]) => void>()
    const openHandlers: Array<(input: { url: string }) => { action: string }> = []
    const contents = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        listeners.set(event, handler)
      }),
      setWindowOpenHandler: vi.fn((handler: (input: { url: string }) => { action: string }) => {
        openHandlers.push(handler)
      })
    }

    installWebviewGuards(contents as any, 'file:///C:/AgentHub/out/renderer/index.html')

    const preventDefault = vi.fn()
    const preferences: any = { preload: 'unsafe.js', nodeIntegration: true }
    listeners.get('will-attach-webview')?.({ preventDefault }, preferences, { src: 'https://example.com' })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(preferences.preload).toBeUndefined()
    expect(preferences.nodeIntegration).toBe(false)

    listeners.get('will-attach-webview')?.({ preventDefault }, {}, { src: 'file:///secret.txt' })
    expect(preventDefault).toHaveBeenCalledTimes(1)

    expect(openHandlers[0]?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(openHandlers[0]?.({ url: 'file:///secret.txt' })).toEqual({ action: 'deny' })
    expect(electronMock.openExternal).toHaveBeenCalledWith('https://example.com')
    expect(electronMock.openExternal).not.toHaveBeenCalledWith('file:///secret.txt')
  })

  it('pins top-level navigation and redirects to the trusted renderer boundary', async () => {
    const { installWebviewGuards } = await import('../webview-guards')
    const createContents = (trustedRendererUrl: string) => {
      const listeners = new Map<string, (...args: any[]) => void>()
      const contents = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          listeners.set(event, handler)
        }),
        setWindowOpenHandler: vi.fn()
      }

      installWebviewGuards(contents as any, trustedRendererUrl)
      return listeners
    }

    const production = createContents('file:///C:/AgentHub/out/renderer/index.html')
    const allowProduction = vi.fn()
    production.get('will-navigate')?.({
      preventDefault: allowProduction,
      url: 'file:///C:/AgentHub/out/renderer/index.html#thread-1',
      isMainFrame: true
    })
    expect(allowProduction).not.toHaveBeenCalled()

    for (const url of [
      'https://example.com/phishing',
      'file:///C:/AgentHub/out/renderer/other.html',
      'file:///C:/Users/test/.ssh/id_rsa'
    ]) {
      const preventDefault = vi.fn()
      production.get('will-navigate')?.({ preventDefault, url, isMainFrame: true })
      expect(preventDefault, url).toHaveBeenCalledOnce()
    }

    const preventRedirect = vi.fn()
    production.get('will-redirect')?.({
      preventDefault: preventRedirect,
      url: 'https://example.com/redirected',
      isMainFrame: true
    })
    expect(preventRedirect).toHaveBeenCalledOnce()

    const development = createContents('http://127.0.0.1:5173/')
    const allowSameOrigin = vi.fn()
    development.get('will-navigate')?.({
      preventDefault: allowSameOrigin,
      url: 'http://127.0.0.1:5173/workbench?mode=dev',
      isMainFrame: true
    })
    expect(allowSameOrigin).not.toHaveBeenCalled()

    for (const url of [
      'http://localhost:5173/',
      'http://127.0.0.1:4173/',
      'https://127.0.0.1:5173/',
      'blob:http://127.0.0.1:5173/attacker-controlled-document',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)'
    ]) {
      const preventDefault = vi.fn()
      development.get('will-navigate')?.({ preventDefault, url, isMainFrame: true })
      expect(preventDefault, url).toHaveBeenCalledOnce()
    }

    const allowSubframe = vi.fn()
    development.get('will-redirect')?.({
      preventDefault: allowSubframe,
      url: 'https://example.com/embedded',
      isMainFrame: false
    })
    expect(allowSubframe).not.toHaveBeenCalled()
  })
})
