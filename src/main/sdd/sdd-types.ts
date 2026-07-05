/**
 * SDD (Spec Driven Development) Type Definitions
 *
 * 需求驱动开发系统的核心类型定义
 * 参照 kun 的 SDD 系统设计
 */

// ============================================================
// 需求状态
// ============================================================

/**
 * 需求状态机
 * draft → planned → building → done → verified
 * 状态只能前进，不能后退
 */
export type SddStatus = 'draft' | 'planned' | 'building' | 'done' | 'verified'

// ============================================================
// 需求块 (R-Block)
// ============================================================

/**
 * 需求验收标准
 */
export interface SddAcceptanceCriterion {
  text: string
  checked: boolean
}

/**
 * 需求块 (R-Block)
 *
 * 格式：
 * ```markdown
 * ### R-1: 需求标题 {building}
 * 描述正文...
 * - [ ] 验收标准一
 * - [x] 验收标准二
 * ```
 */
export interface SddRequirementBlock {
  id: string                    // 如 "R-1", "R-2"
  title: string
  status: SddStatus
  description: string
  acceptanceCriteria: SddAcceptanceCriterion[]
  lineNumber: number            // 在文档中的起始行号
}

// ============================================================
// 设计上下文
// ============================================================

export type SddDesignType = 'brand' | 'product'

export interface SddDesignContext {
  designType?: SddDesignType
  brandColor?: string
  tone?: string[]  // e.g. ['专业', '简洁']
}

// ============================================================
// 需求草稿
// ============================================================

/**
 * 需求草稿
 */
export interface SddDraft {
  id: string
  workspaceRoot: string
  relativePath: string         // 如 .agenthub/requirements/<uuid>/requirement.md
  title: string
  content: string
  designContext?: SddDesignContext
  createdAt: string
  updatedAt: string
}

/**
 * 需求草稿元数据（不包含 content）
 */
export interface SddDraftMeta {
  id: string
  workspaceRoot: string
  relativePath: string
  title: string
  createdAt: string
  updatedAt: string
}

// ============================================================
// 计划项
// ============================================================

/**
 * 计划项
 *
 * 格式：
 * ```markdown
 * - [ ] 实现导出 API (covers: R-1, R-2)
 * - [x] 添加单元测试 (covers: R-1)
 * ```
 */
export interface SddPlanItem {
  id: string
  text: string
  covers: string[]              // 关联的需求 ID，如 ['R-1', 'R-2']
  status: 'pending' | 'in_progress' | 'completed'
  lineNumber: number
  turnId?: string
  commits?: SddCommitEvidence[]
}

export interface SddCommitEvidence {
  sha: string
  shortSha: string
  summary?: string
  files?: Array<{
    path: string
    oldPath?: string | null
    status: string
    additions?: number
    deletions?: number
  }>
  linkedAt: string
  turnId?: string
  threadId?: string
}

// ============================================================
// 需求追踪
// ============================================================

/**
 * 需求追踪结果
 */
export interface SddTrace {
  draftId: string
  requirementBlocks: SddRequirementBlock[]
  planItems: SddPlanItem[]
  coverage: Record<string, string[]>  // requirementId -> planItemIds
  derivedStatuses: Record<string, SddStatus>
  uncoveredRequirementIds: string[]
  timestamp: string
}

/**
 * 追踪快照（持久化用）
 */
export interface SddTraceSnapshot {
  version: 1
  draftId: string
  trace: SddTrace
  savedAt: string
}

// ============================================================
// AI 助手
// ============================================================

/**
 * AI 对话消息
 */
export interface SddChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  threadId?: string
}

/**
 * AI 对话记录
 */
export interface SddChatTranscript {
  draftId: string
  threadId: string
  messages: SddChatMessage[]
  createdAt: string
  updatedAt: string
}

/**
 * PM 技能框架阶段
 */
export type SddWorkflowStage = 'discover' | 'structure' | 'risk'

/**
 * PM 技能框架
 */
export interface SddPmFramework {
  id: string
  name: string
  stage: SddWorkflowStage
  description: string
  prompt: string
}

// ============================================================
// 需求创建选项
// ============================================================

export interface SddCreateOptions {
  workspaceRoot: string
  title: string
  template?: 'blank' | 'standard' | 'minimal'
  designContext?: SddDesignContext
}

export interface SddUpdateOptions {
  content?: string
  designContext?: SddDesignContext
}

// ============================================================
// 路径常量
// ============================================================

export const SDD_RELATIVE_DIR = '.agenthub'
export const SDD_REQUIREMENTS_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/requirements`
export const SDD_DRAFT_FILE_NAME = 'requirement.md'
export const SDD_TRACE_FILE_NAME = 'trace.json'
export const SDD_PLAN_FILE_NAME = 'plan.md'
export const SDD_CHAT_DIR_NAME = 'chat'
export const SDD_IMG_DIR_NAME = 'img'
