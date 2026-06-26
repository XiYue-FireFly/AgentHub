const DANGEROUS_TAGS = /<(script|iframe|object|embed|form|link|meta|style|base|template|slot)[\s\S]*?>[\s\S]*?<\/\1>|<(script|iframe|object|embed|form|link|meta|style|base|template|slot)[\s\S]*?\/?>/gi
const EVENT_HANDLERS = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_PROTOCOL = /(?:href|src|action)\s*=\s*(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi
const SVG_EVENTS = /<(?:svg|img|video|audio|source|input|details|select|textarea|button)[^>]*?\son[a-z]+\s*=/gi

export function sanitizeHtml(html: string): string {
  return html
    .replace(DANGEROUS_TAGS, '')
    .replace(EVENT_HANDLERS, '')
    .replace(JS_PROTOCOL, '')
    .replace(SVG_EVENTS, (match) => match.replace(/\s+on[a-z]+/gi, ''))
}
