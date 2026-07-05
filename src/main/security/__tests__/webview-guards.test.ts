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

    installWebviewGuards(contents as any)

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
})
