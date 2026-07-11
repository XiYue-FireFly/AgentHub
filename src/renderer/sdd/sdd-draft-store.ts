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
  draftSession: number
  editRevision: number

  // Requirement blocks
  requirementBlocks: SddRequirementBlock[]

  // Trace
  trace: SddTrace | null

  // Actions
  setActiveDraft: (draft: SddDraft | null) => void
  setContent: (content: string) => void
  markSaved: (expectedSession: number, expectedRevision: number) => void
  markError: (expectedSession: number, expectedRevision: number, error: string) => void
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
        draftSession: 0,
        editRevision: 0,
        requirementBlocks: [],
        trace: null,

        // Actions
        setActiveDraft: (draft) => set((state) => {
          state.draftSession++
          state.activeDraft = draft
          state.content = draft?.content || ''
          state.lastSavedContent = draft?.content || ''
          state.saveStatus = 'saved'
          state.operationStatus = 'idle'
          state.error = null
          state.editRevision = 0
          state.requirementBlocks = []
          state.trace = null
        }),

        setContent: (content) => set((state) => {
          if (state.content === content) return
          state.content = content
          state.editRevision++
          state.saveStatus = 'dirty'
        }),

        markSaved: (expectedSession, expectedRevision) => set((state) => {
          if (state.draftSession !== expectedSession || state.editRevision !== expectedRevision) return
          state.lastSavedContent = state.content
          state.saveStatus = 'saved'
          state.error = null
          // Keep partialized activeDraft in sync so rehydrate does not prefer a stale empty blob
          if (state.activeDraft) {
            state.activeDraft.content = state.content
          }
        }),

        markError: (expectedSession, expectedRevision, error) => set((state) => {
          if (state.draftSession !== expectedSession || state.editRevision !== expectedRevision) return
          state.saveStatus = 'error'
          state.error = error
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
          const next = {
            ...state.activeDraft.designContext,
            ...patch
          }
          if (sameDesignContext(state.activeDraft.designContext, next)) return
          state.activeDraft.designContext = next
          state.editRevision++
          state.saveStatus = 'dirty'
        }),

        clearDraft: () => set((state) => {
          state.draftSession++
          state.activeDraft = null
          state.content = ''
          state.lastSavedContent = ''
          state.saveStatus = 'saved'
          state.operationStatus = 'idle'
          state.error = null
          state.editRevision = 0
          state.requirementBlocks = []
          state.trace = null
        }),
      })),
      {
        name: 'sdd-draft-store',
        version: 1,
        partialize: (state) => ({
          // Persist draft metadata + last known content snapshot.
          // Live `content` is also restored on rehydrate from activeDraft.content
          // to avoid empty-buffer autosave wiping disk (G2-MC1).
          activeDraft: state.activeDraft,
          lastSavedContent: state.lastSavedContent,
          // Never persist dirty/saving — rehydrate must not trigger empty overwrite
          saveStatus: 'saved' as SddSaveStatus,
        }),
        onRehydrateStorage: () => (state) => {
          if (!state) return
          state.draftSession++
          if (state.activeDraft) {
            // Prefer lastSavedContent (successful save snapshot). Do not use ?? on
            // activeDraft.content — empty string would block fallback (G2-MC1 review).
            const fromSaved = typeof state.lastSavedContent === 'string' ? state.lastSavedContent : ''
            const fromDraft = typeof state.activeDraft.content === 'string' ? state.activeDraft.content : ''
            const restored = fromSaved.length > 0 ? fromSaved : fromDraft
            state.content = restored
            state.lastSavedContent = restored
            state.activeDraft.content = restored
            state.saveStatus = 'saved'
            state.editRevision = 0
            // F-W4: schedule disk reload after rehydrate (avoid empty wipe race)
            const draftId = state.activeDraft.id
            const workspaceRoot = state.activeDraft.workspaceRoot
            const draftSession = state.draftSession
            const editRevision = state.editRevision
            queueMicrotask(() => {
              void import('./sdd-draft-actions').then(m => {
                const cur = useSddDraftStore.getState()
                if (
                  cur.activeDraft?.id === draftId &&
                  cur.activeDraft.workspaceRoot === workspaceRoot &&
                  cur.draftSession === draftSession &&
                  cur.editRevision === editRevision &&
                  cur.saveStatus === 'saved'
                ) {
                  void m.reloadActiveDraftFromDisk()
                }
              }).catch(() => {})
            })
          } else {
            state.content = ''
            state.lastSavedContent = ''
            state.saveStatus = 'saved'
            state.editRevision = 0
          }
        },
      }
    ),
    { name: 'sdd-draft-store' }
  )
)

function sameDesignContext(left: SddDesignContext | undefined, right: SddDesignContext | undefined): boolean {
  if (left?.designType !== right?.designType || left?.brandColor !== right?.brandColor) return false
  const leftTone = left?.tone ?? []
  const rightTone = right?.tone ?? []
  return leftTone.length === rightTone.length && leftTone.every((value, index) => value === rightTone[index])
}

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
