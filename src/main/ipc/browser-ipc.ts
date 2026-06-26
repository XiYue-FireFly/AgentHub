import { ipcMain } from 'electron'
import { summarizePageSnapshot, extractReadableText, buildPageAnalysisPrompt } from '../runtime/browser-workspace'

export function registerBrowserIpc(): void {
  ipcMain.handle("browser:open", (_event, input: { workspaceId?: string | null; url?: string }) => ({
    // LOW-05: Add random suffix to prevent ID collisions on rapid creation
    id: `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    workspaceId: input?.workspaceId ?? null,
    url: input?.url || "about:blank",
    title: "",
    canGoBack: false,
    canGoForward: false
  }))

  ipcMain.handle("browser:capture", (_event, attachment: any) => ({
    url: String(attachment?.url || ""),
    title: String(attachment?.title || ""),
    text: String(attachment?.text || "").slice(0, 12000),
    headings: Array.isArray(attachment?.headings) ? attachment.headings.map(String).slice(0, 24) : [],
    links: Array.isArray(attachment?.links)
      ? attachment.links.map((link: any) => ({ text: String(link?.text || ""), href: String(link?.href || "") })).slice(0, 40)
      : [],
    forms: Array.isArray(attachment?.forms) ? attachment.forms.map(String).slice(0, 10) : [],
    capturedAt: Number(attachment?.capturedAt || Date.now())
  }))

  ipcMain.handle("browser:summarize", (_e, snapshot: any) => summarizePageSnapshot(snapshot))
  ipcMain.handle("browser:extractText", (_e, html: string) => extractReadableText(html))
  ipcMain.handle("browser:analyzePrompt", (_e, snapshot: any, request?: string) => buildPageAnalysisPrompt(snapshot, request))
}
