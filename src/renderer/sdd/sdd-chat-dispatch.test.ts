import { describe, expect, it } from 'vitest'
import { buildRequirementDocumentChatPrompt } from './sdd-chat-dispatch'
import type { SddDraft, SddRequirementBlock } from './sdd-draft-store'

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Student profile',
  content: '',
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z'
}

const blocks: SddRequirementBlock[] = [{
  id: 'R-1',
  title: 'Edit nickname',
  status: 'draft',
  description: 'Students can submit nickname changes.',
  acceptanceCriteria: [
    { text: 'student sees new nickname after approval', checked: false },
    { text: 'admin sees pending change request', checked: false }
  ],
  lineNumber: 3
}]

describe('requirement document chat dispatch prompt', () => {
  it('wraps the complete requirement document with strict agent execution instructions', () => {
    const prompt = buildRequirementDocumentChatPrompt({
      draft,
      blocks,
      content: '# Student profile\n\n### R-1: Edit nickname\n- [ ] student sees new nickname after approval'
    })

    expect(prompt).toContain('请严格按照下面的需求文档进行开发')
    expect(prompt).toContain('将本文档作为本次开发的主要需求来源')
    expect(prompt).toContain('需求标题：Student profile')
    expect(prompt).toContain('需求路径：.agenthub/requirements/draft-1/requirement.md')
    expect(prompt).toContain('- R-1: Edit nickname [draft]')
    expect(prompt).toContain('AC1: student sees new nickname after approval')
    expect(prompt).toContain('```markdown')
    expect(prompt).toContain('# Student profile')
  })
})
