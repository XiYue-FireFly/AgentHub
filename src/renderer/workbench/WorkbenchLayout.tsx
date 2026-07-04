import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC } from '../glass/ui'
import { BindingDef, ProviderDef, TaskItem } from '../glass/meta'
import { ApprovalDialog, ApprovalItem } from '../glass/approval-dialog'
import { SettingsScreen } from '../screens/Settings'
type MotionLevel = 'off' | 'subtle' | 'rich'
// Phase 3.2 lazy loading: secondary heavy views loaded on demand
const WorkflowsPanel = React.lazy(() => import('./WorkflowsPanel').then(m => ({ default: m.WorkflowsPanel })))
import { TerminalPanel } from './TerminalPanel'
import { TasksScreen } from '../screens/Tasks'
import { SetupTab, summarizeAgentConnections } from '../glass/connection-status'
import { tr } from '../glass/i18n'
import { SessionSidebar } from './SessionSidebar'
import { ThreadView } from './ThreadView'
import { ComposerBar } from './ComposerBar'
import { RunTimeline } from './RunTimeline'
import { WorkbenchChatTopBar } from './WorkbenchChatTopBar'
import { WriteWorkspace } from './WriteWorkspace'
import { GitWorkbenchPanel } from './GitWorkbenchPanel'
import { WorkspaceItem, AgentMap } from './types'
import { CommandPalette, PaletteCommand } from './CommandPalette'
import { NativeTitlebar, type WorkbenchRightPanel } from './NativeTitlebar'
import { DEFAULT_INSPECTOR_WIDTH, WorkbenchBottomDock, WorkbenchInspector, clampInspectorWidth } from './WorkbenchPanels'
import { ErrorBoundary } from '../ErrorBoundary'
import { GitBranchControl } from './GitBranchControl'
import { FileTreePanel } from './FileTreePanel'
import { SubagentDetailPanel } from './SubagentDetailPanel'
import { SideConversationPanel } from './SideConversationPanel'
import { WorktreePanel } from './components/panels/WorktreePanel'
import { BrowserPanel } from './components/panels/BrowserPanel'
import { SddRequirementsList } from '../sdd/components/SddRequirementsList'
import { localAgentOptions } from './localAgentOptions'
import { isWorkbenchViewMode, type ViewMode } from './viewModes'
import { readRememberedWorkspaceId, rememberWorkbenchWorkspaceId, resolveWorkbenchWorkspaceId } from './workspaceSelection'
import { customScheduleHasRunnableSteps, defaultCustomSchedule, defaultSmartFiveRoleSchedule, isStoredSchedule, normalizeStoredScheduleOverrides, sanitizeCustomSchedule } from './customSchedule'
import { defaultDialogPath, readAppearanceLocal, rememberDialogPath } from '../appearance'
import { mergeRuntimeEventLists, isBufferedRuntimeEvent, shouldFlushFirstStreamDelta } from './utils/eventUtils'
import { parseSlashInput, parseLoopLimit, stripLoopFlags } from './utils/slashCommandUtils'
import { selectableModelOptions, isSelectableModel, resolveModelCommand, reasoningFromCommand, reasoningLabel, type WorkbenchThinking } from './utils/modelUtils'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  KEYBOARD_SHORTCUT_STORE_KEY,
  KEYBOARD_SHORTCUT_COMMANDS,
  KEYBOARD_SHORTCUTS_CHANGED,
  KeyboardShortcutsConfigV1,
  resolveKeyboardShortcutBindings
} from '../keyboard-shortcuts'

type SettingsTabKey = SetupTab | 'appearance' | 'memory' | 'updates' | 'shortcuts' | 'models' | 'plugins' | 'usage' | 'agentLoop' | 'requirements'
type RightPanel = WorkbenchRightPanel

const INSPECTOR_WIDTH_STORE_KEY = 'agenthub.workbench.inspectorWidth.v1'
const LAST_VIEW_STORE_KEY = 'agenthub.workbench.lastView.v1'
const LAST_THREAD_STORE_KEY = 'agenthub.workbench.lastThread.v1'
const CUSTOM_SCHEDULE_STORE_KEY = 'agenthub.workbench.customSchedule.v1'
const SMART_SCHEDULE_STORE_KEY = 'agenthub.workbench.smartFiveRoleSchedule.v1'
const SCHEDULE_OVERRIDES_STORE_KEY = 'agenthub.workbench.scheduleOverrides.v1'
const ANNOUNCEMENT_STORE_KEY = 'agenthub.workbench.announcement.v0.5.4'

interface WorkbenchLayoutProps {
  hubRunning: boolean
  proxyHost: string
  agents: AgentMap
  providers: ProviderDef[]
  bindings: BindingDef[]
  fallbackChain: string[]
  tasks: TaskItem[]
  approvals: ApprovalItem[]
  runtimeRefreshNonce?: number
  onApprovalDecide: (item: ApprovalItem, approved: boolean, remember: boolean) => void
  onCancelTask: (id: string) => void
  onDeleteTask: (id: string) => void
  onClearCompletedTasks: () => void
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
  motion: MotionLevel
  setMotion: (m: MotionLevel) => void
}

export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  const [view, setViewState] = useState<ViewMode>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>('providers')
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>({ threads: [], turns: [], runs: [], activeThreadId: null })
  const [selectedThreadId, setSelectedThreadIdState] = useState<string | null>(null)
  const [allThreads, setAllThreads] = useState<WorkbenchThread[]>([])
  const [events, setEvents] = useState<RuntimeEvent[]>([])
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
  const [customSchedule, setCustomScheduleState] = useState<SchedulePreview>(() => defaultCustomSchedule())
  const [smartSchedule, setSmartScheduleState] = useState<SchedulePreview>(() => defaultSmartFiveRoleSchedule())
  const [scheduleOverrides, setScheduleOverridesState] = useState<Partial<Record<DispatchPreset, SchedulePreview>>>({})
  const [localAgents, setLocalAgents] = useState<LocalAgentStatus[]>([])
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectDraft, setProjectDraft] = useState({ name: '', rootPath: '' })
  const [projectError, setProjectError] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [selectedAgentDetail, setSelectedAgentDetail] = useState<{ agentId: string; turnId: string } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => { setSendError(null) }, [view])
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  const [viewportWidth, setViewportWidth] = useState(typeof window === 'undefined' ? 1280 : window.innerWidth)
  const [terminalRuns, setTerminalRuns] = useState<TerminalRun[]>([])
  const [pendingComposerAttachments, setPendingComposerAttachments] = useState<WorkbenchAttachment[]>([])
  const [pendingBrowserUrl, setPendingBrowserUrl] = useState<string | null>(null)
  const [announcementOpen, setAnnouncementOpen] = useState(() => {
    try { return localStorage.getItem(ANNOUNCEMENT_STORE_KEY) !== 'seen' } catch { return true }
  })
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
  const startupViewApplied = useRef(false)
  const smartScheduleStoreLoaded = useRef(false)
  const userExplicitAgentRef = useRef<string | null>(null)  // 跟踪用户明确选择的 agent
  const selectedThreadIdRef = useRef<string | null>(null)
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

  const rememberWorkspaceId = useCallback((id: string | null) => {
    rememberWorkbenchWorkspaceId(id)
  }, [])

  const setView = useCallback((next: ViewMode) => {
    setViewState(next)
    if (startupViewApplied.current) {
      try { localStorage.setItem(LAST_VIEW_STORE_KEY, next) } catch { /* noop */ }
    }
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
      setThreadTodosState([])
      return
    }
    const todos = await window.electronAPI.todos.list(threadId)
    setThreadTodosState(todos)
  }, [activeThreadId])

  const appendRuntimeEvents = useCallback((nextEvents: RuntimeEvent[]) => {
    if (nextEvents.length === 0) return
    setEvents(prev => mergeRuntimeEventLists(prev, nextEvents))
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
      setEvents(prev => mergeRuntimeEventLists(
        loadedEvents,
        [
          ...prev.filter(event => event.threadId === nextVisibleThreadId),
          ...pendingRuntimeEvents.current.filter(event => event.threadId === nextVisibleThreadId)
        ]
      ))
      setThreadTodosState(await window.electronAPI.todos.list(nextVisibleThreadId).catch(() => []))
      if (loadWorkbenchGenRef.current !== gen) return
      if (loadingThreadIdRef.current === nextVisibleThreadId) loadingThreadIdRef.current = null
    } else {
      setEvents([])
      setThreadTodosState([])
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
    if (startupViewApplied.current) return
    startupViewApplied.current = true
    const target = readAppearanceLocal().startupOpenTarget
    if (target === 'settings') {
      setSettingsTab('appearance')
      setView('settings')
      return
    }
    if (target === 'last') {
      let lastView: ViewMode = 'chat'
      try {
        const saved = localStorage.getItem(LAST_VIEW_STORE_KEY)
        if (isWorkbenchViewMode(saved)) lastView = saved
      } catch { /* noop */ }
      setView(lastView)
    }
  }, [setView])

  useEffect(() => {
    if (props.runtimeRefreshNonce === undefined) return
    loadWorkbench(workspaceId).catch(() => {})
  }, [props.runtimeRefreshNonce, loadWorkbench, workspaceId])

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
      .then(value => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          setInspectorWidth(clampInspectorWidth(value))
        }
      })
      .catch(() => {})
    window.electronAPI.terminal.history().then(setTerminalRuns).catch(() => {})
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI.runtime.onEvent(event => {
      const isPendingThreadEvent = pendingActiveThreadId !== null && event.threadId === loadingThreadIdRef.current
      const isVisibleThreadEvent = event.threadId === selectedThreadIdRef.current

      if (isPendingThreadEvent) {
        pendingRuntimeEvents.current.push(event)
        return
      }

      if (isVisibleThreadEvent) {
        if (isBufferedRuntimeEvent(event)) enqueueRuntimeEvent(event)
        else {
          flushRuntimeEvents()
          appendRuntimeEvents([event])
        }
        if (event.kind === 'orchestrate' && event.payload?.kind === 'orchestrate:plan') {
          void refreshThreadTodos(event.threadId)
        }
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
  }, [activeThreadId, pendingActiveThreadId, workspaceId, refreshThreadTodos, appendRuntimeEvents, enqueueRuntimeEvent, flushRuntimeEvents, clearRuntimeEventBuffer])

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
  const activeEvents = useMemo(
    () => visibleThreadId === activeThreadId ? events : events.filter(event => event.threadId === visibleThreadId),
    [events, visibleThreadId, activeThreadId]
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

  const selectTargetAgent = useCallback((agentId: string | null) => {
    userExplicitAgentRef.current = agentId  // 记录用户明确选择
    setTargetAgent(agentId)
    if (agentId) {
      setModelSelection(null)
      setMode('auto')
    }
  }, [])

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

  const openSetup = useCallback((tab: SettingsTabKey = 'providers') => {
    setSettingsTab(tab)
    setView('settings')
  }, [setView])

  const closeAnnouncement = () => {
    try { localStorage.setItem(ANNOUNCEMENT_STORE_KEY, 'seen') } catch { /* noop */ }
    setAnnouncementOpen(false)
  }

  const openAnnouncementSetup = (tab: SettingsTabKey) => {
    closeAnnouncement()
    openSetup(tab)
  }

  const selectWorkspace = async (id: string | null) => {
    setWorkspaceId(id)
    rememberWorkspaceId(id)
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
      setThreadTodosState(todos)
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
    setProjectError(null)
    setProjectDraft({ name: '', rootPath: '' })
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
      const action = link?.action
      const params = link?.params || {}
      if (action === 'new-thread') void createThread()
      else if (action === 'open-project') openCreateProject()
      else if (action === 'view') {
        if (isWorkbenchViewMode(params.view)) setView(params.view)
      } else if (action === 'open-panel') {
        const panel = params.panel
        if (panel === 'runs' || panel === 'git' || panel === 'worktrees' || panel === 'browser') setRightPanel(panel)
      } else if (action === 'setup') {
        openSetup(params.tab as SettingsTabKey)
      }
    })
  }, [createThread, openCreateProject, setView, openSetup])

  const shortcutBindings = useMemo(() => resolveKeyboardShortcutBindings(keyboardShortcuts), [keyboardShortcuts])

  useEffect(() => {
    let alive = true
    const load = () => {
      window.electronAPI.store.get(KEYBOARD_SHORTCUT_STORE_KEY)
        .then(value => { if (alive) setKeyboardShortcuts(value || { bindings: {} }) })
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

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  const runShortcutCommand = useCallback((commandId: string) => {
    if (commandId === 'command-palette') { setCommandPaletteOpen(prev => !prev); return }
    if (commandId === 'focus-composer') { document.querySelector<HTMLTextAreaElement>('.wb-composer-input')?.focus(); return }
    if (commandId === 'new-chat') void createThread()
    else if (commandId === 'choose-workspace') openCreateProject()
    else if (commandId === 'view-chat') setView('chat')
    else if (commandId === 'view-write') setView('write')
    else if (commandId === 'view-tasks') setView('tasks')
    else if (commandId === 'view-requirements') setView('requirements')
    else if (commandId === 'view-settings') setView('settings')
    else if (commandId === 'panel-runs') setRightPanel('runs')
    else if (commandId === 'panel-git') setRightPanel('git')
    else if (commandId === 'panel-browser') setRightPanel('browser')
    else if (commandId === 'panel-terminal') setRightPanel('terminal')
    else if (commandId === 'settings-shortcuts') openSetup('shortcuts')
    else if (commandId === 'settings-mcp') openSetup('mcp')
    else if (commandId === 'open-workflows') setView('workflows')
  }, [createThread, openCreateProject, setView, openSetup])

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const cmds = KEYBOARD_SHORTCUT_COMMANDS as readonly { id: string; labelZh: string; labelEn: string; descriptionZh: string; descriptionEn: string; defaultBindings: readonly string[] }[]
    const fromShortcuts: PaletteCommand[] = cmds.map(cmd => ({
      id: cmd.id,
      label: cmd.labelEn || cmd.id,
      labelZh: cmd.labelZh,
      labelEn: cmd.labelEn,
      descriptionZh: cmd.descriptionZh,
      descriptionEn: cmd.descriptionEn,
      category: 'keyboard'
    }))
    const extra: PaletteCommand[] = [
      { id: 'open-memory', label: 'Open Memory', labelZh: '打开记忆', category: 'navigation' },
      { id: 'open-skills', label: 'Open Skills', labelZh: '打开技能', category: 'navigation' },
      { id: 'open-prompts', label: 'Open Prompts', labelZh: '打开提示词库', category: 'navigation' },
      { id: 'open-plugins', label: 'Open Plugins', labelZh: '打开插件管理', category: 'navigation' },
      { id: 'open-usage', label: 'Open Usage Stats', labelZh: '打开用量统计', category: 'navigation' },
      { id: 'open-models', label: 'Open Models', labelZh: '打开模型列表', category: 'navigation' },
      { id: 'open-diagnostics', label: 'Run Diagnostics', labelZh: '运行诊断', category: 'system' },
      { id: 'open-backup', label: 'Create Backup', labelZh: '创建备份', category: 'system' },
      { id: 'seed-workflows', label: 'Seed Default Workflows', labelZh: '加载默认工作流', category: 'system' },
      // Agent switching commands
      ...localAgentOptions(localAgents).map(id => ({
        id: `switch-agent:${id}`,
        label: `Switch to ${id}`,
        labelZh: `切换到 ${id}`,
        category: 'agent' as const
      }))
    ]
    return [...fromShortcuts, ...extra]
  }, [localAgents])

  const executePaletteCommand = useCallback((id: string) => {
    if (id === 'open-memory') { openSetup('memory'); return }
    if (id === 'open-skills') { openSetup('skills'); return }
    if (id === 'open-plugins') { openSetup('plugins'); return }
    if (id === 'open-usage') { openSetup('usage'); return }
    if (id === 'open-models') { openSetup('models'); return }
    if (id === 'open-prompts') { openSetup('shortcuts'); return }
    if (id === 'open-diagnostics') { openSetup('appearance'); return }
    if (id === 'open-backup') { openSetup('appearance'); return }
    if (id === 'seed-workflows') {
      window.electronAPI.workflows.seed().catch(() => {})
      return
    }
    if (id.startsWith('switch-agent:')) {
      const agentId = id.split(':')[1]
      const usable = localAgentOptions(localAgents)
      if (agentId && usable.includes(agentId)) {
        setTargetAgent(agentId)
        setView('chat')
      }
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

  const pickProjectFolder = async () => {
    const picked = await window.electronAPI.app.pickFolder({ defaultPath: defaultDialogPath('folder', activeWorkspace?.rootPath) })
    if (!picked) return
    rememberDialogPath('folder', picked)
    const inferred = picked.split(/[\\/]/).filter(Boolean).at(-1) || tr('新工作目录', 'New folder')
    setProjectDraft(draft => ({ name: draft.name || inferred, rootPath: picked }))
  }

  const submitProject = async () => {
    const name = projectDraft.name.trim()
    const rootPath = projectDraft.rootPath.trim()
    if (!name || !rootPath) {
      setProjectError(tr('请选择本地目录并填写名称。', 'Choose a local folder and enter a name.'))
      return
    }
    try {
      setProjectError(null)
      const ws = await window.electronAPI.workspaces.create({ name, rootPath })
      await window.electronAPI.workspaces.setActive(ws.id)
      setWorkspaceId(ws.id)
      rememberWorkspaceId(ws.id)
      setProjectDialogOpen(false)
      await loadWorkbench(ws.id)
      const thread = await window.electronAPI.threads.create({ workspaceId: ws.id, title: tr('新对话', 'New chat') })
      await selectThread(thread.id)
    } catch (e: any) {
      setProjectError(e?.message || tr('添加工作目录失败。', 'Failed to add folder.'))
    }
  }

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
    if (!prompt.trim() || sending) return
    const requestedTargetAgent = overrides.targetAgent !== undefined ? overrides.targetAgent : targetAgent
    const requestedModelSelection = requestedTargetAgent ? null : (overrides.modelSelection !== undefined ? overrides.modelSelection : modelSelection)
    const selectedProviderDirect = !requestedTargetAgent && requestedModelSelection?.source === 'provider'
    const selectedLocalDirect = !!requestedTargetAgent
    const nextTargetAgent = selectedProviderDirect ? null : requestedTargetAgent
    const nextMode = selectedProviderDirect || selectedLocalDirect ? 'auto' : (overrides.mode || mode)
    const rawCustomSchedule = selectedProviderDirect || selectedLocalDirect
      ? undefined
      : (overrides.customSchedule || (!nextTargetAgent ? dispatchScheduleForMode(nextMode) : undefined))
    const usableLocalAgents = localAgentOptions(localAgents)
    const safeCustomSchedule = rawCustomSchedule ? sanitizeCustomSchedule(rawCustomSchedule, usableLocalAgents) : undefined
    const scheduleUnavailable = safeCustomSchedule
      ? !customScheduleHasRunnableSteps(safeCustomSchedule)
      : nextMode === 'custom' || nextMode === 'firefly-custom'
        ? usableLocalAgents.length === 0
        : false
    if (scheduleUnavailable && !nextTargetAgent && !selectedProviderDirect) {
      setSendError(tr('智能/自定义调度需要至少一个可用本地 Agent。请先在设置 > 路由里配置 CLI。', 'Smart and custom schedules need at least one usable local agent. Configure a CLI in Settings > Routing first.'))
      return
    }
    setSendError(null)
    setSending(true)
    try {
      const result = await window.electronAPI.turns.create({
        threadId: activeThreadId,
        workspaceId: workspaceId ?? null,
        prompt,
        mode: nextMode,
        targetAgent: nextTargetAgent,
        thinking,
        modelSelection: selectedLocalDirect ? undefined : requestedModelSelection || undefined,
        attachments,
        customSchedule: selectedProviderDirect || selectedLocalDirect ? undefined : safeCustomSchedule
      })
      const threadId = result?.thread?.id || activeThreadId
      if (threadId) {
        setSelectedThreadId(threadId)
        await selectThread(threadId)
      }
      else await loadWorkbench(workspaceId)
    } catch (e: any) {
      setSendError(e?.message || tr('启动运行失败。', 'Failed to start the run.'))
    } finally {
      setSending(false)
    }
  }

  const cancelLatest = async () => {
    const running = [...activeTurns].reverse().find(t => t.status === 'running')
    if (running) {
      await window.electronAPI.turns.cancel(running.id)
      await loadWorkbench(workspaceId)
    }
  }

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
    setInspectorWidth(next)
    window.electronAPI.store.set(INSPECTOR_WIDTH_STORE_KEY, next).catch(() => {})
  }, [viewportWidth])

  const previewInspectorWidth = useCallback((width: number) => {
    setInspectorWidth(clampInspectorWidth(width, viewportWidth))
  }, [viewportWidth])

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
      setMode('firefly-custom')
      setTargetAgent(null)
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
      setModelSelection(null)
      setMode(command.payload.preset as DispatchPreset)
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
          setTargetAgent(null)
          setModelSelection(result.selection)
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
  }, [workspaceId, activeThreadId, activeGoal, createThread, sendPrompt, openSetup, usableAgentIds.join('|'), selectableModels, thinking])

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

        <main className="wb-main">
          {props.configLoadError && (
            <div className="wb-config-error" role="alert">
              <span>{props.configLoadError}</span>
              <button type="button" onClick={props.providerActions.onReload}>{tr('重试', 'Retry')}</button>
            </div>
          )}

          {view === 'write' && (
            <ErrorBoundary label="Write">
            <WriteWorkspace
              workspace={activeWorkspace}
              hasWorkspace={!!workspaceId}
              targetAgent={targetAgent}
              setTargetAgent={selectTargetAgent}
              agents={props.agents}
              localAgents={localAgents}
              sending={sending}
              onSend={sendPrompt}
              onCancel={cancelLatest}
              onCreateProject={openCreateProject}
              openChat={() => setView('chat')}
              thread={activeThread}
              turns={activeTurns}
              events={activeEvents}
            />
            </ErrorBoundary>
          )}

          {view === 'chat' && (
            <ErrorBoundary label="Chat">
            <>
              <div className="wb-chat-head">
                <WorkbenchChatTopBar
                  title={title}
                  workspaceName={workspaceName}
                  workspaceTitle={activeWorkspace?.rootPath || tr('添加工作目录', 'Add working folder')}
                  openWorkspace={workspaceId ? () => selectWorkspace(workspaceId) : openCreateProject}
                  workspaceRoot={activeWorkspace?.rootPath ?? null}
                  activePanel={rightPanel}
                  setPanel={setRightPanel}
                  workspaceId={workspaceId}
                  readyLocalAgents={readyLocalAgents}
                  todos={threadTodos}
                  activeThreadId={activeThreadId}
                  openTasks={() => setView('tasks')}
                  updateTodoStatus={updateThreadTodoStatus}
                  deleteTodo={deleteThreadTodo}
                />
              </div>

              {activeGoal && (
                <div className="wb-goal-strip">
                  <div>
                    <strong>{tr('当前目标', 'Current goal')}</strong>
                    <span>{activeGoal.goal}</span>
                    <small>{tr(`Loop 上限 ${activeGoal.loopLimit} 轮`, `Loop limit ${activeGoal.loopLimit}`)}</small>
                  </div>
                  <button className="ah-btn sm" onClick={() => runSlashCommand({ text: `/loop --limit ${activeGoal.loopLimit}` })}>
                    {tr('启动 Loop', 'Run loop')}
                  </button>
                  <button className="ah-btn sm" onClick={() => runSlashCommand({ text: '/goal clear' })}>
                    {tr('清除', 'Clear')}
                  </button>
                </div>
              )}

              <ThreadView
                thread={activeThread}
                turns={activeTurns}
                events={activeEvents}
                onRetry={retryTurn}
                onCancelAgent={cancelAgent}
                onResolveGuard={resolveGuard}
                openSetup={openSetup}
                onCreateProject={openCreateProject}
                onCreateThread={createThread}
                hasWorkspace={!!workspaceId}
                workspaceRoot={activeWorkspace?.rootPath ?? null}
                scrollRef={threadScrollRef}
                onScroll={handleThreadScroll}
              />

              {sendError && <div className="wb-send-error">{sendError}</div>}

              <ComposerBar
                mode={mode}
                setMode={setMode}
                providers={props.providers}
                bindings={props.bindings}
                modelSelection={modelSelection}
                setModelSelection={setModelSelection}
                thinking={thinking}
                setThinking={setThinking}
                schedules={schedules}
                sending={sending}
                onSend={sendPrompt}
                onCancel={cancelLatest}
                workspaceId={workspaceId}
                workspaces={workspaces}
                setWorkspaceId={selectWorkspace}
                onCreateProject={openCreateProject}
                localAgents={localAgents}
                targetAgent={targetAgent}
                setTargetAgent={selectTargetAgent}
                agents={props.agents}
                onRunCommand={runSlashCommand}
                onOpenProviderSettings={() => openSetup('providers')}
                onRefreshProviders={props.providerActions.onReload}
                externalAttachments={pendingComposerAttachments}
                onExternalAttachmentsConsumed={() => setPendingComposerAttachments([])}
                gitBranchNode={
                  <GitBranchControl
                    workspaceId={workspaceId}
                    onOpenGit={() => setRightPanel('git')}
                    compact
                  />
                }
                threadId={activeThread?.id ?? null}
                turns={activeTurns}
                events={activeEvents}
              />
            </>
            </ErrorBoundary>
          )}

          {view === 'tasks' && (
            <ErrorBoundary label="Tasks">
            <div className="wb-scroll-surface">
              <TasksScreen
                tasks={props.tasks}
                search={search}
                onCancelTask={props.onCancelTask}
                onDeleteTask={props.onDeleteTask}
                onClearCompleted={props.onClearCompletedTasks}
                openSetup={openSetup}
              />
            </div>
            </ErrorBoundary>
          )}

          {view === 'requirements' && (
            <ErrorBoundary label="Requirements">
            <div className="wb-scroll-surface">
              <SddRequirementsList workspaceRoot={activeWorkspace?.rootPath ?? null} />
            </div>
            </ErrorBoundary>
          )}

          {view === 'settings' && (
            <ErrorBoundary label="Settings">
            <div className="wb-scroll-surface wb-settings-surface">
              <React.Suspense fallback={<div className="wb-muted-box">{tr('加载设置...', 'Loading settings...')}</div>}>
              <SettingsScreen
                providers={props.providers}
                bindings={props.bindings}
                onSetEnabled={props.providerActions.onSetEnabled}
                onSetKey={props.providerActions.onSetKey}
                onSetBinding={props.providerActions.onSetBinding}
                fallbackChain={props.fallbackChain}
                onSetFallback={props.providerActions.onSetFallback}
                onReload={props.providerActions.onReload}
                onUpsertProvider={props.providerActions.onUpsertProvider}
                onDeleteProvider={props.providerActions.onDeleteProvider}
                onReorderProvidersForClaude={props.providerActions.onReorderProvidersForClaude}
                motion={props.motion}
                setMotion={props.setMotion}
                initialTab={settingsTab}
                workspaceId={workspaceId}
                connectionSummary={connectionSummary}
                goChat={(agentId) => { selectTargetAgent(agentId); setView('chat') }}
                openSetup={openSetup}
              />
              </React.Suspense>
            </div>
            </ErrorBoundary>
          )}
          {view === 'workflows' && (
            <ErrorBoundary label="Workflows">
            <div className="wb-scroll-surface wb-settings-surface">
              <React.Suspense fallback={<div className="wb-muted-box">{tr('加载工作流...', 'Loading workflows...')}</div>}>
              <WorkflowsPanel onClose={() => setView('chat')} />
              </React.Suspense>
            </div>
            </ErrorBoundary>
          )}
        </main>

        {rightPanel && rightPanel !== 'git' && (
          <>
            <button className="wb-panel-scrim" type="button" aria-label={tr('关闭侧边栏', 'Close side panel')} onClick={() => setRightPanel(null)} />
            <WorkbenchInspector
              width={inspectorWidth}
              viewportWidth={viewportWidth}
              setWidth={previewInspectorWidth}
              commitWidth={setInspectorWidthPersisted}
              activePanel={rightPanel}
              setPanel={setRightPanel}
              workspaceId={workspaceId}
              onClose={() => setRightPanel(null)}
            >
              {rightPanel === 'runs' ? (
                selectedAgentDetail ? (
                  <SubagentDetailPanel
                    agentId={selectedAgentDetail.agentId}
                    turnId={selectedAgentDetail.turnId}
                    events={activeEvents}
                    onClose={() => setSelectedAgentDetail(null)}
                  />
                ) : (
                <RunTimeline
                  events={activeEvents}
                  turns={activeTurns}
                  localAgents={localAgents}
                  setLocalAgents={setLocalAgents}
                  schedules={schedules}
                  mode={mode}
                  setMode={setMode}
                  currentSchedule={scheduleForMode(mode)}
                  setScheduleForMode={setScheduleForMode}
                  openSetup={openSetup}
                  onClose={() => setRightPanel(null)}
                  terminalRuns={terminalRuns}
                  setTerminalRuns={setTerminalRuns}
                  onSelectAgent={(agentId, turnId) => setSelectedAgentDetail({ agentId, turnId })}
                />
                )
              ) : rightPanel === 'files' ? (
                <FileTreePanel
                  workspaceRoot={workspaceId ? activeWorkspace?.rootPath ?? null : null}
                  workspaceId={workspaceId}
                  onClose={() => setRightPanel(null)}
                  onFileSelect={(path) => {
                    // Open file in external editor
                    window.electronAPI.app.openPath({ path, target: 'editor' }).catch(() => {})
                  }}
                />
              ) : rightPanel === 'side-chat' ? (
                <SideConversationPanel
                  parentThreadId={activeThreadId}
                  parentTurnId={activeTurns.length > 0 ? activeTurns[activeTurns.length - 1].id : null}
                  workspaceId={workspaceId}
                  onClose={() => setRightPanel(null)}
                />
              ) : rightPanel === 'terminal' ? (
                <TerminalPanel
                  workspaceRoot={workspaceId ? activeWorkspace?.rootPath : undefined}
                  onClose={() => setRightPanel(null)}
                />
              ) : (
                <WorkbenchToolPanel
                  panel={rightPanel}
                  workspaceId={workspaceId}
                  onClose={() => setRightPanel(null)}
                  browserUrl={pendingBrowserUrl}
                  onBrowserUrlConsumed={() => setPendingBrowserUrl(null)}
                  onAttachBrowserCapture={attachment => setPendingComposerAttachments([attachment])}
                />
              )}
            </WorkbenchInspector>
          </>
        )}

        {rightPanel === 'git' && (
          <>
            <button className="wb-panel-scrim bottom" type="button" aria-label={tr('关闭底部面板', 'Close bottom panel')} onClick={() => setRightPanel(null)} />
            <WorkbenchBottomDock
              workspaceId={workspaceId}
              activePanel={rightPanel}
              setPanel={setRightPanel}
              onClose={() => setRightPanel(null)}
            >
              <GitWorkbenchPanel workspaceId={workspaceId} onClose={() => setRightPanel(null)} />
            </WorkbenchBottomDock>
          </>
        )}
      </div>

      {projectDialogOpen && (
        <div className="wb-modal-backdrop" onMouseDown={() => setProjectDialogOpen(false)}>
          <div className="wb-project-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="wb-project-modal-head">
              <div>
                <strong>{tr('添加工作目录', 'Add working folder')}</strong>
                <span>{tr('选择一个本地目录。绑定后文件、Git、终端和工作树会使用这个目录。', 'Choose a local folder for files, Git, terminal, and worktrees.')}</span>
              </div>
              <button onClick={() => setProjectDialogOpen(false)}><Icon d={IC.x} size={14} /></button>
            </div>
            <label>
              {tr('目录名称', 'Folder name')}
              <input value={projectDraft.name} onChange={e => setProjectDraft(d => ({ ...d, name: e.target.value }))} placeholder={tr('给这个目录起个名字', 'Name this folder')} />
            </label>
            <label>
              {tr('本地目录', 'Local folder')}
              <div className="wb-folder-picker">
                <input value={projectDraft.rootPath} onChange={e => setProjectDraft(d => ({ ...d, rootPath: e.target.value }))} placeholder={tr('选择本地目录', 'Choose a local folder')} />
                <button onClick={pickProjectFolder}>{tr('浏览', 'Browse')}</button>
              </div>
            </label>
            {projectError && <div className="wb-project-error">{projectError}</div>}
            <div className="wb-project-modal-actions">
              <button onClick={() => setProjectDialogOpen(false)}>{tr('取消', 'Cancel')}</button>
              <button className="primary" onClick={submitProject}>{tr('添加工作目录', 'Add folder')}</button>
            </div>
          </div>
        </div>
      )}

      {announcementOpen && (
        <div className="wb-modal-backdrop wb-announcement-backdrop" onMouseDown={closeAnnouncement}>
          <section className="wb-announcement-modal" onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={tr('AgentHub 使用公告', 'AgentHub announcement')}>
            <div className="wb-announcement-head">
              <div>
                <span>{tr('AgentHub 0.5.4', 'AgentHub 0.5.4')}</span>
                <h2>{tr('开始前请先完成运行配置', 'Finish run setup before starting')}</h2>
              </div>
              <button onClick={closeAnnouncement} aria-label={tr('关闭公告', 'Close announcement')}>
                <Icon d={IC.x} size={15} />
              </button>
            </div>
            <p className="wb-announcement-intro">
              {tr(
                '本版本把 AgentHub 工作台、Agent 切换、API 厂商直连、Git、Skills 和 MCP 整合到一个桌面流程中。为了避免任务发错 Agent，请按下面顺序完成首次配置。',
                'This release combines the workbench, agent switching, provider direct runs, Git, Skills, and MCP into one desktop workflow. Complete the setup below before sending tasks.'
              )}
            </p>
            <div className="wb-announcement-steps">
              <article>
                <strong>{tr('1. 配置可用 Agent CLI', '1. Configure an Agent CLI')}</strong>
                <p>{tr('进入 设置 -> Local Agents，点击检测或手动选择 Codex、Claude、Gemini、OpenCode 等 CLI 路径。只有检测通过或已配置可用路径的 Agent 才会出现在工作台选择器中。', 'Open Settings -> Local Agents, then detect or choose the CLI path for Codex, Claude, Gemini, OpenCode, and other agents. Only available agents appear in the workbench picker.')}</p>
              </article>
              <article>
                <strong>{tr('2. 检查路由与 API 厂商', '2. Check routing and providers')}</strong>
                <p>{tr('进入 设置 -> Providers / Routing，为需要的 API 厂商填写 Key，并确认 Agent 路由绑定。选择 DeepSeek、OpenAI 等厂商模型时，AgentHub 会直接走 API，不会误调用本地 CLI。', 'Open Settings -> Providers / Routing, add API keys, and confirm agent bindings. Provider models such as DeepSeek or OpenAI run through direct API calls instead of local CLIs.')}</p>
              </article>
              <article>
                <strong>{tr('3. 回到工作台选择运行对象', '3. Choose who runs the task')}</strong>
                <p>{tr('回到聊天工作台，在右侧/底部的运行选择器中点击要使用的 Agent 或 API 厂商模型。选中本地 Agent 后走 CLI/ACP；选中厂商模型后走 API 直连。', 'Return to the chat workbench and choose the agent or provider model from the run picker. Local agents use CLI/ACP; provider models use direct API calls.')}</p>
              </article>
              <article>
                <strong>{tr('4. 绑定工作目录并使用工具区', '4. Bind a folder and use tools')}</strong>
                <p>{tr('需要读取项目、查看 Git 或执行终端命令时，请先添加工作目录。Git、MCP、运行记录和外观设置都在工作台工具区或设置页中。', 'Add a working folder before reading project files, using Git, or running terminal commands. Git, MCP, run history, and appearance settings live in the tool area or Settings.')}</p>
              </article>
            </div>
            <div className="wb-announcement-actions">
              <button onClick={() => openAnnouncementSetup('local-agents')}>{tr('去选择 Agent CLI', 'Choose Agent CLI')}</button>
              <button onClick={() => openAnnouncementSetup('providers')}>{tr('配置 API 厂商', 'Configure providers')}</button>
              <button className="primary" onClick={closeAnnouncement}>{tr('我知道了', 'Got it')}</button>
            </div>
          </section>
        </div>
      )}

      <ApprovalDialog items={props.approvals} onDecide={props.onApprovalDecide} />
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

function WorkbenchToolPanel({
  panel,
  workspaceId,
  onClose,
  browserUrl,
  onBrowserUrlConsumed,
  onAttachBrowserCapture
}: {
  panel: Exclude<RightPanel, null | 'runs' | 'files' | 'terminal' | 'side-chat'>
  workspaceId: string | null
  onClose: () => void
  browserUrl?: string | null
  onBrowserUrlConsumed?: () => void
  onAttachBrowserCapture: (attachment: WorkbenchAttachment) => void
}) {
  if (panel === 'git') return <GitWorkbenchPanel workspaceId={workspaceId} onClose={onClose} />
  if (panel === 'worktrees') return <WorktreePanel workspaceId={workspaceId} onClose={onClose} />
  if (panel === 'browser') return <BrowserPanel workspaceId={workspaceId} onClose={onClose} initialUrl={browserUrl} onInitialUrlConsumed={onBrowserUrlConsumed} onAttach={onAttachBrowserCapture} />
  return null
}

async function watchTerminalRun(runId: string, setRuns: React.Dispatch<React.SetStateAction<TerminalRun[]>>, signal?: AbortSignal) {
  let attempt = 0
  while (!signal?.aborted) {
    if (signal?.aborted) return
    const delay = attempt < 8 ? 500 : Math.min(5000, 1200 + (attempt - 8) * 250)
    await new Promise(resolve => setTimeout(resolve, delay))
    if (signal?.aborted) return
    const history = await window.electronAPI.terminal.history().catch(() => [])
    const current = history.find(run => run.id === runId)
    setRuns(history)
    if (current && current.status !== 'running') break
    if (!current) break
    attempt += 1
  }
}

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
