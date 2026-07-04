import { describe, expect, it } from 'vitest'
import {
  applyAssistantRequirementResponse,
  cleanAssistantMarkdown,
  looksLikeFullRequirementDocument
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

  it('does not classify analysis feedback as a complete requirement document', () => {
    expect(looksLikeFullRequirementDocument('# 需求分析反馈\n\n## 当前问题\n\n目标不清晰')).toBe(false)
  })

  it('cleans markdown code fences without changing plain markdown', () => {
    expect(cleanAssistantMarkdown('```md\n# 标题\n\n内容\n```')).toBe('# 标题\n\n内容')
    expect(cleanAssistantMarkdown('# 标题\n\n内容')).toBe('# 标题\n\n内容')
  })
})
