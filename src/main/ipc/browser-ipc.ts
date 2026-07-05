import { summarizePageSnapshot, extractReadableText, buildPageAnalysisPrompt } from '../runtime/browser-workspace'
import { typedHandle } from './typed-ipc'

export function registerBrowserIpc(): void {
  typedHandle("browser:open", (_event, input) => ({
    // LOW-05: Add random suffix to prevent ID collisions on rapid creation
    id: `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    workspaceId: input?.workspaceId ?? null,
    url: input?.url || "about:blank",
    title: "",
    canGoBack: false,
    canGoForward: false
  }))

  typedHandle("browser:capture", (_event, attachment) => ({
    url: String(attachment?.url || ""),
    title: String(attachment?.title || ""),
    text: String(attachment?.text || "").slice(0, 12000),
    headings: Array.isArray(attachment?.headings) ? attachment.headings.map(String).slice(0, 24) : [],
    links: Array.isArray(attachment?.links)
      ? attachment.links.map(link => ({
        text: String(typeof link === 'object' && link ? link.text || "" : ""),
        href: String(typeof link === 'object' && link ? link.href || "" : "")
      })).slice(0, 40)
      : [],
    forms: Array.isArray(attachment?.forms) ? attachment.forms.map(String).slice(0, 10) : [],
    capturedAt: Number(attachment?.capturedAt || Date.now())
  }))

  typedHandle("browser:summarize", (_e, snapshot) => summarizePageSnapshot(snapshot))
  typedHandle("browser:extractText", (_e, html) => extractReadableText(html))
  typedHandle("browser:analyzePrompt", (_e, snapshot, request) => buildPageAnalysisPrompt(snapshot, request))
}
