/**
 * SDD Requirements List - 需求列表页面
 *
 * 显示所有需求，支持创建、删除、搜索、编辑
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import type { ProviderDef } from '../../glass/meta'
import { styledConfirm } from '../../lib/confirm'
import { useSddDraftStore, type SddRequirementBlock } from '../sdd-draft-store'
import { listDrafts, createNewDraft, deleteDraft, loadDraft, saveDraftToDisk, parseRequirementBlocks, persistPlanTrace, applyVerifyVerdicts } from '../sdd-draft-actions'
import { buildAssistantPrompt } from '../sdd-assistant-prompt'
import { previewAssistantRequirementResponse } from '../sdd-assistant-apply'
import { recordAiHistory } from '../sdd-draft-history'
import { buildPlanPrompt } from '../sdd-plan-prompt'
import { buildVerifyEvidenceSummary, buildVerifyPrompt, hashVerifyContent, parseVerifyResponse, type VerifyDraftSnapshot } from '../sdd-verify-prompt'
import { buildRequirementDocumentChatPrompt } from '../sdd-chat-dispatch'
import { SddDraftEditor } from './SddDraftEditor'
import { SddAssistantPanel } from './SddAssistantPanel'

interface SddRequirementsListProps {
  workspaceRoot: string | null
  threadId?: string | null
  threadTodos?: ThreadTodo[]
  events?: RuntimeEvent[]
  providers?: ProviderDef[]
  modelSelection?: ModelSelection | null
  onModelSelectionChange?: (selection: ModelSelection | null) => void
  onThreadTodosChanged?: (threadId: string) => void | Promise<void>
  onSendRequirementToChat?: (prompt: string, modelSelection?: ModelSelection | null) => Promise<unknown>
  onRequirementSentToChat?: () => void
}

const PLAN_GENERATION_TRIGGER_MESSAGE = 'Generate an implementation plan from the current requirement document.'
const VERIFY_TRIGGER_MESSAGE = 'Review completed implementation evidence and verify acceptance criteria for this requirement document.'
const ASSISTANT_WIDTH_KEY = 'sdd.assistantPanelWidth'
const ASSISTANT_DEFAULT_WIDTH = 420
const ASSISTANT_MIN_WIDTH = 360
const ASSISTANT_MAX_WIDTH = 780
type AssistantRequestMode = 'chat' | 'plan' | 'verify'
type ToolbarStatusTone = 'muted' | 'success' | 'warning' | 'error'

interface ToolbarStatus {
  tone: ToolbarStatusTone
  text: string
}

interface AssistantRequirementApplyContext {
  kind: 'requirement-apply'
  draftId: string
  workspaceRoot: string
  contentHash: string
  nextContent: string
  preview: {
    added: string[]
    removed: string[]
  }
}

function isVerifyDraftSnapshot(value: unknown): value is VerifyDraftSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<VerifyDraftSnapshot>
  return typeof snapshot.draftId === 'string' &&
    typeof snapshot.workspaceRoot === 'string' &&
    typeof snapshot.contentHash === 'string'
}

function isAssistantRequirementApplyContext(value: unknown): value is AssistantRequirementApplyContext {
  if (!value || typeof value !== 'object') return false
  const context = value as Partial<AssistantRequirementApplyContext>
  return context.kind === 'requirement-apply' &&
    typeof context.draftId === 'string' &&
    typeof context.workspaceRoot === 'string' &&
    typeof context.contentHash === 'string' &&
    typeof context.nextContent === 'string'
}

function clampAssistantWidth(width: number): number {
  if (!Number.isFinite(width)) return ASSISTANT_DEFAULT_WIDTH
  return Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, Math.round(width)))
}

function readAssistantPanelWidth(): number {
  try {
    return clampAssistantWidth(Number(localStorage.getItem(ASSISTANT_WIDTH_KEY)) || ASSISTANT_DEFAULT_WIDTH)
  } catch {
    return ASSISTANT_DEFAULT_WIDTH
  }
}

function buildRequirementTodoMarkdown(blocks: SddRequirementBlock[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    for (const criterion of block.acceptanceCriteria) {
      const text = criterion.text.trim()
      if (!text) continue
      const marker = criterion.checked ? 'x' : ' '
      lines.push(`- [${marker}] ${block.id}: ${text} (covers: ${block.id})`)
    }
  }
  return lines.join('\n')
}

function parseRequirementTodoBlocksFromMarkdown(markdown: string): SddRequirementBlock[] {
  const blocks: SddRequirementBlock[] = []
  let current: SddRequirementBlock | null = null
  const lines = markdown.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    const blockMatch = trimmed.match(/^###\s+(R-\d+):\s+(.+?)(?:\s+\{(\w+)\})?\s*$/i)
    if (blockMatch) {
      current = {
        id: blockMatch[1].toUpperCase(),
        title: blockMatch[2].trim(),
        status: 'draft',
        description: '',
        acceptanceCriteria: [],
        lineNumber: index + 1
      }
      blocks.push(current)
      continue
    }
    if (!current) continue
    const criterionMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)
    if (!criterionMatch) continue
    current.acceptanceCriteria.push({
      checked: criterionMatch[1].toLowerCase() === 'x',
      text: criterionMatch[2].trim()
    })
  }
  return blocks.filter(block => block.acceptanceCriteria.length > 0)
}

function selectRequirementTodoBlocks(parsedBlocks: SddRequirementBlock[], fallbackBlocks: SddRequirementBlock[], markdown: string): SddRequirementBlock[] {
  if (parsedBlocks.length > 0) return parsedBlocks
  const markdownBlocks = parseRequirementTodoBlocksFromMarkdown(markdown)
  if (markdownBlocks.length > 0) return markdownBlocks
  const hasChecklistMarkers = /^\s*[-*]\s+\[[ xX]\]\s+.+$/m.test(markdown)
  return hasChecklistMarkers ? fallbackBlocks : []
}

export function SddRequirementsList({ workspaceRoot, threadId = null, threadTodos = [], events = [], providers = [], modelSelection = null, onModelSelectionChange, onThreadTodosChanged, onSendRequirementToChat, onRequirementSentToChat }: SddRequirementsListProps) {
  const [drafts, setDrafts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantMode, setAssistantMode] = useState<AssistantRequestMode>('chat')
  const [assistantTriggerNonce, setAssistantTriggerNonce] = useState(0)
  const [assistantWidth, setAssistantWidth] = useState(readAssistantPanelWidth)
  const [assistantResizing, setAssistantResizing] = useState(false)
  const [syncingDocumentTodo, setSyncingDocumentTodo] = useState(false)
  const [syncDocumentTodoStatus, setSyncDocumentTodoStatus] = useState<ToolbarStatus | null>(null)
  const assistantResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const autoVerifyTriggeredRef = useRef<Set<string>>(new Set())
  const autoVerifySeenEventKeysRef = useRef<Set<string>>(new Set())
  const autoVerifyBaselineKeyRef = useRef<string | null>(null)

  const activeDraft = useSddDraftStore((s) => s.activeDraft)

  // Clear seen event keys when draft changes to prevent memory leak
  useEffect(() => {
    autoVerifySeenEventKeysRef.current.clear()
    autoVerifyTriggeredRef.current.clear()
  }, [activeDraft?.id])
  const draftContent = useSddDraftStore((s) => s.content)

  const saveAssistantWidth = useCallback((nextWidth: number) => {
    const clamped = clampAssistantWidth(nextWidth)
    setAssistantWidth(clamped)
    try { localStorage.setItem(ASSISTANT_WIDTH_KEY, String(clamped)) } catch { /* noop */ }
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const active = assistantResizeRef.current
      if (!active) return
      event.preventDefault()
      saveAssistantWidth(active.startWidth + active.startX - event.clientX)
    }
    const handlePointerUp = () => {
      if (!assistantResizeRef.current) return
      assistantResizeRef.current = null
      setAssistantResizing(false)
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [saveAssistantWidth])

  const startAssistantResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    assistantResizeRef.current = {
      startX: event.clientX,
      startWidth: assistantWidth
    }
    setAssistantResizing(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [assistantWidth])

  const handleAssistantResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (event.key === 'Home') {
      saveAssistantWidth(ASSISTANT_MIN_WIDTH)
      return
    }
    if (event.key === 'End') {
      saveAssistantWidth(ASSISTANT_MAX_WIDTH)
      return
    }
    saveAssistantWidth(assistantWidth + (event.key === 'ArrowLeft' ? 24 : -24))
  }, [assistantWidth, saveAssistantWidth])

  const triggerVerification = useCallback(() => {
    if (!draftContent) return
    if (assistantOpen && assistantMode === 'verify') return
    setAssistantMode('verify')
    setAssistantTriggerNonce(value => value + 1)
    setAssistantOpen(true)
  }, [assistantMode, assistantOpen, draftContent])

  const handleSendRequirementToChat = useCallback(async () => {
    const store = useSddDraftStore.getState()
    const draft = store.activeDraft
    if (!draft || !onSendRequirementToChat) return
    const saved = await saveDraftToDisk()
    if (!saved) throw new Error('Failed to save draft before sending it to chat')
    await parseRequirementBlocks()
    const latest = useSddDraftStore.getState()
    const latestDraft = latest.activeDraft ?? draft
    const prompt = buildRequirementDocumentChatPrompt({
      draft: latestDraft,
      content: latest.content,
      blocks: latest.requirementBlocks
    })
    await onSendRequirementToChat(prompt, modelSelection)
    onRequirementSentToChat?.()
  }, [modelSelection, onRequirementSentToChat, onSendRequirementToChat])

  const handleSyncDocumentTodos = useCallback(async () => {
    if (syncingDocumentTodo) return
    if (!threadId) {
      setSyncDocumentTodoStatus({ tone: 'warning', text: tr('需要先打开一个会话。', 'Open a thread first.') })
      return
    }
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return
    setSyncingDocumentTodo(true)
    setSyncDocumentTodoStatus({ tone: 'muted', text: tr('同步中...', 'Syncing...') })
    try {
      const saved = await saveDraftToDisk()
      if (!saved) throw new Error('Failed to save draft before syncing todos')
      const previousBlocks = useSddDraftStore.getState().requirementBlocks
      await parseRequirementBlocks()
      const latest = useSddDraftStore.getState()
      const latestDraft = latest.activeDraft ?? draft
      const source = {
        workspaceRoot: latestDraft.workspaceRoot,
        draftId: latestDraft.id,
        relativePath: latestDraft.relativePath
      }
      const requirementBlocks = selectRequirementTodoBlocks(latest.requirementBlocks, previousBlocks, latest.content)
      const todoMarkdown = buildRequirementTodoMarkdown(requirementBlocks)
      const todoCount = todoMarkdown ? todoMarkdown.split('\n').filter(Boolean).length : 0
      await window.electronAPI.todos.syncFromMarkdown(threadId, todoMarkdown, source)
      await onThreadTodosChanged?.(threadId)
      setSyncDocumentTodoStatus({
        tone: todoCount > 0 ? 'success' : 'warning',
        text: todoCount > 0
          ? tr(`已同步 ${todoCount} 个 Todo`, `Synced ${todoCount} todos`)
          : tr('没有解析到 Todo，请检查文档是否包含 - [ ] 清单', 'No todos parsed. Use - [ ] checklist items in the document.')
      })
    } catch (error: any) {
      setSyncDocumentTodoStatus({
        tone: 'error',
        text: error?.message || tr('同步 Todo 失败', 'Sync Todo failed')
      })
    } finally {
      setSyncingDocumentTodo(false)
    }
  }, [onThreadTodosChanged, syncingDocumentTodo, threadId])

  // Load drafts
  const refreshDrafts = useCallback(async () => {
    if (!workspaceRoot) return
    setLoading(true)
    try {
      const result = await listDrafts(workspaceRoot)
      setDrafts(result)
    } catch (error) {
      console.error('Failed to load drafts:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => {
    refreshDrafts()
  }, [refreshDrafts])

  useEffect(() => {
    if (!activeDraft || !threadId || !draftContent) return
    const baselineKey = `${activeDraft.workspaceRoot}:${activeDraft.id}:${threadId}`
    const completedPlanEvents = threadTodos.flatMap(todo => {
      const source = todo.source
      if (todo.status !== 'completed') return []
      if (source?.kind !== 'plan' || source.draftId !== activeDraft.id || source.workspaceRoot !== activeDraft.workspaceRoot || !source.turnId) return []
      return events.filter(event =>
        event.threadId === threadId &&
        event.turnId === source.turnId &&
        (event.kind === 'turn:status' || event.kind === 'run:status') &&
        event.payload?.status === 'completed'
      ).map(event => ({
        turnId: source.turnId,
        eventKey: `${baselineKey}:${source.turnId}:${event.id ?? event.seq ?? event.createdAt}`
      }))
    })
    if (autoVerifyBaselineKeyRef.current !== baselineKey) {
      autoVerifyBaselineKeyRef.current = baselineKey
      completedPlanEvents.forEach(event => autoVerifySeenEventKeysRef.current.add(event.eventKey))
      return
    }
    const newPlanEvent = completedPlanEvents.find(event =>
      !autoVerifySeenEventKeysRef.current.has(event.eventKey) &&
      !autoVerifyTriggeredRef.current.has(`${activeDraft.id}:${event.turnId}`)
    )
    completedPlanEvents.forEach(event => autoVerifySeenEventKeysRef.current.add(event.eventKey))
    const turnId = newPlanEvent?.turnId
    if (!turnId) return
    autoVerifyTriggeredRef.current.add(`${activeDraft.id}:${turnId}`)
    triggerVerification()
  }, [activeDraft, draftContent, events, threadId, threadTodos, triggerVerification])

  // Filter drafts by search
  const filteredDrafts = useMemo(() => {
    if (!search.trim()) return drafts
    const needle = search.toLowerCase()
    return drafts.filter(d =>
      d.title.toLowerCase().includes(needle) ||
      d.id.toLowerCase().includes(needle)
    )
  }, [drafts, search])

  // Create new draft
  const handleCreate = async () => {
    if (!workspaceRoot || !newTitle.trim()) return
    try {
      const draft = await createNewDraft(workspaceRoot, newTitle.trim())
      if (!draft) return
      setNewTitle('')
      setShowCreateDialog(false)
      await refreshDrafts()
      // 自动打开新创建的需求
      setView('editor')
    } catch (error) {
      console.error('Failed to create draft:', error)
    }
  }

  // Delete draft
  const handleDelete = async (draftId: string) => {
    if (!workspaceRoot) return
    const ok = await styledConfirm({
      message: tr('删除这个需求草稿？该操作会移除需求文档、聊天记录和追踪快照。', 'Delete this requirement draft? This removes the requirement document, chat history, and trace snapshot.'),
      danger: true
    })
    if (!ok) return
    try {
      await deleteDraft(workspaceRoot, draftId)
      if (activeDraft?.id === draftId) {
        setView('list')
      }
      await refreshDrafts()
    } catch (error) {
      console.error('Failed to delete draft:', error)
    }
  }

  // Open draft
  const handleOpen = async (draftId: string) => {
    if (!workspaceRoot) return
    await loadDraft(workspaceRoot, draftId)
    setView('editor')
  }

  // Back to list
  const handleBack = () => {
    setView('list')
  }

  const handleSendAssistantMessage = useCallback(async (
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    mode: AssistantRequestMode = 'chat'
  ): Promise<string | { content: string; applyContext?: VerifyDraftSnapshot | AssistantRequirementApplyContext }> => {
    const store = useSddDraftStore.getState()
    const draft = store.activeDraft
    if (!draft) throw new Error('No active draft')
    let requestDraft = { ...draft, content: store.content }
    let requestBlocks = store.requirementBlocks

    let systemPrompt: string
    let userPrompt: string = message
    let verifySnapshot: VerifyDraftSnapshot | undefined

    if (mode === 'plan' || mode === 'verify') {
      const saved = await saveDraftToDisk()
      if (!saved) throw new Error(mode === 'plan' ? 'Failed to save draft before planning' : 'Failed to save draft before verification')
      await parseRequirementBlocks()
      const latest = useSddDraftStore.getState()
      const latestDraft = latest.activeDraft ?? draft
      requestDraft = { ...latestDraft, content: latest.content }
      requestBlocks = latest.requirementBlocks
      if (mode === 'plan') {
        const planResult = buildPlanPrompt({
          draft: requestDraft,
          blocks: requestBlocks,
          designContext: requestDraft.designContext
        })
        systemPrompt = planResult.systemPrompt
        userPrompt = planResult.userPrompt
      } else {
        verifySnapshot = {
          draftId: requestDraft.id,
          workspaceRoot: requestDraft.workspaceRoot,
          contentHash: hashVerifyContent(requestDraft.content)
        }
        const verifyResult = buildVerifyPrompt({
          draft: requestDraft,
          blocks: requestBlocks,
          evidenceSummary: buildVerifyEvidenceSummary({
            draftId: requestDraft.id,
            workspaceRoot: requestDraft.workspaceRoot,
            relativePath: requestDraft.relativePath,
            threadId,
            trace: latest.trace,
            todos: threadTodos,
            events
          }),
          planContent: latest.trace?.planItems.map(item => {
            const check = item.status === 'completed' ? 'x' : ' '
            return `- [${check}] ${item.text}${item.turnId ? ` (turn: ${item.turnId})` : ''}`
          }).join('\n')
        })
        systemPrompt = verifyResult.systemPrompt
        userPrompt = verifyResult.userPrompt
      }
      setAssistantMode('chat')
    } else {
      const result = buildAssistantPrompt(
        {
          draft: requestDraft,
          blocks: requestBlocks,
          designContext: requestDraft.designContext,
          history
        },
        message
      )
      systemPrompt = result.systemPrompt
      userPrompt = result.userPrompt
    }

    const result = await window.electronAPI.ai.quickComplete({
      prompt: userPrompt,
      systemPrompt,
      providerId: modelSelection?.source === 'provider' ? modelSelection.providerId : undefined,
      modelId: modelSelection?.source === 'provider' ? modelSelection.modelId : undefined,
      workspaceRoot: requestDraft.workspaceRoot
    })
    if (!result?.ok) throw new Error(result?.error || 'AI request failed')
    const content = result.content || ''
    if (mode === 'plan' && content.trim()) {
      await persistPlanTrace(content, requestDraft)
    }
    if (mode === 'chat' && content.trim()) {
      const latest = useSddDraftStore.getState()
      const latestDraft = latest.activeDraft
      if (!latestDraft) throw new Error('No active draft')
      const preview = previewAssistantRequirementResponse(latest.content, content)
      if (preview.changed) {
        return {
          content,
          applyContext: {
            kind: 'requirement-apply',
            draftId: latestDraft.id,
            workspaceRoot: latestDraft.workspaceRoot,
            contentHash: hashVerifyContent(latest.content),
            nextContent: preview.content,
            preview: {
              added: preview.added,
              removed: preview.removed
            }
          }
        }
      }
    }
    return verifySnapshot ? { content, applyContext: verifySnapshot } : content
  }, [events, refreshDrafts, threadId, threadTodos])

  const handleApplyAssistantRequirement = useCallback(async (applyContext?: unknown) => {
    if (!isAssistantRequirementApplyContext(applyContext)) {
      throw new Error('No pending requirement update to apply.')
    }
    const latest = useSddDraftStore.getState()
    const latestDraft = latest.activeDraft
    if (!latestDraft) throw new Error('No active draft')
    if (latestDraft.id !== applyContext.draftId || latestDraft.workspaceRoot !== applyContext.workspaceRoot) {
      throw new Error('This AI response belongs to a different requirement draft. Ask again for the current draft.')
    }
    if (hashVerifyContent(latest.content) !== applyContext.contentHash) {
      throw new Error('Requirement document changed after this AI response. Ask again before applying it.')
    }

    const previousBlocks = latest.requirementBlocks
    recordAiHistory(latestDraft, latest.content, 'assistant requirement writeback')
    latest.setContent(applyContext.nextContent)
    const saved = await saveDraftToDisk()
    if (!saved) throw new Error('Failed to save assistant requirement update')
    await parseRequirementBlocks()
    if (threadId) {
      const afterApply = useSddDraftStore.getState()
      const requirementBlocks = selectRequirementTodoBlocks(afterApply.requirementBlocks, previousBlocks, afterApply.content)
      const todoMarkdown = buildRequirementTodoMarkdown(requirementBlocks)
      await window.electronAPI.todos.syncFromMarkdown(threadId, todoMarkdown, {
        workspaceRoot: latestDraft.workspaceRoot,
        draftId: latestDraft.id,
        relativePath: latestDraft.relativePath
      })
      await onThreadTodosChanged?.(threadId)
    }
    if (workspaceRoot) await refreshDrafts()
  }, [onThreadTodosChanged, refreshDrafts, threadId, workspaceRoot])

  const handleSyncPlanTodos = useCallback(async (planMarkdown: string): Promise<ThreadTodo[]> => {
    if (!threadId) throw new Error(tr('需要先打开一个会话。', 'Open a thread first.'))
    const draft = useSddDraftStore.getState().activeDraft
    const todos = await window.electronAPI.todos.syncFromMarkdown(threadId, planMarkdown, draft ? {
      workspaceRoot: draft.workspaceRoot,
      draftId: draft.id,
      relativePath: draft.relativePath
    } : undefined)
    await onThreadTodosChanged?.(threadId)
    return todos
  }, [onThreadTodosChanged, threadId])

  const handleApplyVerification = useCallback(async (verificationMarkdown: string, applyContext?: unknown) => {
    const blocks = useSddDraftStore.getState().requirementBlocks
    const parsed = parseVerifyResponse(verificationMarkdown, blocks)
    const result = await applyVerifyVerdicts(parsed.verdicts, isVerifyDraftSnapshot(applyContext) ? applyContext : undefined)
    await refreshDrafts()
    return {
      appliedCount: result.appliedCount,
      verifiedRequirementIds: result.verifiedRequirementIds,
      warnings: [...parsed.warnings, ...result.warnings]
    }
  }, [refreshDrafts])

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  // 如果正在编辑，显示编辑器
  if (view === 'editor' && activeDraft) {
    const requirementsLayoutStyle = assistantOpen
      ? ({ '--sdd-assistant-width': `${assistantWidth}px` } as React.CSSProperties)
      : undefined

    return (
      <div
        className={`sdd-requirements-full ${assistantOpen ? 'sdd-with-assistant' : ''} ${assistantResizing ? 'sdd-assistant-resizing' : ''}`}
        style={requirementsLayoutStyle}
      >
        <SddDraftEditor
          providers={providers}
          modelSelection={modelSelection}
          onModelSelectionChange={onModelSelectionChange}
          onClose={handleBack}
          onOpenAssistant={() => setAssistantOpen(!assistantOpen)}
          onSendToChat={onSendRequirementToChat ? handleSendRequirementToChat : undefined}
          onSyncToTodo={handleSyncDocumentTodos}
          onNext={() => {
            // 触发计划生成：切换到计划模式并打开 AI 助手面板
            if (!draftContent) return
            setAssistantMode('plan')
            setAssistantTriggerNonce(value => value + 1)
            setAssistantOpen(true)
          }}
          onVerify={() => {
            triggerVerification()
          }}
          nextDisabled={!draftContent}
          verifyDisabled={!draftContent}
          sendToChatDisabled={!draftContent}
          syncToTodoDisabled={!draftContent}
          syncingTodo={syncingDocumentTodo}
          syncTodoStatus={syncDocumentTodoStatus}
        />
        {assistantOpen && (
          <div
            className="sdd-assistant-resize-handle"
            role="separator"
            aria-label={tr('Resize requirements AI panel', 'Resize requirements AI panel')}
            aria-orientation="vertical"
            aria-valuemin={ASSISTANT_MIN_WIDTH}
            aria-valuemax={ASSISTANT_MAX_WIDTH}
            aria-valuenow={assistantWidth}
            tabIndex={0}
            title={tr('拖拽调整需求 AI 面板宽度', 'Drag to resize Requirements AI panel')}
            onPointerDown={startAssistantResize}
            onKeyDown={handleAssistantResizeKeyDown}
          />
        )}
        {assistantOpen && (
          <SddAssistantPanel
            draftId={activeDraft.id}
            workspaceRoot={activeDraft.workspaceRoot}
            providers={providers}
            modelSelection={modelSelection}
            onModelSelectionChange={onModelSelectionChange}
            initialMessage={
              assistantMode === 'plan'
                ? PLAN_GENERATION_TRIGGER_MESSAGE
                : assistantMode === 'verify'
                  ? VERIFY_TRIGGER_MESSAGE
                  : undefined
            }
            initialMessageKey={assistantMode === 'chat' ? undefined : `${assistantMode}-${assistantTriggerNonce}`}
            initialMode={assistantMode}
            onSendMessage={handleSendAssistantMessage}
            threadId={threadId}
            onSyncPlanTodos={handleSyncPlanTodos}
            onApplyVerification={handleApplyVerification}
            onApplyRequirementResponse={handleApplyAssistantRequirement}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </div>
    )
  }

  if (!workspaceRoot) {
    return (
      <div className="sdd-empty-state">
        <Icon d={IC.folder} size={48} />
        <h3>{tr('没有选择工作区', 'No workspace selected')}</h3>
        <p>{tr('请先选择一个工作区来管理需求', 'Please select a workspace to manage requirements')}</p>
      </div>
    )
  }

  return (
    <div className="sdd-requirements-full sdd-list-mode">
      <div className="sdd-requirements-list">
      {/* Header */}
      <div className="sdd-requirements-header">
        <div className="sdd-requirements-title">
          <Icon d={IC.file} size={24} />
          <h2>{tr('需求管理', 'Requirements')}</h2>
          <span className="sdd-requirements-count">{drafts.length}</span>
        </div>
        <button
          className="ah-btn primary"
          onClick={() => setShowCreateDialog(true)}
        >
          <Icon d={IC.plus} size={16} />
          {tr('新建需求', 'New Requirement')}
        </button>
      </div>

      {/* Search */}
      <div className="sdd-requirements-search">
        <Icon d={IC.search} size={16} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr('搜索需求...', 'Search requirements...')}
        />
      </div>

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="sdd-create-dialog">
          <div className="sdd-create-dialog-content">
            <h3>{tr('创建新需求', 'Create New Requirement')}</h3>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={tr('输入需求标题...', 'Enter requirement title...')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowCreateDialog(false)
              }}
            />
            <div className="sdd-create-dialog-actions">
              <button className="ah-btn" onClick={() => setShowCreateDialog(false)}>
                {tr('取消', 'Cancel')}
              </button>
              <button
                className="ah-btn primary"
                onClick={handleCreate}
                disabled={!newTitle.trim()}
              >
                {tr('创建', 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drafts List */}
      <div className="sdd-drafts-container">
        {loading && (
          <div className="sdd-loading">
            {tr('加载中...', 'Loading...')}
          </div>
        )}

        {!loading && filteredDrafts.length === 0 && (
          <div className="sdd-empty-state">
            <Icon d={IC.file} size={32} />
            <p>{tr('没有找到需求，点击"新建需求"开始', 'No requirements found, click "New Requirement" to start')}</p>
          </div>
        )}

        {filteredDrafts.map(draft => (
          <div
            key={draft.id}
            className={`sdd-draft-card ${activeDraft?.id === draft.id ? 'active' : ''}`}
            onClick={() => handleOpen(draft.id)}
          >
            <div className="sdd-draft-card-header">
              <Icon d={IC.file} size={18} />
              <span className="sdd-draft-card-title">{draft.title}</span>
              <button
                className="sdd-draft-card-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(draft.id)
                }}
                title={tr('删除', 'Delete')}
              >
                <Icon d={IC.trash} size={14} />
              </button>
            </div>
            <div className="sdd-draft-card-meta">
              <span className="sdd-draft-card-date">
                {formatDate(draft.updatedAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}
