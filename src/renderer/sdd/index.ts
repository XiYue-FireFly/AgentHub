/**
 * SDD Module Index
 *
 * 导出所有 SDD 相关的组件和工具
 */

// Components
export { SddDraftEditor } from './components/SddDraftEditor'
export { SddProgressBar } from './components/SddProgressBar'
export { SddRequirementsList } from './components/SddRequirementsList'

// Store
export { useSddDraftStore } from './sdd-draft-store'
export type { SddDraft, SddDesignContext, SddRequirementBlock, SddTrace, SddSaveStatus, SddOperationStatus } from './sdd-draft-store'

// Actions
export {
  createNewDraft,
  loadDraft,
  saveDraftToDisk,
  deleteDraft,
  updateDesignContext,
  parseRequirementBlocks,
  computeTrace,
  listDrafts,
  draftExists
} from './sdd-draft-actions'

// Prompt builders (参考 Kun SDD 模块)
export {
  buildAssistantSystemPrompt,
  buildAssistantUserMessage,
  buildHistorySummary,
  buildAssistantPrompt
} from './sdd-assistant-prompt'
export type { AssistantContext } from './sdd-assistant-prompt'

export {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
  buildPlanPrompt,
  buildCoverageCheckPrompt
} from './sdd-plan-prompt'
export type { PlanPromptContext, PlanPromptResult } from './sdd-plan-prompt'

export {
  buildVerifySystemPrompt,
  buildVerifyUserPrompt,
  buildVerifyPrompt,
  buildBlockVerifyPrompt
} from './sdd-verify-prompt'
export type { VerifyPromptContext, VerifyPromptResult } from './sdd-verify-prompt'

// Draft history (参考 Kun SDD 模块)
export {
  getDraftHistory,
  addHistoryEntry,
  getHistoryEntry,
  restoreFromHistory,
  diffHistoryVersions,
  clearDraftHistory,
  getHistorySummary,
  recordSaveHistory,
  recordAiHistory
} from './sdd-draft-history'
export type { DraftHistoryEntry, DraftHistoryState } from './sdd-draft-history'
