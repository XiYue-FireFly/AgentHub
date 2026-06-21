/**
 * BrowserAgent: structured browser page analysis for AI context.
 *
 * Takes raw page capture data and produces structured summaries
 * that can be injected into AI context. Integrates with the
 * existing BrowserPanelV2 capture mechanism.
 *
 * Phase 3.4: Browser agent enhancement.
 */

export interface PageSnapshot {
  url: string
  title: string
  text: string
  headings: string[]
  links: Array<{ text: string; href: string }>
  forms: string[]
  capturedAt: number
}

export interface PageAnalysis {
  url: string
  title: string
  summary: string
  keyTopics: string[]
  linkCount: number
  formCount: number
  wordCount: number
  isDocumentation: boolean
  isCodeRepo: boolean
  hasInteractiveContent: boolean
  /** Structured text for AI context injection */
  contextText: string
}

/**
 * Analyze a page snapshot into structured data for AI context.
 */
export function analyzePage(snapshot: PageSnapshot): PageAnalysis {
  const wordCount = snapshot.text.split(/\s+/).filter(Boolean).length
  const headings = (snapshot.headings || []).filter(Boolean)
  const links = snapshot.links || []
  const forms = snapshot.forms || []

  // Heuristics
  const lowerUrl = snapshot.url.toLowerCase()
  const lowerTitle = snapshot.title.toLowerCase()
  const lowerText = snapshot.text.toLowerCase()

  const isDocumentation = /docs?|documentation|api|reference|guide|manual|wiki|readme/i.test(lowerUrl + ' ' + lowerTitle)
  const isCodeRepo = /github\.com|gitlab\.com|bitbucket|gitee|codeberg/i.test(lowerUrl)
  const hasInteractiveContent = forms.length > 0 || links.length > 20

  // Extract key topics from headings
  const keyTopics = headings
    .map(h => h.trim())
    .filter(h => h.length > 2 && h.length < 80)
    .slice(0, 10)

  // Build structured summary
  const summaryParts: string[] = []
  summaryParts.push(`Page: ${snapshot.title || '(untitled)'}`)
  summaryParts.push(`URL: ${snapshot.url}`)
  if (headings.length > 0) summaryParts.push(`Sections: ${headings.slice(0, 8).join(', ')}`)
  if (links.length > 0) summaryParts.push(`Links: ${links.length}`)
  if (forms.length > 0) summaryParts.push(`Forms: ${forms.join(', ')}`)

  // Extract first 500 chars of content as preview
  const contentPreview = snapshot.text.replace(/\s+/g, ' ').trim().slice(0, 500)
  if (contentPreview) summaryParts.push(`Content: ${contentPreview}...`)

  const contextText = summaryParts.join('\n')

  return {
    url: snapshot.url,
    title: snapshot.title,
    summary: summaryParts.join(' | '),
    keyTopics,
    linkCount: links.length,
    formCount: forms.length,
    wordCount,
    isDocumentation,
    isCodeRepo,
    hasInteractiveContent,
    contextText
  }
}

/**
 * Build a structured text representation for AI context injection.
 */
export function buildPageContext(analysis: PageAnalysis): string {
  const parts: string[] = []
  parts.push(`[Web Page] ${analysis.title}`)
  parts.push(`URL: ${analysis.url}`)
  if (analysis.keyTopics.length > 0) parts.push(`Sections: ${analysis.keyTopics.join(', ')}`)

  const flags: string[] = []
  if (analysis.isDocumentation) flags.push('docs')
  if (analysis.isCodeRepo) flags.push('code-repo')
  if (analysis.hasInteractiveContent) flags.push('interactive')
  if (flags.length > 0) parts.push(`Type: ${flags.join(', ')}`)

  parts.push(`${analysis.wordCount} words, ${analysis.linkCount} links, ${analysis.formCount} forms`)
  parts.push('')
  parts.push(analysis.contextText)

  return parts.join('\n')
}
