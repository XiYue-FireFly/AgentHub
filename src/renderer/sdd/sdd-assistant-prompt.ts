/**
 * SDD Assistant Prompt - 需求 AI 助手 prompt 构建
 *
 * 参照 kun 的 sdd-assistant-prompt.ts 设计
 * 系统化构建发送给 AI 的需求分析 prompt
 */

import type { SddDraft, SddDesignContext, SddRequirementBlock } from './sdd-draft-store'
import type { SddPmFramework } from './pm-skill-frameworks'

// ============================================================
// 类型定义
// ============================================================

export interface AssistantContext {
  draft: SddDraft
  blocks: SddRequirementBlock[]
  designContext?: SddDesignContext
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

// ============================================================
// 系统提示构建
// ============================================================

/**
 * 构建需求 AI 助手的系统 prompt
 * 包含需求内容、设计上下文、需求块状态等上下文信息
 */
export function buildAssistantSystemPrompt(ctx: AssistantContext): string {
  const parts: string[] = [
    '你是一个专业的需求分析助手（SDD Assistant），帮助用户澄清、完善和优化需求文档。',
    '',
    '## 你的职责',
    '1. 帮助用户澄清模糊的需求描述',
    '2. 发现需求中的遗漏和矛盾',
    '3. 建议改进需求结构和验收标准',
    '4. 根据 PM 技能框架提供专业建议',
    '5. 使用中文回复',
    '',
    '## 当前需求文档',
    `标题：${ctx.draft.title || '未命名需求'}`,
    ''
  ]

  // 设计上下文
  if (ctx.designContext) {
    const dcParts: string[] = ['### 设计上下文']
    if (ctx.designContext.designType) {
      dcParts.push(`- 设计类型：${ctx.designContext.designType === 'brand' ? '品牌' : '产品'}`)
    }
    if (ctx.designContext.brandColor) {
      dcParts.push(`- 品牌色：${ctx.designContext.brandColor}`)
    }
    if (ctx.designContext.tone && ctx.designContext.tone.length > 0) {
      dcParts.push(`- 色调：${ctx.designContext.tone.join('、')}`)
    }
    parts.push(...dcParts, '')
  }

  // 需求块状态
  if (ctx.blocks.length > 0) {
    parts.push('### 需求块状态')
    for (const block of ctx.blocks) {
      const checked = block.acceptanceCriteria.filter(c => c.checked).length
      const total = block.acceptanceCriteria.length
      parts.push(`- ${block.id}: ${block.title} [${block.status}] (${checked}/${total} 验收标准)`)
    }
    parts.push('')
  }

  // 需求内容摘要
  if (ctx.draft.content) {
    const contentPreview = ctx.draft.content.length > 2000
      ? ctx.draft.content.slice(0, 2000) + '\n...(内容已截断)'
      : ctx.draft.content
    parts.push('### 需求内容', '```markdown', contentPreview, '```', '')
  }

  parts.push(
    '## 回复要求',
    '- 回复简洁明了，避免冗长',
    '- 如果用户要求完善、整理、改写或更新需求文档，直接返回完整的修订版 Markdown 需求文档，从一级标题开始，不要只返回分析意见',
    '- 如果用户只是咨询、评审或提问，返回分析意见即可',
    '- 如发现遗漏的验收标准，主动提出建议',
    '- 引用需求块时使用其 ID（如 R-1）'
  )

  return parts.join('\n')
}

// ============================================================
// 用户消息构建
// ============================================================

/**
 * 构建增强的用户消息
 * 如果有 PM 技能框架，将其上下文注入到用户消息中
 */
export function buildAssistantUserMessage(
  message: string,
  framework?: SddPmFramework
): string {
  if (!framework) return message

  const parts: string[] = [
    `【PM 框架：${framework.name}】`,
    '',
    framework.description,
    ''
  ]

  // 使用框架的 prompt 作为指导上下文
  if (framework.prompt) {
    parts.push('框架指导：', framework.prompt, '')
  }

  parts.push('---', '', message)

  return parts.join('\n')
}

// ============================================================
// 对话历史构建
// ============================================================

/**
 * 构建对话历史的摘要
 * 用于在多轮对话中提供上下文
 */
export function buildHistorySummary(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxMessages = 6
): string {
  if (history.length === 0) return ''

  const recent = history.slice(-maxMessages)
  const parts: string[] = ['### 对话历史']

  for (const msg of recent) {
    const role = msg.role === 'user' ? '用户' : '助手'
    const content = msg.content.length > 300
      ? msg.content.slice(0, 300) + '...'
      : msg.content
    parts.push(`**${role}**：${content}`)
  }

  return parts.join('\n')
}

// ============================================================
// 完整 prompt 构建
// ============================================================

/**
 * 构建完整的 AI 请求 prompt
 * 包含系统提示、对话历史和用户消息
 */
export function buildAssistantPrompt(
  ctx: AssistantContext,
  userMessage: string,
  framework?: SddPmFramework
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = buildAssistantSystemPrompt(ctx)
  const historySummary = buildHistorySummary(ctx.history)

  let userPrompt = buildAssistantUserMessage(userMessage, framework)

  if (historySummary) {
    userPrompt = `${historySummary}\n\n---\n\n${userPrompt}`
  }

  return { systemPrompt, userPrompt }
}
