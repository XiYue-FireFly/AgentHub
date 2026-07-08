/**
 * Inline Edit: AI-powered code editing within a selected range.
 *
 * Constructs prompts for targeted code modifications. The model returns
 * a diff that can be applied to the selected range. Uses the existing
 * agentic tool infrastructure for file operations.
 */

export interface EditRange {
  /** File path */
  filePath: string
  /** Start line (1-based) */
  startLine: number
  /** End line (1-based, inclusive) */
  endLine: number
  /** Selected code text */
  selectedText: string
  /** Full file content (for context) */
  fullContent?: string
}

export interface EditRequest {
  range: EditRange
  /** User's natural language description of the desired change */
  instruction: string
  /** Target model/provider for the edit */
  providerId?: string
  modelId?: string
}

/**
 * Build a prompt for inline code editing.
 * The model is instructed to return ONLY the replacement code for the
 * selected range, not the entire file.
 */
export function buildInlineEditPrompt(request: EditRequest): string {
  const { range, instruction } = request
  const parts: string[] = []

  parts.push(`You are a code editor. The user wants to modify a specific code selection.`)
  parts.push(`File: ${range.filePath}`)
  parts.push(`Lines: ${range.startLine}-${range.endLine}`)

  if (range.fullContent) {
    // Show surrounding context (5 lines before and after)
    const lines = range.fullContent.split('\n')
    const contextStart = Math.max(0, range.startLine - 6)
    const contextEnd = Math.min(lines.length, range.endLine + 5)
    const before = lines.slice(contextStart, range.startLine - 1).join('\n')
    const after = lines.slice(range.endLine, contextEnd).join('\n')

    if (before) parts.push(`Context before:\n\`\`\`\n${before}\n\`\`\``)
    parts.push(`Selected code to modify:\n\`\`\`\n${range.selectedText}\n\`\`\``)
    if (after) parts.push(`Context after:\n\`\`\`\n${after}\n\`\`\``)
  } else {
    parts.push(`Selected code:\n\`\`\`\n${range.selectedText}\n\`\`\``)
  }

  parts.push(`Instruction: ${instruction}`)
  parts.push(`Return ONLY the replacement code for the selected range. Do not include line numbers, explanations, or the surrounding context.`)

  return parts.join('\n\n')
}

/**
 * Validate that an edit result can be safely applied.
 */
export function validateEditResult(
  original: string,
  replacement: string
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = []

  if (!replacement.trim()) {
    warnings.push('Replacement is empty — this would delete the selected code.')
  }

  if (replacement === original) {
    warnings.push('Replacement is identical to original — no change.')
  }

  // Check for obvious issues
  const openBraces = (replacement.match(/\{/g) || []).length
  const closeBraces = (replacement.match(/\}/g) || []).length
  if (Math.abs(openBraces - closeBraces) > 1) {
    warnings.push(`Brace mismatch: ${openBraces} opening vs ${closeBraces} closing braces.`)
  }

  return { valid: warnings.length === 0 || (warnings.length === 1 && warnings[0].includes('identical')), warnings }
}

/**
 * Apply an edit to full file content by replacing the selected range.
 *
 * Returns the new content plus the resulting line span of the replacement,
 * so callers that need to re-select or navigate after the edit can locate
 * the new range without recomputing it.
 *
 * Line-ending safety: detects the dominant line ending (CRLF on Windows,
 * LF elsewhere) from the original content and re-applies it to the
 * replacement, so editing a CRLF file does not produce mixed line endings.
 */
export function applyInlineEdit(
  fullContent: string,
  startLine: number,
  endLine: number,
  replacement: string
): { ok: boolean; content?: string; newStartLine?: number; newEndLine?: number; error?: string } {
  const lines = fullContent.split('\n')
  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    return { ok: false, error: `Invalid range: ${startLine}-${endLine} (file has ${lines.length} lines)` }
  }
  // Detect dominant line ending: if any original line ends with \r, treat as CRLF.
  const isCrlf = lines.some(l => l.endsWith('\r'))
  const eol = isCrlf ? '\r\n' : '\n'
  // Normalize the replacement to the detected EOL so we never produce mixed endings.
  const normalizedReplacement = replacement === '' ? '' : replacement.replace(/\r?\n/g, eol)
  // Trim trailing \r from original lines so joining with the chosen eol is clean.
  const cleanLines = isCrlf ? lines.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l)) : lines
  const before = cleanLines.slice(0, startLine - 1)
  const after = cleanLines.slice(endLine)
  const newContent = [...before, normalizedReplacement, ...after].join(eol)
  // replacement may itself span multiple lines; expose the resulting range
  // so callers can update selections/cursors after the edit.
  const replacementLineCount = normalizedReplacement === '' ? 0 : normalizedReplacement.split(eol).length
  const newStartLine = startLine
  const newEndLine = replacementLineCount === 0 ? startLine : startLine + replacementLineCount - 1
  return { ok: true, content: newContent, newStartLine, newEndLine }
}
