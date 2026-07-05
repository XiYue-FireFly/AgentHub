/**
 * SDD Plan Prompt - 从需求生成计划的 prompt 构建
 *
 * 参照 kun 的 sdd-plan-prompt.ts 设计
 * 将需求文档转化为结构化的实施计划
 */

import type { SddDraft, SddDesignContext, SddRequirementBlock } from './sdd-draft-store'

// ============================================================
// 类型定义
// ============================================================

export interface PlanPromptContext {
  draft: SddDraft
  blocks: SddRequirementBlock[]
  designContext?: SddDesignContext
  workspaceRoot?: string
  existingPlan?: string
}

export interface PlanPromptResult {
  systemPrompt: string
  userPrompt: string
}

// ============================================================
// 计划模板
// ============================================================

const PLAN_TEMPLATE = `# 实施计划

## 概述
简要描述本次实施的目标和范围。

## 技术方案
### 架构选择
描述技术架构和关键设计决策。

### 技术栈
列出将使用的技术和库。

## 任务分解

> 机器可读任务清单：下面的每个实施任务必须保留 checkbox 和 (covers: R-x) 标注，用于同步 Todo 和计算 trace 覆盖率。

- [ ] T-1: 任务名称，说明要修改的模块/文件和主要动作 (covers: R-1)
- [ ] T-2: 任务名称，说明验证方式和交付物 (covers: R-1, R-2)

### T-1: [任务名称]
- **对应需求**: R-x
- **描述**: 具体做什么
- **步骤**:
  1. 步骤一
  2. 步骤二
- **验收标准**: 
  - 标准一
  - 标准二

### T-2: [任务名称]
- **对应需求**: R-x
- **描述**: 具体做什么
- **步骤**:
  1. 步骤一
  2. 步骤二
- **验收标准**:
  - 标准一
  - 标准二

## 风险与对策
| 风险 | 可能性 | 影响 | 对策 |
|------|--------|------|------|
| 风险一 | 低/中/高 | 低/中/高 | 对策 |

## 里程碑
1. 里程碑一 - 预计时间
2. 里程碑二 - 预计时间
`

// ============================================================
// 系统提示构建
// ============================================================

/**
 * 构建生成计划的系统 prompt
 */
export function buildPlanSystemPrompt(ctx: PlanPromptContext): string {
  const parts: string[] = [
    '你是一个专业的技术架构师，负责将需求文档转化为可执行的实施计划。',
    '',
    '## 你的职责',
    '1. 仔细分析每条需求，理解其业务价值和技术约束',
    '2. 将需求分解为具体、可执行的任务',
    '3. 为每个任务指定对应的需求数（如 R-1）',
    '4. 定义清晰的验收标准',
    '5. 识别技术风险并提供对策',
    '6. 使用中文回复',
    '',
    '## 输出格式',
    '严格按照以下 Markdown 模板输出计划：',
    '',
    '```markdown',
    PLAN_TEMPLATE,
    '```',
    '',
    '## 关键规则',
    '- 每个任务必须对应至少一个需求块（R-x）',
    '- 任务分解必须包含机器可读 checklist：`- [ ] T-x: 任务说明 (covers: R-x)`',
    '- 只有实施任务使用 checkbox；任务细节里的验收标准不要使用 `- [ ]`，避免被同步为 Todo',
    '- 验收标准必须可验证、可量化',
    '- 任务粒度适中，单个任务不超过 4 小时工作量',
    '- 步骤描述具体到文件/模块级别',
    '- 如果需求不明确，在"风险与对策"中标注'
  ]

  // 设计上下文
  if (ctx.designContext) {
    parts.push('', '## 设计上下文')
    if (ctx.designContext.designType) {
      parts.push(`- 设计类型：${ctx.designContext.designType === 'brand' ? '品牌' : '产品'}`)
    }
    if (ctx.designContext.brandColor) {
      parts.push(`- 品牌色：${ctx.designContext.brandColor}`)
    }
    if (ctx.designContext.tone && ctx.designContext.tone.length > 0) {
      parts.push(`- 色调：${ctx.designContext.tone.join('、')}`)
    }
  }

  return parts.join('\n')
}

// ============================================================
// 用户提示构建
// ============================================================

/**
 * 构建生成计划的用户 prompt
 * 包含需求内容和需求块状态
 */
export function buildPlanUserPrompt(ctx: PlanPromptContext): string {
  const parts: string[] = []

  // 需求内容
  if (ctx.draft.content) {
    parts.push('## 需求文档', '', ctx.draft.content, '')
  }

  // 需求块摘要
  if (ctx.blocks.length > 0) {
    parts.push('## 需求块摘要')
    for (const block of ctx.blocks) {
      const checked = block.acceptanceCriteria.filter(c => c.checked).length
      const total = block.acceptanceCriteria.length
      parts.push(`- ${block.id}: ${block.title} [${block.status}] (${checked}/${total} 验收)`)
    }
    parts.push('')
  }

  // 已有计划（如果有）
  if (ctx.existingPlan) {
    parts.push('## 已有计划（请在此基础上优化）', '', '```markdown', ctx.existingPlan, '```', '')
  }

  // 指令
  parts.push(
    '## 指令',
    '请根据以上需求文档生成完整的实施计划。',
    '确保每个需求块（R-x）都有对应的任务覆盖。',
    '如果需求中有未明确的点，在风险中标注并提出假设。'
  )

  return parts.join('\n')
}

// ============================================================
// 完整 prompt 构建
// ============================================================

/**
 * 构建完整的计划生成 prompt
 */
export function buildPlanPrompt(ctx: PlanPromptContext): PlanPromptResult {
  return {
    systemPrompt: buildPlanSystemPrompt(ctx),
    userPrompt: buildPlanUserPrompt(ctx)
  }
}

// ============================================================
// 计划验证 prompt
// ============================================================

/**
 * 构建计划与需求覆盖率验证的 prompt
 */
export function buildCoverageCheckPrompt(
  requirementContent: string,
  planContent: string
): PlanPromptResult {
  return {
    systemPrompt: [
      '你是一个需求覆盖率分析专家。',
      '你的任务是检查实施计划是否覆盖了所有需求。',
      '请输出覆盖率分析报告，格式如下：',
      '',
      '```',
      '覆盖率: X%',
      '已覆盖需求: R-1, R-2, ...',
      '未覆盖需求: R-3, ...',
      '建议: 补充 T-x 任务覆盖 R-3',
      '```'
    ].join('\n'),
    userPrompt: [
      '## 需求文档',
      requirementContent,
      '',
      '## 实施计划',
      planContent,
      '',
      '请分析计划对需求的覆盖率。'
    ].join('\n')
  }
}
