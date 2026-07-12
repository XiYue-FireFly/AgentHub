import type { WebContents } from 'electron'
import { shell } from 'electron'

export const WEBVIEW_PARTITION = 'persist:agenthub-browser-webview'

export function safeBrowserUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

export function sanitizeWebviewPreferences(webPreferences: Electron.WebPreferences): void {
  delete (webPreferences as any).preload
  delete (webPreferences as any).preloadURL
  webPreferences.nodeIntegration = false
  ;(webPreferences as any).nodeIntegrationInSubFrames = false
  ;(webPreferences as any).nodeIntegrationInWorker = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.partition = WEBVIEW_PARTITION
}

export function isAllowedRendererNavigation(url: string, trustedRendererUrl: string): boolean {
  try {
    const target = new URL(url)
    const trusted = new URL(trustedRendererUrl)

    if (trusted.protocol === 'http:' || trusted.protocol === 'https:') {
      return target.protocol === trusted.protocol && target.origin === trusted.origin
    }
    if (trusted.protocol !== 'file:' || target.protocol !== 'file:') return false

    target.search = ''
    target.hash = ''
    trusted.search = ''
    trusted.hash = ''
    return target.href === trusted.href
  } catch {
    return false
  }
}

export function installWebviewGuards(contents: WebContents, trustedRendererUrl: string): void {
  const guardTopLevelNavigation = (event: Electron.Event & { isMainFrame: boolean; url: string }): void => {
    if (event.isMainFrame && !isAllowedRendererNavigation(event.url, trustedRendererUrl)) {
      event.preventDefault()
    }
  }

  contents.on('will-navigate', guardTopLevelNavigation)
  contents.on('will-redirect', guardTopLevelNavigation)
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = String(params.src || '')
    if (!safeBrowserUrl(src)) {
      event.preventDefault()
      return
    }
    sanitizeWebviewPreferences(webPreferences)
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (safeBrowserUrl(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
}
