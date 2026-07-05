import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BindingDef, ProviderDef } from '../glass/meta'
import { ApprovalDialog, ApprovalItem } from '../glass/approval-dialog'
type MotionLevel = 'off' | 'subtle' | 'rich'
import { summarizeAgentConnections } from '../glass/connection-status'
import { tr } from '../glass/i18n'
import { SessionSidebar } from './SessionSidebar'
import { WorkbenchMainContent } from './WorkbenchMainContent'
import { WorkbenchAnnouncementModal } from './WorkbenchAnnouncementModal'
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { WorkbenchPanelContainers } from './WorkbenchPanelContainers'
import { WorkspaceItem, AgentMap } from './types'
import { CommandPalette } from './CommandPalette'
import { NativeTitlebar } from './NativeTitlebar'
import { clampInspectorWidth } from './WorkbenchPanels'
import { localAgentOptions } from './localAgentOptions'
import { readRememberedWorkspaceId, rememberWorkbenchWorkspaceId, resolveWorkbenchWorkspaceId } from './workspaceSelection'
import { customScheduleHasRunnableSteps, defaultCustomSchedule, defaultSmartFiveRoleSchedule, isStoredSchedule, normalizeStoredScheduleOverrides } from './customSchedule'
import { readAppearanceLocal } from '../appearance'
import { styledConfirm } from '../lib/confirm'
import {
  findSddPlanTodosForRuntimeEvent,
  getSddPlanDispatchGitBaseline,
  isSddPlanTodo,
  persistSddPlanCompletedTurnGitEvidence,
  persistSddPlanDispatch,
  persistSddPlanTodoStatus
} from '../sdd/sdd-trace-dispatch'
import { mergeRuntimeEventLists, isBufferedRuntimeEvent, isTaskHistoryEvent, runtimeAgentStatusFromEvent, shouldFlushFirstStreamDelta } from './utils/eventUtils'
import { parseSlashInput, parseLoopLimit, stripLoopFlags } from './utils/slashCommandUtils'
import { selectableModelOptions, isSelectableModel, resolveModelCommand, reasoningFromCommand, reasoningLabel, type WorkbenchThinking } from './utils/modelUtils'
import { deriveTaskItems, type RuntimeTaskEventsByThread } from './utils/taskItems'
import { approvalItemFromRuntimeEvent } from './utils/approvalEvents'
import { watchTerminalRun } from './utils/terminalRunWatcher'
import { buildPaletteCommands, resolvePaletteExtraAction } from './utils/paletteCommands'
import { resolveShortcutCommandAction } from './utils/shortcutCommands'
import { resolveWorkbenchMenuCommand } from './utils/menuCommands'
import { resolveDispatchRequest } from './utils/dispatchRequest'
import { resolveWorkbenchRoutingSelectionPatch, type WorkbenchRoutingSelectionPatch } from './state/routingSelectionState'
import {
  INSPECTOR_WIDTH_STORE_KEY,
  useWorkbenchUiStore,
  type WorkbenchUiSettingsTabKey
} from './state/ui-store'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  KEYBOARD_SHORTCUT_STORE_KEY,
  KEYBOARD_SHORTCUTS_CHANGED,
  KeyboardShortcutsConfigV1,
  normalizeKeyboardShortcuts,
  resolveKeyboardShortcutBindings
} from '../keyboard-shortcuts'

const LAST_THREAD_STORE_KEY = 'agenthub.workbench.lastThread.v1'
const CUSTOM_SCHEDULE_STORE_KEY = 'agenthub.workbench.customSchedule.v1'
const SMART_SCHEDULE_STORE_KEY = 'agenthub.workbench.smartFiveRoleSchedule.v1'
const SCHEDULE_OVERRIDES_STORE_KEY = 'agenthub.workbench.scheduleOverrides.v1'

interface WorkbenchLayoutProps {
  hubRunning: boolean
  proxyHost: string
  agents: AgentMap
  providers: ProviderDef[]
  bindings: BindingDef[]
  fallbackChain: string[]
  providerActions: {
    onSetEnabled: (id: string, enabled: boolean) => void
    onSetKey: (id: string, key: string) => void
    onSetBinding: (b: BindingDef) => void
    onSetFallback: (chain: string[]) => void
    onReload: () => void
    onUpsertProvider: (p: any) => void
    onDeleteProvider: (id: string) => void
    onReorderProvidersForClaude: (orderedIds: string[]) => void
  }
  configLoadError?: string | null
  onRuntimeAgentStatus?: (agentId: string, status: 'busy' | 'idle', runKey: string) => void
  motion: MotionLevel
  setMotion: (m: MotionLevel) => void
}

export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  const view = useWorkbenchUiStore(state => state.view)
  const setView = useWorkbenchUiStore(state => state.setView)
  const applyStartupView = useWorkbenchUiStore(state => state.applyStartupView)
  const settingsTab = useWorkbenchUiStore(state => state.settingsTab)
  const setSettingsTab = useWorkbenchUiStore(state => state.setSettingsTab)
  const rightPanel = useWorkbenchUiStore(state => state.rightPanel)
  const setRightPanel = useWorkbenchUiStore(state => state.setRightPanel)
  const inspectorWidth = useWorkbenchUiStore(state => state.inspectorWidth)
  const setInspectorWidth = useWorkbenchUiStore(state => state.setInspectorWidth)
  const hydrateInspectorWidth = useWorkbenchUiStore(state => state.hydrateInspectorWidth)
  const announcementOpen = useWorkbenchUiStore(state => state.announcementOpen)
  const closeAnnouncement = useWorkbenchUiStore(state => state.closeAnnouncement)
  const commandPaletteOpen = useWorkbenchUiStore(state => state.commandPaletteOpen)
  const setCommandPaletteOpen = useWorkbenchUiStore(state => state.setCommandPaletteOpen)
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>({ threads: [], turns: [], runs: [], activeThreadId: null })
  const [selectedThreadId, setSelectedThreadIdState] = useState<string | null>(null)
  const [allThreads, setAllThreads] = useState<WorkbenchThread[]>([])
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  const [taskEventsByThread, setTaskEventsByThread] = useState<RuntimeTaskEventsByThread>({})
  const [approvals, setApprovals] = useState<ApprovalItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [pendingActiveThreadId, setPendingActiveThreadId] = useState<string | null>(null)
  const emptyWorkspaceRetryRef = useRef(0)
  const [mode, setMode] = useState<DispatchPreset>('lead-workers')
  const [targetAgent, setTargetAgent] = useState<string | null>(null)
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null)
  const [thinking, setThinking] = useState<WorkbenchThinking>({ mode: 'auto', level: 'medium', collapseInUI: true })
  const [schedules, setSchedules] = useState<SchedulePreview[]>([])
  const [activeGoal, setActiveGoal] = useState<WorkbenchGoal | null>(null)
  const [threadTodos, setThreadTodosState] = useState<ThreadTodo[]>([])
  const [dispatchingTodoId, setDispatchingTodoId] = useState<string | null>(null)
  const [customSchedule, setCustomScheduleState] = useState<SchedulePreview>(() => defaultCustomSchedule())
  const [smartSchedule, setSmartScheduleState] = useState<SchedulePreview>(() => defaultSmartFiveRoleSchedule())
  const [scheduleOverrides, setScheduleOverridesState] = useState<Partial<Record<DispatchPreset, SchedulePreview>>>({})
  const [localAgents, setLocalAgents] = useState<LocalAgentStatus[]>([])
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [selectedAgentDetail, setSelectedAgentDetail] = useState<{ agentId: string; turnId: string } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => { setSendError(null) }, [view])
  const [viewportWidth, setViewportWidth] = useState(typeof window === 'undefined' ? 1280 : window.innerWidth)
  const [terminalRuns, setTerminalRuns] = useState<TerminalRun[]>([])
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<WorkbenchAttachment[]>([])
  const [pendingBrowserUrl, setPendingBrowserUrl] = useState<string | null>(null)
  const [keyboardShortcuts, setKeyboardShortcuts] = useState<KeyboardShortcutsConfigV1>({ bindings: {} })
  const snapshotRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRuntimeEvents = useRef<RuntimeEvent[]>([])
  const seenImmediateStreamKeys = useRef<Set<string>>(new Set())
  const loadingThreadIdRef = useRef<string | null>(null)
  const loadWorkbenchGenRef = useRef(0)
  const selectThreadGenRef = useRef(0)
  const runtimeEventFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadScrollRef = useRef<HTMLElement | null>(null)
  const shouldStickToBottom = useRef(true)
  const fullyLoadedTaskThreadIds = useRef<Set<string>>(new Set())
  const smartScheduleStoreLoaded = useRef(false)
  const userExplicitAgentRef = useRef<string | null>(null)  // 跟踪用户明确选择的 agent
  const selectedThreadIdRef = useRef<string | null>(null)
  const threadTodosRef = useRef<ThreadTodo[]>([])
  const terminalWatchAbortRef = useRef<AbortController | null>(null)

  // Cleanup terminal watch on unmount
  useEffect(() => {
    return () => { terminalWatchAbortRef.current?.abort() }
  }, [])

  const setSelectedThreadId = useCallback((threadId: string | null) => {
    selectedThreadIdRef.current = threadId
    setSelectedThreadIdState(threadId)
    try {
      if (threadId) localStorage.setItem(LAST_THREAD_STORE_KEY, threadId)
      else localStorage.removeItem(LAST_THREAD_STORE_KEY)
    } catch { /* noop */ }
  }, [])

  const setThreadTodos = useCallback((todos: ThreadTodo[]) => {
    threadTodosRef.current = todos
    setThreadTodosState(todos)
  }, [])

  const rememberWorkspaceId = useCallback((id: string | null) => {
    rememberWorkbenchWorkspaceId(id)
  }, [])

  const setCustomSchedule = useCallback((schedule: SchedulePreview) => {
    const next = { ...schedule, preset: 'custom' as DispatchPreset }
    setCustomScheduleState(next)
    window.electronAPI.store.set(CUSTOM_SCHEDULE_STORE_KEY, next).catch(() => {})
  }, [])

  const setSmartSchedule = useCallback((schedule: SchedulePreview) => {
    const next = { ...schedule, preset: 'firefly-custom' as DispatchPreset }
    setSmartScheduleState(next)
    window.electronAPI.store.set(SMART_SCHEDULE_STORE_KEY, next).catch(() => {})
  }, [])

  const setScheduleForMode = useCallback((preset: DispatchPreset, schedule: SchedulePreview) => {
    const next = { ...schedule, preset }
    if (preset === 'custom') {
      setCustomSchedule(next)
      return
    }
    if (preset === 'firefly-custom') {
      setSmartSchedule(next)
      return
    }
    setScheduleOverridesState(prev => {
      const updated = { ...prev, [preset]: next }
      window.electronAPI.store.set(SCHEDULE_OVERRIDES_STORE_KEY, updated).catch(() => {})
      return updated
    })
  }, [setCustomSchedule, setSmartSchedule])

  const selectedThreadStillVisible = selectedThreadId && snapshot.threads.some(thread => thread.id === selectedThreadId)
  const activeThreadId = selectedThreadStillVisible ? selectedThreadId : null
  const sidebarActiveThreadId = pendingActiveThreadId ?? activeThreadId
  const visibleThreadId = pendingActiveThreadId ?? activeThreadId

  const refreshThreadTodos = useCallback(async (threadId = activeThreadId) => {
    if (!threadId) {
      if (!selectedThreadIdRef.current) setThreadTodosState([])
      if (!selectedThreadIdRef.current) threadTodosRef.current = []
      return
    }
    const todos = await window.electronAPI.todos.list(threadId)
    if (selectedThreadIdRef.current === threadId) {
      threadTodosRef.current = todos
      setThreadTodosState(todos)
    }
  }, [activeThreadId])

  const syncSddPlanTodoForRuntimeEvent = useCallback(async (event: RuntimeEvent, seedTodos?: ThreadTodo[]) => {
    const persistedTodos = await window.electronAPI.todos.list(event.threadId).catch(() => [])
    const seedOnlyTodos = (seedTodos ?? []).filter(seed => !persistedTodos.some(todo => todo.id === seed.id))
    const todosForEventThread = [...persistedTodos, ...seedOnlyTodos]
    const sddTodoStatusUpdates = findSddPlanTodosForRuntimeEvent(todosForEventThread, event)
    for (const { todo, status } of sddTodoStatusUpdates) {
      const nextSource = { ...(todo.source || { kind: 'manual' as const }), threadId: event.threadId }
      const nextTodo = { ...todo, status, source: nextSource }
      await window.electronAPI.todos.upsert({
        threadId: event.threadId,
        id: todo.id,
        content: todo.content,
        status,
        source: nextSource
      })
      await persistSddPlanTodoStatus(nextTodo, status)
      if (status === 'completed') {
        await persistSddPlanCompletedTurnGitEvidence({ workspaceId, todo: nextTodo, event })
      }
    }
    if (sddTodoStatusUpdates.length > 0) {
      await refreshThreadTodos(event.threadId)
    }
  }, [refreshThreadTodos, workspaceId])

  const appendRuntimeEvents = useCallback((nextEvents: RuntimeEvent[]) => {
    if (nextEvents.length === 0) return
    setEvents(prev => mergeRuntimeEventLists(prev, nextEvents))
  }, [])

  const appendTaskRuntimeEvents = useCallback((threadId: string, nextEvents: RuntimeEvent[]) => {
    if (nextEvents.length === 0) return
    setTaskEventsByThread(prev => ({
      ...prev,
      [threadId]: mergeRuntimeEventLists(prev[threadId] || [], nextEvents)
    }))
  }, [])

  const appendApprovalFromRuntimeEvent = useCallback((event: RuntimeEvent) => {
    const item = approvalItemFromRuntimeEvent(event)
    if (!item) return
    setApprovals(prev => prev.some(existing => existing.id === item.id) ? prev : [...prev, item])
  }, [])

  const flushRuntimeEvents = useCallback(() => {
    if (runtimeEventFlushTimer.current) {
      clearTimeout(runtimeEventFlushTimer.current)
      runtimeEventFlushTimer.current = null
    }
    const next = pendingRuntimeEvents.current
    pendingRuntimeEvents.current = []
    appendRuntimeEvents(next)
  }, [appendRuntimeEvents])

  const clearRuntimeEventBuffer = useCallback(() => {
    if (runtimeEventFlushTimer.current) {
      clearTimeout(runtimeEventFlushTimer.current)
      runtimeEventFlushTimer.current = null
    }
    pendingRuntimeEvents.current = []
    seenImmediateStreamKeys.current.clear()
  }, [])

  const enqueueRuntimeEvent = useCallback((event: RuntimeEvent) => {
    if (shouldFlushFirstStreamDelta(event, seenImmediateStreamKeys.current)) {
      appendRuntimeEvents([event])
      return
    }
    pendingRuntimeEvents.current.push(event)
    if (runtimeEventFlushTimer.current) return
    runtimeEventFlushTimer.current = setTimeout(() => {
      runtimeEventFlushTimer.current = null
      const next = pendingRuntimeEvents.current
      pendingRuntimeEvents.current = []
      appendRuntimeEvents(next)
    }, 80)
  }, [appendRuntimeEvents])

  const preserveSelectedSnapshot = useCallback((next: WorkbenchSnapshot, previous: WorkbenchSnapshot): WorkbenchSnapshot => {
    const selected = selectedThreadIdRef.current
    if (selected && next.threads.some(thread => thread.id === selected)) {
      return { ...next, activeThreadId: selected }
    }
    const previousActive = previous.activeThreadId
    if (previousActive && next.threads.some(thread => thread.id === previousActive)) {
      return { ...next, activeThreadId: previousActive }
    }
    return next
  }, [])

  const loadWorkbench = useCallback(async (nextWorkspaceId?: string | null) => {
    const gen = ++loadWorkbenchGenRef.current
    clearRuntimeEventBuffer()
    const [wsList, activeWs, scheduleList, local] = await Promise.all([
      window.electronAPI.workspaces.list().catch(() => []),
      window.electronAPI.workspaces.getActive().catch(() => null),
      window.electronAPI.schedules.list().catch(() => []),
      window.electronAPI.localAgents.status().catch(() => [])
    ])

    const resolvedWorkspaceId = resolveWorkbenchWorkspaceId({
      requestedWorkspaceId: nextWorkspaceId,
      currentWorkspaceId: workspaceId,
      activeWorkspaceId: activeWs,
      rememberedWorkspaceId: readRememberedWorkspaceId(),
      workspaces: wsList
    })
    if (nextWorkspaceId === undefined && resolvedWorkspaceId && resolvedWorkspaceId !== activeWs) {
      window.electronAPI.workspaces.setActive(resolvedWorkspaceId).catch(() => null)
    }
    const [snap, allSnap] = await Promise.all([
      window.electronAPI.runtime.snapshot(resolvedWorkspaceId),
      window.electronAPI.runtime.snapshot(undefined)
    ])
    if (loadWorkbenchGenRef.current !== gen) return
    if (wsList.length > 0) emptyWorkspaceRetryRef.current = 0

    let persistedThreadId: string | null = null
    try { persistedThreadId = localStorage.getItem(LAST_THREAD_STORE_KEY) } catch { /* noop */ }
    const selectedStillVisible = selectedThreadIdRef.current && snap.threads.some(thread => thread.id === selectedThreadIdRef.current)
    const persistedStillVisible = persistedThreadId && snap.threads.some(thread => thread.id === persistedThreadId)
    const nextVisibleThreadId = selectedStillVisible
      ? selectedThreadIdRef.current
      : persistedStillVisible
        ? persistedThreadId
        : snap.threads[0]?.id ?? null
    setSnapshot({ ...snap, activeThreadId: nextVisibleThreadId })
    setAllThreads(allSnap.threads)
    setWorkspaces(wsList)
    setWorkspaceId(resolvedWorkspaceId)
    rememberWorkspaceId(resolvedWorkspaceId)
    setSchedules(scheduleList)
    setLocalAgents(local)
    if (!selectedStillVisible) setSelectedThreadId(nextVisibleThreadId)

    if (nextVisibleThreadId) {
      loadingThreadIdRef.current = nextVisibleThreadId
      const loadedEvents = await window.electronAPI.runtime.eventsSince(nextVisibleThreadId, 0)
      if (loadWorkbenchGenRef.current !== gen) return
      const pendingForVisible = pendingRuntimeEvents.current.filter(event => event.threadId === nextVisibleThreadId)
      fullyLoadedTaskThreadIds.current.add(nextVisibleThreadId)
      setTaskEventsByThread(prev => ({
        ...prev,
        [nextVisibleThreadId]: mergeRuntimeEventLists(loadedEvents, pendingForVisible)
      }))
      setEvents(prev => mergeRuntimeEventLists(
        loadedEvents,
        [
          ...prev.filter(event => event.threadId === nextVisibleThreadId),
          ...pendingForVisible
        ]
      ))
      setThreadTodos(await window.electronAPI.todos.list(nextVisibleThreadId).catch(() => []))
      if (loadWorkbenchGenRef.current !== gen) return
      if (loadingThreadIdRef.current === nextVisibleThreadId) loadingThreadIdRef.current = null
    } else {
      setEvents([])
      setThreadTodos([])
      loadingThreadIdRef.current = null
      if (nextWorkspaceId === undefined && wsList.length === 0) {
        window.setTimeout(() => {
          if (loadWorkbenchGenRef.current === gen) loadWorkbench().catch(() => {})
        }, 500)
      }
    }
  }, [workspaceId, clearRuntimeEventBuffer, rememberWorkspaceId])

  useEffect(() => {
    loadWorkbench().catch(() => {})
  }, [])

  useEffect(() => {
    applyStartupView(readAppearanceLocal().startupOpenTarget)
  }, [applyStartupView])

  useEffect(() => {
    // LOW-16: rAF throttle to avoid excessive re-renders during resize
    let rafId = 0
    const onResize = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => setViewportWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    window.electronAPI.store.get(CUSTOM_SCHEDULE_STORE_KEY)
      .then(value => { if (isStoredSchedule(value, 'custom')) setCustomScheduleState(value) })
      .catch(() => {})
    window.electronAPI.store.get(SMART_SCHEDULE_STORE_KEY)
      .then(value => {
        smartScheduleStoreLoaded.current = true
        if (isStoredSchedule(value, 'firefly-custom')) setSmartScheduleState(value)
      })
      .catch(() => {})
    window.electronAPI.store.get(SCHEDULE_OVERRIDES_STORE_KEY)
      .then(value => setScheduleOverridesState(normalizeStoredScheduleOverrides(value)))
      .catch(() => {})
    window.electronAPI.store.get(INSPECTOR_WIDTH_STORE_KEY)
      .then(value => hydrateInspectorWidth(value))
      .catch(() => {})
    window.electronAPI.terminal.history().then(setTerminalRuns).catch(() => {})
  }, [hydrateInspectorWidth])

  useEffect(() => {
    const unsubscribe = window.electronAPI.runtime.onEvent(event => {
      const isPendingThreadEvent = pendingActiveThreadId !== null && event.threadId === loadingThreadIdRef.current
      const isVisibleThreadEvent = event.threadId === selectedThreadIdRef.current
      appendApprovalFromRuntimeEvent(event)
      const runtimeAgentStatus = runtimeAgentStatusFromEvent(event)
      if (runtimeAgentStatus) {
        props.onRuntimeAgentStatus?.(runtimeAgentStatus.agentId, runtimeAgentStatus.status, runtimeAgentStatus.runKey)
      }

      void syncSddPlanTodoForRuntimeEvent(event).catch(() => {})

      if (isPendingThreadEvent) {
        appendTaskRuntimeEvents(event.threadId, [event])
        pendingRuntimeEvents.current.push(event)
        return
      }

      if (isVisibleThreadEvent) {
        appendTaskRuntimeEvents(event.threadId, [event])
        if (isBufferedRuntimeEvent(event)) enqueueRuntimeEvent(event)
        else {
          flushRuntimeEvents()
          appendRuntimeEvents([event])
        }
        if (event.kind === 'orchestrate' && event.payload?.kind === 'orchestrate:plan') {
          void refreshThreadTodos(event.threadId)
        }
      }

      if (!isVisibleThreadEvent && isTaskHistoryEvent(event)) {
        appendTaskRuntimeEvents(event.threadId, [event])
      }

      if (pendingActiveThreadId) {
        if (snapshotRefreshTimer.current) {
          clearTimeout(snapshotRefreshTimer.current)
          snapshotRefreshTimer.current = null
        }
        return
      }

      const immediate = event.kind === 'turn:created' || event.kind === 'turn:status' || event.kind === 'agent:done' || event.kind === 'agent:error' || event.kind === 'run:created' || event.kind === 'run:status'
      if (snapshotRefreshTimer.current) clearTimeout(snapshotRefreshTimer.current)
      snapshotRefreshTimer.current = setTimeout(() => {
        if (event.threadId === selectedThreadIdRef.current) {
          window.electronAPI.runtime.snapshot(workspaceId).then(next => {
            setSnapshot(prev => preserveSelectedSnapshot(next, prev))
          }).catch(() => {})
        } else {
          window.electronAPI.runtime.snapshot(workspaceId).then(next => {
            setSnapshot(prev => preserveSelectedSnapshot(next, prev))
          }).catch(() => {})
        }
        window.electronAPI.runtime.snapshot(undefined).then(snap => setAllThreads(snap.threads)).catch(() => {})
        snapshotRefreshTimer.current = null
      }, immediate ? 0 : 400)
    })
    return () => {
      unsubscribe()
      if (snapshotRefreshTimer.current) clearTimeout(snapshotRefreshTimer.current)
      clearRuntimeEventBuffer()
    }
  }, [activeThreadId, pendingActiveThreadId, workspaceId, props.onRuntimeAgentStatus, syncSddPlanTodoForRuntimeEvent, appendRuntimeEvents, appendTaskRuntimeEvents, appendApprovalFromRuntimeEvent, enqueueRuntimeEvent, flushRuntimeEvents, clearRuntimeEventBuffer])

  const onApprovalDecide = useCallback((item: ApprovalItem, approved: boolean, remember: boolean) => {
    if (remember) {
      window.electronAPI.agentic.setApprovalOverride(item.agentId, item.tool, approved ? 'allow' : 'deny').catch(() => {})
    }
    window.electronAPI.agentic.resolveApproval(item.id, approved).catch(() => {})
    setApprovals(prev => prev.filter(existing => existing.id !== item.id))
  }, [])

  useEffect(() => {
    refreshThreadTodos().catch(() => {})
  }, [refreshThreadTodos])

  const activeThread = useMemo(
    () => snapshot.threads.find(t => t.id === visibleThreadId) ?? null,
    [snapshot.threads, visibleThreadId]
  )

  const activeTurns = useMemo(
    () => activeThread ? snapshot.turns.filter(t => t.threadId === activeThread.id) : [],
    [snapshot.turns, activeThread]
  )
  const cancelLatest = useCallback(async () => {
    const running = [...activeTurns].reverse().find(t => t.status === 'running')
    if (running) {
      await window.electronAPI.turns.cancel(running.id)
      await loadWorkbench(workspaceId)
    }
  }, [activeTurns, loadWorkbench, workspaceId])

  const activeEvents = useMemo(
    () => visibleThreadId === activeThreadId ? events : events.filter(event => event.threadId === visibleThreadId),
    [events, visibleThreadId, activeThreadId]
  )
  const runtimeTasks = useMemo(
    () => deriveTaskItems(snapshot, taskEventsByThread),
    [snapshot, taskEventsByThread]
  )

  const connectionSummary = useMemo(
    () => summarizeAgentConnections({ agents: props.agents, bindings: props.bindings, providers: props.providers }),
    [props.agents, props.bindings, props.providers]
  )
  const selectableModels = useMemo(() => selectableModelOptions(props.providers), [props.providers])
  const selectableModelSignature = useMemo(
    () => selectableModels.map(item => `${item.providerId}/${item.modelId}`).join('|'),
    [selectableModels]
  )

  useEffect(() => {
    if (targetAgent) {
      if (modelSelection) setModelSelection(null)
      return
    }
    if (modelSelection && isSelectableModel(modelSelection, props.providers)) return
    if (modelSelection) setModelSelection(null)
  }, [targetAgent, modelSelection, props.providers, selectableModelSignature])

  useEffect(() => {
    if (props.providers.length > 0) return
    const timer = window.setTimeout(() => props.providerActions.onReload(), 350)
    return () => window.clearTimeout(timer)
  }, [props.providers.length, props.providerActions])

  const applyRoutingSelectionPatch = useCallback((patch: WorkbenchRoutingSelectionPatch) => {
    if (patch.targetAgent !== undefined) setTargetAgent(patch.targetAgent)
    if (patch.modelSelection !== undefined) setModelSelection(patch.modelSelection)
    if (patch.mode !== undefined) setMode(patch.mode)
  }, [])

  const selectTargetAgent = useCallback((agentId: string | null) => {
    userExplicitAgentRef.current = agentId  // 记录用户明确选择
    applyRoutingSelectionPatch(resolveWorkbenchRoutingSelectionPatch({ type: 'select-agent', agentId }))
  }, [applyRoutingSelectionPatch])

  useEffect(() => {
    if (!smartScheduleStoreLoaded.current) return
    const usable = localAgentOptions(localAgents)
    if (usable.length === 0 || customScheduleHasRunnableSteps(smartSchedule)) return
    const next = defaultSmartFiveRoleSchedule(usable)
    // MED-28: Stricter termination — skip if generated schedule is identical to current
    if (JSON.stringify(next) === JSON.stringify(smartSchedule)) return
    setSmartScheduleState(next)
    window.electronAPI.store.set(SMART_SCHEDULE_STORE_KEY, next).catch(() => {})
  }, [localAgents, smartSchedule])

  const scheduleForMode = useCallback((preset: DispatchPreset): SchedulePreview | undefined => {
    if (preset === 'custom') return customSchedule
    if (preset === 'firefly-custom') return smartSchedule
    return scheduleOverrides[preset] || schedules.find(schedule => schedule.preset === preset)
  }, [customSchedule, smartSchedule, scheduleOverrides, schedules])

  const dispatchScheduleForMode = useCallback((preset: DispatchPreset): SchedulePreview | undefined => {
    if (preset === 'custom') return customSchedule
    if (preset === 'firefly-custom') return smartSchedule
    return scheduleOverrides[preset]
  }, [customSchedule, smartSchedule, scheduleOverrides])

  const openSetup = useCallback((tab: WorkbenchUiSettingsTabKey = 'providers') => {
    setSettingsTab(tab)
    setView('settings')
  }, [setView])

  const ensureTaskEventsLoaded = useCallback(() => {
    const unloadedThreadIds = snapshot.threads
      .map(thread => thread.id)
      .filter(threadId => !fullyLoadedTaskThreadIds.current.has(threadId))
    if (unloadedThreadIds.length === 0) return
    Promise.all(unloadedThreadIds.map(async threadId => {
      const loaded = await window.electronAPI.runtime.eventsSince(threadId, 0).catch(() => [])
      return { threadId, loaded }
    })).then(results => {
      setTaskEventsByThread(prev => {
        const next = { ...prev }
        for (const { threadId, loaded } of results) {
          fullyLoadedTaskThreadIds.current.add(threadId)
          next[threadId] = mergeRuntimeEventLists(next[threadId] || [], loaded)
        }
        return next
      })
    }).catch(() => {})
  }, [snapshot.threads])

  useEffect(() => {
    if (view === 'tasks') ensureTaskEventsLoaded()
  }, [view, ensureTaskEventsLoaded])

  const cancelRuntimeTask = useCallback(async (id: string) => {
    await window.electronAPI.turns.cancel(id).catch(() => false)
    loadWorkbench(workspaceId).catch(() => {})
  }, [loadWorkbench, workspaceId])

  const deleteRuntimeTask = useCallback(async (id: string) => {
    const ok = await styledConfirm({ message: tr('删除这条任务历史？对应的运行详情也会从当前会话记录中移除。', 'Delete this task history? Its run details will also be removed from the current conversation.'), danger: true })
    if (!ok) return
    await window.electronAPI.tasks.delete(id).catch(() => false)
    fullyLoadedTaskThreadIds.current.clear()
    setTaskEventsByThread({})
    loadWorkbench(workspaceId).catch(() => {})
  }, [loadWorkbench, workspaceId])

  const clearCompletedRuntimeTasks = useCallback(async () => {
    const ok = await styledConfirm({ message: tr('清理所有已结束的任务历史？对应的运行详情也会从当前会话记录中移除。', 'Clear all finished task history? Matching run details will also be removed from the current conversation.'), danger: true })
    if (!ok) return
    await window.electronAPI.tasks.clearCompleted().catch(() => false)
    fullyLoadedTaskThreadIds.current.clear()
    setTaskEventsByThread({})
    loadWorkbench(workspaceId).catch(() => {})
  }, [loadWorkbench, workspaceId])

  const openAnnouncementSetup = (tab: WorkbenchUiSettingsTabKey) => {
    closeAnnouncement()
    openSetup(tab)
  }

  const selectWorkspace = async (id: string | null) => {
    setWorkspaceId(id)
    rememberWorkspaceId(id)
    fullyLoadedTaskThreadIds.current.clear()
    setTaskEventsByThread({})
    await window.electronAPI.workspaces.setActive(id).catch(() => null)
    await loadWorkbench(id)
    setView('chat')
  }

  const selectThread = async (threadId: string | null) => {
    const gen = ++selectThreadGenRef.current
    loadWorkbenchGenRef.current += 1
    flushRuntimeEvents()
    clearRuntimeEventBuffer()
    setPendingActiveThreadId(threadId)
    loadingThreadIdRef.current = threadId
    const thread = allThreads.find(t => t.id === threadId)
    const threadWorkspaceId = thread ? thread.workspaceId : workspaceId
    if (threadWorkspaceId !== workspaceId) {
      await window.electronAPI.workspaces.setActive(threadWorkspaceId).catch(() => null)
    }

    try {
      const selected = await window.electronAPI.threads.select(threadId)
      if (selectThreadGenRef.current !== gen) return // stale — newer call in progress
      const [snap, allSnap, loadedEvents, todos, goal] = await Promise.all([
        window.electronAPI.runtime.snapshot(threadWorkspaceId),
        window.electronAPI.runtime.snapshot(undefined),
        selected ? window.electronAPI.runtime.eventsSince(selected, 0) : Promise.resolve([]),
        selected ? window.electronAPI.todos.list(selected).catch(() => []) : Promise.resolve([]),
        selected ? window.electronAPI.goals.get(selected).catch(() => null) : Promise.resolve(null)
      ])
      if (selectThreadGenRef.current !== gen) return // stale
      const pendingForSelected = selected ? pendingRuntimeEvents.current.filter(event => event.threadId === selected) : []
      clearRuntimeEventBuffer()
      if (selectThreadGenRef.current !== gen) return // stale — newer call before final writes
      setSnapshot({ ...snap, activeThreadId: selected })
      setAllThreads(allSnap.threads)
      if (selected) fullyLoadedTaskThreadIds.current.add(selected)
      if (selected) {
        setTaskEventsByThread(prev => ({
          ...prev,
          [selected]: mergeRuntimeEventLists(loadedEvents, pendingForSelected)
        }))
      }
      setEvents(prev => selected ? mergeRuntimeEventLists(
        loadedEvents,
        [
          ...prev.filter(event => event.threadId === selected),
          ...pendingForSelected
        ]
      ) : [])
      setWorkspaceId(threadWorkspaceId)
      rememberWorkspaceId(threadWorkspaceId)
      setSelectedThreadId(selected)
      setThreadTodos(todos)
      setActiveGoal(goal)
      shouldStickToBottom.current = true
      setView('chat')
    } finally {
      if (selectThreadGenRef.current === gen) {
        setPendingActiveThreadId(null)
        if (loadingThreadIdRef.current === threadId) loadingThreadIdRef.current = null
      }
    }
  }

  const updateThreadTodoStatus = useCallback(async (todo: ThreadTodo, status: ThreadTodoStatus) => {
    if (!activeThreadId) return
    await window.electronAPI.todos.upsert({
      threadId: activeThreadId,
      id: todo.id,
      content: todo.content,
      status,
      source: todo.source
    })
    if (isSddPlanTodo(todo)) {
      await persistSddPlanTodoStatus(todo, status)
    }
    await refreshThreadTodos(activeThreadId)
  }, [activeThreadId, refreshThreadTodos])

  const deleteThreadTodo = useCallback(async (todoId: string) => {
    if (!activeThreadId) return
    await window.electronAPI.todos.delete(activeThreadId, todoId)
    await refreshThreadTodos(activeThreadId)
  }, [activeThreadId, refreshThreadTodos])

  useEffect(() => {
    if (!shouldStickToBottom.current) return
    const el = threadScrollRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [activeThreadId, activeTurns.length, events.length])

  useEffect(() => {
    if (!activeThreadId) {
      setActiveGoal(null)
      return
    }
    let alive = true
    window.electronAPI.goals.get(activeThreadId)
      .then(goal => { if (alive) setActiveGoal(goal) })
      .catch(() => { if (alive) setActiveGoal(null) })
    return () => { alive = false }
  }, [activeThreadId])

  const handleThreadScroll = useCallback(() => {
    const el = threadScrollRef.current
    if (!el) return
    shouldStickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96
  }, [])

  const openCreateProject = useCallback(() => {
    setProjectDialogOpen(true)
  }, [])

  const createThread = useCallback(async (targetWorkspaceId?: string | null) => {
    const nextWorkspaceId = targetWorkspaceId === undefined ? workspaceId : targetWorkspaceId
    const thread = await window.electronAPI.threads.create({ workspaceId: nextWorkspaceId ?? null, title: tr('新对话', 'New chat') })
    await selectThread(thread.id)
  }, [workspaceId, selectThread])

  const createThreadInWorkspace = useCallback(async (targetWorkspaceId: string) => {
    await selectWorkspace(targetWorkspaceId)
    const thread = await window.electronAPI.threads.create({ workspaceId: targetWorkspaceId, title: tr('新会话', 'New session') })
    await selectThread(thread.id)
  }, [selectThread, selectWorkspace])

  useEffect(() => {
    return window.electronAPI.app.onMenuCommand?.((link) => {
      const action = resolveWorkbenchMenuCommand(link)
      if (!action) return
      if (action.type === 'new-thread') void createThread()
      else if (action.type === 'open-project') openCreateProject()
      else if (action.type === 'set-view') setView(action.view)
      else if (action.type === 'set-panel') setRightPanel(action.panel)
      else if (action.type === 'setup') openSetup(action.tab as WorkbenchUiSettingsTabKey)
    })
  }, [createThread, openCreateProject, setView, setRightPanel, openSetup])

  const shortcutBindings = useMemo(() => resolveKeyboardShortcutBindings(keyboardShortcuts), [keyboardShortcuts])

  useEffect(() => {
    let alive = true
    const load = () => {
      window.electronAPI.store.get(KEYBOARD_SHORTCUT_STORE_KEY)
        .then(value => { if (alive) setKeyboardShortcuts(normalizeKeyboardShortcuts(value && typeof value === 'object' ? value : null)) })
        .catch(() => { if (alive) setKeyboardShortcuts({ bindings: {} }) })
    }
    load()
    const onChange = () => load()
    window.addEventListener(KEYBOARD_SHORTCUTS_CHANGED, onChange)
    return () => {
      alive = false
      window.removeEventListener(KEYBOARD_SHORTCUTS_CHANGED, onChange)
    }
  }, [])

  const runShortcutCommand = useCallback((commandId: string) => {
    const action = resolveShortcutCommandAction(commandId)
    if (!action) return
    if (action.type === 'toggle-command-palette') setCommandPaletteOpen(prev => !prev)
    else if (action.type === 'focus-composer') document.querySelector<HTMLTextAreaElement>('.wb-composer-input')?.focus()
    else if (action.type === 'stop-task') void cancelLatest()
    else if (action.type === 'new-chat') void createThread()
    else if (action.type === 'choose-workspace') openCreateProject()
    else if (action.type === 'set-view') setView(action.view)
    else if (action.type === 'set-panel') setRightPanel(action.panel)
    else if (action.type === 'setup') openSetup(action.tab as WorkbenchUiSettingsTabKey)
  }, [cancelLatest, createThread, openCreateProject, setView, openSetup])

  const paletteCommands = useMemo(() => buildPaletteCommands(localAgents), [localAgents])

  const executePaletteCommand = useCallback((id: string) => {
    const extraAction = resolvePaletteExtraAction(id, localAgents)
    if (extraAction?.type === 'setup') {
      openSetup(extraAction.tab as WorkbenchUiSettingsTabKey)
      return
    }
    if (extraAction?.type === 'seed-workflows') {
      window.electronAPI.workflows.seed().catch(() => {})
      return
    }
    if (extraAction?.type === 'switch-agent') {
      setTargetAgent(extraAction.agentId)
      setView('chat')
      return
    }
    runShortcutCommand(id)
  }, [runShortcutCommand, openSetup, localAgents, setTargetAgent, setView])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const shortcut = keyboardEventToShortcut(event)
      if (!shortcut) return
      if (!event.ctrlKey && !event.metaKey && !event.altKey && shortcut !== 'Shift+Tab') return
      const target = event.target as HTMLElement | null
      const typingTarget = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )
      if (typingTarget && !event.ctrlKey && !event.metaKey && !event.altKey) return
      const commandId = findKeyboardShortcutCommand(shortcutBindings, shortcut)
      if (!commandId) return
      event.preventDefault()
      runShortcutCommand(commandId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutBindings, runShortcutCommand])

  const handleProjectCreated = useCallback(async (ws: Pick<WorkspaceItem, 'id' | 'name' | 'rootPath'>) => {
    await window.electronAPI.workspaces.setActive(ws.id)
    setWorkspaceId(ws.id)
    rememberWorkspaceId(ws.id)
    setProjectDialogOpen(false)
    await loadWorkbench(ws.id)
    const thread = await window.electronAPI.threads.create({ workspaceId: ws.id, title: tr('新对话', 'New chat') })
    await selectThread(thread.id)
  }, [loadWorkbench, rememberWorkspaceId, selectThread])

  const deleteThread = async (threadId: string) => {
    await window.electronAPI.threads.delete(threadId)
    if (selectedThreadIdRef.current === threadId) setSelectedThreadId(null)
    await loadWorkbench(workspaceId)
  }

  const renameThread = async (threadId: string, nextTitle: string) => {
    await window.electronAPI.threads.rename(threadId, nextTitle)
    await loadWorkbench(workspaceId)
  }

  const sendPrompt = async (prompt: string, attachments: WorkbenchAttachment[] = [], overrides: { targetAgent?: string | null; mode?: DispatchPreset; customSchedule?: SchedulePreview; modelSelection?: ModelSelection | null } = {}) => {
    if (!prompt.trim() || sending) return null
    const usableLocalAgents = localAgentOptions(localAgents)
    const dispatchRequest = resolveDispatchRequest({
      targetAgent,
      modelSelection,
      mode,
      overrides,
      usableLocalAgents,
      scheduleForMode: dispatchScheduleForMode
    })
    if (dispatchRequest.scheduleUnavailable && !dispatchRequest.targetAgent && !dispatchRequest.selectedProviderDirect) {
      setSendError(tr('智能/自定义调度需要至少一个可用本地 Agent。请先在设置 > 路由里配置 CLI。', 'Smart and custom schedules need at least one usable local agent. Configure a CLI in Settings > Routing first.'))
      return null
    }
    setSendError(null)
    setSending(true)
    try {
      const result = await window.electronAPI.turns.create({
        threadId: activeThreadId,
        workspaceId: workspaceId ?? null,
        prompt,
        mode: dispatchRequest.mode,
        targetAgent: dispatchRequest.targetAgent,
        thinking,
        modelSelection: dispatchRequest.modelSelection,
        attachments,
        customSchedule: dispatchRequest.customSchedule
      })
      const threadId = result?.thread?.id || activeThreadId
      if (threadId) {
        setSelectedThreadId(threadId)
        await selectThread(threadId)
      }
      else await loadWorkbench(workspaceId)
      return result
    } catch (e: any) {
      setSendError(e?.message || tr('启动运行失败。', 'Failed to start the run.'))
      return null
    } finally {
      setSending(false)
    }
  }

  const dispatchThreadTodo = useCallback(async (todo: ThreadTodo) => {
    if (!activeThreadId || sending || dispatchingTodoId) return
    setDispatchingTodoId(todo.id)
    try {
      const gitBaseline = await getSddPlanDispatchGitBaseline(workspaceId, todo)
      const result = await sendPrompt(todo.content, [], { targetAgent, mode: 'auto' })
      const turnId = result?.turn?.id
      if (!turnId) return
      const nextSource = { ...(todo.source || { kind: 'manual' as const }), threadId: activeThreadId, ...gitBaseline, turnId }
      const dispatchedTodo = { ...todo, status: 'in_progress' as const, source: nextSource }
      await window.electronAPI.todos.upsert({
        threadId: activeThreadId,
        id: todo.id,
        content: todo.content,
        status: 'in_progress',
        source: nextSource
      })
      if (isSddPlanTodo(dispatchedTodo)) {
        await persistSddPlanDispatch(dispatchedTodo, turnId)
        const latestSnapshot = await window.electronAPI.runtime.snapshot(workspaceId).catch(() => null)
        const latestTurn = latestSnapshot?.turns.find(turn => turn.id === turnId && turn.threadId === activeThreadId)
        if (latestTurn && (latestTurn.status === 'completed' || latestTurn.status === 'failed' || latestTurn.status === 'cancelled')) {
          await syncSddPlanTodoForRuntimeEvent({
            id: `turn-status-${turnId}`,
            threadId: activeThreadId,
            turnId,
            seq: 0,
            kind: 'turn:status',
            payload: { status: latestTurn.status },
            createdAt: Date.now()
          } as RuntimeEvent, [dispatchedTodo])
        }
      }
      await refreshThreadTodos(activeThreadId)
    } catch (e: any) {
      setSendError(e?.message || tr('派发 Todo 失败。', 'Failed to dispatch Todo.'))
    } finally {
      setDispatchingTodoId(null)
    }
  }, [activeThreadId, dispatchingTodoId, refreshThreadTodos, sendPrompt, sending, syncSddPlanTodoForRuntimeEvent, targetAgent, workspaceId])

  const cancelAgent = async (turnId: string, agentId: string) => {
    await window.electronAPI.turns.cancelAgent(turnId, agentId).catch(() => false)
    const next = await window.electronAPI.runtime.snapshot(workspaceId).catch(() => snapshot)
    setSnapshot(prev => preserveSelectedSnapshot(next, prev))
  }

  const resolveGuard = async (requestId: string, approved: boolean) => {
    await window.electronAPI.turns.resolveGuard(requestId, approved).catch(() => false)
  }

  const retryTurn = async (turnId: string) => {
    setSending(true)
    try {
      await window.electronAPI.turns.retry(turnId)
      await loadWorkbench(workspaceId)
    } finally {
      setSending(false)
    }
  }

  const title = activeThread?.title || (workspaceId ? tr('新对话', 'New chat') : tr('个人会话', 'Personal chat'))
  const activeWorkspace = workspaceId ? workspaces.find(w => w.id === workspaceId) ?? null : null
  const workspaceName = activeWorkspace?.name || (workspaceId ? tr('工作目录', 'Working folder') : tr('未绑定工作目录', 'No folder bound'))
  const _currentSchedule = schedules.find(schedule => schedule.preset === mode)
  const usableAgentIds = localAgentOptions(localAgents)
  const readyLocalAgents = usableAgentIds.length

  useEffect(() => {
    // 不要重置用户明确选择的 agent（即使是通过 HTTP provider 绑定的）
    if (targetAgent && !usableAgentIds.includes(targetAgent) && targetAgent !== userExplicitAgentRef.current) {
      setTargetAgent(null)
    }
  }, [targetAgent, usableAgentIds.join('|')])

  const setInspectorWidthPersisted = useCallback((width: number) => {
    const next = clampInspectorWidth(width, viewportWidth)
    setInspectorWidth(next, viewportWidth)
    window.electronAPI.store.set(INSPECTOR_WIDTH_STORE_KEY, next).catch(() => {})
  }, [setInspectorWidth, viewportWidth])

  const previewInspectorWidth = useCallback((width: number) => {
    setInspectorWidth(width, viewportWidth)
  }, [setInspectorWidth, viewportWidth])

  const runSlashCommand = useCallback(async (input: { text: string; command?: WorkbenchCommand | null }) => {
    const raw = input.text.trim()
    const parsed = parseSlashInput(raw)
    const command = input.command || await window.electronAPI.commands.run({ text: raw }).catch(() => null)
    if (!command) return false
    const args = parsed?.args ?? ''

    if (command.action === 'new-thread' || command.action === 'clear-thread') {
      if (args) return false
      await createThread()
      return true
    }
    if (command.action === 'set-goal') {
      if (!activeThreadId) {
        setSendError(tr('请先创建或选择一个对话线程。', 'Create or select a thread first.'))
        return true
      }
      if (!args) {
        const currentGoal = await window.electronAPI.goals.get(activeThreadId).catch(() => null)
        setActiveGoal(currentGoal)
        setSendError(currentGoal
          ? tr(`当前目标：${currentGoal.goal}`, `Current goal: ${currentGoal.goal}`)
          : tr('当前线程还没有目标。请使用 /goal 写下目标。', 'No goal is set for this thread. Use /goal to set one.'))
        return true
      }
      if (/^(clear|off|remove|unset)$/i.test(args.trim())) {
        const cleared = await window.electronAPI.goals.clear(activeThreadId).catch(() => null)
        setActiveGoal(null)
        setSendError(cleared ? tr('当前线程目标已清除。', 'Current thread goal cleared.') : tr('当前线程还没有目标。', 'No goal is set for this thread.'))
        return true
      }
      const existingGoal = await window.electronAPI.goals.get(activeThreadId).catch(() => null)
      const match = args.match(/^(.*?)(?:\s+(?:--?(?:n|times|limit|max)|循环|轮数)\s*[=:]?\s*(\d{1,2}))?$/i)
      const goalText = (match?.[1] || args).trim()
      const loopLimit = match?.[2] ? Number(match[2]) : (existingGoal?.loopLimit || undefined)
      if (!goalText) {
        setSendError(tr('请在 /goal 后写下目标，或输入 clear 清除目标。', 'Write a goal after /goal, or use clear to remove it.'))
        return true
      }
      const nextGoal = await window.electronAPI.goals.set(activeThreadId, goalText, loopLimit).catch((error: any) => {
        setSendError(error?.message || tr('设置目标失败。', 'Failed to set goal.'))
        return null
      })
      if (!nextGoal) return true
      setActiveGoal(nextGoal)
      setSendError(tr(`已设置目标：${nextGoal.goal}`, `Goal set: ${nextGoal.goal}`))
      return true
    }
    if (command.action === 'run-loop') {
      if (!activeThreadId) {
        setSendError(tr('请先创建或选择一个对话线程。', 'Create or select a thread first.'))
        return true
      }
      const currentGoal = activeGoal || await window.electronAPI.goals.get(activeThreadId).catch(() => null)
      const loopLimit = parseLoopLimit(args, currentGoal?.loopLimit || 5)
      const extra = stripLoopFlags(args).trim()
      const goalText = currentGoal?.goal || extra
      if (!goalText) {
        setSendError(tr('请先用 /goal 设置目标，再运行 /loop。', 'Set a goal with /goal before running /loop.'))
        return true
      }
      const nextPrompt = [
        '[AgentHub Loop]',
        `Goal: ${goalText}`,
        `Loop limit: ${loopLimit}`,
        'Task: run a bounded goal pass using the smart five-role schedule. Plan compact iterations inside this run, report progress, and stop when the goal is satisfied, when blocked, or when the loop limit is reached.',
        'Constraints: preserve user intent, avoid destructive actions without confirmation, and summarize each iteration briefly.',
        extra && currentGoal?.goal ? `\nExtra instructions:\n${extra}` : ''
      ].filter(Boolean).join('\n\n')
      applyRoutingSelectionPatch(resolveWorkbenchRoutingSelectionPatch({ type: 'run-loop-command' }))
      await sendPrompt(nextPrompt, [], { targetAgent: null, mode: 'firefly-custom', modelSelection: null, customSchedule: smartSchedule })
      return true
    }
    if (command.source === 'ecc') {
      const instruction = command.payload?.prompt || command.description || command.label
      if (command.label.toLowerCase() === '/plan') {
        if (!args) {
          setSendError(tr('请在 /plan 后写下要规划的需求。', 'Write the request after /plan.'))
          return true
        }
        // 保留用户选择的 agent，不重置为 null
        const nextPrompt = [
          instruction,
          '',
          '用户需求:',
          args
        ].join('\n')
        await sendPrompt(nextPrompt, [], { mode: 'auto', targetAgent })
        return true
      }
      const nextPrompt = [
        `[${tr('工作流指令', 'Workflow command')}: ${command.label}]`,
        instruction,
        args ? `\n用户内容:\n${args}` : ''
      ].filter(Boolean).join('\n\n')
      // 保留用户选择的 agent
      await sendPrompt(nextPrompt, [], { targetAgent })
      return true
    }
    if (command.action === 'use-skill') {
      if (!command.payload?.skillId) {
      openSetup('skills')
        return true
      }
      const skillName = command.payload?.name || command.label.replace(/^\/skill:/, '')
      const instructions = command.payload?.instructions || command.description || ''
      const nextPrompt = [
        `[临时技能: ${skillName}]`,
        instructions,
        args ? `\n用户内容:\n${args}` : tr('请按这个技能处理当前任务。', 'Use this skill for the current task.')
      ].filter(Boolean).join('\n\n')
      await sendPrompt(nextPrompt)
      return true
    }
    if (command.action === 'open-panel') {
      const panel = command.payload?.panel
      if (panel === 'runs' || panel === 'git' || panel === 'worktrees' || panel === 'browser') setRightPanel(panel)
      if (panel === 'browser' && args) setPendingBrowserUrl(args)
      return true
    }
    if (command.action === 'use-schedule' && command.payload?.preset) {
      // 保留用户选择的 agent，不重置为 null
      applyRoutingSelectionPatch(resolveWorkbenchRoutingSelectionPatch({ type: 'select-schedule-command', preset: command.payload.preset as DispatchPreset }))
      return true
    }
    if (command.action === 'use-agent' && command.payload?.agentId) {
      const agentId = String(command.payload.agentId)
      if (!usableAgentIds.includes(agentId)) {
        setSendError(tr('这个本地 Agent 当前不可用，请先在设置里配置。', 'This local agent is not available. Configure it in Settings first.'))
        return true
      }
      selectTargetAgent(agentId)
      if (args) await sendPrompt(args, [], { targetAgent: agentId, mode: 'auto' })
      return true
    }
    if (command.action === 'insert' && command.payload?.template) {
      if (command.payload.template === 'model') {
        const result = resolveModelCommand(args, selectableModels)
        if (result.selection) {
          applyRoutingSelectionPatch(resolveWorkbenchRoutingSelectionPatch({ type: 'select-provider-model-command', selection: result.selection }))
          setSendError(tr(`已切换模型：${result.label}`, `Model switched: ${result.label}`))
        } else {
          setSendError(result.message || tr('没有可用模型。请先在设置里启用供应商并填写 Key。', 'No available models. Enable a provider and API key in Settings first.'))
        }
        return true
      }
      if (command.payload.template === 'reasoning') {
        const nextThinking = reasoningFromCommand(args, thinking)
        if (!nextThinking) {
          setSendError(tr('推理强度可选：低、中、高、超高。', 'Reasoning options: low, medium, high, extra high.'))
          return true
        }
        setThinking(nextThinking)
        setSendError(tr(`已切换推理：${reasoningLabel(nextThinking)}`, `Reasoning switched: ${reasoningLabel(nextThinking)}`))
        return true
      }
      if (!args) {
        setSendError(tr('请在指令后面写下要处理的内容。', 'Write the content after the command.'))
        return true
      }
      if (command.payload.template === 'context') {
        await sendPrompt(args)
        return true
      }
      if (command.payload.template === 'review') {
        await sendPrompt([
          '请以代码审查方式回答，优先指出 bug、风险、行为回归和缺失测试。',
          '请按严重程度排序，并给出具体文件或代码位置；如果信息不足，请说明需要我补充什么。',
          '',
          '用户内容:',
          args
        ].join('\n'))
        return true
      }
    }
    if (command.action === 'run-terminal' || raw.startsWith('/terminal')) {
      const terminalCommand = args || raw.replace(/^\/terminal\b/i, '').trim()
      if (!terminalCommand) return false
      if (!workspaceId) {
        setSendError(tr('终端命令需要先选择工作目录。', 'Choose a working folder before running terminal commands.'))
        return true
      }
      setRightPanel('runs')
      const run = await window.electronAPI.terminal.run({ workspaceId: workspaceId ?? null, command: terminalCommand })
      setTerminalRuns(prev => [run, ...prev.filter(item => item.id !== run.id)].slice(0, 20))
      terminalWatchAbortRef.current?.abort()
      const ac = new AbortController()
      terminalWatchAbortRef.current = ac
      void watchTerminalRun(run.id, setTerminalRuns, ac.signal)
      return true
    }
    if (command.action === 'run-git' || raw.startsWith('/git')) {
      setRightPanel('git')
      if (!workspaceId) setSendError(tr('Git 命令需要先选择工作目录。', 'Choose a working folder before using Git commands.'))
      else if (args) {
        const result = await window.electronAPI.git.query({ workspaceId, threadId: activeThreadId, query: args })
        await selectThread(result.threadId)
      }
      return true
    }
    if (raw.startsWith('/browser')) {
      setRightPanel('browser')
      if (args) setPendingBrowserUrl(args)
      return true
    }
    return false
  }, [workspaceId, activeThreadId, activeGoal, createThread, sendPrompt, openSetup, applyRoutingSelectionPatch, usableAgentIds.join('|'), selectableModels, thinking])

  return (
    <div className="wb-root">
      <NativeTitlebar
        hubRunning={props.hubRunning}
        search={search}
        setSearch={setSearch}
        view={view}
        setView={setView}
        createThread={createThread}
        openCreateProject={openCreateProject}
        openSetup={openSetup}
        setRightPanel={setRightPanel}
        shortcuts={shortcutBindings}
      />
      <div className={'wb-shell' + (rightPanel === 'git' ? ' has-bottom-dock' : '')}>
        <SessionSidebar
          view={view}
          setView={setView}
          workspaces={workspaces}
          workspaceId={workspaceId}
          selectWorkspace={selectWorkspace}
          createProject={openCreateProject}
          threads={allThreads}
          activeThreadId={sidebarActiveThreadId}
          pendingThreadId={pendingActiveThreadId}
          selectThread={selectThread}
          createThread={createThread}
          createThreadInWorkspace={createThreadInWorkspace}
          renameThread={renameThread}
          deleteThread={deleteThread}
          search={search}
          setSearch={setSearch}
          proxyHost={props.proxyHost}
        />

        <WorkbenchMainContent
          view={view}
          setView={setView}
          configLoadError={props.configLoadError}
          onReloadConfig={props.providerActions.onReload}
          activeWorkspace={activeWorkspace}
          workspaceId={workspaceId}
          activeThreadId={activeThreadId}
          activeThread={activeThread}
          activeTurns={activeTurns}
          activeEvents={activeEvents}
          activeGoal={activeGoal}
          threadTodos={threadTodos}
          readyLocalAgents={readyLocalAgents}
          title={title}
          workspaceName={workspaceName}
          sendError={sendError}
          rightPanel={rightPanel}
          setRightPanel={setRightPanel}
          selectWorkspace={selectWorkspace}
          selectTargetAgent={selectTargetAgent}
          targetAgent={targetAgent}
          agents={props.agents}
          localAgents={localAgents}
          sending={sending}
          sendPrompt={sendPrompt}
          cancelLatest={cancelLatest}
          openCreateProject={openCreateProject}
          openSetup={openSetup}
          updateTodoStatus={updateThreadTodoStatus}
          deleteTodo={deleteThreadTodo}
          dispatchTodo={dispatchThreadTodo}
          dispatchingTodoId={dispatchingTodoId}
          refreshThreadTodos={refreshThreadTodos}
          runSlashCommand={runSlashCommand}
          retryTurn={retryTurn}
          cancelAgent={cancelAgent}
          resolveGuard={resolveGuard}
          createThread={createThread}
          handleThreadScroll={handleThreadScroll}
          threadScrollRef={threadScrollRef}
          search={search}
          runtimeTasks={runtimeTasks}
          cancelRuntimeTask={cancelRuntimeTask}
          deleteRuntimeTask={deleteRuntimeTask}
          clearCompletedRuntimeTasks={clearCompletedRuntimeTasks}
          providers={props.providers}
          bindings={props.bindings}
          fallbackChain={props.fallbackChain}
          providerActions={props.providerActions}
          motion={props.motion}
          setMotion={props.setMotion}
          settingsTab={settingsTab}
          connectionSummary={connectionSummary}
          mode={mode}
          setMode={setMode}
          modelSelection={modelSelection}
          setModelSelection={setModelSelection}
          thinking={thinking}
          setThinking={setThinking}
          schedules={schedules}
          workspaces={workspaces}
          pendingComposerAttachments={pendingComposerAttachments}
          onExternalAttachmentsConsumed={() => setPendingComposerAttachments([])}
        />

        <WorkbenchPanelContainers
          rightPanel={rightPanel}
          setRightPanel={setRightPanel}
          inspectorWidth={inspectorWidth}
          viewportWidth={viewportWidth}
          previewInspectorWidth={previewInspectorWidth}
          setInspectorWidthPersisted={setInspectorWidthPersisted}
          workspaceId={workspaceId}
          workspaceRoot={workspaceId ? activeWorkspace?.rootPath ?? null : null}
          activeThreadId={activeThreadId}
          parentTurnId={activeTurns.length > 0 ? activeTurns[activeTurns.length - 1].id : null}
          activeEvents={activeEvents}
          activeTurns={activeTurns}
          localAgents={localAgents}
          setLocalAgents={setLocalAgents}
          schedules={schedules}
          mode={mode}
          setMode={setMode}
          scheduleForMode={scheduleForMode}
          setScheduleForMode={setScheduleForMode}
          openSetup={openSetup}
          terminalRuns={terminalRuns}
          setTerminalRuns={setTerminalRuns}
          selectedAgentDetail={selectedAgentDetail}
          onSelectAgentDetail={setSelectedAgentDetail}
          browserUrl={pendingBrowserUrl}
          onBrowserUrlConsumed={() => setPendingBrowserUrl(null)}
          onAttachBrowserCapture={attachment => setPendingComposerAttachments([attachment])}
        />
      </div>

      {projectDialogOpen && (
        <CreateWorkspaceDialog
          activeWorkspaceRoot={activeWorkspace?.rootPath}
          onClose={() => setProjectDialogOpen(false)}
          onCreated={handleProjectCreated}
        />
      )}

      {announcementOpen && <WorkbenchAnnouncementModal onClose={closeAnnouncement} onOpenSetup={openAnnouncementSetup} />}

      <ApprovalDialog items={approvals} onDecide={onApprovalDecide} />
      {commandPaletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onExecute={executePaletteCommand}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
    </div>
  )
}

// GitBranchControl moved to GitBranchControl.tsx (registered via import)

function _modeLabel(mode: DispatchPreset): string {
  return ({
    auto: tr('自动路由', 'Auto route'),
    broadcast: tr('广播', 'Broadcast'),
    chain: tr('链式交接', 'Chain handoff'),
    orchestrate: tr('编排', 'Orchestrate'),
    'lead-workers': tr('主控 + 工作者', 'Lead + workers'),
    'parallel-review': tr('并行评审', 'Parallel review'),
    'firefly-custom': tr('智能五角色', 'Smart five-role'),
    custom: tr('自定义调度', 'Custom schedule')
  } as Partial<Record<DispatchPreset, string>>)[mode] || mode
}
