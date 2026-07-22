import { describe, expect, it } from 'vitest'
import {
  buildCandidatePrompt,
  buildJudgePrompt,
  buildSynthesisPrompt,
  parseJudgeResult,
  selectBestRevision,
  type JudgeResult,
  type ScoredRevision
} from '../multi-model-loop-prompts'

const revisionId = 'revision-1'
const validJudge: Omit<JudgeResult, 'valid'> = {
  verdict: 'PASS',
  score: 90,
  revisionId,
  feedback: 'Looks good.',
  unresolved: []
}

describe('multi-model loop prompts and Judge parsing', () => {
  it('keeps candidate and synthesis prompts rooted, read-only, and side-effect free', () => {
    const candidate = buildCandidatePrompt({
      effectivePrompt: 'Repair login',
      round: 2,
      candidateIndex: 1,
      feedback: 'Preserve refresh-token behavior.'
    })
    const synthesis = buildSynthesisPrompt({
      effectivePrompt: 'Repair login',
      round: 2,
      candidates: [{ routeKey: 'p1\u0000m1', content: 'Use a refresh-token rotation.' }]
    })

    expect(candidate).toContain('Repair login')
    expect(candidate).toContain('Preserve refresh-token behavior.')
    expect(candidate).toContain('Read-only workspace inspection is allowed.')
    expect(candidate).toContain('Do not write files or run commands.')
    expect(synthesis).toContain('Repair login')
    expect(synthesis).toContain('Use a refresh-token rotation.')
    expect(synthesis).toContain('Do not perform side effects.')
  })

  it('builds a Judge prompt with the exact required JSON shape', () => {
    const prompt = buildJudgePrompt({
      effectivePrompt: 'Repair login',
      revisionId: 'revision-2',
      revision: 'Candidate answer'
    })

    expect(prompt).toContain('"verdict":"PASS|REVISE"')
    expect(prompt).toContain('"revisionId":"revision-2"')
    expect(prompt).toContain('Score must be an integer from 0 through 100.')
  })

  it('accepts bare JSON and exactly one JSON fence', () => {
    expect(parseJudgeResult(JSON.stringify(validJudge), revisionId)).toEqual({
      valid: true,
      ...validJudge
    })
    expect(parseJudgeResult(`~~~json\n${JSON.stringify(validJudge)}\n~~~`, revisionId)).toEqual({
      valid: true,
      ...validJudge
    })
    expect(parseJudgeResult(`~~~\n${JSON.stringify(validJudge)}\n~~~`, revisionId)).toEqual({
      valid: true,
      ...validJudge
    })
  })

  it('accepts standard Markdown code fences that real models emit by default', () => {
    expect(parseJudgeResult(`\`\`\`json\n${JSON.stringify(validJudge)}\n\`\`\``, revisionId)).toEqual({
      valid: true,
      ...validJudge
    })
    expect(parseJudgeResult(`\`\`\`\n${JSON.stringify(validJudge)}\n\`\`\``, revisionId)).toEqual({
      valid: true,
      ...validJudge
    })
    expect(parseJudgeResult(`\`\`\`json\r\n${JSON.stringify(validJudge)}\r\n\`\`\``, revisionId)).toEqual({
      valid: true,
      ...validJudge
    })
  })

  it('fails closed for mismatched fence markers', () => {
    expect(parseJudgeResult(`\`\`\`json\n${JSON.stringify(validJudge)}\n~~~`, revisionId)).toMatchObject({
      valid: false,
      verdict: 'REVISE',
      score: 0,
      revisionId
    })
  })

  it.each([
    ['invalid JSON', 'not json'],
    ['fractional score', JSON.stringify({ ...validJudge, score: 90.5 })],
    ['out-of-range score', JSON.stringify({ ...validJudge, score: 101 })],
    ['wrong revision id', JSON.stringify({ ...validJudge, revisionId: 'wrong' })],
    ['extra field', JSON.stringify({ ...validJudge, extra: true })],
    ['missing field', JSON.stringify({ verdict: 'PASS', score: 90, revisionId, feedback: 'ok' })],
    ['non-array unresolved', JSON.stringify({ ...validJudge, unresolved: 'none' })],
    ['non-string unresolved item', JSON.stringify({ ...validJudge, unresolved: ['ok', 1] })]
  ])('fails closed for %s', (_name, raw) => {
    expect(parseJudgeResult(raw, revisionId)).toMatchObject({
      valid: false,
      verdict: 'REVISE',
      score: 0,
      revisionId,
      unresolved: []
    })
  })

  it.each([
    ['repeated score', '{"verdict":"PASS","score":90,"score":90,"revisionId":"revision-1","feedback":"","unresolved":[]}'],
    ['repeated verdict', '{"verdict":"PASS","verdict":"REVISE","score":90,"revisionId":"revision-1","feedback":"","unresolved":[]}'],
    ['escaped equivalent score', '{"verdict":"PASS","score":90,"\\u0073core":90,"revisionId":"revision-1","feedback":"","unresolved":[]}']
  ])('fails closed for duplicate top-level Judge keys: %s', (_name, raw) => {
    expect(parseJudgeResult(raw, revisionId)).toMatchObject({
      valid: false,
      verdict: 'REVISE',
      score: 0,
      revisionId
    })
  })

  it('keeps special revision ids JSON-safe in the Judge shape example', () => {
    const specialRevisionId = 'revision "quoted" \\ slash\nnext'
    const prompt = buildJudgePrompt({
      effectivePrompt: 'Repair login',
      revisionId: specialRevisionId,
      revision: 'Candidate answer'
    })
    const shape = prompt.split('\n\n').find(line => line.startsWith('{"verdict"'))

    expect(shape).toBeDefined()
    expect(JSON.parse(shape!)).toEqual({
      verdict: 'PASS|REVISE',
      score: 0,
      revisionId: specialRevisionId,
      feedback: '',
      unresolved: []
    })
  })

  it('selects valid revisions by score, later round, then lexical id without mutating input', () => {
    const revisions: ScoredRevision[] = [
      { revisionId: 'invalid', content: 'invalid', round: 3, judge: { valid: false, ...validJudge, revisionId: 'invalid' } },
      { revisionId: 'revision-b', content: 'b', round: 2, judge: { valid: true, ...validJudge, verdict: 'REVISE', revisionId: 'revision-b' } },
      { revisionId: 'revision-c', content: 'c', round: 3, judge: { valid: true, ...validJudge, verdict: 'REVISE', revisionId: 'revision-c' } },
      { revisionId: 'revision-a', content: 'a', round: 3, judge: { valid: true, ...validJudge, verdict: 'REVISE', revisionId: 'revision-a' } },
      { revisionId: 'lower-score', content: 'low', round: 9, judge: { valid: true, ...validJudge, score: 89, revisionId: 'lower-score' } }
    ]
    const originalOrder = revisions.map(revision => revision.revisionId)

    expect(selectBestRevision(revisions)?.revisionId).toBe('revision-a')
    expect(revisions.map(revision => revision.revisionId)).toEqual(originalOrder)
  })

  it('breaks non-ASCII id ties by code unit independently of locale comparison', () => {
    const revisions: ScoredRevision[] = [
      { revisionId: 'revision-ä', content: 'umlaut', round: 2, judge: { valid: true, ...validJudge, revisionId: 'revision-ä' } },
      { revisionId: 'revision-z', content: 'ascii', round: 2, judge: { valid: true, ...validJudge, revisionId: 'revision-z' } }
    ]
    const originalLocaleCompare = String.prototype.localeCompare
    String.prototype.localeCompare = () => 1

    try {
      expect(selectBestRevision(revisions)?.revisionId).toBe('revision-z')
    } finally {
      String.prototype.localeCompare = originalLocaleCompare
    }
  })
})
