import type { SddDraft, SddRequirementBlock } from './sdd-draft-store'

export function buildRequirementDocumentChatPrompt(input: {
  draft: SddDraft
  content: string
  blocks: SddRequirementBlock[]
}): string {
  const blockSummary = input.blocks.length > 0
    ? input.blocks.map(block => {
      const criteria = block.acceptanceCriteria
        .map((criterion, index) => `  - AC${index + 1}: ${criterion.text}`)
        .join('\n')
      return `- ${block.id}: ${block.title} [${block.status}]\n${criteria || '  - No explicit acceptance criteria'}`
    }).join('\n')
    : '- No parsed requirement blocks'

  return [
    '请严格按照下面的需求文档进行开发。',
    '',
    '执行要求：',
    '1. 将本文档作为本次开发的主要需求来源，不要只根据聊天里的零散描述实现。',
    '2. 先基于需求文档确认开发范围和执行计划，然后开始修改代码。',
    '3. 实现时覆盖文档中的验收标准、业务边界和假设；无法确认的点先明确说明。',
    '4. 修改完成后运行相关测试，并在最终回复中说明修改内容、测试结果和未覆盖风险。',
    '5. 如果需求与现有代码冲突，以需求文档为目标，保留必要的兼容说明。',
    '',
    `需求标题：${input.draft.title || '未命名需求'}`,
    `需求路径：${input.draft.relativePath}`,
    `工作目录：${input.draft.workspaceRoot}`,
    '',
    '解析到的需求块：',
    blockSummary,
    '',
    '完整需求文档：',
    '```markdown',
    input.content.trim(),
    '```'
  ].join('\n')
}
