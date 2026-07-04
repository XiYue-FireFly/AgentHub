import { tr } from '../../glass/i18n'

/**
 * Normalize a URL value, adding https:// if missing.
 */
export function normalizeUrl(value: string): string {
  const text = value.trim()
  if (!text) return 'about:blank'
  if (/^(https?|file):\/\//i.test(text)) return text
  return `https://${text}`
}

/**
 * Convert a browser capture to a workbench attachment.
 */
export function browserCaptureToAttachment(capture: BrowserContextAttachment): WorkbenchAttachment {
  const title = capture.title || capture.url || tr('浏览器捕获', 'Browser capture')
  const headings = (capture.headings || []).filter(Boolean).map(item => `- ${item}`).join('\n')
  const links = (capture.links || []).slice(0, 24).map(link => `- ${link.text}: ${link.href}`).join('\n')
  const forms = (capture.forms || []).filter(Boolean).map(item => `- ${item}`).join('\n')
  const text = [
    `URL: ${capture.url}`,
    `标题: ${capture.title || '-'}`,
    headings ? `\n页面标题:\n${headings}` : '',
    links ? `\n链接摘要:\n${links}` : '',
    forms ? `\n表单:\n${forms}` : '',
    capture.text ? `\n正文:\n${capture.text.slice(0, 12000)}` : ''
  ].filter(Boolean).join('\n')
  return {
    id: `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: `${title.slice(0, 52)}.browser.md`,
    mime: 'text/markdown',
    text,
    createdAt: Date.now()
  }
}
