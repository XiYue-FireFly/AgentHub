/**
 * SDD Draft Store - 需求草稿状态管理
 *
 * 使用 Zustand 管理需求草稿的状态
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// ============================================================
// Types
// ============================================================

export type SddSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export type SddOperationStatus = 'idle' | 'upgrading' | 'error'

export interface SddDraft {
  id: string
  workspaceRoot: string
  relativePath: string
  title: string
  content: string
  designContext?: SddDesignContext
  createdAt: string
  updatedAt: string
}

export interface SddDesignContext {
  designType?: 'brand' | 'product'
  brandColor?: string
  tone?: string[]
}

export interface SddRequirementBlock {
  id: string
  title: string
  status: 'draft' | 'planned' | 'building' | 'done' | 'verified'
  description: string
  acceptanceCriteria: Array<{ text: string; checked: boolean }>
  lineNumber: number
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

export interface SddTrace {
  draftId: string
  requirementBlocks: SddRequirementBlock[]
  planItems: Array<{
    id: string
    text: string
    covers: string[]
    status: 'pending' | 'in_progress' | 'completed'
    lineNumber: number
    turnId?: string
    commits?: SddCommitEvidence[]
  }>
  coverage: Record<string, string[]>
  derivedStatuses: Record<string, SddRequirementBlock['status']>
  uncoveredRequirementIds: string[]
  timestamp: string
}

// ============================================================
// Store State
// ============================================================

interface SddDraftState {
  // Draft state
  activeDraft: SddDraft | null
  content: string
  lastSavedContent: string
  saveStatus: SddSaveStatus
  operationStatus: SddOperationStatus
  error: string | null

  // Requirement blocks
  requirementBlocks: SddRequirementBlock[]

  // Trace
  trace: SddTrace | null

  // Actions
  setActiveDraft: (draft: SddDraft | null) => void
  setContent: (content: string) => void
  markSaved: () => void
  setSaveStatus: (status: SddSaveStatus) => void
  setOperationStatus: (status: SddOperationStatus) => void
  setError: (error: string | null) => void
  setRequirementBlocks: (blocks: SddRequirementBlock[]) => void
  setTrace: (trace: SddTrace | null) => void
  updateDesignContext: (patch: Partial<SddDesignContext>) => void
  clearDraft: () => void
}

// ============================================================
// Store
// ============================================================

export const useSddDraftStore = create<SddDraftState>()(
  devtools(
    persist(
      immer((set) => ({
        // Initial state
        activeDraft: null,
        content: '',
        lastSavedContent: '',
        saveStatus: 'saved',
        operationStatus: 'idle',
        error: null,
        requirementBlocks: [],
        trace: null,

        // Actions
        setActiveDraft: (draft) => set((state) => {
          state.activeDraft = draft
          state.content = draft?.content || ''
          state.lastSavedContent = draft?.content || ''
          state.saveStatus = 'saved'
          state.operationStatus = 'idle'
          state.error = null
          state.requirementBlocks = []
          state.trace = null
        }),

        setContent: (content) => set((state) => {
          state.content = content
          state.saveStatus = 'dirty'
        }),

        markSaved: () => set((state) => {
          state.lastSavedContent = state.content
          state.saveStatus = 'saved'
        }),

        setSaveStatus: (status) => set((state) => {
          state.saveStatus = status
        }),

        setOperationStatus: (status) => set((state) => {
          state.operationStatus = status
        }),

        setError: (error) => set((state) => {
          state.error = error
        }),

        setRequirementBlocks: (blocks) => set((state) => {
          state.requirementBlocks = blocks
        }),

        setTrace: (trace) => set((state) => {
          state.trace = trace
        }),

        updateDesignContext: (patch) => set((state) => {
          if (!state.activeDraft) return
          state.activeDraft.designContext = {
            ...state.activeDraft.designContext,
            ...patch
          }
        }),

        clearDraft: () => set((state) => {
          state.activeDraft = null
          state.content = ''
          state.lastSavedContent = ''
          state.saveStatus = 'saved'
          state.operationStatus = 'idle'
          state.error = null
          state.requirementBlocks = []
          state.trace = null
        }),
      })),
      {
        name: 'sdd-draft-store',
        version: 1,
        partialize: (state) => ({
          // 只持久化必要的状态（content 已通过 saveDraftToDisk 单独保存）
          activeDraft: state.activeDraft,
          lastSavedContent: state.lastSavedContent,
          saveStatus: state.saveStatus,
        }),
        onRehydrateStorage: () => (state) => {
          // After rehydration, content will be loaded from draft file
          // Set saveStatus to dirty if we have an active draft
          if (state && state.activeDraft) {
            state.saveStatus = 'dirty'
          }
        },
      }
    ),
    { name: 'sdd-draft-store' }
  )
)

// ============================================================
// Selector Hooks
// ============================================================

export const useSddActiveDraft = () => useSddDraftStore((state) => state.activeDraft)
export const useSddContent = () => useSddDraftStore((state) => state.content)
export const useSddSaveStatus = () => useSddDraftStore((state) => state.saveStatus)
export const useSddOperationStatus = () => useSddDraftStore((state) => state.operationStatus)
export const useSddError = () => useSddDraftStore((state) => state.error)
export const useSddRequirementBlocks = () => useSddDraftStore((state) => state.requirementBlocks)
export const useSddTrace = () => useSddDraftStore((state) => state.trace)
