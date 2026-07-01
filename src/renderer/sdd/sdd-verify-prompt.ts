/**
 * SDD Verify Prompt - 验收 prompt 构建
 *
 * 参照 kun 的 sdd-verify-prompt.ts 设计
 * 生成验收检查清单和自动化验收 prompt
 */

import type { SddDraft, SddRequirementBlock } from './sdd-draft-store'

// ============================================================
// 类型定义
// ============================================================

export interface VerifyPromptContext {
  draft: SddDraft
  blocks: SddRequirementBlock[]
  planContent?: string
  codeChanges?: string[]
}

export interface VerifyPromptResult {
  systemPrompt: string
  userPrompt: string
}

// ============================================================
// 系统提示构建
// ============================================================

/**
 * 构建验收检查的系统 prompt
 */
export function buildVerifySystemPrompt(): string {
  return [
    '你是一个专业的验收测试工程师，负责验证需求是否被正确实现。',
    '',
    '## 你的职责',
    '1. 逐条检查验收标准是否满足',
    '2. 识别实现与需求之间的偏差',
    '3. 发现遗漏的边界情况',
    '4. 提供具体的修复建议',
    '5. 使用中文回复',
    '',
    '## 输出格式',
    '```markdown',
    '## 验收报告',
    '',
    '### 总体结果',
    '- 通过: X/Y 条验收标准',
    '- 状态: ✅ 全部通过 / ⚠️ 部分通过 / ❌ 未通过',
    '',
    '### 逐条验收',
    '',
    '#### R-1: [需求标题]',
    '- [✅/❌] 验收标准 1: 描述',
    '  - 验证结果: ...',
    '  - 问题: ...（如有）',
    '  - 建议: ...（如有）',
    '',
    '### 关键问题',
    '1. 问题描述（严重程度: 高/中/低）',
    '   - 影响: ...',
    '   - 建议: ...',
    '',
    '### 改进建议',
    '1. 建议一',
    '2. 建议二',
    '```'
  ].join('\n')
}

// ============================================================
// 用户提示构建
// ============================================================

/**
 * 构建验收检查的用户 prompt
 * 包含需求块、验收标准、代码变更等信息
 */
export function buildVerifyUserPrompt(ctx: VerifyPromptContext): string {
  const parts: string[] = []

  // 需求内容
  if (ctx.draft.content) {
    parts.push('## 需求文档', '', ctx.draft.content, '')
  }

  // 需求块和验收标准
  if (ctx.blocks.length > 0) {
    parts.push('## 需求块和验收标准')
    for (const block of ctx.blocks) {
      parts.push('', `### ${block.id}: ${block.title} [${block.status}]`)
      if (block.description) {
        parts.push(`描述: ${block.description}`)
      }
      if (block.acceptanceCriteria.length > 0) {
        parts.push('验收标准:')
        for (const criteria of block.acceptanceCriteria) {
          parts.push(`- [${criteria.checked ? 'x' : ' '}] ${criteria.text}`)
        }
      }
    }
    parts.push('')
  }

  // 计划内容（如果有）
  if (ctx.planContent) {
    parts.push('## 实施计划', '', '```markdown', ctx.planContent, '```', '')
  }

  // 代码变更（如果有）
  if (ctx.codeChanges && ctx.codeChanges.length > 0) {
    parts.push('## 代码变更')
    for (const change of ctx.codeChanges) {
      parts.push(`- ${change}`)
    }
    parts.push('')
  }

  // 指令
  parts.push(
    '## 指令',
    '请逐条验证每个需求块的验收标准。',
    '对于未通过的标准，给出具体的问题描述和修复建议。',
    '如果代码变更不足以验证某些标准，请标注为"待验证"。'
  )

  return parts.join('\n')
}

// ============================================================
// 完整 prompt 构建
// ============================================================

/**
 * 构建完整的验收 prompt
 */
export function buildVerifyPrompt(ctx: VerifyPromptContext): VerifyPromptResult {
  return {
    systemPrompt: buildVerifySystemPrompt(),
    userPrompt: buildVerifyUserPrompt(ctx)
  }
}

// ============================================================
// 单需求块验收 prompt
// ============================================================

/**
 * 为单个需求块构建验收 prompt
 * 用于增量验收场景
 */
export function buildBlockVerifyPrompt(
  block: SddRequirementBlock,
  codeChanges?: string[]
): VerifyPromptResult {
  const parts: string[] = [
    `## 需求块: ${block.id}`,
    `标题: ${block.title}`,
    `状态: ${block.status}`,
    ''
  ]

  if (block.description) {
    parts.push(`描述: ${block.description}`, '')
  }

  if (block.acceptanceCriteria.length > 0) {
    parts.push('验收标准:')
    for (const criteria of block.acceptanceCriteria) {
      parts.push(`- [${criteria.checked ? 'x' : ' '}] ${criteria.text}`)
    }
    parts.push('')
  }

  if (codeChanges && codeChanges.length > 0) {
    parts.push('## 代码变更')
    for (const change of codeChanges) {
      parts.push(`- ${change}`)
    }
    parts.push('')
  }

  parts.push('请逐条验证此需求块的验收标准，给出验证结果和建议。')

  return {
    systemPrompt: buildVerifySystemPrompt(),
    userPrompt: parts.join('\n')
  }
}
