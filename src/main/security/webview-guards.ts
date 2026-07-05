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

export function installWebviewGuards(contents: WebContents): void {
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
