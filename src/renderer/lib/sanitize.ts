const DANGEROUS_TAGS = /<(script|iframe|object|embed|form|link|meta|style|base|template|slot)[\s\S]*?>[\s\S]*?<\/\1>|<(script|iframe|object|embed|form|link|meta|style|base|template|slot)[\s\S]*?\/?>/gi
const EVENT_HANDLERS = /[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_PROTOCOL = /\s+(?:formaction|xlink:href|href|src|action)\s*=\s*(?:"(?:javascript|vbscript|data):[^"]*"|'(?:javascript|vbscript|data):[^']*')/gi
const SVG_EVENTS = /<(?:svg|img|video|audio|source|input|details|select|textarea|button)[^>]*?\son[a-z]+\s*=/gi
// CSS-based XSS in inline style attributes: expression(), @import, url(javascript:), url(data:)
// Neutralize the dangerous CSS payload rather than removing the whole style attr (preserve benign styling).
const CSS_DANGER = /style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
// Match expression(...)/url(...) including nested parens (e.g. url(javascript:alert(1))), plus @import.
// @import[^"';]* stops at quote/semicolon so it does not eat the closing quote of the style attribute.
// One level of nesting is matched per pass; neutralizeStyleAttr loops until stable for deeper trees.
const CSS_PAYLOAD_DANGER = /(?:expression|url)\s*\((?:[^()]*|\([^()]*\))*\)|@import[^"';]*/gi

function neutralizeStyleAttr(match: string): string {
  // Keep `style="..."` but strip dangerous CSS payloads inside the quotes.
  // Loop so multi-level nested url/expression eventually strip.
  let prev = ''
  let next = match
  let guard = 0
  while (prev !== next && guard < 8) {
    prev = next
    next = next.replace(CSS_PAYLOAD_DANGER, '')
    guard++
  }
  // Residual deep nesting the regex cannot fully peel — drop the style value.
  if (/(?:javascript|vbscript|expression\s*\(|@import)/i.test(next)) {
    return match.replace(/=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/, '=""')
  }
  return next
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(DANGEROUS_TAGS, '')
    .replace(EVENT_HANDLERS, '')
    .replace(JS_PROTOCOL, '')
    .replace(SVG_EVENTS, (match) => match.replace(/[\s/]+on[a-z]+/gi, ''))
    .replace(CSS_DANGER, neutralizeStyleAttr)
}
