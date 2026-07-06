import { describe, expect, it } from 'vitest'
import {
  applyAssistantRequirementResponse,
  cleanAssistantMarkdown,
  extractCoreRequirementMarkdown,
  looksLikeFullRequirementDocument,
  previewAssistantRequirementResponse
} from './sdd-assistant-apply'

const baseDraft = `# 未命名需求

## 背景

描述此需求的上下文和动机。

## 目标

应该实现什么？

## 验收标准

- [ ] 验收标准 1
- [ ] 验收标准 2
`

const fixedNow = new Date('2026-07-04T04:43:23.000Z')

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1
}

describe('sdd assistant requirement response application', () => {
  it('replaces the existing AI requirement section instead of appending a new copy', () => {
    const first = applyAssistantRequirementResponse(
      baseDraft,
      '# 需求分析反馈\n\n## 当前问题\n\n旧反馈内容',
      { now: fixedNow }
    )

    const second = applyAssistantRequirementResponse(
      first,
      '# 需求分析反馈\n\n## 当前问题\n\n新反馈内容',
      { now: fixedNow }
    )

    expect(countOccurrences(second, '## AI 需求整理')).toBe(1)
    expect(second).toContain('新反馈内容')
    expect(second).not.toContain('旧反馈内容')
    expect(second.indexOf('## AI 需求整理')).toBeGreaterThan(second.indexOf('## 验收标准'))
  })

  it('replaces the draft when the assistant returns a complete requirement document', () => {
    const revisedDraft = `# 学生管理系统需求

## 背景

当前需要统一管理学生信息。

## 目标

提供学生信息的创建、查询、编辑和删除能力。

## 验收标准

- [ ] 支持新增学生
- [ ] 支持按姓名搜索学生`

    const result = applyAssistantRequirementResponse(baseDraft, revisedDraft, { now: fixedNow })

    expect(result).toBe(`${revisedDraft}\n`)
    expect(result).not.toContain('描述此需求的上下文和动机')
    expect(result).not.toContain('## AI 需求整理')
  })

  it('unwraps fenced markdown before deciding whether to replace the draft', () => {
    const revisedDraft = `# 学生管理系统需求

## 背景

当前需要统一管理学生信息。

## 目标

提供学生信息的创建、查询、编辑和删除能力。

## 验收标准

- [ ] 支持新增学生`

    const result = applyAssistantRequirementResponse(
      baseDraft,
      `\`\`\`markdown\n${revisedDraft}\n\`\`\``,
      { now: fixedNow }
    )

    expect(result).toBe(`${revisedDraft}\n`)
  })

  it('extracts only the core revised requirement document from assistant commentary', () => {
    const response = `是的，这份需求文档还需要进一步澄清。

主要修改建议

- 补充验收标准
- 删除模糊表述

基于以上，我为您提供一个修订后的完整需求文档。

学生信息管理系统 V1.0（修订版）

1. 背景

为解决学生信息分散维护的问题，系统提供基础的信息录入、查看和审核能力。

2. 目标

管理员可以维护学生信息，学生可以查看自己的信息。

5. 验收标准（修订）

[ ] AC1（角色与权限）：管理员和学生登录后看到的功能菜单严格符合角色权限。
[ ] AC2（学生信息查看）：学生登录后，可清晰查看包含学院、年级、班级在内的个人详细信息。`

    const extracted = extractCoreRequirementMarkdown(response)
    const result = applyAssistantRequirementResponse(baseDraft, response, { now: fixedNow })

    expect(extracted).toContain('学生信息管理系统 V1.0（修订版）')
    expect(extracted).not.toContain('主要修改建议')
    expect(result).toBe(`${extracted}\n`)
    expect(result).not.toContain('是的，这份需求文档还需要进一步澄清')
  })

  it('does not classify analysis feedback as a complete requirement document', () => {
    expect(looksLikeFullRequirementDocument('# 需求分析反馈\n\n## 当前问题\n\n目标不清晰')).toBe(false)
  })

  it('cleans markdown code fences without changing plain markdown', () => {
    expect(cleanAssistantMarkdown('```md\n# 标题\n\n内容\n```')).toBe('# 标题\n\n内容')
    expect(cleanAssistantMarkdown('# 标题\n\n内容')).toBe('# 标题\n\n内容')
  })
  it('previews requirement writeback changes without mutating the current draft', () => {
    const preview = previewAssistantRequirementResponse(
      baseDraft,
      'Add shipping address collection to checkout.',
      { now: fixedNow }
    )

    expect(preview.changed).toBe(true)
    expect(preview.content).toContain('Add shipping address collection to checkout.')
    expect(preview.added).toContain('Add shipping address collection to checkout.')
    expect(baseDraft).not.toContain('Add shipping address collection to checkout.')
  })
})
