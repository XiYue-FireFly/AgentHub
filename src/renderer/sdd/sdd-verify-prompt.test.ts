import { describe, expect, it } from 'vitest'
import {
  applyVerifyVerdictsToContent,
  buildVerifyEvidenceSummary,
  buildVerifyPrompt,
  buildVerifySystemPrompt,
  hashVerifyContent,
  parseVerifyResponse
} from './sdd-verify-prompt'
import type { SddDraft, SddRequirementBlock } from './sdd-draft-store'

const blocks: SddRequirementBlock[] = [
  {
    id: 'R-1',
    title: 'Checkout flow',
    status: 'done',
    description: 'Users can pay for items.',
    acceptanceCriteria: [
      { text: 'submit payment', checked: false },
      { text: 'show receipt', checked: false }
    ],
    lineNumber: 3
  }
]

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Checkout flow',
  content: [
    '# Checkout flow',
    '',
    '### R-1: Checkout flow {done}',
    'Users can pay for items.',
    '- [ ] submit payment',
    '- [ ] show receipt'
  ].join('\n'),
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

describe('sdd verify prompt', () => {
  it('requires a stable machine-readable verdict block', () => {
    const systemPrompt = buildVerifySystemPrompt()

    expect(systemPrompt).toContain('```sdd-verify-json')
    expect(systemPrompt).toContain('"requirementId": "R-1"')
    expect(systemPrompt).toContain('"criterionIndex": 0')
    expect(systemPrompt).toContain('"status": "pass"')
    expect(systemPrompt).toContain('status must be exactly one of: pass, fail, unknown')
  })

  it('lists acceptance criteria with stable zero-based ids', () => {
    const prompt = buildVerifyPrompt({
      draft,
      blocks,
      planContent: '- [x] Implement checkout (covers: R-1)',
      evidenceSummary: 'Related run evidence:\n- turn-1/codex agent:done: tests passed'
    })

    expect(prompt.userPrompt).toContain('R-1::0 [ ] submit payment')
    expect(prompt.userPrompt).toContain('R-1::1 [ ] show receipt')
    expect(prompt.userPrompt).toContain('Implementation Plan / Dispatch Trace')
    expect(prompt.userPrompt).toContain('Verification Evidence')
    expect(prompt.userPrompt).toContain('tests passed')
  })

  it('parses json verdicts and ignores invalid or duplicate entries', () => {
    const parsed = parseVerifyResponse([
      '## Report',
      '```sdd-verify-json',
      JSON.stringify({
        criteria: [
          { requirementId: 'r-1', criterionIndex: 0, status: 'pass', reason: 'covered' },
          { requirementId: 'R-1', criterionIndex: 0, status: 'fail', reason: 'duplicate' },
          { requirementId: 'R-1', criterionIndex: 9, status: 'pass' },
          { requirementId: 'R-2', criterionIndex: 0, status: 'pass' }
        ]
      }),
      '```'
    ].join('\n'), blocks)

    expect(parsed.verdicts).toEqual([{
      requirementId: 'R-1',
      criterionIndex: 0,
      status: 'pass',
      reason: 'covered'
    }])
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate'),
      expect.stringContaining('out of range'),
      expect.stringContaining('requirement was not found')
    ]))
  })

  it('ignores malformed json verdict entries without throwing', () => {
    const parsed = parseVerifyResponse([
      '## Report',
      '```sdd-verify-json',
      JSON.stringify({
        criteria: [
          null,
          'bad entry',
          { requirementId: 'R-1', criterionIndex: 0, status: 'pass' }
        ]
      }),
      '```'
    ].join('\n'), blocks)

    expect(parsed.verdicts).toEqual([{
      requirementId: 'R-1',
      criterionIndex: 0,
      status: 'pass',
      reason: undefined
    }])
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid verdict')
    ]))
  })

  it('can parse fallback line verdicts', () => {
    const parsed = parseVerifyResponse([
      '- [x] R-1::0 - covered',
      '- [ ] R-1::1 - not enough evidence'
    ].join('\n'), blocks)

    expect(parsed.verdicts).toMatchObject([
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' },
      { requirementId: 'R-1', criterionIndex: 1, status: 'unknown' }
    ])
  })

  it('applies only passing verdicts and marks a requirement verified when every criterion is checked', () => {
    const result = applyVerifyVerdictsToContent(draft.content, [
      { requirementId: 'R-1', criterionIndex: 0, status: 'pass' },
      { requirementId: 'R-1', criterionIndex: 1, status: 'fail' }
    ])

    expect(result.appliedCount).toBe(1)
    expect(result.verifiedRequirementIds).toEqual([])
    expect(result.content).toContain('- [x] submit payment')
    expect(result.content).toContain('- [ ] show receipt')
    expect(result.content).toContain('### R-1: Checkout flow {done}')

    const fullyVerified = applyVerifyVerdictsToContent(result.content, [
      { requirementId: 'R-1', criterionIndex: 1, status: 'pass' }
    ])

    expect(fullyVerified.appliedCount).toBe(1)
    expect(fullyVerified.verifiedRequirementIds).toEqual(['R-1'])
    expect(fullyVerified.content).toContain('### R-1: Checkout flow {verified}')
    expect(fullyVerified.content).toContain('- [x] show receipt')
  })

  it('hashes verification content deterministically for stale apply guards', () => {
    expect(hashVerifyContent(draft.content)).toBe(hashVerifyContent(draft.content))
    expect(hashVerifyContent(draft.content)).not.toBe(hashVerifyContent(`${draft.content}\n- [ ] extra`))
  })

  it('builds verification evidence from trace, SDD todos, and related runtime events', () => {
    const summary = buildVerifyEvidenceSummary({
      draftId: 'draft-1',
      workspaceRoot: 'E:\\workspace',
      trace: {
        draftId: 'draft-1',
        requirementBlocks: blocks,
        planItems: [{
          id: 'T-1',
          text: 'T-1: Implement checkout (covers: R-1)',
          covers: ['R-1'],
          status: 'completed',
          lineNumber: 1,
          turnId: 'turn-1'
        }],
        coverage: { 'R-1': ['T-1'] },
        derivedStatuses: { 'R-1': 'done' },
        uncoveredRequirementIds: [],
        timestamp: '2026-07-04T00:00:00.000Z'
      },
      todos: [{
        id: 'todo-1',
        threadId: 'thread-1',
        content: 'T-1: Implement checkout (covers: R-1)',
        status: 'completed',
        source: {
          kind: 'plan',
          draftId: 'draft-1',
          workspaceRoot: 'E:\\workspace',
          planItemId: 'T-1',
          turnId: 'turn-1'
        },
        updatedAt: 1
      }],
      events: [{
        id: 'event-2',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 1,
        kind: 'run:status',
        agentId: 'codex',
        payload: { status: 'completed', scheduleRole: 'executor', taskId: 'task-1' },
        createdAt: 1
      } as RuntimeEvent,
      {
        id: 'event-summary',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 2,
        kind: 'turn:summary',
        agentId: 'dispatch-planner',
        payload: {
          intent: 'implementation',
          matchedSkills: ['tdd', 'verification'],
          matchedPlugins: ['git'],
          strategy: 'single',
          effectiveMode: 'direct',
          dispatchMode: 'auto',
          selectedAgentId: 'codex'
        },
        createdAt: 2
      } as RuntimeEvent,
      {
        id: 'event-3',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 3,
        kind: 'guard:verdict',
        agentId: 'reviewer',
        payload: { role: 'reviewer', level: 'low', status: 'pass', reasons: ['No acceptance regressions found'] },
        createdAt: 3
      } as RuntimeEvent,
      {
        id: 'event-4',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 4,
        kind: 'turn:status',
        payload: { status: 'completed' },
        createdAt: 4
      } as RuntimeEvent]
    })

    expect(summary).toContain('Trace plan items:')
    expect(summary).toContain('T-1: completed; covers=R-1; turn=turn-1')
    expect(summary).toContain('Current thread SDD todos:')
    expect(summary).toContain('completed; planItem=T-1; turn=turn-1')
    expect(summary).toContain('Related run evidence:')
    expect(summary).toContain('run - completed - executor - task-1')
    expect(summary).toContain('intent=implementation - skills=tdd, verification - plugins=git')
    expect(summary).toContain('strategy=single - mode=direct - dispatch=auto - selected=codex')
    expect(summary).toContain('guard - reviewer - low - pass - No acceptance regressions found')
    expect(summary).toContain('turn - completed')
  })

  it('filters SDD todos and their runtime events to the current draft scope', () => {
    const summary = buildVerifyEvidenceSummary({
      draftId: 'draft-1',
      workspaceRoot: 'E:\\workspace',
      trace: {
        draftId: 'draft-1',
        requirementBlocks: blocks,
        planItems: [{
          id: 'T-1',
          text: 'T-1: Implement checkout (covers: R-1)',
          covers: ['R-1'],
          status: 'completed',
          lineNumber: 1,
          turnId: 'turn-current'
        }],
        coverage: { 'R-1': ['T-1'] },
        derivedStatuses: { 'R-1': 'done' },
        uncoveredRequirementIds: [],
        timestamp: '2026-07-04T00:00:00.000Z'
      },
      todos: [
        {
          id: 'todo-current',
          threadId: 'thread-1',
          content: 'T-1: Implement checkout (covers: R-1)',
          status: 'completed',
          source: {
            kind: 'plan',
            draftId: 'draft-1',
            workspaceRoot: 'E:\\workspace',
            planItemId: 'T-1',
            turnId: 'turn-current'
          },
          updatedAt: 1
        },
        {
          id: 'todo-other-draft',
          threadId: 'thread-1',
          content: 'T-9: Implement unrelated invoices (covers: R-9)',
          status: 'completed',
          source: {
            kind: 'plan',
            draftId: 'draft-2',
            workspaceRoot: 'E:\\workspace',
            planItemId: 'T-9',
            turnId: 'turn-other-draft'
          },
          updatedAt: 2
        },
        {
          id: 'todo-other-workspace',
          threadId: 'thread-1',
          content: 'T-10: Implement unrelated reports (covers: R-10)',
          status: 'completed',
          source: {
            kind: 'plan',
            draftId: 'draft-1',
            workspaceRoot: 'E:\\other',
            planItemId: 'T-10',
            turnId: 'turn-other-workspace'
          },
          updatedAt: 3
        }
      ],
      events: [
        {
          id: 'event-current',
          threadId: 'thread-1',
          turnId: 'turn-current',
          seq: 1,
          kind: 'run:status',
          agentId: 'codex',
          payload: { status: 'completed', taskId: 'task-current' },
          createdAt: 1
        } as RuntimeEvent,
        {
          id: 'event-other-draft',
          threadId: 'thread-1',
          turnId: 'turn-other-draft',
          seq: 2,
          kind: 'agent:done',
          agentId: 'codex',
          payload: { content: 'Implemented unrelated invoices.' },
          createdAt: 2
        } as RuntimeEvent,
        {
          id: 'event-other-workspace',
          threadId: 'thread-1',
          turnId: 'turn-other-workspace',
          seq: 3,
          kind: 'agent:done',
          agentId: 'codex',
          payload: { content: 'Implemented unrelated reports.' },
          createdAt: 3
        } as RuntimeEvent,
        {
          id: 'event-other-guard',
          threadId: 'thread-1',
          turnId: 'turn-other-draft',
          seq: 4,
          kind: 'guard:verdict',
          agentId: 'reviewer',
          payload: { role: 'reviewer', level: 'high', status: 'block', reasons: ['Unrelated blocker'] },
          createdAt: 4
        } as RuntimeEvent
      ]
    })

    expect(summary).toContain('run - completed - task-current')
    expect(summary).toContain('turn-current')
    expect(summary).toContain('Implement checkout')
    expect(summary).not.toContain('unrelated invoices')
    expect(summary).not.toContain('unrelated reports')
    expect(summary).not.toContain('Unrelated blocker')
    expect(summary).not.toContain('turn-other-draft')
    expect(summary).not.toContain('turn-other-workspace')
  })

  it('filters same-draft todos that do not belong to the current trace plan or turn', () => {
    const summary = buildVerifyEvidenceSummary({
      draftId: 'draft-1',
      workspaceRoot: 'E:\\workspace',
      trace: {
        draftId: 'draft-1',
        requirementBlocks: blocks,
        planItems: [{
          id: 'T-1',
          text: 'T-1: Implement checkout (covers: R-1)',
          covers: ['R-1'],
          status: 'completed',
          lineNumber: 1,
          turnId: 'turn-current'
        }],
        coverage: { 'R-1': ['T-1'] },
        derivedStatuses: { 'R-1': 'done' },
        uncoveredRequirementIds: [],
        timestamp: '2026-07-04T00:00:00.000Z'
      },
      todos: [
        {
          id: 'todo-current',
          threadId: 'thread-1',
          content: 'T-1: Implement checkout (covers: R-1)',
          status: 'completed',
          source: {
            kind: 'plan',
            draftId: 'draft-1',
            workspaceRoot: 'E:\\workspace',
            planItemId: 'T-1',
            turnId: 'turn-current'
          },
          updatedAt: 1
        },
        {
          id: 'todo-old-same-draft',
          threadId: 'thread-1',
          content: 'T-99: Old same-draft implementation (covers: R-1)',
          status: 'completed',
          source: {
            kind: 'plan',
            draftId: 'draft-1',
            workspaceRoot: 'E:\\workspace',
            planItemId: 'T-99',
            turnId: 'turn-old'
          },
          updatedAt: 2
        }
      ],
      events: [
        {
          id: 'event-current',
          threadId: 'thread-1',
          turnId: 'turn-current',
          seq: 1,
          kind: 'turn:status',
          payload: { status: 'completed' },
          createdAt: 1
        } as RuntimeEvent,
        {
          id: 'event-old',
          threadId: 'thread-1',
          turnId: 'turn-old',
          seq: 2,
          kind: 'turn:status',
          payload: { status: 'failed', error: 'old failure' },
          createdAt: 2
        } as RuntimeEvent
      ]
    })

    expect(summary).toContain('Implement checkout')
    expect(summary).toContain('turn - completed')
    expect(summary).not.toContain('Old same-draft implementation')
    expect(summary).not.toContain('old failure')
    expect(summary).not.toContain('turn-old')
  })

  it('includes only explicitly linked trace commit evidence', () => {
    const summary = buildVerifyEvidenceSummary({
      draftId: 'draft-1',
      workspaceRoot: 'E:\\workspace',
      trace: {
        draftId: 'draft-1',
        requirementBlocks: blocks,
        planItems: [{
          id: 'T-1',
          text: 'T-1: Implement checkout (covers: R-1)',
          covers: ['R-1'],
          status: 'completed',
          lineNumber: 1,
          turnId: 'turn-current',
          commits: [
            {
              sha: 'abcdef1234567890abcdef1234567890abcdef12',
              shortSha: 'abcdef1',
              summary: 'Implement checkout submit flow',
              linkedAt: '2026-07-04T00:00:00.000Z',
              turnId: 'turn-current',
              files: [
                { path: 'src/checkout.ts', status: 'M', additions: 12, deletions: 2 },
                { path: 'src/checkout.test.ts', status: 'A', additions: 24, deletions: 0 }
              ]
            },
            {
              sha: 'fffffff1234567890abcdef1234567890abcdef12',
              shortSha: 'fffffff',
              summary: 'Unrelated stale turn commit',
              linkedAt: '2026-07-04T00:00:00.000Z',
              turnId: 'turn-old',
              files: [{ path: 'src/old.ts', status: 'M', additions: 1, deletions: 1 }]
            }
          ]
        }],
        coverage: { 'R-1': ['T-1'] },
        derivedStatuses: { 'R-1': 'done' },
        uncoveredRequirementIds: [],
        timestamp: '2026-07-04T00:00:00.000Z'
      },
      todos: [],
      events: []
    })

    expect(summary).toContain('Related commit evidence:')
    expect(summary).toContain('T-1 abcdef1; turn=turn-current; Implement checkout submit flow')
    expect(summary).toContain('M src/checkout.ts +12 -2')
    expect(summary).toContain('A src/checkout.test.ts +24 -0')
    expect(summary).not.toContain('Unrelated stale turn commit')
    expect(summary).not.toContain('src/old.ts')
  })

  it('filters linked commit evidence by current thread id', () => {
    const summary = buildVerifyEvidenceSummary({
      draftId: 'draft-1',
      workspaceRoot: 'E:\\workspace',
      threadId: 'thread-1',
      trace: {
        draftId: 'draft-1',
        requirementBlocks: blocks,
        planItems: [{
          id: 'T-1',
          text: 'T-1: Implement checkout (covers: R-1)',
          covers: ['R-1'],
          status: 'completed',
          lineNumber: 1,
          turnId: 'turn-current',
          commits: [
            {
              sha: 'abcdef1234567890abcdef1234567890abcdef12',
              shortSha: 'abcdef1',
              summary: 'Current thread commit',
              linkedAt: '2026-07-04T00:00:00.000Z',
              turnId: 'turn-current',
              threadId: 'thread-1'
            },
            {
              sha: 'bbbbbbb1234567890abcdef1234567890abcdef12',
              shortSha: 'bbbbbbb',
              summary: 'Other thread commit',
              linkedAt: '2026-07-04T00:00:00.000Z',
              turnId: 'turn-current',
              threadId: 'thread-2'
            },
            {
              sha: 'ccccccc1234567890abcdef1234567890abcdef12',
              shortSha: 'ccccccc',
              summary: 'Unscoped legacy commit',
              linkedAt: '2026-07-04T00:00:00.000Z',
              turnId: 'turn-current'
            }
          ]
        }],
        coverage: { 'R-1': ['T-1'] },
        derivedStatuses: { 'R-1': 'done' },
        uncoveredRequirementIds: [],
        timestamp: '2026-07-04T00:00:00.000Z'
      },
      todos: [],
      events: []
    })

    expect(summary).toContain('Current thread commit')
    expect(summary).not.toContain('Other thread commit')
    expect(summary).not.toContain('Unscoped legacy commit')
  })
})
