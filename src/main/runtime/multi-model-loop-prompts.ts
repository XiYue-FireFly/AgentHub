export interface JudgeResult {
  valid: boolean
  verdict: 'PASS' | 'REVISE'
  score: number
  revisionId: string
  feedback: string
  unresolved: string[]
}

export interface ScoredRevision {
  revisionId: string
  content: string
  round: number
  judge: JudgeResult
}

export function buildCandidatePrompt(input: {
  effectivePrompt: string
  round: number
  candidateIndex: number
  feedback?: string
}): string {
  return [
    '[Multi-model candidate]',
    'Round: ' + input.round,
    'Candidate: ' + input.candidateIndex,
    'Analyze independently. Read-only workspace inspection is allowed. Do not write files or run commands.',
    input.feedback ? 'Judge feedback from the prior round:\n' + input.feedback : '',
    'Prepared root request:\n' + input.effectivePrompt
  ].filter(Boolean).join('\n\n')
}

export function buildSynthesisPrompt(input: {
  effectivePrompt: string
  round: number
  candidates: Array<{ routeKey: string; content: string }>
}): string {
  const evidence = input.candidates.map((candidate, index) =>
    '[Candidate ' + (index + 1) + ' ' + candidate.routeKey + ']\n' + candidate.content
  ).join('\n\n')

  return [
    '[Multi-model synthesizer]',
    'Round: ' + input.round,
    'Produce one revision. Preserve material disagreements and unresolved evidence. Do not perform side effects.',
    'Prepared root request:\n' + input.effectivePrompt,
    evidence
  ].join('\n\n')
}

export function buildJudgePrompt(input: {
  effectivePrompt: string
  revisionId: string
  revision: string
}): string {
  return [
    '[Independent Judge]',
    'Evaluate correctness, completeness, faithfulness, and unresolved risks.',
    'Return exactly one JSON object with this shape:',
    JSON.stringify({
      verdict: 'PASS|REVISE',
      score: 0,
      revisionId: input.revisionId,
      feedback: '',
      unresolved: []
    }),
    'Score must be an integer from 0 through 100. revisionId must match exactly.',
    'Prepared root request:\n' + input.effectivePrompt,
    'Revision:\n' + input.revision
  ].join('\n\n')
}

function stripSingleJsonFence(raw: string): string {
  const text = raw.trim()
  // Accept the Markdown code fences models emit by default (``` / ~~~),
  // requiring the closing marker to match the opening one.
  const match = text.match(/^(~~~|```)(?:json)?\s*([\s\S]*?)\s*\1$/i)
  return match ? match[2].trim() : text
}

function skipWhitespace(raw: string, index: number): number {
  while (index < raw.length && /\s/.test(raw[index])) index++
  return index
}

function scanJsonStringEnd(raw: string, index: number): number {
  if (raw[index] !== '"') return -1
  for (let cursor = index + 1; cursor < raw.length; cursor++) {
    if (raw[cursor] === '\\') {
      cursor++
      continue
    }
    if (raw[cursor] === '"') return cursor + 1
  }
  return -1
}

function scanJsonValueEnd(raw: string, index: number): number {
  index = skipWhitespace(raw, index)
  const first = raw[index]
  if (first === '"') return scanJsonStringEnd(raw, index)
  if (first === '{' || first === '[') {
    const closers: string[] = [first === '{' ? '}' : ']']
    for (let cursor = index + 1; cursor < raw.length; cursor++) {
      const character = raw[cursor]
      if (character === '"') {
        const stringEnd = scanJsonStringEnd(raw, cursor)
        if (stringEnd < 0) return -1
        cursor = stringEnd - 1
        continue
      }
      if (character === '{') {
        closers.push('}')
        continue
      }
      if (character === '[') {
        closers.push(']')
        continue
      }
      if (character === closers[closers.length - 1]) {
        closers.pop()
        if (closers.length === 0) return cursor + 1
        continue
      }
      if (character === '}' || character === ']') return -1
    }
    return -1
  }

  let cursor = index
  while (cursor < raw.length && raw[cursor] !== ',' && raw[cursor] !== '}' && !/\s/.test(raw[cursor])) {
    cursor++
  }
  return cursor === index ? -1 : cursor
}

function hasDuplicateTopLevelObjectKeys(raw: string): boolean {
  let index = skipWhitespace(raw, 0)
  if (raw[index] !== '{') return false
  index++
  const keys = new Set<string>()

  while (index < raw.length) {
    index = skipWhitespace(raw, index)
    if (raw[index] === '}') return false
    if (raw[index] !== '"') return false
    const keyEnd = scanJsonStringEnd(raw, index)
    if (keyEnd < 0) return false
    let key: unknown
    try {
      key = JSON.parse(raw.slice(index, keyEnd))
    } catch {
      return false
    }
    if (typeof key !== 'string') return false
    if (keys.has(key)) return true
    keys.add(key)

    index = skipWhitespace(raw, keyEnd)
    if (raw[index] !== ':') return false
    const valueEnd = scanJsonValueEnd(raw, index + 1)
    if (valueEnd < 0) return false
    index = skipWhitespace(raw, valueEnd)
    if (raw[index] === '}') return false
    if (raw[index] !== ',') return false
    index++
  }

  return false
}

function invalidJudgeResult(expectedRevisionId: string, feedback: string): JudgeResult {
  return {
    valid: false,
    verdict: 'REVISE',
    score: 0,
    revisionId: expectedRevisionId,
    feedback,
    unresolved: []
  }
}

export function parseJudgeResult(raw: string, expectedRevisionId: string): JudgeResult {
  try {
    const json = stripSingleJsonFence(raw)
    if (hasDuplicateTopLevelObjectKeys(json)) {
      return invalidJudgeResult(expectedRevisionId, 'Judge result has duplicate fields.')
    }
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalidJudgeResult(expectedRevisionId, 'Judge result is not an object.')
    }

    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    if (keys.join(',') !== ['feedback', 'revisionId', 'score', 'unresolved', 'verdict'].join(',')) {
      return invalidJudgeResult(expectedRevisionId, 'Judge result has unexpected fields.')
    }
    if (record.verdict !== 'PASS' && record.verdict !== 'REVISE') {
      return invalidJudgeResult(expectedRevisionId, 'Judge verdict is invalid.')
    }
    const score = record.score
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
      return invalidJudgeResult(expectedRevisionId, 'Judge score is invalid.')
    }
    if (record.revisionId !== expectedRevisionId) {
      return invalidJudgeResult(expectedRevisionId, 'Judge revisionId does not match.')
    }
    if (typeof record.feedback !== 'string') {
      return invalidJudgeResult(expectedRevisionId, 'Judge feedback is invalid.')
    }
    if (!Array.isArray(record.unresolved) || record.unresolved.some(item => typeof item !== 'string')) {
      return invalidJudgeResult(expectedRevisionId, 'Judge unresolved list is invalid.')
    }

    return {
      valid: true,
      verdict: record.verdict,
      score,
      revisionId: record.revisionId,
      feedback: record.feedback,
      unresolved: [...record.unresolved]
    }
  } catch {
    return invalidJudgeResult(expectedRevisionId, 'Judge output is not valid JSON.')
  }
}

export function selectBestRevision(revisions: readonly ScoredRevision[]): ScoredRevision | undefined {
  return [...revisions]
    .filter(revision => revision.judge.valid)
    .sort((left, right) =>
      right.judge.score - left.judge.score
      || right.round - left.round
      || (left.revisionId === right.revisionId ? 0 : left.revisionId < right.revisionId ? -1 : 1)
    )[0]
}
