/**
 * SDD Assistant Panel - AI 助手面板
 *
 * 参照 kun 的 SddAssistantPanel 设计
 * 提供 AI 对话、PM 技能框架、消息输入功能
 */

import React, { useState, useRef, useEffect } from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import type { ProviderDef } from '../../glass/meta'
import { MarkdownBlock } from '../../workbench/MarkdownBlock'
import {
  SDD_FRAMEWORK_GROUPS,
  frameworksForStage,
  type SddWorkflowStage,
  type SddPmFramework
} from '../pm-skill-frameworks'
import { parseVerifyResponse } from '../sdd-verify-prompt'
import {
  createAssistantHistorySession,
  getAssistantHistory,
  getAssistantHistoryState,
  saveAssistantHistory,
  setActiveAssistantHistorySession,
  type SddAssistantHistoryState
} from '../sdd-assistant-history'

// ============================================================
// Types
// ============================================================

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  mode?: 'chat' | 'plan' | 'verify'
  applyContext?: unknown
}

interface RequirementApplyContextLike {
  kind: 'requirement-apply'
  preview?: {
    added?: string[]
    removed?: string[]
  }
}

type RequirementApplyState = 'applying' | 'applied' | 'failed' | 'discarded'

interface RequirementApplyStatus {
  state: RequirementApplyState
  text: string
}

interface SddAssistantPanelProps {
  draftId: string
  workspaceRoot: string
  providers?: ProviderDef[]
  modelSelection?: ModelSelection | null
  onModelSelectionChange?: (selection: ModelSelection | null) => void
  onSendMessage?: (
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    mode?: 'chat' | 'plan' | 'verify'
  ) => Promise<string | { content: string; applyContext?: unknown }>
  onApplyFramework?: (framework: SddPmFramework) => void
  onClose?: () => void
  initialMessage?: string
  initialMessageKey?: string | number
  initialMode?: 'chat' | 'plan' | 'verify'
  threadId?: string | null
  onSyncPlanTodos?: (planMarkdown: string) => Promise<ThreadTodo[]>
  onApplyVerification?: (verificationMarkdown: string, applyContext?: unknown) => Promise<{
    appliedCount: number
    verifiedRequirementIds: string[]
    warnings: string[]
  }>
  onApplyRequirementResponse?: (applyContext?: unknown) => Promise<void>
}

interface SddModelOption {
  providerId: string
  modelId: string
  label: string
}

// ============================================================
// Framework Icons
// ============================================================

type AssistantIconName =
  | 'question'
  | 'lightbulb'
  | 'search'
  | 'users'
  | 'tree'
  | 'inbox'
  | 'checks'
  | 'layout'
  | 'quote'
  | 'file'
  | 'spell'
  | 'shield'
  | 'sliders'
  | 'warning'
  | 'flask'
  | 'sparkles'
  | 'send'

const FRAMEWORK_ICONS: Record<string, AssistantIconName> = {
  clarify: 'lightbulb',
  research: 'search',
  'brainstorm-ideas': 'users',
  'opportunity-tree': 'tree',
  'triage-requests': 'inbox',
  structure: 'checks',
  wwa: 'layout',
  'job-stories': 'quote',
  prd: 'file',
  polish: 'spell',
  assumptions: 'shield',
  'prioritize-assumptions': 'sliders',
  'pre-mortem': 'warning',
  experiments: 'flask'
}

const STAGE_COLORS: Record<SddWorkflowStage, string> = {
  discover: 'sdd-stage-discover',
  structure: 'sdd-stage-structure',
  risk: 'sdd-stage-risk'
}

function verificationSummary(markdown: string): {
  pass: number
  fail: number
  unknown: number
  warnings: string[]
} {
  const parsed = parseVerifyResponse(markdown)
  return {
    pass: parsed.verdicts.filter(verdict => verdict.status === 'pass').length,
    fail: parsed.verdicts.filter(verdict => verdict.status === 'fail').length,
    unknown: parsed.verdicts.filter(verdict => verdict.status === 'unknown').length,
    warnings: parsed.warnings
  }
}

function isRequirementApplyContext(value: unknown): value is RequirementApplyContextLike {
  return !!value && typeof value === 'object' && (value as Partial<RequirementApplyContextLike>).kind === 'requirement-apply'
}

const ICON_PATHS: Record<AssistantIconName, string[]> = {
  question: ['M9 9a3 3 0 1 1 5.1 2.1c-.9.8-2.1 1.2-2.1 2.9', 'M12 17h.01', 'M6 3h9l3 3v15H6z'],
  lightbulb: ['M9 18h6', 'M10 22h4', 'M8.5 14.5a5 5 0 1 1 7 0c-.8.8-1.5 1.9-1.5 3.5h-4c0-1.6-.7-2.7-1.5-3.5z'],
  search: ['M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z', 'M21 21l-4.3-4.3'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  tree: ['M12 3v5', 'M6 13h12', 'M6 13v5', 'M18 13v5', 'M12 8v5', 'M4 18h4v3H4z', 'M10 18h4v3h-4z', 'M16 18h4v3h-4z'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z'],
  checks: ['M4 7l2 2 4-4', 'M4 17l2 2 4-4', 'M13 6h7', 'M13 16h7'],
  layout: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  quote: ['M8 11H5a4 4 0 0 1 4-4v2a2 2 0 0 0-2 2h2v6H5v-6', 'M18 11h-3a4 4 0 0 1 4-4v2a2 2 0 0 0-2 2h2v6h-4v-6'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6'],
  spell: ['M5 20l6-16 6 16', 'M8 14h6', 'M18 5l2 2 3-4'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M12 8v5', 'M12 16h.01'],
  sliders: ['M4 6h10', 'M18 6h2', 'M14 4v4', 'M4 12h2', 'M10 12h10', 'M8 10v4', 'M4 18h12', 'M20 18h0', 'M16 16v4'],
  warning: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  flask: ['M9 2h6', 'M10 2v6l-5.5 9.5A3 3 0 0 0 7.1 22h9.8a3 3 0 0 0 2.6-4.5L14 8V2', 'M8 16h8'],
  sparkles: ['M12 3l1.6 4.8L18 10l-4.4 2.2L12 17l-1.6-4.8L6 10l4.4-2.2z', 'M20 3v4', 'M22 5h-4', 'M4 17v3', 'M5.5 18.5h-3'],
  send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z']
}

function AssistantIcon({ name, size = 18 }: { name: AssistantIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

function availableSddModels(providers: ProviderDef[] = []): SddModelOption[] {
  return providers.flatMap(provider => {
    if (!provider.enabled || !provider.apiKey || provider.apiKeyLocked || !provider.models?.length) return []
    return provider.models
      .filter(model => model.enabled !== false)
      .map(model => ({
        providerId: provider.id,
        modelId: model.id,
        label: `${provider.name} / ${model.label || model.id}`
      }))
  })
}

export function SddModelSelect({
  providers = [],
  modelSelection,
  onModelSelectionChange,
  compact = false
}: {
  providers?: ProviderDef[]
  modelSelection?: ModelSelection | null
  onModelSelectionChange?: (selection: ModelSelection | null) => void
  compact?: boolean
}) {
  const options = availableSddModels(providers)
  const selectedValue = modelSelection?.source === 'provider'
    ? `${modelSelection.providerId}::${modelSelection.modelId}`
    : ''
  if (!onModelSelectionChange) return null

  return (
    <label className={`sdd-model-select ${compact ? 'compact' : ''}`} title={tr('选择需求 AI 使用的供应商模型', 'Choose the provider model used by Requirements AI')}>
      <span>{tr('模型', 'Model')}</span>
      <select
        value={selectedValue}
        onChange={(event) => {
          const value = event.target.value
          if (!value) {
            onModelSelectionChange(null)
            return
          }
          const [providerId, modelId] = value.split('::')
          onModelSelectionChange({ providerId, modelId, source: 'provider' })
        }}
      >
        <option value="">{tr('默认供应商', 'Default provider')}</option>
        {options.map(option => (
          <option key={`${option.providerId}::${option.modelId}`} value={`${option.providerId}::${option.modelId}`}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ============================================================
// Component
// ============================================================

export function SddAssistantPanel({
  draftId,
  workspaceRoot,
  providers,
  modelSelection,
  onModelSelectionChange,
  onSendMessage,
  onApplyFramework,
  onClose,
  initialMessage,
  initialMessageKey,
  initialMode = 'chat',
  threadId,
  onSyncPlanTodos,
  onApplyVerification,
  onApplyRequirementResponse
}: SddAssistantPanelProps) {
  const assistantHistoryScope = `${workspaceRoot || ''}::${draftId}`
  const [historyState, setHistoryState] = useState<SddAssistantHistoryState>(() => getAssistantHistoryState(draftId, workspaceRoot))
  const [messages, setMessages] = useState<ChatMessage[]>(() => getAssistantHistory(draftId, workspaceRoot))
  const [loadedHistoryScope, setLoadedHistoryScope] = useState(assistantHistoryScope)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncingMessageId, setSyncingMessageId] = useState<string | null>(null)
  const [syncStatusByMessageId, setSyncStatusByMessageId] = useState<Record<string, string>>({})
  const [applyingVerifyMessageId, setApplyingVerifyMessageId] = useState<string | null>(null)
  const [verifyStatusByMessageId, setVerifyStatusByMessageId] = useState<Record<string, string>>({})
  const [applyingRequirementMessageId, setApplyingRequirementMessageId] = useState<string | null>(null)
  const [requirementStatusByMessageId, setRequirementStatusByMessageId] = useState<Record<string, RequirementApplyStatus>>({})
  const [previewRequirementMessageId, setPreviewRequirementMessageId] = useState<string | null>(null)
  const [discardedRequirementMessageIds, setDiscardedRequirementMessageIds] = useState<Set<string>>(() => new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const msgIdCounter = useRef(0)
  const initialMessageSentFor = useRef<string | null>(null)
  const onSendMessageRef = useRef(onSendMessage)
  const mountedRef = useRef(false)

  useEffect(() => {
    onSendMessageRef.current = onSendMessage
  }, [onSendMessage])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const restoredState = getAssistantHistoryState(draftId, workspaceRoot)
    setHistoryState(restoredState)
    setMessages(getAssistantHistory(draftId, workspaceRoot, restoredState.activeSessionId))
    setLoadedHistoryScope(assistantHistoryScope)
    setSyncStatusByMessageId({})
    setVerifyStatusByMessageId({})
    setRequirementStatusByMessageId({})
    setPreviewRequirementMessageId(null)
    setDiscardedRequirementMessageIds(new Set())
  }, [assistantHistoryScope, draftId, workspaceRoot])

  useEffect(() => {
    if (loadedHistoryScope !== assistantHistoryScope) return
    const nextState = saveAssistantHistory(draftId, workspaceRoot, messages, historyState.activeSessionId)
    setHistoryState(nextState)
  }, [assistantHistoryScope, draftId, historyState.activeSessionId, loadedHistoryScope, messages, workspaceRoot])

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-send initial message (e.g. for plan generation mode)
  useEffect(() => {
    if (!initialMessage) {
      initialMessageSentFor.current = null
      return
    }
    const sendKey = String(initialMessageKey ?? initialMessage)
    if (initialMessageSentFor.current === sendKey || !onSendMessageRef.current) return
    setInput(initialMessage)
    // 使用 setTimeout 确保 state 已更新后再触发发送
    const timer = setTimeout(() => {
      if (!mountedRef.current || initialMessageSentFor.current === sendKey) return
      initialMessageSentFor.current = sendKey
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-${++msgIdCounter.current}`,
        role: 'user',
        content: initialMessage,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, userMessage])
      setInput('')
      setBusy(true)
      const sendInitialMessage = onSendMessageRef.current
      if (!sendInitialMessage) {
        setBusy(false)
        return
      }
      sendInitialMessage(initialMessage, [], initialMode)
        .then(response => {
          if (!mountedRef.current) return
          const responseContent = typeof response === 'string' ? response : response.content
          const assistantMessage: ChatMessage = {
            id: `msg-${Date.now()}-${++msgIdCounter.current}`,
            role: 'assistant',
            content: responseContent,
            timestamp: new Date().toISOString(),
            mode: initialMode,
            applyContext: typeof response === 'string' ? undefined : response.applyContext
          }
          setMessages(prev => [...prev, assistantMessage])
        })
        .catch(error => {
          if (!mountedRef.current) return
          const errorMessage: ChatMessage = {
            id: `msg-${Date.now()}-${++msgIdCounter.current}`,
            role: 'assistant',
            content: `Error: ${error?.message || String(error)}`,
            timestamp: new Date().toISOString()
          }
          setMessages(prev => [...prev, errorMessage])
        })
        .finally(() => { if (mountedRef.current) setBusy(false) })
    }, 0)
    // Only cancel the scheduled send. Once started, parent rerenders must not
    // cancel the in-flight request; mountedRef guards unmounts.
    return () => {
      clearTimeout(timer)
    }
  }, [initialMessage, initialMessageKey, initialMode, !!onSendMessage])

  // Send message
  const handleSend = async () => {
    if (!input.trim() || busy || !onSendMessage) return

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${++msgIdCounter.current}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setBusy(true)

    try {
      // 传递对话历史给 AI，支持多轮对话上下文
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const response = await onSendMessage(userMessage.content, history, 'chat')
      const responseContent = typeof response === 'string' ? response : response.content
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-${++msgIdCounter.current}`,
        role: 'assistant',
        content: responseContent,
        timestamp: new Date().toISOString(),
        mode: 'chat',
        applyContext: typeof response === 'string' ? undefined : response.applyContext
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error: any) {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-${++msgIdCounter.current}`,
        role: 'assistant',
        content: `Error: ${error?.message || String(error)}`,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setBusy(false)
    }
  }

  // Apply framework
  const handleApplyFramework = (framework: SddPmFramework) => {
    if (onApplyFramework) {
      onApplyFramework(framework)
    } else {
      // 默认行为：将框架 prompt 作为用户消息发送
      setInput(framework.prompt)
    }
  }

  const resetSessionActionState = () => {
    setSyncingMessageId(null)
    setSyncStatusByMessageId({})
    setApplyingVerifyMessageId(null)
    setVerifyStatusByMessageId({})
    setApplyingRequirementMessageId(null)
    setRequirementStatusByMessageId({})
    setPreviewRequirementMessageId(null)
    setDiscardedRequirementMessageIds(new Set())
  }

  const handleStartNewHistorySession = () => {
    if (busy) return
    saveAssistantHistory(draftId, workspaceRoot, messages, historyState.activeSessionId)
    const nextState = createAssistantHistorySession(draftId, workspaceRoot)
    const nextMessages = getAssistantHistory(draftId, workspaceRoot, nextState.activeSessionId)
    setHistoryState(nextState)
    setMessages(nextMessages)
    setInput('')
    resetSessionActionState()
  }

  const handleSelectHistorySession = (sessionId: string) => {
    if (busy || sessionId === historyState.activeSessionId) return
    saveAssistantHistory(draftId, workspaceRoot, messages, historyState.activeSessionId)
    const nextState = setActiveAssistantHistorySession(draftId, workspaceRoot, sessionId)
    const nextSession = nextState.sessions.find(session => session.id === nextState.activeSessionId)
    setHistoryState(nextState)
    setMessages(nextSession?.messages ?? [])
    setInput('')
    resetSessionActionState()
  }

  const handleSyncPlanTodos = async (message: ChatMessage) => {
    if (!onSyncPlanTodos || !threadId || message.mode !== 'plan') return
    setSyncingMessageId(message.id)
    setSyncStatusByMessageId(prev => ({ ...prev, [message.id]: tr('同步中...', 'Syncing...') }))
    try {
      const todos = await onSyncPlanTodos(message.content)
      setSyncStatusByMessageId(prev => ({
        ...prev,
        [message.id]: todos.length > 0
          ? tr(`已同步 ${todos.length} 个 Todo`, `Synced ${todos.length} todos`)
          : tr('没有解析到 Todo，请检查计划是否包含 - [ ] 清单', 'No todos parsed. Use - [ ] checklist items in the plan.')
      }))
    } catch (error: any) {
      setSyncStatusByMessageId(prev => ({
        ...prev,
        [message.id]: error?.message || tr('同步失败', 'Sync failed')
      }))
    } finally {
      setSyncingMessageId(null)
    }
  }

  const handleApplyVerification = async (message: ChatMessage) => {
    if (!onApplyVerification || message.mode !== 'verify') return
    setApplyingVerifyMessageId(message.id)
    setVerifyStatusByMessageId(prev => ({ ...prev, [message.id]: tr('Applying...', 'Applying...') }))
    try {
      const result = await onApplyVerification(message.content, message.applyContext)
      const warningSuffix = result.warnings.length > 0
        ? tr(`, ${result.warnings.length} warnings`, `, ${result.warnings.length} warnings`)
        : ''
      setVerifyStatusByMessageId(prev => ({
        ...prev,
        [message.id]: tr(
          `Applied ${result.appliedCount} passing criteria${warningSuffix}`,
          `Applied ${result.appliedCount} passing criteria${warningSuffix}`
        )
      }))
    } catch (error: any) {
      setVerifyStatusByMessageId(prev => ({
        ...prev,
        [message.id]: error?.message || tr('Apply failed', 'Apply failed')
      }))
    } finally {
      setApplyingVerifyMessageId(null)
    }
  }

  const handleApplyRequirementResponse = async (message: ChatMessage) => {
    if (!onApplyRequirementResponse || !isRequirementApplyContext(message.applyContext)) return
    setApplyingRequirementMessageId(message.id)
    setRequirementStatusByMessageId(prev => ({
      ...prev,
      [message.id]: { state: 'applying', text: tr('Applying...', 'Applying...') }
    }))
    try {
      await onApplyRequirementResponse(message.applyContext)
      setRequirementStatusByMessageId(prev => ({
        ...prev,
        [message.id]: { state: 'applied', text: tr('Applied to document', 'Applied to document') }
      }))
    } catch (error: any) {
      setRequirementStatusByMessageId(prev => ({
        ...prev,
        [message.id]: { state: 'failed', text: error?.message || tr('Apply failed', 'Apply failed') }
      }))
    } finally {
      setApplyingRequirementMessageId(null)
    }
  }

  const handleDiscardRequirementResponse = (message: ChatMessage) => {
    setDiscardedRequirementMessageIds(prev => new Set(prev).add(message.id))
    setPreviewRequirementMessageId(current => current === message.id ? null : current)
    setRequirementStatusByMessageId(prev => ({
      ...prev,
      [message.id]: { state: 'discarded', text: tr('Discarded', 'Discarded') }
    }))
  }

  // Format timestamp
  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const hasMessages = messages.length > 0
  const activeSessionId = historyState.activeSessionId

  return (
    <aside className="sdd-assistant-panel">
      <div className="sdd-assistant-history-sidebar" aria-label={tr('历史对话', 'Chat history')}>
        <div className="sdd-assistant-history-header">
          <span>{tr('历史对话', 'History')}</span>
          <button
            type="button"
            className="sdd-assistant-history-new"
            onClick={handleStartNewHistorySession}
            disabled={busy}
            title={tr('新开一个需求 AI 对话', 'Start a new Requirements AI chat')}
          >
            +
          </button>
        </div>
        <div className="sdd-assistant-history-list">
          {historyState.sessions.map((session) => {
            const lastMessage = session.messages[session.messages.length - 1]
            const previewContent = lastMessage?.content?.replace(/\s+/g, ' ').trim()
            const preview = previewContent
              ? `${lastMessage.role === 'user' ? tr('用户', 'User') : 'AI'} · ${previewContent}`
              : tr('空白对话', 'Empty chat')
            return (
              <button
                key={session.id}
                type="button"
                className={`sdd-assistant-history-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => handleSelectHistorySession(session.id)}
                disabled={busy}
                aria-current={session.id === activeSessionId ? 'true' : undefined}
              >
                <span className="sdd-assistant-history-title">{session.title}</span>
                <span className="sdd-assistant-history-preview">{preview}</span>
                <span className="sdd-assistant-history-meta">
                  {formatTime(session.updatedAt)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="sdd-assistant-main">
      <div className="sdd-assistant-header">
        <div className="sdd-assistant-header-content">
          {onClose && (
            <button className="sdd-assistant-close" onClick={onClose} title={tr('关闭', 'Close')}>
              <Icon d={IC.x} size={16} />
            </button>
          )}
          <div className="sdd-assistant-title">
            <span className="sdd-assistant-sparkle"><AssistantIcon name="sparkles" size={17} /></span>
            <span>{tr('需求 AI', 'Requirements AI')}</span>
          </div>
          <SddModelSelect
            providers={providers}
            modelSelection={modelSelection}
            onModelSelectionChange={onModelSelectionChange}
            compact
          />
        </div>
        <div className="sdd-assistant-path">
          {workspaceRoot}
        </div>
      </div>

      <div className="sdd-assistant-body">
        {hasMessages ? (
          <div className="sdd-assistant-timeline">
            {messages.map((msg) => (
              <div key={msg.id} className={`sdd-message sdd-message-${msg.role}`}>
                <div className="sdd-message-header">
                  <span className="sdd-message-role">
                    {msg.role === 'user' ? '👤' : '✨'}
                    {msg.role === 'user' ? tr('用户', 'User') : tr('AI 助手', 'AI Assistant')}
                  </span>
                  <span className="sdd-message-time">{formatTime(msg.timestamp)}</span>
                </div>
                <div className="sdd-message-content">
                  {msg.role === 'assistant'
                    ? <MarkdownBlock content={msg.content} workspaceRoot={workspaceRoot} />
                    : msg.content}
                </div>
                {msg.role === 'assistant' && msg.mode === 'plan' && (
                  <div className="sdd-message-actions">
                    <button
                      type="button"
                      className="sdd-message-action"
                      onClick={() => handleSyncPlanTodos(msg)}
                      disabled={!threadId || !onSyncPlanTodos || syncingMessageId === msg.id}
                      title={threadId ? tr('同步计划清单到当前会话 Todo', 'Sync plan checklist to current thread todos') : tr('需要先打开一个会话', 'Open a thread first')}
                    >
                      <Icon d={IC.check} size={14} />
                      <span>{syncingMessageId === msg.id ? tr('同步中', 'Syncing') : tr('同步到 Todo', 'Sync to Todo')}</span>
                    </button>
                    {syncStatusByMessageId[msg.id] && (
                      <span className="sdd-message-action-status">{syncStatusByMessageId[msg.id]}</span>
                    )}
                  </div>
                )}
                {msg.role === 'assistant' && msg.mode === 'verify' && (
                  <div className="sdd-message-actions">
                    {(() => {
                      const summary = verificationSummary(msg.content)
                      return (
                        <div className="sdd-verify-summary" aria-label={tr('Verification summary', 'Verification summary')}>
                          <span className="sdd-verify-summary-pill pass">{tr(`Pass ${summary.pass}`, `Pass ${summary.pass}`)}</span>
                          <span className="sdd-verify-summary-pill fail">{tr(`Fail ${summary.fail}`, `Fail ${summary.fail}`)}</span>
                          <span className="sdd-verify-summary-pill unknown">{tr(`Unknown ${summary.unknown}`, `Unknown ${summary.unknown}`)}</span>
                          {summary.warnings.length > 0 && (
                            <span className="sdd-verify-summary-warning">{tr(`${summary.warnings.length} parse warnings`, `${summary.warnings.length} parse warnings`)}</span>
                          )}
                        </div>
                      )
                    })()}
                    <button
                      type="button"
                      className="sdd-message-action"
                      onClick={() => handleApplyVerification(msg)}
                      disabled={!onApplyVerification || applyingVerifyMessageId === msg.id}
                      title={tr('Write passing AI verification criteria back to the requirement document', 'Write passing AI verification criteria back to the requirement document')}
                    >
                      <Icon d={IC.check} size={14} />
                      <span>{applyingVerifyMessageId === msg.id ? tr('Applying', 'Applying') : tr('Apply passed', 'Apply passed')}</span>
                    </button>
                    {verifyStatusByMessageId[msg.id] && (
                      <span className="sdd-message-action-status">{verifyStatusByMessageId[msg.id]}</span>
                    )}
                  </div>
                )}
                {msg.role === 'assistant' && msg.mode === 'chat' && isRequirementApplyContext(msg.applyContext) && (
                  <div className="sdd-message-actions">
                    {(() => {
                      const requirementStatus = requirementStatusByMessageId[msg.id]
                      const requirementAlreadyApplied = requirementStatus?.state === 'applied'
                      const requirementDiscarded = requirementStatus?.state === 'discarded' || discardedRequirementMessageIds.has(msg.id)
                      return (
                        <>
                    <button
                      type="button"
                      className="sdd-message-action neutral"
                      onClick={() => setPreviewRequirementMessageId(current => current === msg.id ? null : msg.id)}
                    >
                      <Icon d={IC.file} size={14} />
                      <span>{previewRequirementMessageId === msg.id ? tr('Hide preview', 'Hide preview') : tr('Preview changes', 'Preview changes')}</span>
                    </button>
                    <button
                      type="button"
                      className="sdd-message-action"
                      onClick={() => handleApplyRequirementResponse(msg)}
                      disabled={!onApplyRequirementResponse || applyingRequirementMessageId === msg.id || requirementAlreadyApplied || requirementDiscarded}
                      title={tr('Apply this AI response to the requirement document', 'Apply this AI response to the requirement document')}
                    >
                      <Icon d={IC.check} size={14} />
                      <span>{applyingRequirementMessageId === msg.id ? tr('Applying', 'Applying') : tr('Apply to document', 'Apply to document')}</span>
                    </button>
                    <button
                      type="button"
                      className="sdd-message-action danger"
                      onClick={() => handleDiscardRequirementResponse(msg)}
                      disabled={requirementAlreadyApplied || requirementDiscarded}
                    >
                      <Icon d={IC.x} size={14} />
                      <span>{tr('Discard', 'Discard')}</span>
                    </button>
                    {requirementStatus && (
                      <span className="sdd-message-action-status">{requirementStatus.text}</span>
                    )}
                        </>
                      )
                    })()}
                    {previewRequirementMessageId === msg.id && (
                      <div className="sdd-requirement-preview">
                        {(msg.applyContext.preview?.added?.length ?? 0) > 0 && (
                          <div className="sdd-requirement-preview-column">
                            <span className="sdd-requirement-preview-title">{tr('Will add', 'Will add')}</span>
                            {msg.applyContext.preview?.added?.slice(0, 8).map((line, index) => (
                              <code key={`add-${index}`}>+ {line}</code>
                            ))}
                          </div>
                        )}
                        {(msg.applyContext.preview?.removed?.length ?? 0) > 0 && (
                          <div className="sdd-requirement-preview-column">
                            <span className="sdd-requirement-preview-title">{tr('Will remove', 'Will remove')}</span>
                            {msg.applyContext.preview?.removed?.slice(0, 8).map((line, index) => (
                              <code key={`remove-${index}`}>- {line}</code>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="sdd-message sdd-message-assistant">
                <div className="sdd-message-header">
                  <span className="sdd-message-role">✨ {tr('AI 助手', 'AI Assistant')}</span>
                </div>
                <div className="sdd-message-content sdd-message-loading">
                  {tr('思考中...', 'Thinking...')}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="sdd-assistant-empty">
            <div className="sdd-assistant-empty-card">
              <div className="sdd-assistant-empty-icon">
                <AssistantIcon name="question" size={22} />
              </div>
              <h3>{tr('一起把需求问清楚', 'Let’s clarify the requirement')}</h3>
              <p>{tr('可以让 AI 帮你调研、补问题、整理边界，然后再进入计划。', 'AI can research, ask missing questions, organize boundaries, then move into planning.')}</p>
            </div>

            <div className="sdd-assistant-frameworks">
              {SDD_FRAMEWORK_GROUPS.map((group) => {
                const frameworks = frameworksForStage(group.stage)
                if (frameworks.length === 0) return null
                return (
                  <div key={group.stage} className="sdd-framework-group">
                    <span className="sdd-framework-group-title">
                      {group.title}
                    </span>
                    <span className="sdd-framework-group-desc">
                      {group.description}
                    </span>
                    <div className="sdd-framework-items">
                      {frameworks.map((framework) => (
                        <button
                          key={framework.id}
                          className={`sdd-framework-item ${STAGE_COLORS[framework.stage]}`}
                          onClick={() => handleApplyFramework(framework)}
                        >
                          <span className="sdd-framework-icon">
                            <AssistantIcon name={FRAMEWORK_ICONS[framework.id] || 'sparkles'} size={18} />
                          </span>
                          <span className="sdd-framework-copy">
                            <span className="sdd-framework-name">
                              {framework.name}
                            </span>
                            <span className="sdd-framework-subtitle">
                              {framework.subtitle}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="sdd-assistant-composer">
        <div className="sdd-composer-input-wrapper">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr('向智能体提问...', 'Ask the assistant...')}
            rows={3}
            disabled={busy}
            className="sdd-composer-textarea"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
        </div>
        <div className="sdd-composer-footer">
          <div className="sdd-composer-hints">
            <span className="sdd-composer-hint">{tr('Enter 发送', 'Enter to send')}</span>
            <span className="sdd-composer-hint">{tr('Shift+Enter 换行', 'Shift+Enter for newline')}</span>
          </div>
          <button
            className="sdd-composer-send"
            onClick={handleSend}
            disabled={busy || !input.trim()}
          >
            {busy ? (
              <span className="sdd-composer-send-loading">{tr('发送中...', 'Sending...')}</span>
            ) : (
              <>
                <AssistantIcon name="send" size={15} />
              </>
            )}
          </button>
        </div>
      </div>
      </div>
    </aside>
  )
}
