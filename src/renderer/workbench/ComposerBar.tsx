import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, IC, AgentMark } from '../glass/ui'
import { getLang, tr } from '../glass/i18n'
import { AGENT_META } from '../glass/meta'
import type { AgentUIStatus, BindingDef, ProviderDef } from '../glass/meta'
import { WorkspaceItem } from './types'
import { normalizeScheduleForStorage } from './customSchedule'
import { localAgentLabel, localAgentOptions } from './localAgentOptions'
import { formatContextWindow } from './contextCapacity'
import { PromptEnhancer } from './PromptEnhancer'
import { DecisionBar, type DecisionBarSubmitResult } from './decisions/DecisionBar'
import type { DecisionItem, DraftDecisionItem } from './decisions/decisionAdapters'
import type { DecisionSubmission } from '../../shared/decision-contract'
import { defaultDialogPath, rememberDialogPath } from '../appearance'
import {
  addPaletteQuery,
  commandTextForSelection,
  currentTextHasCommandArgs,
  filterCommands,
  normalizeCommandToken,
  rankCommandsForPalette,
  replaceAddToken,
  shouldRunComposerCommand,
  slashCommandQuery
} from './utils/composerCommandUtils'
import { fileToAttachment, formatBytes, pickedFilePathsToAttachments } from './utils/composerAttachments'
import {
  buildBaseAddItems,
  buildPluginAddItems,
  composerAddSectionLabel,
  filterComposerAddItems,
  groupComposerAddItems,
  pluginAddItemToAttachment,
  safeMentionToken,
  type ComposerAddItem
} from './utils/composerAddItems'
import {
  approvalDisplayModeDetail,
  approvalDisplayModeFromConfig,
  approvalDisplayModeLabel,
  approvalPresetForDisplayMode,
  type ApprovalDisplayMode
} from './utils/approvalMode'

type ComposerThinkingConfig = { mode: 'off' | 'auto' | 'enabled'; level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; collapseInUI?: boolean; budgetTokens?: number }
type PickerAgentRow =
  | { source: 'local-agent'; id: string; label: string; subtitle: string; agentId: string }
  | { source: 'provider-agent'; id: string; label: string; subtitle: string; providerId: string; modelCount: number }
type PickerModelRow = { source: 'provider-model'; id: string; label: string; subtitle: string; providerId: string; modelId: string; contextWindow?: number }
export type ComposerSendOverrides = { mode?: DispatchPreset; targetAgent?: string | null; customSchedule?: SchedulePreview | null; modelSelection?: ModelSelection | null; multiModelFusion?: boolean }
export type ComposerSendFailureReason = 'busy' | 'routing-unavailable' | 'schedule-target-unavailable' | 'schedule-unavailable' | 'create-failed' | 'cancelled' | 'owner-changed' | 'send-failed'
export type ComposerSendResult = { ok: true } | { ok: false; reason: ComposerSendFailureReason; error?: string }
type ComposerSubmission = {
  id: number
  text: string
  draftText: string
  attachments: WorkbenchAttachment[]
  overrides: ComposerSendOverrides
  clearDraftOnSuccess: boolean
  quickRole: 'none' | 'reviewer' | 'executor' | 'gatekeeper'
  ownerKey: string
}
type SelectableApprovalMode = 'ask' | 'auto' | 'full'

type PickerAnchor = { left: number; top: number } | null

export function ComposerBar({
  mode,
  setMode,
  providers,
  bindings,
  modelSelection,
  setModelSelection,
  thinking,
  setThinking,
  schedules,
  scheduleForMode,
  multiModelFusion = false,
  setMultiModelFusion,
  sending,
  onSend,
  onCancel,
  workspaceId,
  threadId,
  workspaces,
  setWorkspaceId,
  onCreateProject,
  localAgents,
  targetAgent,
  setTargetAgent,
  agents,
  onRunCommand,
  onRefreshProviders,
  externalAttachments,
  onExternalAttachmentsConsumed,
  gitBranchNode,
  decisionItem = null,
  decisionPosition = 0,
  decisionCount = 0,
  onDecisionSubmit,
  onDraftDecision
}: {
  mode: DispatchPreset
  setMode: (mode: DispatchPreset) => void
  providers: ProviderDef[]
  bindings: BindingDef[]
  modelSelection: ModelSelection | null
  setModelSelection: (selection: ModelSelection | null) => void
  thinking: ComposerThinkingConfig
  setThinking: (thinking: ComposerThinkingConfig) => void
  schedules: SchedulePreview[]
  scheduleForMode?: (preset: DispatchPreset) => SchedulePreview | undefined
  multiModelFusion?: boolean
  setMultiModelFusion?: (enabled: boolean) => void
  sending: boolean
  onSend: (prompt: string, attachments?: WorkbenchAttachment[], overrides?: ComposerSendOverrides) => Promise<ComposerSendResult>
  onCancel: () => void
  workspaceId: string | null
  workspaces: WorkspaceItem[]
  setWorkspaceId: (id: string | null) => void
  onCreateProject: () => void
  localAgents: LocalAgentStatus[]
  targetAgent: string | null
  setTargetAgent: (agentId: string | null) => void
  agents: Record<string, { status: AgentUIStatus }>
  onRunCommand?: (input: { text: string; command?: WorkbenchCommand | null }) => Promise<boolean>
  onOpenProviderSettings?: () => void
  onRefreshProviders?: () => void
  externalAttachments?: WorkbenchAttachment[]
  onExternalAttachmentsConsumed?: () => void
  gitBranchNode?: React.ReactNode
  threadId?: string | null
  turns?: WorkbenchTurn[]
  events?: RuntimeEvent[]
  decisionItem?: DecisionItem | null
  decisionPosition?: number
  decisionCount?: number
  onDecisionSubmit?: (item: DecisionItem, submission: DecisionSubmission) => Promise<DecisionBarSubmitResult> | DecisionBarSubmitResult
  onDraftDecision?: (decision: DraftDecisionItem) => void
}) {
  const [text, setText] = useState('')
  const [draftRevision, setDraftRevision] = useState(0)
  const [draftHash, setDraftHash] = useState<string | null>(null)
  const [draftHashText, setDraftHashText] = useState<string | null>(null)
  const [focusAfterDecisionId, setFocusAfterDecisionId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<WorkbenchAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [commands, setCommands] = useState<WorkbenchCommand[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [addPaletteOpen, setAddPaletteOpen] = useState(false)
  const [activeAddIndex, setActiveAddIndex] = useState(0)
  const [pluginAddItems, setPluginAddItems] = useState<ComposerAddItem[]>([])
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [approvalPickerOpen, setApprovalPickerOpen] = useState(false)
  const [approvalMode, setApprovalMode] = useState<ApprovalDisplayMode>('full')
  const [approvalSaving, setApprovalSaving] = useState(false)
  const [quickRole, setQuickRole] = useState<'none' | 'reviewer' | 'executor' | 'gatekeeper'>('none')
  const [queue, setQueue] = useState<ComposerSubmission[]>([])
  const [failedQueueHeadId, setFailedQueueHeadId] = useState<number | null>(null)
  const [failedQueueReason, setFailedQueueReason] = useState<ComposerSendFailureReason | null>(null)
  const [queuePaused, setQueuePaused] = useState(false)
  const [queueWorkerBusy, setQueueWorkerBusy] = useState(false)
  const [queueWorkerEpoch, setQueueWorkerEpoch] = useState(0)
  const [budgetEstimate, setBudgetEstimate] = useState<BudgetEstimate | null>(null)
  const [budgetEstimateLoading, setBudgetEstimateLoading] = useState(false)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [modelPickerAnchor, setModelPickerAnchor] = useState<PickerAnchor>(null)
  const [workspacePickerAnchor, setWorkspacePickerAnchor] = useState<PickerAnchor>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const modelPickerRef = useRef<HTMLDivElement | null>(null)
  const workspacePickerRef = useRef<HTMLDivElement | null>(null)
  const approvalPickerRef = useRef<HTMLDivElement | null>(null)
  const approvalSavingRef = useRef(false)
  const submissionSeqRef = useRef(0)
  const queueInFlightIdRef = useRef<number | null>(null)
  const pausedInFlightIdsRef = useRef(new Set<number>())
  const queuePausedRef = useRef(false)
  const ownerMoveRouteRebuildSubmissionIdRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const workerGenerationRef = useRef(0)
  const ownerKey = `${workspaceId || ''}\u0000${threadId || ''}`
  const ownerKeyRef = useRef(ownerKey)
  const textRef = useRef(text)
  const draftRevisionRef = useRef(draftRevision)
  const attachmentsRef = useRef(attachments)
  const quickRoleRef = useRef(quickRole)
  textRef.current = text
  draftRevisionRef.current = draftRevision
  attachmentsRef.current = attachments
  quickRoleRef.current = quickRole
  ownerKeyRef.current = ownerKey

  useEffect(() => {
    mountedRef.current = true
    const generation = ++workerGenerationRef.current
    return () => {
      if (workerGenerationRef.current === generation) workerGenerationRef.current++
      mountedRef.current = false
    }
  }, [])
  const composingRef = useRef(false)
  const compositionEndedAtRef = useRef(0)
  const workspace = workspaces.find(item => item.id === workspaceId) ?? null
  void bindings
  void thinking
  void setThinking
  void agents
  const readyAgentIds = localAgentOptions(localAgents)
  const apiProviderRows = providerAgentRows(providers)
  const pickerAgentRows = filterPickerAgentRows([
    ...localAgentRows(readyAgentIds),
    ...apiProviderRows
  ], modelQuery)
  const apiModelRows = activeProviderId ? providerModelRows(providers, activeProviderId) : []
  const selectedProviderRows = modelSelection?.source === 'provider' && modelSelection.providerId
    ? providerModelRows(providers, modelSelection.providerId)
    : []
  const pickerAvailable = readyAgentIds.length > 0 || apiProviderRows.length > 0
  const hasProviderConfig = providers.length > 0
  const selectedAgentId = targetAgent && readyAgentIds.includes(targetAgent) ? targetAgent : null
  const selectedAgentLabel = selectedAgentId ? agentDisplayName(selectedAgentId) : tr('未检测到可用 Agent', 'No available agent')

  const selectedProviderModel = modelSelection?.source === 'provider' && modelSelection.providerId
    ? selectedProviderRows.find(row => row.id === `provider:${modelSelection.providerId}:${modelSelection.modelId}`)
    : null
  const selectedProviderAgent = modelSelection?.source === 'provider' && modelSelection.providerId
    ? apiProviderRows.find(row => row.source === 'provider-agent' && row.providerId === modelSelection.providerId)
    : null
  const activeProviderAgent = activeProviderId
    ? apiProviderRows.find(row => row.source === 'provider-agent' && row.providerId === activeProviderId)
    : null
  const selectedPickerLabel = selectedProviderModel?.label || selectedProviderAgent?.label || activeProviderAgent?.label || selectedAgentLabel
  const pickerTitle = pickerAvailable
    ? tr('切换 Agent 或 API 厂商', 'Switch agent or API provider')
    : tr('请先在设置里配置本地 Agent 或 API 厂商', 'Configure a local agent or API provider in Settings first')
  const activeModelRows = filterPickerModelRows(activeProviderId ? apiModelRows : [], modelQuery)
  const selectedPickerModelKey = modelSelectionKey(modelSelection)
  const budgetBlocked = budgetEstimate?.check.allowed === false

  const refreshApprovalMode = useCallback(async () => {
    const config = await window.electronAPI.agentic.getApprovalConfig()
    setApprovalMode(approvalDisplayModeFromConfig(config))
  }, [])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 42), 118)}px`
  }, [text])

  useEffect(() => {
    let current = true
    setDraftHash(null)
    setDraftHashText(null)
    void sha256Text(text).then(hash => {
      if (!current) return
      setDraftHash(hash)
      setDraftHashText(text)
    }).catch(() => {
      // Local decisions fail closed when Web Crypto is unavailable.
      if (current) setDraftHash(null)
    })
    return () => { current = false }
  }, [text])

  useEffect(() => {
    if (!focusAfterDecisionId || decisionItem?.id === focusAfterDecisionId) return
    const timer = window.setTimeout(() => {
      const nextPrimary = textareaRef.current?.closest('.wb-composer')?.querySelector<HTMLElement>('[data-decision-primary]:not(:disabled)')
      if (nextPrimary) nextPrimary.focus()
      else textareaRef.current?.focus()
      setFocusAfterDecisionId(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [decisionItem?.id, focusAfterDecisionId])

  useEffect(() => {
    window.electronAPI.commands.list().then(setCommands).catch(() => {})
    refreshApprovalMode().catch(() => {})
  }, [refreshApprovalMode])

  useEffect(() => {
    if (providers.length > 0 || !onRefreshProviders) return
    const timer = window.setTimeout(() => onRefreshProviders(), 350)
    return () => window.clearTimeout(timer)
  }, [providers.length, onRefreshProviders])

  // F-W6: only push a notification when the warning text changes (avoid inbox spam while typing)
  const lastBudgetWarnRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    const prompt = text.trim()
    if (!prompt && attachments.length === 0) {
      setBudgetEstimate(null)
      setBudgetEstimateLoading(false)
      lastBudgetWarnRef.current = null
      return () => { alive = false }
    }
    const timer = window.setTimeout(() => {
      const quickSchedule = quickRole === 'none' ? undefined : quickRoleSchedule(quickRole, readyAgentIds) || undefined
      const selectedSchedule = scheduleSnapshotForSubmission(
        mode,
        quickSchedule || (!targetAgent && !(modelSelection?.source === 'provider') ? scheduleForMode?.(mode) : undefined)
      )
      if (alive) setBudgetEstimateLoading(true)
      window.electronAPI.budget.estimateDispatch({
        workspaceId,
        prompt: prompt || 'Please analyze the attached content.',
        mode,
        targetAgent,
        modelSelection: modelSelection || undefined,
        multiModelFusion: {
          enabled: multiModelFusion === true,
          maxCandidates: 3,
          maxRounds: 3,
          allowExecutor: true
        },
        attachments,
        customSchedule: selectedSchedule
      }).then(result => {
        if (!alive) return
        setBudgetEstimate(result)
        const warn = result?.check?.warning ?? null
        if (!warn) {
          lastBudgetWarnRef.current = null
          return
        }
        if (warn === lastBudgetWarnRef.current) return
        lastBudgetWarnRef.current = warn
        if (typeof window.electronAPI.notifications?.push === 'function') {
          void window.electronAPI.notifications.push({
            title: tr('预算提醒', 'Budget warning'),
            body: warn,
            category: 'system'
          }).catch(() => {})
        }
      })
        .catch(() => { if (alive) setBudgetEstimate(null) })
        .finally(() => { if (alive) setBudgetEstimateLoading(false) })
    }, 450)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [text, attachments, quickRole, readyAgentIds, targetAgent, modelSelection, scheduleForMode, mode, workspaceId])

  useEffect(() => {
    let alive = true
    const loadPlugins = async () => {
      try {
        const plugins = await window.electronAPI.plugins.scan(workspace?.rootPath)
        const contributions = await window.electronAPI.plugins.contributions(plugins)
        if (alive) setPluginAddItems(buildPluginAddItems(plugins, contributions))
      } catch {
        if (alive) setPluginAddItems([])
      }
    }
    loadPlugins().catch(() => {})
    return () => { alive = false }
  }, [workspace?.rootPath])

  useEffect(() => {
    if (!externalAttachments?.length) return
    addAttachments(externalAttachments)
    onExternalAttachmentsConsumed?.()
  }, [externalAttachments])

  useEffect(() => {
    if (!modelPickerOpen) return
    const updateAnchor = () => {
      const rect = modelPickerRef.current?.getBoundingClientRect()
      setModelPickerAnchor(rect ? { left: rect.right, top: rect.bottom } : null)
    }
    updateAnchor()
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      // Check if click is inside the trigger OR the portaled picker
      if (modelPickerRef.current?.contains(target)) return
      if (document.querySelector('.wb-agent-picker')?.contains(target)) return
      setModelPickerOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
    }
  }, [modelPickerOpen])

  useEffect(() => {
    if (!workspacePickerOpen) return
    const updateAnchor = () => {
      const rect = workspacePickerRef.current?.getBoundingClientRect()
      setWorkspacePickerAnchor(rect ? { left: rect.left, top: rect.bottom } : null)
    }
    updateAnchor()
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      // Check if click is inside the trigger OR the portaled picker
      if (workspacePickerRef.current?.contains(target)) return
      if (document.querySelector('.wb-workspace-popover')?.contains(target)) return
      setWorkspacePickerOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
    }
  }, [workspacePickerOpen])

  useEffect(() => {
    if (!approvalPickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (approvalPickerRef.current?.contains(target)) return
      setApprovalPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [approvalPickerOpen])

  const slashQuery = slashCommandQuery(text, commands)
  const commandMatches = slashQuery !== null ? rankCommandsForPalette(filterCommands(commands, slashQuery), slashQuery).slice(0, 12) : []
  const addMention = addPaletteQuery(text, commands, cursorIndex)
  const addQuery = addMention?.query ?? null
  const addItems = useMemo(() => {
    const base = buildBaseAddItems({
      hasWorkspace: !!workspaceId,
      hasAgents: readyAgentIds.length > 0
    })
    return filterComposerAddItems([...base, ...pluginAddItems], addQuery || '').slice(0, 12)
  }, [addQuery, pluginAddItems, readyAgentIds.length, workspaceId])

  useEffect(() => {
    setPaletteOpen(slashQuery !== null)
    setActiveCommandIndex(0)
  }, [slashQuery])

  useEffect(() => {
    setAddPaletteOpen(addQuery !== null)
    setActiveAddIndex(0)
  }, [addQuery])

  // Stable callback and queue refs keep the single-head worker immune to parent re-renders.
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend
  const queueRef = useRef(queue)
  queueRef.current = queue

  // Process exactly one immutable queue head at a time. Only explicit success removes it.
  useEffect(() => {
    const next = queue[0]
    if (sending || queuePaused || !next || failedQueueHeadId === next.id || queueInFlightIdRef.current !== null) return
    if (next.ownerKey !== ownerKeyRef.current) {
      setFailedQueueHeadId(next.id)
      setFailedQueueReason('owner-changed')
      setAttachError(tr('会话或工作区已切换，排队消息已暂停。', 'The thread or workspace changed, so the queued message was paused.'))
      return
    }
    queueInFlightIdRef.current = next.id
    setQueueWorkerBusy(true)
    const generation = workerGenerationRef.current
    void (async () => {
      let result: ComposerSendResult | undefined
      try {
        result = await onSendRef.current(next.text, next.attachments, next.overrides)
      } catch (error) {
        result = { ok: false, reason: 'send-failed', error: error instanceof Error ? error.message : String(error) }
      }
      if (!mountedRef.current || workerGenerationRef.current !== generation) return
      if (queuePausedRef.current || pausedInFlightIdsRef.current.has(next.id)) {
        setQueuePaused(true)
        queuePausedRef.current = true
        setFailedQueueHeadId(next.id)
        setFailedQueueReason('cancelled')
      } else if (result?.ok) {
        if (ownerMoveRouteRebuildSubmissionIdRef.current === next.id) {
          ownerMoveRouteRebuildSubmissionIdRef.current = null
        }
        setQueue(current => current[0]?.id === next.id ? current.slice(1) : current)
        setFailedQueueHeadId(current => current === next.id ? null : current)
        setFailedQueueReason(null)
        if (next.clearDraftOnSuccess
          && textRef.current === next.draftText
          && sameAttachments(attachmentsRef.current, next.attachments)) {
          setText('')
          setAttachments([])
          if (quickRoleRef.current === next.quickRole) setQuickRole('none')
        }
      } else {
        setFailedQueueHeadId(next.id)
        setFailedQueueReason(result?.reason || 'send-failed')
        setAttachError(result?.error || tr('发送失败，消息已保留，可重试。', 'Failed to send. Your message was kept for retry.'))
      }
      queueInFlightIdRef.current = null
      setQueueWorkerBusy(false)
      setQueueWorkerEpoch(value => value + 1)
    })()
  }, [sending, queue, failedQueueHeadId, queueWorkerEpoch, queuePaused])

  const rebuildSubmissionForCurrentRoute = (submission: ComposerSubmission): ComposerSubmission => createComposerSubmission({
    id: submission.id,
    prompt: submission.text,
    draftText: submission.draftText,
    attachments: submission.attachments,
    mode,
    targetAgent,
    modelSelection,
    multiModelFusion: multiModelFusion === true,
    schedule: scheduleSnapshotForSubmission(
      mode,
      !targetAgent && modelSelection?.source !== 'provider' ? scheduleForMode?.(mode) : undefined
    ),
    quickRole: 'none',
    clearDraftOnSuccess: submission.clearDraftOnSuccess,
    ownerKey: ownerKeyRef.current
  })

  const send = async () => {
    const failedHead = failedQueueHeadId === queueRef.current[0]?.id ? queueRef.current[0] : null
    if (queuePaused) {
      queuePausedRef.current = false
      pausedInFlightIdsRef.current.clear()
      setQueuePaused(false)
      setFailedQueueHeadId(null)
      setFailedQueueReason(null)
      setAttachError(null)
      return
    }
    if (failedHead && isRouteFailure(failedQueueReason)) {
      if (failedHead.ownerKey !== ownerKeyRef.current) {
        ownerMoveRouteRebuildSubmissionIdRef.current = failedHead.id
        setFailedQueueReason('owner-changed')
        setAttachError(tr('会话或工作区已切换，排队消息已暂停。', 'The thread or workspace changed, so the queued message was paused.'))
        return
      }
      if (ownerMoveRouteRebuildSubmissionIdRef.current === failedHead.id) {
        ownerMoveRouteRebuildSubmissionIdRef.current = null
      }
      const rebuilt = rebuildSubmissionForCurrentRoute(failedHead)
      setQueue(current => current[0]?.id === failedHead.id ? [rebuilt, ...current.slice(1)] : current)
      setFailedQueueHeadId(null)
      setFailedQueueReason(null)
      setAttachError(null)
      return
    }
    const prompt = text.trim() || (attachments.length ? tr('请分析我附加的内容。', 'Please analyze the attached content.') : '')
    if (!prompt) {
      if (failedHead) {
        if (failedHead.ownerKey === ownerKeyRef.current
          && ownerMoveRouteRebuildSubmissionIdRef.current === failedHead.id) {
          ownerMoveRouteRebuildSubmissionIdRef.current = null
        }
        setAttachError(null)
        setFailedQueueHeadId(null)
        setFailedQueueReason(null)
      }
      return
    }
    if (shouldRunComposerCommand(prompt, commands)) {
      if (onRunCommand) {
        const handled = await onRunCommand({ text: prompt })
        if (handled) {
          setText('')
          setPaletteOpen(false)
          return
        }
      }
      setAttachError(tr('未识别的指令，请从 / 指令面板选择，或移除开头的 / 或 @ 后再发送。', 'Unknown command. Choose one from the / palette, or remove the leading / or @ before sending.'))
      return
    }
    const quickSchedule = quickRole === 'none' ? undefined : quickRoleSchedule(quickRole, readyAgentIds)
    if (quickRole !== 'none' && !quickSchedule) {
      setAttachError(tr('没有可用本地 Agent，无法派发子 Agent。请先在设置里配置 CLI。', 'No usable local agent is available for child-agent dispatch. Configure a CLI in Settings first.'))
      return
    }
    if (failedHead && text === failedHead.draftText && sameAttachments(attachments, failedHead.attachments)) {
      if (failedHead.ownerKey === ownerKeyRef.current
        && ownerMoveRouteRebuildSubmissionIdRef.current === failedHead.id) {
        ownerMoveRouteRebuildSubmissionIdRef.current = null
      }
      setAttachError(null)
      setFailedQueueHeadId(null)
      return
    }
    const submission = createComposerSubmission({
      id: ++submissionSeqRef.current,
      prompt,
      draftText: text,
      attachments,
      mode,
      targetAgent,
      modelSelection,
      multiModelFusion: multiModelFusion === true,
      schedule: scheduleSnapshotForSubmission(
        mode,
        quickSchedule || (!targetAgent && modelSelection?.source !== 'provider' ? scheduleForMode?.(mode) : undefined)
      ),
      quickRole,
      clearDraftOnSuccess: !sending && !failedHead,
      ownerKey: ownerKeyRef.current
    })
    setQueue(current => [...current, submission])
    setAttachError(null)
    if (sending || failedHead) {
      setText('')
      setAttachments([])
      setQuickRole('none')
    }
    if (failedHead) setFailedQueueHeadId(null)
  }

  const stopQueue = () => {
    queuePausedRef.current = true
    setQueuePaused(true)
    const inFlightId = queueInFlightIdRef.current
    if (inFlightId !== null) pausedInFlightIdsRef.current.add(inFlightId)
    onCancel()
  }

  const moveFailedHeadToCurrentOwner = () => {
    const failedId = failedQueueHeadId
    if (failedQueueReason !== 'owner-changed' || failedId === null) return
    const rebuildRoute = ownerMoveRouteRebuildSubmissionIdRef.current === failedId
    if (rebuildRoute) ownerMoveRouteRebuildSubmissionIdRef.current = null
    setQueue(current => current[0]?.id === failedId
      ? [
          rebuildRoute
            ? rebuildSubmissionForCurrentRoute(current[0])
            : { ...current[0], ownerKey: ownerKeyRef.current },
          ...current.slice(1)
        ]
      : current)
    setFailedQueueHeadId(null)
    setFailedQueueReason(null)
    setAttachError(null)
  }

  const isImeConfirming = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }
    return composingRef.current || native.isComposing || native.keyCode === 229 || Date.now() - compositionEndedAtRef.current < 40
  }

  const addAttachments = (items: WorkbenchAttachment[]) => {
    if (!items.length) return
    setAttachError(null)
    setAttachments(current => {
      const seen = new Set(current.map(item => item.path || item.dataUrl || item.id))
      const merged = [...current]
      for (const item of items) {
        const key = item.path || item.dataUrl || item.id
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(item)
        }
      }
      return merged.slice(0, 12)
    })
  }

  const pickAttachments = async () => {
    if (sending) return
    try {
      const picked = await window.electronAPI.app.pickFiles({ defaultPath: defaultDialogPath('file', workspace?.rootPath) }) as unknown
      const nextAttachments = pickedFilePathsToAttachments(picked)
      if (nextAttachments[0]?.path) rememberDialogPath('file', nextAttachments[0].path)
      addAttachments(nextAttachments)
    } catch (e: any) {
      setAttachError(e?.message || tr('添加附件失败。', 'Failed to add attachments.'))
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments(current => current.filter(item => item.id !== id))
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => !!file && file.type.startsWith('image/'))
    if (files.length > 0) {
      event.preventDefault()
      addAttachments(await Promise.all(files.map(fileToAttachment)))
    }
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files || [])
    if (!files.length) return
    event.preventDefault()
    addAttachments(await Promise.all(files.map(fileToAttachment)))
  }

  const syncCursor = () => {
    const next = textareaRef.current?.selectionStart
    setCursorIndex(typeof next === 'number' ? next : text.length)
  }

  const selectAgentChoice = (agentId: string) => {
    setTargetAgent(agentId)
    setModelSelection(null)
    setMode('auto')
    setModelQuery('')
    setActiveProviderId(null)
    setModelPickerOpen(false)
  }

  const selectProviderChoice = (providerId: string) => {
    setTargetAgent(null)
    setActiveProviderId(providerId)
    if (modelSelection?.source === 'provider' && modelSelection.providerId !== providerId) setModelSelection(null)
    setModelQuery('')
  }

  const selectProviderModel = (providerId: string, modelId: string) => {
    setTargetAgent(null)
    setModelSelection({ providerId, modelId, source: 'provider' })
    setMode('auto')
    setModelPickerOpen(false)
    setModelQuery('')
    setActiveProviderId(providerId)
  }

  const selectScheduleMode = (nextMode: DispatchPreset) => {
    setMode(nextMode)
    if (nextMode !== 'auto') {
      setTargetAgent(null)
      setModelSelection(null)
      setActiveProviderId(null)
      setModelQuery('')
    }
  }

  const applyApprovalMode = async (nextMode: SelectableApprovalMode) => {
    if (approvalSavingRef.current) return
    approvalSavingRef.current = true
    setApprovalSaving(true)
    try {
      const config = await window.electronAPI.agentic.setApprovalPreset(approvalPresetForDisplayMode(nextMode))
      setApprovalMode(approvalDisplayModeFromConfig(config))
      setApprovalPickerOpen(false)
    } finally {
      approvalSavingRef.current = false
      setApprovalSaving(false)
    }
  }

  const selectWorkspace = (nextWorkspaceId: string | null) => {
    setWorkspaceId(nextWorkspaceId)
    setWorkspacePickerOpen(false)
  }

  const createWorkspaceFromPicker = () => {
    setWorkspacePickerOpen(false)
    onCreateProject()
  }

  const chooseCommand = async (command: WorkbenchCommand) => {
    if (command.source === 'ecc') {
      if (currentTextHasCommandArgs(text.trim(), command)) {
        const handled = await onRunCommand?.({ text: commandTextForSelection(text.trim(), command), command })
        if (handled) {
          setText('')
          setPaletteOpen(false)
          return
        }
      }
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'use-skill') {
      const handled = await onRunCommand?.({ text: command.insertText || command.label, command })
      if (handled) {
        setText('')
        setPaletteOpen(false)
        return
      }
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'use-agent') {
      const currentText = text.trim()
      const handled = await onRunCommand?.({ text: commandTextForSelection(currentText, command), command })
      if (handled) {
        setText('')
        setPaletteOpen(false)
        return
      }
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'insert') {
      setText(command.insertText || `${command.label} `)
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    if (command.action === 'run-terminal') {
      setText('/terminal ')
      setPaletteOpen(false)
      textareaRef.current?.focus()
      return
    }
    const handled = await onRunCommand?.({ text: command.insertText || command.label, command })
    if (handled) {
      setText('')
      setPaletteOpen(false)
    } else if (command.insertText) {
      setText(command.insertText)
      setPaletteOpen(false)
      textareaRef.current?.focus()
    }
  }

  const chooseAddItem = async (item: ComposerAddItem) => {
    setAttachError(null)
    setAddPaletteOpen(false)
    if (item.kind === 'attachments') {
      setText(current => replaceAddToken(current, addMention, ''))
      await pickAttachments()
      textareaRef.current?.focus()
      return
    }
    if (item.kind === 'goal') {
      setText(current => replaceAddToken(current, addMention, '/goal '))
      textareaRef.current?.focus()
      return
    }
    if (item.kind === 'schedule') {
      selectScheduleMode('firefly-custom')
      setText(current => replaceAddToken(current, addMention, ''))
      textareaRef.current?.focus()
      return
    }
    if (item.kind === 'workspace') {
      setText(current => replaceAddToken(current, addMention, ''))
      onCreateProject()
      return
    }
    if (item.kind.startsWith('plugin-')) {
      const token = item.token || `@plugin-${safeMentionToken(item.title)}`
      setText(current => replaceAddToken(current, addMention, `${token} `))
      addAttachments([pluginAddItemToAttachment(item)])
      textareaRef.current?.focus()
    }
  }

  const updateTextFromUser = (nextText: string) => {
    setText(nextText)
    setDraftRevision(current => {
      const nextRevision = current + 1
      draftRevisionRef.current = nextRevision
      return nextRevision
    })
  }

  const submitInlineDecision = async (submission: DecisionSubmission): Promise<DecisionBarSubmitResult> => {
    const item = decisionItem
    if (!item || !onDecisionSubmit) return { accepted: false }

    const result = await onDecisionSubmit(item, submission)
    if (!decisionAccepted(result)) return result

    if (item.origin === 'draft') {
      const currentRevision = draftRevisionRef.current
      const currentText = textRef.current
      const currentHash = await sha256Text(currentText).catch(() => null)
      const draftStillMatches = currentRevision === item.draftRevision && currentHash === item.draftHash
      const selectedOptionId = submission.selectedOptionIds?.[0]
      const mappedValue = selectedOptionId ? item.valuesByOptionId[selectedOptionId] : undefined
      const customText = typeof submission.customText === 'string'
        ? submission.customText.slice(0, item.request.customInput?.maxChars ?? 8_000)
        : undefined
      const nextText = customText ?? mappedValue
      if (draftStillMatches && typeof nextText === 'string') setText(nextText)
    }

    setFocusAfterDecisionId(item.id)
    return result
  }

  return (
    <div
      className={'wb-composer-wrap' + (attachments.length ? ' has-attachments' : '')}
      onDragOver={event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={handleDrop}
    >
      <div className="wb-composer">
        {decisionItem && (
          <DecisionBar
            item={decisionItem}
            position={decisionPosition || 1}
            count={decisionCount || 1}
            onSubmit={submitInlineDecision}
          />
        )}
        <div className="wb-composer-input-layer">
          <textarea
            ref={textareaRef}
            className="wb-composer-input"
            value={text}
            onChange={e => {
              updateTextFromUser(e.target.value)
              setCursorIndex(e.target.selectionStart ?? e.target.value.length)
            }}
            onClick={syncCursor}
            onKeyUp={syncCursor}
            onSelect={syncCursor}
            onPaste={handlePaste}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
              compositionEndedAtRef.current = Date.now()
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && isImeConfirming(e)) return
              if (addPaletteOpen) {
                if (e.key === 'ArrowDown' && addItems.length > 0) {
                  e.preventDefault()
                  setActiveAddIndex(index => (index + 1) % addItems.length)
                  return
                }
                if (e.key === 'ArrowUp' && addItems.length > 0) {
                  e.preventDefault()
                  setActiveAddIndex(index => (index - 1 + addItems.length) % addItems.length)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setAddPaletteOpen(false)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey && addItems.length > 0) {
                  e.preventDefault()
                  chooseAddItem(addItems[activeAddIndex]).catch(() => {})
                  return
                }
              }
              if (paletteOpen && commandMatches.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActiveCommandIndex(index => (index + 1) % commandMatches.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActiveCommandIndex(index => (index - 1 + commandMatches.length) % commandMatches.length)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setPaletteOpen(false)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const currentText = text.trim()
                  const command = commandMatches[activeCommandIndex]
                  const rawFirstToken = currentText.split(/\s+/, 1)[0] || ''
                  const firstToken = normalizeCommandToken(rawFirstToken)
                  if (firstToken === command.label.toLowerCase() && currentText.length > rawFirstToken.length) {
                    send().catch(() => {})
                  } else {
                    chooseCommand(command).catch(() => {})
                  }
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={tr('输入后发送，系统会自动新建会话...', 'Send to start a new session...')}
            rows={1}
          />

          <div className="wb-composer-input-actions">
            {/* Context capacity indicator */}
            {modelSelection && (
              <ContextCapacityIndicator
                text={text}
                attachments={attachments}
                workspaceId={workspaceId}
                modelSelection={modelSelection}
                providers={providers}
              />
            )}
            <button className="wb-icon-button" title={tr('添加文件或图片', 'Attach file or image')} aria-label={tr('添加文件或图片', 'Attach file or image')} disabled={sending} onClick={pickAttachments}>
              <Icon d={IC.plus} size={17} />
            </button>
            <div className="wb-approval-mode-host" ref={approvalPickerRef}>
              <button
                type="button"
                className={'wb-approval-mode-trigger mode-' + approvalMode}
                onClick={() => setApprovalPickerOpen(open => !open)}
                disabled={approvalSaving}
                aria-expanded={approvalPickerOpen}
                title={tr('审批模式', 'Approval mode')}
              >
                <Icon d={approvalIconForMode(approvalMode)} size={14} />
                <span>{approvalDisplayModeLabel(approvalMode)}</span>
                <Icon d={IC.chevDown} size={11} />
              </button>
              {approvalPickerOpen && (
                <div className="wb-approval-mode-popover" role="menu" aria-label={tr('审批模式', 'Approval mode')}>
                  <div className="wb-approval-mode-head">
                    <strong>{tr('应该如何批准 Agent 操作？', 'How should AgentHub approve operations?')}</strong>
                  </div>
                  {approvalModes().map(item => (
                    <button key={item.id} type="button" disabled={approvalSaving} className={approvalMode === item.id ? 'selected' : ''} onClick={() => applyApprovalMode(item.id).catch(err => setAttachError(err?.message || tr('切换审批模式失败。', 'Failed to switch approval mode.')))}>
                      <Icon d={item.icon} size={16} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      {approvalMode === item.id && <Icon d={IC.check} size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              className="wb-subagent-select"
              value={quickRole}
              onChange={event => setQuickRole(event.target.value as any)}
              title={tr('派发子 Agent', 'Dispatch child agent')}
              disabled={sending || readyAgentIds.length === 0}
            >
              <option value="none">{tr('子 Agent', 'Sub-agent')}</option>
              <option value="reviewer">{tr('评审', 'Reviewer')}</option>
              <option value="executor">{tr('执行', 'Executor')}</option>
              <option value="gatekeeper">{tr('门禁', 'Gatekeeper')}</option>
            </select>
            <div className="wb-composer-model-menu-host" ref={modelPickerRef}>
              <button
                type="button"
                className="wb-agent-picker-trigger"
                disabled={!pickerAvailable && hasProviderConfig}
                title={pickerTitle}
                aria-label={pickerTitle}
                aria-expanded={modelPickerOpen}
                onClick={() => {
                  if (!pickerAvailable && !hasProviderConfig) {
                    onRefreshProviders?.()
                    return
                  }
                  setModelPickerOpen(open => {
                  const next = !open
                  if (next) setActiveProviderId(null)
                  return next
                  })
                }}
              >
                {selectedAgentId
                  ? <AgentMark id={selectedAgentId} size={24} radius={7} />
                  : selectedProviderAgent || activeProviderAgent ? <span className="wb-provider-mark small"><Icon d={IC.pulse} size={14} /></span> : <Icon d={IC.terminal} size={16} />}
                <span>{selectedPickerLabel}</span>
                <Icon d={IC.chevDown} size={12} />
              </button>
              {modelPickerOpen && modelPickerAnchor && createPortal(
                <div
                  className={'wb-agent-picker' + (activeModelRows.length > 0 ? ' has-models' : '')}
                  role="menu"
                  aria-label={tr('选择 Agent', 'Choose agent')}
                  style={{
                    position: 'fixed',
                    left: `${modelPickerAnchor.left}px`,
                    top: `${modelPickerAnchor.top}px`,
                    right: 'auto',
                    bottom: 'auto',
                    transform: 'translate(-100%, calc(-100% - 12px))'
                  }}
                >
                  <section className="wb-agent-picker-agents">
                    <div className="wb-agent-picker-title">{tr('Agent', 'Agents')}</div>
                    <div className="wb-agent-picker-list">
                      {pickerAgentRows.map(row => (
                        <button
                          key={row.id}
                          type="button"
                          className={pickerAgentRowSelected(row, selectedAgentId, activeProviderId, modelSelection) ? 'selected' : ''}
                          title={row.label}
                          onClick={() => row.source === 'local-agent' ? selectAgentChoice(row.agentId) : selectProviderChoice(row.providerId)}
                        >
                          {row.source === 'local-agent'
                            ? <AgentMark id={row.agentId} size={32} radius={9} />
                            : <span className="wb-provider-mark"><Icon d={IC.pulse} size={16} /></span>}
                          <span>
                            <strong>{row.label}</strong>
                            {row.subtitle && <small>{row.subtitle}</small>}
                          </span>
                          {pickerAgentRowSelected(row, selectedAgentId, activeProviderId, modelSelection) && <Icon d={IC.check} size={14} />}
                        </button>
                      ))}
                    </div>
                  </section>
                  {activeModelRows.length > 0 && (
                    <section className="wb-agent-model-panel" aria-label={tr('模型', 'Models')}>
                      <div className="wb-agent-picker-title">{tr('模型', 'Models')}</div>
                      {activeProviderId && !modelQuery.trim() && (
                        <button type="button" className="wb-agent-model-back" onClick={() => setActiveProviderId(null)}>
                          ‹ {tr('厂商', 'Providers')}
                        </button>
                      )}
                      <label className="wb-agent-model-search">
                        <Icon d={IC.search} size={13} />
                        <input
                          value={modelQuery}
                          onChange={event => setModelQuery(event.target.value)}
                          placeholder={tr('搜索模型', 'Search models')}
                        />
                      </label>
                      <div className="wb-agent-model-list">
                        {activeModelRows.map(model => (
                          <button
                            key={model.id}
                            type="button"
                            className={model.id === selectedPickerModelKey ? 'selected' : ''}
                            title={model.label}
                            onClick={() => selectProviderModel(model.providerId, model.modelId)}
                          >
                            <span>
                              <strong>{model.label}</strong>
                              <small>{model.subtitle}</small>
                            </span>
                            {model.contextWindow ? <em>{formatContextWindow(model.contextWindow)}</em> : null}
                            {model.id === selectedPickerModelKey && <Icon d={IC.check} size={14} />}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {/* Local model config loading placeholder removed */}
                </div>
                , document.body
              )}
            </div>
            <button
              type="button"
              className={'wb-icon-button' + (multiModelFusion ? ' active' : '')}
              onClick={() => setMultiModelFusion?.(!multiModelFusion)}
              disabled={sending || !setMultiModelFusion}
              aria-pressed={multiModelFusion}
              title={tr('多模型融合', 'Multi-model fusion')}
              aria-label={tr('多模型融合', 'Multi-model fusion')}
            >
              <Icon d={IC.broadcast} size={16} />
            </button>
            {!sending && threadId && text.trim() && draftHash && draftHashText === text && onDraftDecision && (
              <PromptEnhancer
                text={text}
                threadId={threadId}
                draftRevision={draftRevision}
                draftHash={draftHash}
                onDraftDecision={onDraftDecision}
                disabled={sending}
              />
            )}
            {queue.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--color-info)', padding: '2px 6px', borderRadius: 10, background: 'color-mix(in srgb, var(--color-info) 10%, transparent)' }}>
                {queue.length} {tr('排队', 'queued')}
              </span>
            )}
            {(sending || queueWorkerBusy) && !queuePaused
              ? <button className="wb-send stop" onClick={stopQueue} title={tr('停止', 'Stop')} aria-label={tr('停止', 'Stop')}><Icon d={IC.stop} size={15} /></button>
              : <button className="wb-send" disabled={budgetBlocked || (!text.trim() && attachments.length === 0 && queue.length === 0)} onClick={send} title={tr('发送', 'Send')} aria-label={tr('发送', 'Send')}><Icon d={IC.send} size={15} /></button>}
          </div>
        </div>

        {paletteOpen && commandMatches.length > 0 && (
          <div className="wb-command-palette">
            {commandMatches.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={index === activeCommandIndex ? 'active' : ''}
                onMouseEnter={() => setActiveCommandIndex(index)}
                onClick={() => chooseCommand(command).catch(() => {})}
              >
                <code>{command.label}</code>
                <span>
                  <strong>{commandCategoryLabel(command.category)}</strong>
                  {commandDescription(command)}
                </span>
              </button>
            ))}
          </div>
        )}

        {addPaletteOpen && (
          <div className="wb-add-palette" role="listbox" aria-label={tr('Add context or plugin', 'Add context or plugin')}>
            <div className="wb-add-palette-head">
              <strong>{tr('Add context', 'Add context')}</strong>
              <span>{tr('Files, goals, schedules, workspace and plugins', 'Files, goals, schedules, workspace and plugins')}</span>
            </div>
            {addItems.length > 0 ? (
              groupComposerAddItems(addItems).map(group => (
                <div key={group.section} className="wb-add-section">
                  <div className="wb-add-section-title">{composerAddSectionLabel(group.section)}</div>
                  {group.items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={addItems[activeAddIndex]?.id === item.id ? 'active' : ''}
                      onMouseEnter={() => setActiveAddIndex(addItems.findIndex(candidate => candidate.id === item.id))}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => chooseAddItem(item).catch(() => {})}
                    >
                      <span className="wb-add-icon"><Icon d={item.icon} size={15} /></span>
                      <span className="wb-add-copy">
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      {item.token ? <code>{item.token}</code> : null}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="wb-add-palette-empty">
                <strong>{tr('No matching plugin or context item', 'No matching plugin or context item')}</strong>
                <span>{tr('Try a different @ query or install plugins in Settings.', 'Try a different @ query or install plugins in Settings.')}</span>
              </div>
            )}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="wb-attachment-strip">
            {attachments.map(att => (
              <button key={att.id} className={'wb-attachment-chip ' + att.kind} type="button" onClick={() => removeAttachment(att.id)} title={att.path || tr('点击移除附件', 'Click to remove')}>
                {att.kind === 'image' && att.dataUrl
                  ? <img src={att.dataUrl} alt={att.name} />
                  : <Icon d={att.kind === 'image' ? IC.image : IC.file} size={14} />}
                <span>{att.name}</span>
                {att.size ? <small>{formatBytes(att.size)}</small> : null}
                <Icon d={IC.x} size={12} />
              </button>
            ))}
          </div>
        )}

        {attachError && (
          <div className="wb-voice-error">
            <span>{attachError}</span>
            {failedQueueReason === 'owner-changed' && failedQueueHeadId !== null && (
              <button
                type="button"
                className="ah-btn sm"
                onClick={moveFailedHeadToCurrentOwner}
                title={tr('将排队消息移至当前会话并重试', 'Move queued message to current thread and retry')}
                aria-label={tr('将排队消息移至当前会话并重试', 'Move queued message to current thread and retry')}
              >
                {tr('移至当前会话并重试', 'Move to current thread and retry')}
              </button>
            )}
          </div>
        )}

        <div className="wb-composer-context wb-composer-context-minimal">
          <div className="wb-composer-context-left">
            <div className="wb-workspace-picker-host" ref={workspacePickerRef}>
              <button
                type="button"
                className="wb-workspace-trigger"
                onClick={() => setWorkspacePickerOpen(open => !open)}
                aria-expanded={workspacePickerOpen}
                aria-label={tr('切换工作目录', 'Switch working folder')}
                title={workspace?.rootPath || tr('个人会话', 'Personal chat')}
              >
                <Icon d={IC.folder} size={14} />
                <span>{workspace?.name || tr('个人会话', 'Personal chat')}</span>
                <Icon d={IC.chevDown} size={12} />
              </button>
              {workspacePickerOpen && workspacePickerAnchor && createPortal(
                <div
                  className="wb-workspace-popover"
                  role="menu"
                  aria-label={tr('选择工作目录', 'Choose working folder')}
                  style={{
                    position: 'fixed',
                    left: `${workspacePickerAnchor.left}px`,
                    top: `${workspacePickerAnchor.top}px`,
                    right: 'auto',
                    bottom: 'auto',
                    transform: 'translateY(calc(-100% - 12px))'
                  }}
                >
                  <button
                    type="button"
                    className={!workspaceId ? 'selected' : ''}
                    onClick={() => selectWorkspace(null)}
                  >
                    <Icon d={IC.chat} size={14} />
                    <span>
                      <strong>{tr('个人会话', 'Personal chat')}</strong>
                      <small>{tr('不绑定本地目录', 'No local folder bound')}</small>
                    </span>
                    {!workspaceId && <Icon d={IC.check} size={14} />}
                  </button>
                  {workspaces.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={workspaceId === item.id ? 'selected' : ''}
                      onClick={() => selectWorkspace(item.id)}
                    >
                      <Icon d={IC.folder} size={14} />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.rootPath}</small>
                      </span>
                      {workspaceId === item.id && <Icon d={IC.check} size={14} />}
                    </button>
                  ))}
                  <button type="button" className="create" onClick={createWorkspaceFromPicker}>
                    <Icon d={IC.plus} size={14} />
                    <span>
                      <strong>{tr('添加工作目录', 'Add working folder')}</strong>
                      <small>{tr('选择一个本地目录作为上下文', 'Choose a local folder as context')}</small>
                    </span>
                  </button>
                </div>
                , document.body
              )}
            </div>
            {gitBranchNode}
            <select
              className="wb-composer-schedule-select"
              value={mode}
              onChange={event => selectScheduleMode(event.target.value as DispatchPreset)}
              title={tr('调度安排', 'Dispatch schedule')}
              aria-label={tr('调度安排', 'Dispatch schedule')}
              disabled={sending}
            >
              {schedules.map(schedule => (
                <option key={schedule.preset} value={schedule.preset}>{scheduleDisplayLabel(schedule)}</option>
              ))}
            </select>
          </div>
          <BudgetEstimatePill estimate={budgetEstimate} loading={budgetEstimateLoading} />
          <span className="wb-composer-key-hint">{tr('Type / for commands, @ for context', 'Type / for commands, @ for context')}</span>
        </div>
      </div>
    </div>
  )
}

function localAgentRows(agentIds: string[]): PickerAgentRow[] {
  return agentIds.map(agentId => ({
    source: 'local-agent',
    id: `local-agent:${agentId}`,
    label: agentDisplayName(agentId),
    subtitle: tr('本地 CLI', 'Local CLI'),
    agentId
  }))
}

function BudgetEstimatePill({ estimate, loading }: { estimate: BudgetEstimate | null; loading: boolean }) {
  if (!estimate && !loading) return null
  const blocked = estimate?.check.allowed === false
  const warning = !!estimate?.check.warning
  const className = `wb-budget-estimate ${blocked ? 'blocked' : warning ? 'warning' : ''}`
  return (
    <span className={className} title={estimate?.check.reason || estimate?.check.warning || undefined}>
      {loading && !estimate
        ? tr('估算中...', 'Estimating...')
        : (
          <>
            <strong>{formatBudgetTokens(estimate?.totalTokens || 0)}</strong>
            <em>{estimate?.estimatedRequests || 1}x</em>
            <small>{estimate?.estimatedCostUsd == null ? tr('未定价', 'unpriced') : formatBudgetCost(estimate.estimatedCostUsd)}</small>
          </>
        )}
    </span>
  )
}

function formatBudgetTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`
  if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}k tok`
  return `${tokens} tok`
}

function formatBudgetCost(cost: number): string {
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

function providerAgentRows(providers: ProviderDef[]): PickerAgentRow[] {
  return providers
    .filter(provider => provider.enabled && !!provider.apiKey && !provider.apiKeyLocked && provider.models?.some(model => model.enabled !== false))
    .map(provider => ({
      source: 'provider-agent',
      id: `provider-agent:${provider.id}`,
      label: provider.name,
      subtitle: tr(`${provider.models.length} 个模型`, `${provider.models.length} models`),
      providerId: provider.id,
      modelCount: provider.models.length
    }))
}

function providerModelRows(providers: ProviderDef[], onlyProviderId?: string | null): PickerModelRow[] {
  const rows: PickerModelRow[] = []
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey || provider.apiKeyLocked || !provider.models?.length) continue
    if (onlyProviderId && provider.id !== onlyProviderId) continue
    for (const model of provider.models) {
      if (model.enabled === false) continue
      rows.push({
        source: 'provider-model',
        id: `provider:${provider.id}:${model.id}`,
        label: model.label || model.id,
        subtitle: `${provider.name} · ${model.id}`,
        providerId: provider.id,
        modelId: model.id,
        contextWindow: model.contextWindow || 258_000
      })
    }
  }
  return rows
}

function ContextCapacityIndicator({
  text,
  attachments,
  workspaceId: _workspaceId,
  modelSelection,
  providers
}: {
  text: string
  attachments: WorkbenchAttachment[]
  workspaceId: string | null
  modelSelection: ModelSelection
  providers: ProviderDef[]
}) {
  // W-M4b: useMemo instead of effect+setState — derived value recomputed only when inputs change,
  // no extra render pass per keystroke.
  const capacity = useMemo<{ usedRatio: number; tone: string } | null>(() => {
    const provider = providers.find(p => p.id === modelSelection.providerId)
    const model = provider?.models?.find(m => m.id === modelSelection.modelId)
    const windowTokens = model?.contextWindow || 128_000
    // Simple text-based estimation
    const textTokens = Math.ceil((text.length + attachments.reduce((sum, a) => sum + (a.text?.length || 0), 0)) / 4)
    const usedRatio = Math.min(1, textTokens / windowTokens)
    const tone = usedRatio > 0.85 ? 'danger' : usedRatio > 0.7 ? 'warn' : 'ok'
    return { usedRatio, tone }
  }, [text, attachments, modelSelection, providers])

  if (!capacity) return null

  const pct = Math.round(capacity.usedRatio * 100)
  const color = capacity.tone === 'danger' ? 'var(--color-error)' : capacity.tone === 'warn' ? 'var(--color-warning)' : 'var(--tx-3)'

  return (
    <span
      style={{ fontSize: 11, color, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-input)' }}
      title={tr(`上下文占用: ${pct}%`, `Context usage: ${pct}%`)}
    >
      {pct}%
    </span>
  )
}

export function quickRoleSchedule(role: 'reviewer' | 'executor' | 'gatekeeper', readyAgentIds: string[]): SchedulePreview | null {
  const agentId = pickAgentForRole(role, readyAgentIds)
  if (!agentId) return null
  if (role === 'executor') {
    const reviewerAgentId = pickAgentForRole('reviewer', readyAgentIds) || agentId
    return {
      preset: 'custom',
      label: 'Quick executor',
      labelZh: '快速执行',
      labelEn: 'Quick executor',
      description: 'Temporarily review and dispatch one executor child agent for this turn.',
      descriptionZh: '本轮临时先审查，再派发一个执行子 Agent。',
      descriptionEn: 'Temporarily review and dispatch one executor child agent for this turn.',
      steps: [
        {
          id: 'quick-reviewer',
          label: 'Quick reviewer',
          labelZh: '快速评审',
          labelEn: 'Quick reviewer',
          agentId: reviewerAgentId,
          role: 'reviewer',
          mode: 'auto'
        } as any,
        {
          id: 'quick-executor',
          label: 'Quick executor',
          labelZh: '快速执行',
          labelEn: 'Quick executor',
          agentId,
          role,
          mode: 'auto',
          dependsOn: ['quick-reviewer']
        } as any
      ]
    }
  }
  const label = role === 'reviewer' ? 'Quick reviewer' : 'Quick gatekeeper'
  const labelZh = role === 'reviewer' ? '快速评审' : '快速门禁'
  return {
    preset: 'custom',
    label: `Quick ${role}`,
    labelZh,
    labelEn: `Quick ${role}`,
    description: `Temporarily dispatch one ${role} child agent for this turn.`,
    descriptionZh: `本轮临时派发一个${role === 'reviewer' ? '评审' : '门禁'}子 Agent。`,
    descriptionEn: `Temporarily dispatch one ${role} child agent for this turn.`,
    steps: [
      {
        id: `quick-${role}`,
        label,
        labelZh,
        labelEn: label,
        agentId,
        role,
        mode: 'auto'
      } as any
    ]
  }
}

export function quickRoleSendOverrides(schedule: SchedulePreview | null | undefined, selectedAgent?: string | null): ComposerSendOverrides | undefined {
  if (!schedule) return undefined
  return {
    mode: 'custom',
    targetAgent: selectedAgent ?? null,
    customSchedule: schedule,
    modelSelection: null
  }
}

function isBuiltInRoutingPreview(mode: DispatchPreset, schedule: SchedulePreview): boolean {
  if (schedule.graph || schedule.preset !== mode || schedule.steps.length !== 1) return false
  const step = schedule.steps[0]
  if (mode === 'auto') return step.id === 'auto' && step.agentId === 'auto' && step.mode === 'auto'
  if (mode === 'broadcast') return step.id === 'broadcast' && step.agentId === 'all' && step.mode === 'broadcast'
  return false
}

function scheduleSnapshotForSubmission(mode: DispatchPreset, schedule: SchedulePreview | undefined): SchedulePreview | undefined {
  return schedule && !isBuiltInRoutingPreview(mode, schedule) ? schedule : undefined
}

function cloneSchedule(schedule: SchedulePreview | undefined): SchedulePreview | null {
  if (!schedule) return null
  return normalizeScheduleForStorage(JSON.parse(JSON.stringify(schedule)) as SchedulePreview)
}

function sameAttachments(current: WorkbenchAttachment[], submitted: WorkbenchAttachment[]): boolean {
  if (current.length !== submitted.length) return false
  return current.every((item, index) => (
    item.id === submitted[index]?.id
    && item.path === submitted[index]?.path
    && item.dataUrl === submitted[index]?.dataUrl
    && item.text === submitted[index]?.text
  ))
}

function isRouteFailure(reason: ComposerSendFailureReason | null): boolean {
  return reason === 'routing-unavailable'
    || reason === 'schedule-target-unavailable'
    || reason === 'schedule-unavailable'
}

function createComposerSubmission(input: {
  id: number
  prompt: string
  draftText: string
  attachments: WorkbenchAttachment[]
  mode: DispatchPreset
  targetAgent: string | null
  modelSelection: ModelSelection | null
  multiModelFusion: boolean
  schedule?: SchedulePreview
  quickRole: ComposerSubmission['quickRole']
  clearDraftOnSuccess: boolean
  ownerKey: string
}): ComposerSubmission {
  const quickOverrides = input.quickRole === 'none' ? null : quickRoleSendOverrides(input.schedule, input.targetAgent)
  return {
    id: input.id,
    text: input.prompt,
    draftText: input.draftText,
    attachments: input.attachments.map(item => ({ ...item })),
    overrides: quickOverrides
      ? { ...quickOverrides, customSchedule: cloneSchedule(input.schedule), multiModelFusion: input.multiModelFusion }
      : {
          mode: input.mode,
          targetAgent: input.targetAgent,
          modelSelection: input.modelSelection ? { ...input.modelSelection } : null,
          customSchedule: cloneSchedule(input.schedule),
          multiModelFusion: input.multiModelFusion
        },
    clearDraftOnSuccess: input.clearDraftOnSuccess,
    quickRole: input.quickRole,
    ownerKey: input.ownerKey
  }
}

export function pickAgentForRole(role: 'reviewer' | 'executor' | 'gatekeeper', readyAgentIds: string[]): string | null {
  const fallback = readyAgentIds[0] || null
  const preferred = role === 'executor'
    ? ['codex', 'minimax-code', 'claude']
    : ['claude', 'codex', 'minimax-code']
  return preferred.find(id => readyAgentIds.includes(id)) || fallback
}

function approvalModes(): Array<{ id: SelectableApprovalMode; label: string; detail: string; icon: React.ReactNode }> {
  return [
    {
      id: 'ask',
      label: approvalDisplayModeLabel('ask'),
      detail: approvalDisplayModeDetail('ask'),
      icon: IC.tasks
    },
    {
      id: 'auto',
      label: approvalDisplayModeLabel('auto'),
      detail: approvalDisplayModeDetail('auto'),
      icon: IC.broadcast
    },
    {
      id: 'full',
      label: approvalDisplayModeLabel('full'),
      detail: approvalDisplayModeDetail('full'),
      icon: IC.bolt
    }
  ]
}

function approvalIconForMode(mode: ApprovalDisplayMode): React.ReactNode {
  if (mode === 'read-only') return IC.file
  if (mode === 'custom') return IC.gear
  return approvalModes().find(item => item.id === mode)?.icon || IC.tasks
}

function filterPickerAgentRows(rows: PickerAgentRow[], query: string): PickerAgentRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(row => `${row.id} ${row.label} ${row.subtitle}`.toLowerCase().includes(q))
}

function filterPickerModelRows(models: PickerModelRow[], query: string): PickerModelRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter(model => `${model.id} ${model.label} ${model.subtitle}`.toLowerCase().includes(q))
}

function pickerAgentRowSelected(row: PickerAgentRow, selectedAgentId: string | null, activeProviderId: string | null, selection: ModelSelection | null): boolean {
  if (row.source === 'local-agent') return row.agentId === selectedAgentId
  return row.providerId === activeProviderId || (!!selection?.providerId && selection.providerId === row.providerId && !selectedAgentId)
}

function modelSelectionKey(selection: ModelSelection | null): string {
  if (selection?.source === 'provider' && selection.providerId) return `provider:${selection.providerId}:${selection.modelId}`
  return ''
}

function commandCategoryLabel(category: WorkbenchCommand['category']): string {
  if (category === 'session') return tr('会话', 'Session')
  if (category === 'agent') return 'Agent'
  if (category === 'schedule') return tr('调度', 'Schedule')
  if (category === 'tool') return tr('工具', 'Tool')
  if (category === 'skill') return tr('技能', 'Skill')
  if (category === 'ecc') return tr('工作流指令', 'Workflow')
  return tr('工作区', 'Workspace')
}

function commandDescription(command: WorkbenchCommand): string {
  if (getLang() === 'en') return command.descriptionEn || command.description
  return command.descriptionZh || command.description
}

function scheduleDisplayLabel(schedule: SchedulePreview): string {
  if (getLang() === 'zh' && schedule.labelZh) return schedule.labelZh
  if (getLang() === 'en' && schedule.labelEn) return schedule.labelEn
  return schedule.label
}

function decisionAccepted(result: DecisionBarSubmitResult): boolean {
  return result === true || (typeof result === 'object' && result !== null && result.accepted === true)
}

export async function sha256Text(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto is unavailable')
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function agentDisplayName(agentId: string): string {
  return AGENT_META[agentId]?.name || localAgentLabel(agentId)
}
