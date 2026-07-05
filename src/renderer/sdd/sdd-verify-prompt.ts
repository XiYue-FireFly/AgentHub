import type { SddDraft, SddRequirementBlock, SddTrace } from './sdd-draft-store'

export interface VerifyPromptContext {
  draft: SddDraft
  blocks: SddRequirementBlock[]
  planContent?: string
  evidenceSummary?: string
  codeChanges?: string[]
}

export interface VerifyPromptResult {
  systemPrompt: string
  userPrompt: string
}

export type VerifyCriterionStatus = 'pass' | 'fail' | 'unknown'

export interface VerifyCriterionVerdict {
  requirementId: string
  criterionIndex: number
  status: VerifyCriterionStatus
  reason?: string
}

export interface ParsedVerifyResponse {
  verdicts: VerifyCriterionVerdict[]
  warnings: string[]
}

export interface ApplyVerifyVerdictsResult {
  content: string
  appliedCount: number
  verifiedRequirementIds: string[]
  warnings: string[]
  changed: boolean
}

export interface VerifyDraftSnapshot {
  draftId: string
  workspaceRoot: string
  contentHash: string
}

export interface VerifyEvidenceInput {
  draftId?: string
  workspaceRoot?: string
  relativePath?: string
  threadId?: string | null
  trace?: SddTrace | null
  todos?: ThreadTodo[]
  events?: RuntimeEvent[]
}

const STATUS_VALUES = new Set<VerifyCriterionStatus>(['pass', 'fail', 'unknown'])
const MAX_TRACE_EVIDENCE_ITEMS = 24
const MAX_TODO_EVIDENCE_ITEMS = 24
const MAX_RUNTIME_EVIDENCE_EVENTS = 24
const MAX_COMMIT_EVIDENCE_ITEMS = 12
const MAX_COMMIT_FILE_EVIDENCE_ITEMS = 8

export function buildVerifySystemPrompt(): string {
  return [
    'You are a senior acceptance-review engineer for requirement-driven development.',
    '',
    'Your task is to review implementation evidence against each acceptance criterion.',
    'Be strict: mark a criterion as pass only when the evidence clearly proves it.',
    'Use fail when the evidence contradicts or misses the criterion.',
    'Use unknown when the supplied evidence is insufficient.',
    '',
    'Return a concise Markdown report for humans, then append exactly one machine-readable block:',
    '',
    '```sdd-verify-json',
    '{',
    '  "criteria": [',
    '    {',
    '      "requirementId": "R-1",',
    '      "criterionIndex": 0,',
    '      "status": "pass",',
    '      "reason": "Short evidence-based reason"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Rules:',
    '- criterionIndex is zero-based and must match the listed acceptance criteria.',
    '- status must be exactly one of: pass, fail, unknown.',
    '- Include every acceptance criterion exactly once in the JSON block.',
    '- Do not mark unchecked criteria as pass without explicit evidence.',
    '- Do not put comments or trailing commas inside the JSON block.'
  ].join('\n')
}

export function buildVerifyUserPrompt(ctx: VerifyPromptContext): string {
  const parts: string[] = [
    'Review this requirement draft and decide which acceptance criteria are proven by the supplied plan/evidence.',
    '',
    `Draft: ${ctx.draft.title}`,
    `Draft id: ${ctx.draft.id}`,
    ''
  ]

  if (ctx.blocks.length > 0) {
    parts.push('## Acceptance Criteria To Review')
    for (const block of ctx.blocks) {
      parts.push('', `### ${block.id}: ${block.title} [${block.status}]`)
      if (block.description.trim()) {
        parts.push(block.description.trim())
      }
      if (block.acceptanceCriteria.length > 0) {
        parts.push('', 'Criteria:')
        block.acceptanceCriteria.forEach((criterion, index) => {
          const check = criterion.checked ? 'x' : ' '
          parts.push(`- ${block.id}::${index} [${check}] ${criterion.text}`)
        })
      } else {
        parts.push('', 'Criteria: none')
      }
    }
    parts.push('')
  }

  if (ctx.planContent?.trim()) {
    parts.push('## Implementation Plan / Dispatch Trace', '', '```markdown', ctx.planContent.trim(), '```', '')
  }

  if (ctx.evidenceSummary?.trim()) {
    parts.push('## Verification Evidence', '', '```text', ctx.evidenceSummary.trim(), '```', '')
  }

  if (ctx.codeChanges && ctx.codeChanges.length > 0) {
    parts.push('## Evidence / Code Changes')
    for (const change of ctx.codeChanges) {
      parts.push(`- ${change}`)
    }
    parts.push('')
  }

  parts.push(
    '## Requirement Document',
    '',
    '```markdown',
    ctx.draft.content,
    '```',
    '',
    'Return the human report first, followed by the required sdd-verify-json block.'
  )

  return parts.join('\n')
}

export function buildVerifyPrompt(ctx: VerifyPromptContext): VerifyPromptResult {
  return {
    systemPrompt: buildVerifySystemPrompt(),
    userPrompt: buildVerifyUserPrompt(ctx)
  }
}

export function buildBlockVerifyPrompt(
  block: SddRequirementBlock,
  codeChanges?: string[]
): VerifyPromptResult {
  return buildVerifyPrompt({
    draft: {
      id: `${block.id}-single-block`,
      workspaceRoot: '',
      relativePath: '',
      title: block.title,
      content: [
        `### ${block.id}: ${block.title} {${block.status}}`,
        block.description,
        ...block.acceptanceCriteria.map(c => `- [${c.checked ? 'x' : ' '}] ${c.text}`)
      ].filter(Boolean).join('\n'),
      createdAt: '',
      updatedAt: ''
    },
    blocks: [block],
    codeChanges
  })
}

export function parseVerifyResponse(response: string, blocks: SddRequirementBlock[] = []): ParsedVerifyResponse {
  const warnings: string[] = []
  const fromJson = parseJsonVerdicts(response, warnings)
  const rawVerdicts = fromJson.length > 0 ? fromJson : parseLineVerdicts(response)

  if (rawVerdicts.length === 0) {
    warnings.push('No machine-readable verification verdicts were found.')
  }

  const knownBlocks = new Map(blocks.map(block => [block.id.toUpperCase(), block]))
  const seen = new Set<string>()
  const verdicts: VerifyCriterionVerdict[] = []

  for (const verdict of rawVerdicts) {
    if (!verdict || typeof verdict !== 'object') {
      warnings.push(`Ignored invalid verdict: ${JSON.stringify(verdict)}`)
      continue
    }
    const requirementId = normalizeRequirementId(verdict.requirementId)
    const criterionIndex = Number(verdict.criterionIndex)
    const status = normalizeStatus(verdict.status)

    if (!requirementId || !Number.isInteger(criterionIndex) || criterionIndex < 0 || !status) {
      warnings.push(`Ignored invalid verdict: ${JSON.stringify(verdict)}`)
      continue
    }

    const block = knownBlocks.get(requirementId)
    if (block && criterionIndex >= block.acceptanceCriteria.length) {
      warnings.push(`Ignored ${requirementId}::${criterionIndex}: criterion index is out of range.`)
      continue
    }

    if (knownBlocks.size > 0 && !block) {
      warnings.push(`Ignored ${requirementId}::${criterionIndex}: requirement was not found.`)
      continue
    }

    const key = `${requirementId}::${criterionIndex}`
    if (seen.has(key)) {
      warnings.push(`Ignored duplicate verdict for ${key}.`)
      continue
    }
    seen.add(key)

    verdicts.push({
      requirementId,
      criterionIndex,
      status,
      reason: typeof verdict.reason === 'string' ? verdict.reason.trim() : undefined
    })
  }

  return { verdicts, warnings }
}

export function applyVerifyVerdictsToContent(
  content: string,
  verdicts: VerifyCriterionVerdict[]
): ApplyVerifyVerdictsResult {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const passByRequirement = new Map<string, Set<number>>()
  const warnings: string[] = []

  for (const verdict of verdicts) {
    if (verdict.status !== 'pass') continue
    const requirementId = normalizeRequirementId(verdict.requirementId)
    if (!requirementId || verdict.criterionIndex < 0) continue
    const indexes = passByRequirement.get(requirementId) ?? new Set<number>()
    indexes.add(verdict.criterionIndex)
    passByRequirement.set(requirementId, indexes)
  }

  const blocks = scanRequirementLines(lines)
  const touchedRequirements = new Set<string>()
  let appliedCount = 0

  for (const [requirementId, indexes] of passByRequirement) {
    const block = blocks.get(requirementId)
    if (!block) {
      warnings.push(`Skipped ${requirementId}: requirement was not found in the document.`)
      continue
    }
    for (const criterionIndex of indexes) {
      const criterion = block.criteria[criterionIndex]
      if (!criterion) {
        warnings.push(`Skipped ${requirementId}::${criterionIndex}: criterion was not found in the document.`)
        continue
      }
      touchedRequirements.add(requirementId)
      if (!criterion.checked) {
        lines[criterion.lineIndex] = criterion.line.replace(/^(\s*-\s+\[)[ xX](\]\s+.*)$/, '$1x$2')
        criterion.checked = true
        appliedCount++
      }
    }
  }

  const verifiedRequirementIds: string[] = []
  for (const requirementId of touchedRequirements) {
    const block = blocks.get(requirementId)
    if (!block || block.criteria.length === 0) continue
    if (block.criteria.every(criterion => criterion.checked)) {
      lines[block.headingLineIndex] = withRequirementStatus(lines[block.headingLineIndex], 'verified')
      verifiedRequirementIds.push(requirementId)
    }
  }

  const nextContent = lines.join(lineEnding)
  return {
    content: nextContent,
    appliedCount,
    verifiedRequirementIds,
    warnings,
    changed: nextContent !== content
  }
}

export function hashVerifyContent(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function buildVerifyEvidenceSummary(input: VerifyEvidenceInput): string {
  const trace = isTraceInScope(input.trace ?? null, input) ? input.trace ?? null : null
  const tracePlanItemIds = new Set((trace?.planItems ?? []).map(item => item.id))
  const traceTurnIds = new Set((trace?.planItems ?? []).map(item => item.turnId).filter((turnId): turnId is string => Boolean(turnId)))
  const todos = (input.todos ?? []).filter(todo => isRelevantSddTodo(todo, input, tracePlanItemIds, traceTurnIds))
  const events = input.events ?? []
  const lines: string[] = []
  const evidenceTurnIds = new Set<string>()

  for (const item of trace?.planItems ?? []) {
    if (item.turnId) evidenceTurnIds.add(item.turnId)
  }
  for (const todo of todos) {
    if (todo.source?.turnId) evidenceTurnIds.add(todo.source.turnId)
  }

  if (trace?.planItems.length) {
    lines.push('Trace plan items:')
    for (const item of trace.planItems.slice(0, MAX_TRACE_EVIDENCE_ITEMS)) {
      const turn = item.turnId ? `; turn=${item.turnId}` : ''
      lines.push(`- ${item.id}: ${item.status}; covers=${item.covers.join(', ') || 'none'}${turn}; ${shortEvidence(stripPlanEvidenceText(item.text))}`)
    }
    if (trace.planItems.length > MAX_TRACE_EVIDENCE_ITEMS) {
      lines.push(`- ... ${trace.planItems.length - MAX_TRACE_EVIDENCE_ITEMS} more trace items omitted`)
    }
  }

  if (todos.length) {
    if (lines.length) lines.push('')
    lines.push('Current thread SDD todos:')
    for (const todo of todos.slice(0, MAX_TODO_EVIDENCE_ITEMS)) {
      const source = todo.source
      const planItemId = source?.planItemId ? `; planItem=${source.planItemId}` : ''
      const turn = source?.turnId ? `; turn=${source.turnId}` : ''
      lines.push(`- ${todo.status}${planItemId}${turn}; ${shortEvidence(todo.content)}`)
    }
    if (todos.length > MAX_TODO_EVIDENCE_ITEMS) {
      lines.push(`- ... ${todos.length - MAX_TODO_EVIDENCE_ITEMS} more todos omitted`)
    }
  }

  const commits = collectTraceCommitEvidence(trace, evidenceTurnIds, input.threadId)
  if (commits.length) {
    if (lines.length) lines.push('')
    lines.push('Related commit evidence:')
    for (const entry of commits.slice(0, MAX_COMMIT_EVIDENCE_ITEMS)) {
      const turn = entry.commit.turnId ? `; turn=${entry.commit.turnId}` : ''
      const summary = entry.commit.summary ? `; ${shortEvidence(entry.commit.summary)}` : ''
      const files = formatCommitFiles(entry.commit.files ?? [])
      lines.push(`- ${entry.planItemId} ${shortSha(entry.commit)}${turn}${summary}${files ? `; files=${files}` : ''}`)
    }
    if (commits.length > MAX_COMMIT_EVIDENCE_ITEMS) {
      lines.push(`- ... ${commits.length - MAX_COMMIT_EVIDENCE_ITEMS} more commits omitted`)
    }
  }

  const relatedEvents = events
    .filter(event => evidenceTurnIds.has(event.turnId))
    .filter(isEvidenceRuntimeEvent)
    .sort((a, b) => a.seq - b.seq)

  if (relatedEvents.length) {
    if (lines.length) lines.push('')
    lines.push('Related run evidence:')
    const omitted = Math.max(0, relatedEvents.length - MAX_RUNTIME_EVIDENCE_EVENTS)
    if (omitted > 0) lines.push(`- ... ${omitted} older runtime events omitted`)
    for (const event of relatedEvents.slice(-MAX_RUNTIME_EVIDENCE_EVENTS)) {
      lines.push(`- ${event.turnId}${event.agentId ? `/${event.agentId}` : ''} ${event.kind}: ${runtimeEvidenceText(event)}`)
    }
  }

  return lines.join('\n').trim()
}

function collectTraceCommitEvidence(
  trace: SddTrace | null,
  evidenceTurnIds: Set<string>,
  threadId?: string | null
): Array<{ planItemId: string; commit: NonNullable<SddTrace['planItems'][number]['commits']>[number] }> {
  const commits: Array<{ planItemId: string; commit: NonNullable<SddTrace['planItems'][number]['commits']>[number] }> = []
  const seen = new Set<string>()

  for (const item of trace?.planItems ?? []) {
    for (const commit of item.commits ?? []) {
      if (!isValidCommitEvidence(commit)) continue
      if (commit.turnId && !evidenceTurnIds.has(commit.turnId)) continue
      if (threadId && commit.threadId !== threadId) continue
      const key = `${item.id}:${commit.sha}`
      if (seen.has(key)) continue
      seen.add(key)
      commits.push({ planItemId: item.id, commit })
    }
  }

  return commits
}

function isValidCommitEvidence(commit: unknown): commit is NonNullable<SddTrace['planItems'][number]['commits']>[number] {
  if (!commit || typeof commit !== 'object') return false
  const value = commit as Partial<NonNullable<SddTrace['planItems'][number]['commits']>[number]>
  return typeof value.sha === 'string' && value.sha.trim().length >= 7 &&
    typeof value.shortSha === 'string' && value.shortSha.trim().length > 0
}

function shortSha(commit: NonNullable<SddTrace['planItems'][number]['commits']>[number]): string {
  return shortEvidence(commit.shortSha || commit.sha.slice(0, 12))
}

function formatCommitFiles(files: NonNullable<SddTrace['planItems'][number]['commits']>[number]['files']): string {
  const validFiles = (files ?? []).filter(file => file && typeof file.path === 'string' && file.path.trim())
  const visible = validFiles.slice(0, MAX_COMMIT_FILE_EVIDENCE_ITEMS).map(file => {
    const stats = typeof file.additions === 'number' || typeof file.deletions === 'number'
      ? ` +${file.additions || 0} -${file.deletions || 0}`
      : ''
    return shortEvidence(`${file.status || 'M'} ${file.path}${stats}`)
  })
  if (validFiles.length > MAX_COMMIT_FILE_EVIDENCE_ITEMS) {
    visible.push(`... ${validFiles.length - MAX_COMMIT_FILE_EVIDENCE_ITEMS} more files`)
  }
  return visible.join(', ')
}

function isTraceInScope(trace: SddTrace | null, scope: VerifyEvidenceInput): boolean {
  if (!trace) return false
  if (scope.draftId && trace.draftId !== scope.draftId) return false
  return true
}

function isRelevantSddTodo(
  todo: ThreadTodo,
  scope: VerifyEvidenceInput,
  tracePlanItemIds = new Set<string>(),
  traceTurnIds = new Set<string>()
): boolean {
  const source = todo.source
  if (source?.kind !== 'plan' || !source.draftId) return false
  if (scope.threadId && todo.threadId !== scope.threadId) return false
  if (scope.threadId && source.threadId && source.threadId !== scope.threadId) return false
  if (scope.draftId && source.draftId !== scope.draftId) return false
  if (scope.workspaceRoot && normalizeEvidencePath(source.workspaceRoot) !== normalizeEvidencePath(scope.workspaceRoot)) return false
  if (scope.relativePath && source.relativePath && normalizeEvidencePath(source.relativePath) !== normalizeEvidencePath(scope.relativePath)) return false
  if (tracePlanItemIds.size > 0 && (!source.planItemId || !tracePlanItemIds.has(source.planItemId))) return false
  if (traceTurnIds.size > 0 && source.turnId && !traceTurnIds.has(source.turnId)) return false
  if (traceTurnIds.size > 0 && !source.turnId) return false
  return true
}

function normalizeEvidencePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return value.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function isEvidenceRuntimeEvent(event: RuntimeEvent): boolean {
  if (event.kind === 'turn:status' || event.kind === 'run:status' || event.kind === 'guard:verdict') return true
  return event.kind === 'turn:summary'
}

function runtimeEvidenceText(event: RuntimeEvent): string {
  const payload = event.payload || {}
  if (event.kind === 'turn:status') return shortEvidence(['turn', payload.status, payload.error].filter(Boolean).join(' - '))
  if (event.kind === 'turn:summary') {
    return shortEvidence([
      payload.intent ? `intent=${payload.intent}` : '',
      arraySummary('skills', payload.matchedSkills),
      arraySummary('plugins', payload.matchedPlugins),
      payload.strategy ? `strategy=${payload.strategy}` : '',
      payload.effectiveMode ? `mode=${payload.effectiveMode}` : '',
      payload.dispatchMode ? `dispatch=${payload.dispatchMode}` : '',
      payload.selectedAgentId ? `selected=${payload.selectedAgentId}` : ''
    ].filter(Boolean).join(' - '))
  }
  if (event.kind === 'run:status') {
    return shortEvidence(['run', payload.status, payload.scheduleRole || payload.role, payload.taskId, payload.error].filter(Boolean).join(' - '))
  }
  if (event.kind === 'guard:verdict') {
    const reasons = Array.isArray(payload.reasons) ? payload.reasons.join('; ') : payload.reason
    return shortEvidence(['guard', payload.role, payload.level, payload.status || payload.decision, reasons].filter(Boolean).join(' - '))
  }
  if (event.kind === 'agent:error') return shortEvidence(payload.error || payload.message || 'error')
  if (event.kind === 'agent:activity' && payload.step) {
    const step = payload.step
    return shortEvidence([step.status, step.label || step.tool || step.kind, step.detail || step.output || step.error].filter(Boolean).join(' - '))
  }
  return shortEvidence(payload.content || payload.summary?.preview || payload.note || payload.error || payload.status || payload.kind || '')
}

function stripPlanEvidenceText(text: string): string {
  return String(text || '')
    .replace(/\s*\(covers?:\s*[^)]+\)\s*$/i, '')
    .trim()
}

function shortEvidence(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > 360 ? `${text.slice(0, 357)}...` : text
}

function arraySummary(label: string, value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  return `${label}=${value.map(item => String(item)).filter(Boolean).slice(0, 6).join(', ')}`
}

function parseJsonVerdicts(response: string, warnings: string[]): Array<Partial<VerifyCriterionVerdict>> {
  const fenceMatches = Array.from(response.matchAll(/```(?:sdd-verify-json|json)\s*\r?\n([\s\S]*?)\r?\n```/gi))
  for (let i = fenceMatches.length - 1; i >= 0; i--) {
    const body = fenceMatches[i]?.[1]?.trim()
    if (!body) continue
    try {
      const parsed = JSON.parse(body) as unknown
      if (Array.isArray(parsed)) return parsed as Array<Partial<VerifyCriterionVerdict>>
      if (parsed && typeof parsed === 'object') {
        const criteria = (parsed as { criteria?: unknown }).criteria
        if (Array.isArray(criteria)) return criteria as Array<Partial<VerifyCriterionVerdict>>
      }
      warnings.push('Verification JSON did not contain a criteria array.')
    } catch (error: any) {
      warnings.push(`Failed to parse verification JSON: ${error?.message || String(error)}`)
    }
  }
  return []
}

function parseLineVerdicts(response: string): Array<Partial<VerifyCriterionVerdict>> {
  const verdicts: Array<Partial<VerifyCriterionVerdict>> = []
  for (const line of response.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*\[([xX !?-])\]\s*(R-\d+)::(?:AC-)?(\d+)\s*(?:[-:]\s*(.*))?$/i)
    if (!match) continue
    const marker = match[1]
    const indexText = match[3]
    const usesAcceptanceLabel = /::AC-/i.test(line)
    const parsedIndex = Number(indexText)
    verdicts.push({
      requirementId: match[2],
      criterionIndex: usesAcceptanceLabel ? parsedIndex - 1 : parsedIndex,
      status: marker.toLowerCase() === 'x' ? 'pass' : marker === ' ' ? 'unknown' : 'fail',
      reason: match[4]?.trim()
    })
  }
  return verdicts
}

function normalizeRequirementId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^R-\d+$/.test(normalized) ? normalized : null
}

function normalizeStatus(value: unknown): VerifyCriterionStatus | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'passed') return 'pass'
  if (normalized === 'failed') return 'fail'
  return STATUS_VALUES.has(normalized as VerifyCriterionStatus)
    ? normalized as VerifyCriterionStatus
    : null
}

interface ScannedRequirement {
  headingLineIndex: number
  criteria: Array<{
    lineIndex: number
    line: string
    checked: boolean
  }>
}

function scanRequirementLines(lines: string[]): Map<string, ScannedRequirement> {
  const blocks = new Map<string, ScannedRequirement>()
  let current: ScannedRequirement | null = null

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const trimmed = lines[lineIndex].trim()
    const heading = trimmed.match(/^###\s+(R-\d+):\s+(.+?)(?:\s+\{\w+\})?\s*$/i)
    if (heading) {
      current = { headingLineIndex: lineIndex, criteria: [] }
      blocks.set(heading[1].toUpperCase(), current)
      continue
    }

    if (!current) continue
    const criterion = lines[lineIndex].match(/^(\s*-\s+\[)([ xX])(\]\s+.+)$/)
    if (!criterion) continue
    current.criteria.push({
      lineIndex,
      line: lines[lineIndex],
      checked: criterion[2].toLowerCase() === 'x'
    })
  }

  return blocks
}

function withRequirementStatus(line: string, status: SddRequirementBlock['status']): string {
  const trailing = line.match(/\s*$/)?.[0] ?? ''
  const body = line.slice(0, line.length - trailing.length)
  const withoutStatus = body.replace(/\s+\{(?:draft|planned|building|done|verified)\}$/i, '')
  return `${withoutStatus} {${status}}${trailing}`
}
