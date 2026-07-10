import { tr } from '../glass/i18n'

export function renderMarkdown(content: string): string {
  const normalized = normalizeAssistantMarkdown(content)
  if (!normalized.trim()) return `<p>${escapeHtml(tr('\u6682\u65e0\u5185\u5bb9\u3002', 'No content.'))}</p>`
  const lines = normalized.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inList: 'ul' | 'ol' | null = null
  let inQuote = false
  let codeFence: { lang: string; lines: string[] } | null = null

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`)
      inList = null
    }
  }
  const closeQuote = () => {
    if (inQuote) {
      html.push('</blockquote>')
      inQuote = false
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const fence = raw.match(/^```([\w.+-]*)\s*$/)
    if (fence) {
      if (codeFence) {
        html.push(`<pre><code${codeFence.lang ? ` data-lang="${escapeHtml(codeFence.lang)}"` : ''}>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`)
        codeFence = null
      } else {
        closeList()
        closeQuote()
        codeFence = { lang: fence[1] || '', lines: [] }
      }
      continue
    }
    if (codeFence) {
      codeFence.lines.push(raw)
      continue
    }

    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      closeQuote()
      continue
    }

    if (looksLikeTableStart(lines, index)) {
      closeList()
      closeQuote()
      const table = consumeTable(lines, index)
      html.push(table.html)
      index += table.consumed - 1
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      closeList()
      if (!inQuote) {
        html.push('<blockquote>')
        inQuote = true
      }
      html.push(`<p>${inlineMarkdown(quote[1])}</p>`)
      continue
    }
    closeQuote()

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (ordered) {
      if (inList !== 'ol') {
        closeList()
        html.push('<ol>')
        inList = 'ol'
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`)
      continue
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/)
    if (unordered) {
      if (inList !== 'ul') {
        closeList()
        html.push('<ul>')
        inList = 'ul'
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`)
      continue
    }

    closeList()
    html.push(`<p>${inlineMarkdown(line)}</p>`)
  }

  if (codeFence) {
    html.push(`<pre><code${codeFence.lang ? ` data-lang="${escapeHtml(codeFence.lang)}"` : ''}>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`)
  }
  closeList()
  closeQuote()
  return html.join('\n')
}

function normalizeAssistantMarkdown(content: string): string {
  return content
    .replace(/@@AGENTHUB_?TOKEN_\d+@@/gi, '')
    .replace(/@@AGENTHUBTOKEN\d+@@/gi, '')
}

function looksLikeTableStart(lines: string[], index: number): boolean {
  const current = lines[index]?.trim()
  const next = lines[index + 1]?.trim()
  return !!current && !!next && current.includes('|') && /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?$/.test(next)
}

function consumeTable(lines: string[], start: number): { html: string; consumed: number } {
  const rows: string[] = []
  for (let index = start; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line || !line.includes('|')) break
    rows.push(line)
  }
  const header = splitTableRow(rows[0])
  const body = rows.slice(2).map(splitTableRow).filter(row => row.length > 0)
  const thead = `<thead><tr>${header.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${body.map(row => `<tr>${header.map((_head, index) => `<td>${inlineMarkdown(row[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`
  return { html: `<div class="wb-markdown-table-wrap"><table>${thead}${tbody}</table></div>`, consumed: rows.length }
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function inlineMarkdown(value: string): string {
  const tokens: string[] = []
  const stash = (html: string) => {
    const token = `\u0000AGENTHUBTOKEN${tokens.length}\u0000`
    tokens.push(html)
    return token
  }

  let text = escapeHtml(value)
  text = text.replace(/`([^`]+)`/g, (_m, code) => {
    const parsed = parseLocalFileReference(code)
    if (parsed) return stash(fileReferenceHtml(parsed, code))
    return stash(`<code>${code}</code>`)
  })
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) =>
    stash(`<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`)
  )
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, rawTarget) => {
    const parsed = parseLocalFileReference(rawTarget)
    if (!parsed) return _m
    return stash(fileReferenceHtml(parsed, label))
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\u0000AGENTHUBTOKEN(\d+)\u0000/g, (_m, index) => tokens[Number(index)] ?? '')
  return text
}

function fileReferenceHtml(parsed: { path: string; line?: number }, label: string): string {
  // MED-27: parsed.path is already HTML-escaped (from inlineMarkdown's escapeHtml call);
  // do not double-escape it in the data attribute
  return [
    `<a href="#" class="wb-file-ref-chip" data-file-path="${parsed.path}"`,
    parsed.line ? ` data-line="${parsed.line}"` : '',
    '>',
    `<span class="wb-file-ref-icon">${escapeHtml(fileKindLabel(parsed.path))}</span>`,
    `<span>${label}</span>`,
    '</a>'
  ].join('')
}

function parseLocalFileReference(value: string): { path: string; line?: number } | null {
  const raw = value.trim().replace(/^['"]|['"]$/g, '')
  if (!raw || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null
  const match = raw.match(/^(.+?)(?::(\d+))?$/)
  if (!match) return null
  const path = match[1]
  if (!isLikelyLocalPath(path)) return null
  const line = match[2] ? Number(match[2]) : undefined
  return { path, line: Number.isFinite(line) ? line : undefined }
}

function isLikelyLocalPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) ||
    path.startsWith('/') ||
    path.startsWith('./') ||
    path.startsWith('../') ||
    /^[\w.-]+[\\/]/.test(path) ||
    /\.(tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|go|rs|java|cs|cpp|c|h|hpp|vue|svelte)$/i.test(path)
}

function fileKindLabel(path: string): string {
  const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || ''
  if (ext === 'ts' || ext === 'tsx') return 'TS'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'JS'
  if (ext === 'json') return '{}'
  if (ext === 'md') return 'MD'
  if (ext === 'css' || ext === 'scss') return '#'
  if (ext === 'py') return 'PY'
  return '</>'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
