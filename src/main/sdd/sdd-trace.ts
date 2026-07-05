/**
 * SDD Trace - 需求追踪系统
 *
 * 实现 R-Block 解析、covers 解析、覆盖率计算
 */

import {
  SddRequirementBlock,
  SddPlanItem,
  SddStatus,
  SddTrace,
  SddAcceptanceCriterion
} from './sdd-types'

const PLAN_COVERS_RE = /[（(]\s*covers?\s*[:：]\s*([^)）]+)\s*[)）]/i

// ============================================================
// R-Block 解析
// ============================================================

/**
 * 解析需求文档中的 R-Block
 *
 * 格式：
 * ```markdown
 * ### R-1: 需求标题 {building}
 * 描述正文...
 * - [ ] 验收标准一
 * - [x] 验收标准二
 * ```
 */
export function parseRequirementBlocks(markdown: string): SddRequirementBlock[] {
  const lines = markdown.split('\n')
  const blocks: SddRequirementBlock[] = []

  let currentBlock: Partial<SddRequirementBlock> | null = null
  let descriptionLines: string[] = []
  let acceptanceCriteria: SddAcceptanceCriterion[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 检测 R-Block 标题：### R-N: title {status}
    const blockMatch = trimmed.match(/^###\s+(R-\d+):\s+(.+?)(?:\s+\{(\w+)\})?\s*$/)

    if (blockMatch) {
      // 保存前一个 block
      if (currentBlock) {
        blocks.push({
          ...currentBlock,
          description: descriptionLines.join('\n').trim(),
          acceptanceCriteria
        } as SddRequirementBlock)
      }

      // 开始新 block
      const id = blockMatch[1]
      const title = blockMatch[2].trim()
      const statusStr = blockMatch[3] || 'draft'
      const status = parseStatus(statusStr)

      currentBlock = {
        id,
        title,
        status,
        lineNumber: i + 1
      }
      descriptionLines = []
      acceptanceCriteria = []
      continue
    }

    // 在 block 内部
    if (currentBlock) {
      // 检测验收标准：- [ ] 或 - [x]
      const criterionMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/)

      if (criterionMatch) {
        const checked = criterionMatch[1] !== ' '
        const text = criterionMatch[2].trim()
        acceptanceCriteria.push({ text, checked })
      } else if (trimmed === '' && descriptionLines.length > 0) {
        // 空行分隔描述和验收标准
        // 如果已经有验收标准，后续的非验收标准行忽略
        if (acceptanceCriteria.length === 0) {
          descriptionLines.push('')
        }
      } else if (acceptanceCriteria.length === 0) {
        // 描述行
        descriptionLines.push(line)
      }
    }
  }

  // 保存最后一个 block
  if (currentBlock) {
    blocks.push({
      ...currentBlock,
      description: descriptionLines.join('\n').trim(),
      acceptanceCriteria
    } as SddRequirementBlock)
  }

  return blocks
}

/**
 * 解析状态字符串
 */
function parseStatus(statusStr: string): SddStatus {
  const validStatuses: SddStatus[] = ['draft', 'planned', 'building', 'done', 'verified']
  const normalized = statusStr.toLowerCase().trim()

  if (validStatuses.includes(normalized as SddStatus)) {
    return normalized as SddStatus
  }

  return 'draft'
}

// ============================================================
// Plan Covers 解析
// ============================================================

/**
 * 解析计划文件中的 covers 标注
 *
 * 格式：
 * ```markdown
 * - [ ] 实现导出 API (covers: R-1, R-2)
 * - [x] 添加单元测试 (covers: R-1)
 * ```
 */
export function parsePlanCovers(planMarkdown: string): SddPlanItem[] {
  const lines = planMarkdown.split('\n')
  const items: SddPlanItem[] = []
  let itemIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 检测计划项：- [ ] 或 - [x]
    const itemMatch = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/)

    if (itemMatch) {
      itemIndex++
      const checked = itemMatch[1] !== ' '
      const text = itemMatch[2].trim()
      const explicitId = text.match(/^(T-\d+|P-\d+)\s*[:：]\s+/i)?.[1]?.toUpperCase()

      // 提取 covers 标注
      const coversMatch = PLAN_COVERS_RE.exec(text)
      const covers: string[] = []

      if (coversMatch) {
        const coversStr = coversMatch[1]
        const coverIds = coversStr.split(/[,，]/).map(s => s.trim())
        for (const coverId of coverIds) {
          if (coverId.match(/^R-\d+$/i)) {
            covers.push(coverId.toUpperCase())
          }
        }
      }

      items.push({
        id: explicitId || `P-${itemIndex}`,
        text,
        covers,
        status: checked ? 'completed' : 'pending',
        lineNumber: i + 1
      })
    }
  }

  return items
}

// ============================================================
// 覆盖率计算
// ============================================================

/**
 * 计算需求覆盖率
 *
 * 返回：
 * - coverage: requirementId -> planItemIds
 * - uncoveredRequirementIds: 未被计划覆盖的需求 ID
 */
export function computeCoverage(
  blocks: SddRequirementBlock[],
  planItems: SddPlanItem[]
): {
  coverage: Record<string, string[]>
  uncoveredRequirementIds: string[]
} {
  const coverage: Record<string, string[]> = {}
  const coveredRequirementIds = new Set<string>()

  // 初始化所有需求的覆盖列表
  for (const block of blocks) {
    coverage[block.id] = []
  }

  // 计算每个计划项覆盖的需求
  for (const planItem of planItems) {
    for (const requirementId of planItem.covers) {
      if (coverage[requirementId]) {
        coverage[requirementId].push(planItem.id)
        coveredRequirementIds.add(requirementId)
      }
    }
  }

  // 找出未覆盖的需求
  const uncoveredRequirementIds = blocks
    .filter(block => !coveredRequirementIds.has(block.id))
    .map(block => block.id)

  return { coverage, uncoveredRequirementIds }
}

// ============================================================
// 状态推导
// ============================================================

/**
 * 推导需求状态
 *
 * 规则：
 * - 如果所有验收标准都已勾选 → verified
 * - 如果有计划项正在开发 → building
 * - 如果有计划项覆盖 → planned
 * - 否则保持原状态
 */
export function deriveStatuses(
  blocks: SddRequirementBlock[],
  coverage: Record<string, string[]>,
  planStatuses: Record<string, string>
): Record<string, SddStatus> {
  const derivedStatuses: Record<string, SddStatus> = {}

  for (const block of blocks) {
    const planItemIds = coverage[block.id] || []

    // 检查是否所有验收标准都已勾选
    const allCriteriaChecked = block.acceptanceCriteria.length > 0 &&
      block.acceptanceCriteria.every(c => c.checked)

    if (allCriteriaChecked) {
      derivedStatuses[block.id] = 'verified'
      continue
    }

    // 检查是否有计划项正在开发
    const hasBuildingPlan = planItemIds.some(id => planStatuses[id] === 'in_progress')
    if (hasBuildingPlan) {
      derivedStatuses[block.id] = 'building'
      continue
    }

    // 检查是否有计划项覆盖
    if (planItemIds.length > 0) {
      derivedStatuses[block.id] = 'planned'
      continue
    }

    // 保持原状态
    derivedStatuses[block.id] = block.status
  }

  return derivedStatuses
}

// ============================================================
// 完整追踪计算
// ============================================================

/**
 * 计算完整的需求追踪
 */
export function computeTrace(input: {
  draftId: string
  requirementMarkdown: string
  planMarkdown: string | null
}): SddTrace {
  const blocks = parseRequirementBlocks(input.requirementMarkdown)
  const planItems = input.planMarkdown ? parsePlanCovers(input.planMarkdown) : []

  const { coverage, uncoveredRequirementIds } = computeCoverage(blocks, planItems)

  // 计算计划项状态
  const planStatuses: Record<string, string> = {}
  for (const planItem of planItems) {
    planStatuses[planItem.id] = planItem.status
  }

  const derivedStatuses = deriveStatuses(blocks, coverage, planStatuses)

  return {
    draftId: input.draftId,
    requirementBlocks: blocks,
    planItems,
    coverage,
    derivedStatuses,
    uncoveredRequirementIds,
    timestamp: new Date().toISOString()
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 格式化需求状态标签
 */
export function formatSddStatus(status: SddStatus): { zh: string; en: string } {
  const labels: Record<SddStatus, { zh: string; en: string }> = {
    draft: { zh: '草稿', en: 'Draft' },
    planned: { zh: '已规划', en: 'Planned' },
    building: { zh: '开发中', en: 'Building' },
    done: { zh: '已完成', en: 'Done' },
    verified: { zh: '已验收', en: 'Verified' }
  }
  return labels[status] || { zh: status, en: status }
}

/**
 * 计算需求完成度
 */
export function computeCompletionRate(blocks: SddRequirementBlock[]): {
  total: number
  verified: number
  done: number
  building: number
  planned: number
  draft: number
  rate: number
} {
  const total = blocks.length
  const counts = { verified: 0, done: 0, building: 0, planned: 0, draft: 0 }

  for (const block of blocks) {
    counts[block.status]++
  }

  const rate = total > 0 ? (counts.verified + counts.done) / total : 0

  return { total, ...counts, rate }
}
