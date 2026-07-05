import { describe, expect, it } from 'vitest'
import { buildPlanPrompt, buildPlanSystemPrompt } from './sdd-plan-prompt'
import type { SddDraft } from './sdd-draft-store'

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Checkout flow',
  content: [
    '# Checkout flow',
    '',
    '### R-1: Cart checkout {draft}',
    'Users can buy items.'
  ].join('\n'),
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

describe('sdd plan prompt', () => {
  it('requires machine-readable task checklist items with covers markers', () => {
    const systemPrompt = buildPlanSystemPrompt({ draft, blocks: [] })

    expect(systemPrompt).toContain('- [ ] T-1:')
    expect(systemPrompt).toContain('(covers: R-1)')
    expect(systemPrompt).toContain('`- [ ] T-x: 任务说明 (covers: R-x)`')
    expect(systemPrompt).toContain('只有实施任务使用 checkbox')
  })

  it('does not demonstrate checkbox syntax for acceptance criteria details', () => {
    const systemPrompt = buildPlanSystemPrompt({ draft, blocks: [] })
    const acceptanceSections = systemPrompt.match(/- \*\*验收标准\*\*:[\s\S]*?(?=\n### T-|\n## 风险|$)/g) ?? []

    expect(acceptanceSections.length).toBeGreaterThan(0)
    for (const section of acceptanceSections) {
      expect(section).not.toContain('- [ ]')
    }
  })

  it('uses the supplied current draft content in the user prompt', () => {
    const result = buildPlanPrompt({
      draft: {
        ...draft,
        content: '# Checkout flow\n\nUsers can buy items with a saved card.'
      },
      blocks: []
    })

    expect(result.userPrompt).toContain('saved card')
    expect(result.userPrompt).not.toContain('Users can buy items.\n')
  })
})
