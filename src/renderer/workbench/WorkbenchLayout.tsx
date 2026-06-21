import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { BindingDef, ProviderDef, TaskItem } from '../glass/meta'
import { ApprovalDialog, ApprovalItem } from '../glass/approval-dialog'
import { SettingsScreen, MotionLevel } from '../screens/Settings'
import { WorkflowsPanel } from './WorkflowsPanel'
import { TasksScreen } from '../screens/Tasks'
import { SetupTab, summarizeAgentConnections } from '../glass/connection-status'
import { tr } from '../glass/i18n'
import { SessionSidebar } from './SessionSidebar'
import { ThreadView } from './ThreadView'
import { ComposerBar } from './ComposerBar'
import { RunTimeline } from './RunTimeline'
import { WriteWorkspace } from './WriteWorkspace'
import { GitWorkbenchPanel } from './GitWorkbenchPanel'
import { WorkspaceItem, AgentMap } from './types'
import { CommandPalette, PaletteCommand } from './CommandPalette'
import { ErrorBoundary } from '../ErrorBoundary'
import { localAgentLabel, localAgentOptions } from './localAgentOptions'
import { customScheduleHasRunnableSteps, defaultCustomSchedule, defaultSmartFiveRoleSchedule, isStoredSchedule, sanitizeCustomSchedule } from './customSchedule'
import { defaultDialogPath, readAppearanceLocal, rememberDialogPath } from '../appearance'
import {
  findKeyboardShortcutCommand,
  keyboardEventToShortcut,
  KEYBOARD_SHORTCUT_STORE_KEY,
  KEYBOARD_SHORTCUT_COMMANDS,
  KEYBOARD_SHORTCUTS_CHANGED,
  KeyboardShortcutsConfigV1,
  resolveKeyboardShortcutBindings,
  shortcutDisplay
} from '../keyboard-shortcuts'

type ViewMode = 'chat' | 'write' | 'tasks' | 'settings' | 'workflows'
type SettingsTabKey = SetupTab | 'appearance' | 'memory' | 'updates' | 'shortcuts' | 'models'
type RightPanel = 'runs' | 'git' | 'worktrees' | 'browser' | null
type ThinkingLevelChoice = 'low' | 'medium' | 'high' | 'xhigh'
type WorkbenchThinking = { mode: 'off' | 'auto' | 'enabled'; level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; collapseInUI?: boolean; budgetTokens?: number }

const AGENT_SLOT_STORE_KEY = 'agenthub.workbench.agentSlots.v1'
const INSPECTOR_WIDTH_STORE_KEY = 'agenthub.workbench.inspectorWidth.v1'
const LAST_VIEW_STORE_KEY = 'agenthub.workbench.lastView.v1'
const CUSTOM_SCHEDULE_STORE_KEY = 'agenthub.workbench.customSchedule.v1'
const SMART_SCHEDULE_STORE_KEY = 'agenthub.workbench.smartFiveRoleSchedule.v1'
const ANNOUNCEMENT_STORE_KEY = 'agenthub.workbench.announcement.v0.5.4'
const DEFAULT_INSPECTOR_WIDTH = 460
const MIN_INSPECTOR_WIDTH = 340
const MAX_INSPECTOR_WIDTH = 760

function mergeRuntimeEventLists(base: RuntimeEvent[], incoming: RuntimeEvent[]): RuntimeEvent[] {
  if (incoming.length === 0) return base
  const seen = new Set(base.map(event => event.id || `${event.threadId}:${event.seq}`))
  const additions = incoming.filter(event => {
    const key = event.id || `${event.threadId}:${event.seq}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (additions.length === 0) return base
  const last = base[base.length - 1]
  const ordered = !last || additions.every(event => event.seq > last.seq)
  return ordered ? [...base, ...additions] : [...base, ...additions].sort((a, b) => a.seq - b.seq)
}

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
  }
  motion: MotionLevel
  setMotion: (m: MotionLevel) => void
}

export function WorkbenchLayout(props: WorkbenchLayoutProps) {
  const [view, setViewState] = useState<ViewMode>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>('providers')
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>({ threads: [], turns: [], runs: [], activeThreadId: null })
  const [allThreads, setAllThreads] = useState<WorkbenchThread[]>([])
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [mode, setMode] = useState<DispatchPreset>('lead-workers')
  const [targetAgent, setTargetAgent] = useState<string | null>(null)
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(null)
  const [thinking, setThinking] = useState<WorkbenchThinking>({ mode: 'auto', level: 'medium', collapseInUI: true })
  const [schedules, setSchedules] = useState<SchedulePreview[]>([])
  const [activeGoal, setActiveGoal] = useState<WorkbenchGoal | null>(null)
  const [threadTodos, setThreadTodosState] = useState<ThreadTodo[]>([])
  const [customSchedule, setCustomScheduleState] = useState<SchedulePreview>(() => defaultCustomSchedule())
  const [smartSchedule, setSmartScheduleState] = useState<SchedulePreview>(() => defaultSmartFiveRoleSchedule())
  const [localAgents, setLocalAgents] = useState<LocalAgentStatus[]>([])
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectDraft, setProjectDraft] = useState({ name: '', rootPath: '' })
  const [projectError, setProjectError] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [agentSlots, setAgentSlots] = useState<string[]>([])
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
  const runtimeEventFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadScrollRef = useRef<HTMLElement | null>(null)
  const shouldStickToBottom = useRef(true)
  const startupViewApplied = useRef(false)
  const smartScheduleStoreLoaded = useRef(false)

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

  const activeThreadId = snapshot.activeThreadId

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

  const loadWorkbench = useCallback(async (nextWorkspaceId?: string | null) => {
    clearRuntimeEventBuffer()
    const [wsList, activeWs, scheduleList, local] = await Promise.all([
      window.electronAPI.workspaces.list().catch(() => []),
      window.electronAPI.workspaces.getActive().catch(() => null),
      window.electronAPI.schedules.list().catch(() => []),
      window.electronAPI.localAgents.status().catch(() => [])
    ])

    const resolvedWorkspaceId = nextWorkspaceId !== undefined ? nextWorkspaceId : (workspaceId ?? activeWs ?? null)
    const [snap, allSnap] = await Promise.all([
      window.electronAPI.runtime.snapshot(resolvedWorkspaceId),
      window.electronAPI.runtime.snapshot(undefined)
    ])

    setSnapshot(snap)
    setAllThreads(allSnap.threads)
    setWorkspaces(wsList)
    setWorkspaceId(resolvedWorkspaceId)
    setSchedules(scheduleList)
    setLocalAgents(local)

    if (snap.activeThreadId) {
      loadingThreadIdRef.current = snap.activeThreadId
      const loadedEvents = await window.electronAPI.runtime.eventsSince(snap.activeThreadId, 0)
      setEvents(prev => mergeRuntimeEventLists(
        loadedEvents,
        [
          ...prev.filter(event => event.threadId === snap.activeThreadId),
          ...pendingRuntimeEvents.current.filter(event => event.threadId === snap.activeThreadId)
        ]
      ))
      setThreadTodosState(await window.electronAPI.todos.list(snap.activeThreadId).catch(() => []))
      if (loadingThreadIdRef.current === snap.activeThreadId) loadingThreadIdRef.current = null
    } else {
      setEvents([])
      setThreadTodosState([])
      loadingThreadIdRef.current = null
    }
  }, [workspaceId, clearRuntimeEventBuffer])

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
        if (saved === 'chat' || saved === 'write' || saved === 'tasks' || saved === 'settings') lastView = saved
      } catch { /* noop */ }
      setView(lastView)
    }
  }, [setView])

  useEffect(() => {
    if (props.runtimeRefreshNonce === undefined) return
    loadWorkbench(workspaceId).catch(() => {})
  }, [props.runtimeRefreshNonce])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    window.electronAPI.store.get(AGENT_SLOT_STORE_KEY)
      .then(value => { if (Array.isArray(value)) setAgentSlots(value.filter(Boolean).slice(0, 3)) })
      .catch(() => {})
    window.electronAPI.store.get(CUSTOM_SCHEDULE_STORE_KEY)
      .then(value => { if (isStoredSchedule(value, 'custom')) setCustomScheduleState(value) })
      .catch(() => {})
    window.electronAPI.store.get(SMART_SCHEDULE_STORE_KEY)
      .then(value => {
        smartScheduleStoreLoaded.current = true
        if (isStoredSchedule(value, 'firefly-custom')) setSmartScheduleState(value)
      })
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
      if (event.threadId === activeThreadId || event.threadId === loadingThreadIdRef.current) {
        if (isBufferedRuntimeEvent(event)) enqueueRuntimeEvent(event)
        else {
          flushRuntimeEvents()
          appendRuntimeEvents([event])
        }
        if (event.kind === 'orchestrate' && event.payload?.kind === 'orchestrate:plan') {
          void refreshThreadTodos(event.threadId)
        }
      }
      const immediate = event.kind === 'turn:created' || event.kind === 'turn:status' || event.kind === 'agent:done' || event.kind === 'agent:error' || event.kind === 'run:created' || event.kind === 'run:status'
      if (snapshotRefreshTimer.current) clearTimeout(snapshotRefreshTimer.current)
      snapshotRefreshTimer.current = setTimeout(() => {
        window.electronAPI.runtime.snapshot(workspaceId).then(setSnapshot).catch(() => {})
        window.electronAPI.runtime.snapshot(undefined).then(snap => setAllThreads(snap.threads)).catch(() => {})
        snapshotRefreshTimer.current = null
      }, immediate ? 0 : 400)
    })
    return () => {
      unsubscribe()
      clearRuntimeEventBuffer()
    }
  }, [activeThreadId, workspaceId, refreshThreadTodos, appendRuntimeEvents, enqueueRuntimeEvent, flushRuntimeEvents, clearRuntimeEventBuffer])

  useEffect(() => {
    refreshThreadTodos().catch(() => {})
  }, [refreshThreadTodos])

  const activeThread = useMemo(
    () => snapshot.threads.find(t => t.id === snapshot.activeThreadId) ?? null,
    [snapshot]
  )

  const activeTurns = useMemo(
    () => activeThread ? snapshot.turns.filter(t => t.threadId === activeThread.id) : [],
    [snapshot.turns, activeThread]
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

  const selectTargetAgent = useCallback((agentId: string | null) => {
    setTargetAgent(agentId)
    if (agentId) setModelSelection(null)
  }, [])

  useEffect(() => {
    if (!smartScheduleStoreLoaded.current) return
    const usable = localAgentOptions(localAgents)
    if (usable.length === 0 || customScheduleHasRunnableSteps(smartSchedule)) return
    const next = defaultSmartFiveRoleSchedule(usable)
    setSmartScheduleState(next)
    window.electronAPI.store.set(SMART_SCHEDULE_STORE_KEY, next).catch(() => {})
  }, [localAgents, smartSchedule])

  const openSetup = (tab: SettingsTabKey = 'providers') => {
    setSettingsTab(tab)
    setView('settings')
  }

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
    await window.electronAPI.workspaces.setActive(id).catch(() => null)
    await loadWorkbench(id)
    setView('chat')
  }

  const selectThread = async (threadId: string | null) => {
    loadingThreadIdRef.current = threadId
    const thread = allThreads.find(t => t.id === threadId)
    const threadWorkspaceId = thread ? thread.workspaceId : workspaceId
    if (threadWorkspaceId !== workspaceId) {
      setWorkspaceId(threadWorkspaceId)
      await window.electronAPI.workspaces.setActive(threadWorkspaceId).catch(() => null)
    }

    const selected = await window.electronAPI.threads.select(threadId)
    const [snap, allSnap] = await Promise.all([
      window.electronAPI.runtime.snapshot(threadWorkspaceId),
      window.electronAPI.runtime.snapshot(undefined)
    ])
    const loadedEvents = selected ? await window.electronAPI.runtime.eventsSince(selected, 0) : []
    const pendingForSelected = selected ? pendingRuntimeEvents.current.filter(event => event.threadId === selected) : []
    clearRuntimeEventBuffer()
    setSnapshot(snap)
    setAllThreads(allSnap.threads)
    setEvents(prev => selected ? mergeRuntimeEventLists(
      loadedEvents,
      [
        ...prev.filter(event => event.threadId === selected),
        ...pendingForSelected
      ]
    ) : [])
    setThreadTodosState(selected ? await window.electronAPI.todos.list(selected).catch(() => []) : [])
    setActiveGoal(selected ? await window.electronAPI.goals.get(selected).catch(() => null) : null)
    if (loadingThreadIdRef.current === threadId) loadingThreadIdRef.current = null
    shouldStickToBottom.current = true
    setView('chat')
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
        const nextView = params.view as ViewMode
        if (['chat', 'write', 'tasks', 'settings'].includes(nextView)) setView(nextView)
      } else if (action === 'open-panel') {
        const panel = params.panel
        if (panel === 'runs' || panel === 'git' || panel === 'worktrees' || panel === 'browser') setRightPanel(panel)
      } else if (action === 'setup') {
        openSetup(params.tab as SettingsTabKey)
      }
    })
  }, [createThread, openCreateProject])

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
    else if (commandId === 'view-settings') setView('settings')
    else if (commandId === 'panel-runs') setRightPanel('runs')
    else if (commandId === 'panel-git') setRightPanel('git')
    else if (commandId === 'panel-browser') setRightPanel('browser')
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
      { id: 'open-diagnostics', label: 'Run Diagnostics', labelZh: '运行诊断', category: 'system' },
      { id: 'open-backup', label: 'Create Backup', labelZh: '创建备份', category: 'system' }
    ]
    return [...fromShortcuts, ...extra]
  }, [])

  const executePaletteCommand = useCallback((id: string) => {
    // Try shortcut handler first
    runShortcutCommand(id)
    // Handle extra commands
    if (id === 'open-memory') openSetup('memory')
    else if (id === 'open-skills') openSetup('skills')
    else if (id === 'open-diagnostics') openSetup('appearance') // diagnostics tab would go here
    else if (id === 'open-backup') openSetup('appearance')
  }, [runShortcutCommand, openSetup])

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
    const nextTargetAgent = selectedProviderDirect ? null : requestedTargetAgent
    const nextMode = selectedProviderDirect ? 'auto' : (overrides.mode || mode)
    const rawCustomSchedule = selectedProviderDirect
      ? undefined
      : (overrides.customSchedule || (!nextTargetAgent && (nextMode === 'custom' ? customSchedule : nextMode === 'firefly-custom' ? smartSchedule : undefined)))
    const usableLocalAgents = localAgentOptions(localAgents)
    const safeCustomSchedule = rawCustomSchedule ? sanitizeCustomSchedule(rawCustomSchedule, usableLocalAgents) : undefined
    const scheduleUnavailable = nextMode === 'custom'
      ? safeCustomSchedule && !customScheduleHasRunnableSteps(safeCustomSchedule)
      : nextMode === 'firefly-custom'
      ? safeCustomSchedule
        ? !customScheduleHasRunnableSteps(safeCustomSchedule)
        : usableLocalAgents.length === 0
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
        modelSelection: requestedModelSelection || undefined,
        attachments,
        customSchedule: safeCustomSchedule
      })
      const threadId = result?.thread?.id || activeThreadId
      if (threadId) await selectThread(threadId)
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
    setSnapshot(await window.electronAPI.runtime.snapshot(workspaceId).catch(() => snapshot))
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
  const currentSchedule = schedules.find(schedule => schedule.preset === mode)
  const usableAgentIds = localAgentOptions(localAgents)
  const selectedAgentId = targetAgent && usableAgentIds.includes(targetAgent) ? targetAgent : null
  const visibleAgentIds = selectedAgentId
    ? [selectedAgentId, ...usableAgentIds.filter(id => id !== selectedAgentId)].slice(0, 3)
    : usableAgentIds.slice(0, 3)
  const overflowAgentIds = usableAgentIds.filter(id => !visibleAgentIds.includes(id))
  const readyLocalAgents = usableAgentIds.length
  const selectedAgentName = selectedAgentId ? agentShortName(selectedAgentId) : null

  useEffect(() => {
    if (targetAgent && !usableAgentIds.includes(targetAgent)) setTargetAgent(null)
  }, [targetAgent, usableAgentIds.join('|')])

  const persistAgentSlots = useCallback((slots: string[]) => {
    const clean = normalizeAgentSlots(slots, usableAgentIds)
    setAgentSlots(clean)
    window.electronAPI.store.set(AGENT_SLOT_STORE_KEY, clean).catch(() => {})
  }, [usableAgentIds.join('|')])

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
        setTargetAgent(null)
        const nextPrompt = [
          instruction,
          '',
          '用户需求:',
          args
        ].join('\n')
        await sendPrompt(nextPrompt, [], { targetAgent: null, mode: 'auto' })
        return true
      }
      const nextPrompt = [
        `[${tr('工作流指令', 'Workflow command')}: ${command.label}]`,
        instruction,
        args ? `\n用户内容:\n${args}` : ''
      ].filter(Boolean).join('\n\n')
      await sendPrompt(nextPrompt)
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
      setTargetAgent(null)
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
      void watchTerminalRun(run.id, setTerminalRuns)
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
          activeThreadId={activeThreadId}
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
          {view === 'write' && (
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
              events={events}
            />
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
                events={events}
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
                events={events}
              />
            </>
            </ErrorBoundary>
          )}

          {view === 'tasks' && (
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
          )}

          {view === 'settings' && (
            <div className="wb-scroll-surface wb-settings-surface">
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
                motion={props.motion}
                setMotion={props.setMotion}
                initialTab={settingsTab}
                workspaceId={workspaceId}
                connectionSummary={connectionSummary}
                goChat={(agentId) => { selectTargetAgent(agentId); setView('chat') }}
                openSetup={openSetup}
              />
            </div>
          )}
          {view === 'workflows' && (
            <div className="wb-scroll-surface wb-settings-surface">
              <WorkflowsPanel onClose={() => setView('chat')} />
            </div>
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
                <RunTimeline
                  events={events}
                  turns={activeTurns}
                  localAgents={localAgents}
                  setLocalAgents={setLocalAgents}
                  schedules={schedules}
                  mode={mode}
                  setMode={setMode}
                  customSchedule={customSchedule}
                  setCustomSchedule={setCustomSchedule}
                  smartSchedule={smartSchedule}
                  setSmartSchedule={setSmartSchedule}
                  openSetup={openSetup}
                  onClose={() => setRightPanel(null)}
                  terminalRuns={terminalRuns}
                  setTerminalRuns={setTerminalRuns}
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

function NativeTitlebar({
  hubRunning,
  search,
  setSearch,
  view,
  setView,
  createThread,
  openCreateProject,
  openSetup,
  setRightPanel,
  shortcuts
}: {
  hubRunning: boolean
  search: string
  setSearch: (v: string) => void
  view: ViewMode
  setView: (view: ViewMode) => void
  createThread: () => Promise<void>
  openCreateProject: () => void
  openSetup: (tab?: SettingsTabKey) => void
  setRightPanel: (panel: RightPanel) => void
  shortcuts: ReturnType<typeof resolveKeyboardShortcutBindings>
}) {
  const win = window.electronAPI?.win
  const [openMenu, setOpenMenu] = useState<'file' | 'view' | 'help' | null>(null)

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [openMenu])

  const run = (action: () => void | Promise<unknown>) => (event: React.MouseEvent) => {
    event.stopPropagation()
    setOpenMenu(null)
    void action()
  }

  return (
    <div className="wb-titlebar app-drag" onDoubleClick={() => win?.maximizeToggle()}>
      <TitlebarMenu
        id="file"
        label={tr('文件', 'File')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('新建对话', 'New chat'), shortcut: shortcutDisplay(shortcuts['new-chat']), action: run(createThread) },
          { label: tr('添加工作目录', 'Add working folder'), shortcut: shortcutDisplay(shortcuts['choose-workspace']), action: run(openCreateProject) },
          { label: tr('打开 Git 面板', 'Open Git panel'), shortcut: shortcutDisplay(shortcuts['panel-git']), action: run(() => setRightPanel('git')) },
          { label: tr('打开浏览器', 'Open browser'), shortcut: shortcutDisplay(shortcuts['panel-browser']), action: run(() => setRightPanel('browser')) }
        ]}
      />
      <TitlebarMenu
        id="view"
        label={tr('视图', 'View')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('对话', 'Chat'), shortcut: shortcutDisplay(shortcuts['view-chat']), checked: view === 'chat', action: run(() => setView('chat')) },
          { label: tr('写作', 'Write'), shortcut: shortcutDisplay(shortcuts['view-write']), checked: view === 'write', action: run(() => setView('write')) },
          { label: tr('任务历史', 'Tasks'), shortcut: shortcutDisplay(shortcuts['view-tasks']), checked: view === 'tasks', action: run(() => setView('tasks')) },
          { label: tr('设置', 'Settings'), shortcut: shortcutDisplay(shortcuts['view-settings']), checked: view === 'settings', action: run(() => setView('settings')) },
          { label: tr('运行面板', 'Runs panel'), shortcut: shortcutDisplay(shortcuts['panel-runs']), action: run(() => setRightPanel('runs')) },
          { label: tr('工作树面板', 'Worktrees panel'), action: run(() => setRightPanel('worktrees')) }
        ]}
      />
      <TitlebarMenu
        id="help"
        label={tr('帮助', 'Help')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('快捷键设置', 'Keyboard shortcuts'), shortcut: shortcutDisplay(shortcuts['settings-shortcuts']), action: run(() => openSetup('shortcuts')) },
          { label: tr('MCP 配置', 'MCP settings'), shortcut: shortcutDisplay(shortcuts['settings-mcp']), action: run(() => openSetup('mcp')) },
          { label: tr('打开项目主页', 'Open homepage'), action: run(() => window.electronAPI.app.openExternal('https://agenthub.dev')) }
        ]}
      />
      <div className="wb-title-spacer"></div>
      <div className="wb-search app-no-drag">
        <Icon d={IC.search} size={14} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('搜索工作目录、会话、任务', 'Search folders, sessions, tasks')} />
      </div>
      <div className="wb-hub-state">
        <span className={'ah-dot ' + (hubRunning ? 'idle' : 'error')}></span>
        {hubRunning ? tr('Hub 运行中', 'Hub running') : tr('Hub 离线', 'Hub offline')}
      </div>
      <div className="wb-window-actions app-no-drag">
        <button onClick={() => win?.minimize()}><Icon d={IC.min} size={13} /></button>
        <button onClick={() => win?.maximizeToggle()}><Icon d={IC.max} size={13} /></button>
        <button onClick={() => win?.close()}><Icon d={IC.x} size={13} /></button>
      </div>
    </div>
  )
}

function AgentSlotBar({
  usableAgentIds,
  slots,
  persistSlots,
  targetAgent,
  setTargetAgent,
  agents
}: {
  usableAgentIds: string[]
  slots: string[]
  persistSlots: (slots: string[]) => void
  targetAgent: string | null
  setTargetAgent: (agentId: string | null) => void
  agents: AgentMap
}) {
  const normalized = normalizeAgentSlots(slots, usableAgentIds)
  useEffect(() => {
    if (usableAgentIds.length > 0 && normalized.join('|') !== slots.join('|')) {
      persistSlots(normalized)
    }
  }, [usableAgentIds.join('|'), normalized.join('|'), slots.join('|'), persistSlots])

  if (usableAgentIds.length === 0) return null

  return (
    <div className="wb-agent-slots" aria-label={tr('本地 Agent 槽位', 'Local agent slots')}>
      {normalized.map((agentId, index) => {
        const choices = usableAgentIds.filter(id => id === agentId || !normalized.includes(id))
        const canReplace = choices.length > 1
        return (
          <div key={`${index}-${agentId}`} className={'wb-agent-slot' + (targetAgent === agentId ? ' active' : '')}>
            <button
              type="button"
              className="wb-agent-slot-main"
              onClick={() => setTargetAgent(targetAgent === agentId ? null : agentId)}
              title={tr(`直连 ${agentShortName(agentId)}`, `Route directly to ${agentShortName(agentId)}`)}
            >
              <AgentMark id={agentId} size={24} radius={7} />
              <span>{agentShortName(agentId)}</span>
              <i className={'ah-dot ' + (agents[agentId]?.status || 'idle')}></i>
            </button>
            {canReplace && (
              <select
                value={agentId}
                onChange={event => {
                  const next = [...normalized]
                  next[index] = event.target.value
                  persistSlots(next)
                  setTargetAgent(event.target.value)
                }}
                aria-label={tr('替换 Agent', 'Replace agent')}
              >
                {choices.map(id => <option key={id} value={id}>{agentShortName(id)}</option>)}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WorkbenchChatTopBar({
  title,
  workspaceName,
  workspaceTitle,
  openWorkspace,
  workspaceRoot,
  activePanel,
  setPanel,
  workspaceId,
  readyLocalAgents,
  openTasks,
  todos,
  activeThreadId,
  updateTodoStatus,
  deleteTodo
}: {
  title: string
  workspaceName: string
  workspaceTitle: string
  openWorkspace: () => void
  workspaceRoot: string | null
  activePanel: RightPanel
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  readyLocalAgents: number
  openTasks: () => void
  todos: ThreadTodo[]
  activeThreadId: string | null
  updateTodoStatus: (todo: ThreadTodo, status: ThreadTodoStatus) => void
  deleteTodo: (todoId: string) => void
}) {
  const [todoOpen, setTodoOpen] = useState(false)
  const todoRef = useRef<HTMLDivElement | null>(null)
  const openTodos = todos.filter(todo => todo.status !== 'completed')
  const completedTodos = todos.filter(todo => todo.status === 'completed')

  useEffect(() => {
    if (!todoOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!todoRef.current?.contains(event.target as Node)) setTodoOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [todoOpen])

  return (
    <>
      <div className="wb-minimal-head-left">
        <button className="wb-minimal-project" type="button" onClick={openWorkspace} title={workspaceTitle}>
          <Icon d={IC.folder} size={14} />
          <span>{workspaceName}</span>
          <Icon d={IC.chevDown} size={12} />
        </button>
        <span className="wb-minimal-title">{title}</span>
      </div>
      <div className="wb-minimal-head-actions">
        <button
          className="wb-minimal-tool-button"
          type="button"
          disabled={!workspaceRoot}
          onClick={() => workspaceRoot && window.electronAPI.app.openPath({ path: workspaceRoot, target: readAppearanceLocal().defaultOpenTarget })}
          title={workspaceRoot ? tr('打开编辑器（默认打开目标）', 'Open editor (default open target)') : tr('选择工作目录后可用', 'Choose a working folder first')}
        >
          <Icon d={IC.folder} size={15} />
          <span>{tr('打开编辑器', 'Open editor')}</span>
        </button>
        <ToolPanelBar activePanel={activePanel} setPanel={setPanel} workspaceId={workspaceId} iconOnly />
        <button
          className={'wb-minimal-tool-button' + (activePanel === 'runs' ? ' active' : '')}
          onClick={() => setPanel(activePanel === 'runs' ? null : 'runs')}
          title={tr('运行', 'Runs')}
        >
          <Icon d={IC.tasks} size={15} />
          {readyLocalAgents > 0 && <small>{readyLocalAgents}</small>}
        </button>
        <div className="wb-top-todo" ref={todoRef}>
          <button
            className={'wb-minimal-tool-button' + (todoOpen ? ' active' : '')}
            onClick={() => setTodoOpen(open => !open)}
            title={tr('Todo / Agent 分步任务', 'Todo / agent plan tasks')}
          >
            <Icon d={IC.tasks} size={15} />
            <span>Todo</span>
            {openTodos.length > 0 && <small>{Math.min(99, openTodos.length)}</small>}
          </button>
          {todoOpen && (
            <div className="wb-top-todo-popover">
              <div className="wb-top-todo-head">
                <div>
                  <strong>Todo</strong>
                  <span>{activeThreadId ? tr('当前会话的 Agent 分步任务', 'Agent plan tasks for this thread') : tr('还没有打开会话', 'No active thread')}</span>
                </div>
                <button className="ah-btn sm" type="button" onClick={openTasks}>{tr('完整任务页', 'Task page')}</button>
              </div>
              <div className="wb-top-todo-list">
                {todos.length === 0 && (
                  <div className="wb-top-todo-empty">
                    {tr('Agent 生成计划后，分步任务会显示在这里。', 'Agent-generated plan steps will appear here.')}
                  </div>
                )}
                {openTodos.map(todo => (
                  <TodoPopoverRow
                    key={todo.id}
                    todo={todo}
                    onStatus={updateTodoStatus}
                    onDelete={deleteTodo}
                  />
                ))}
                {completedTodos.length > 0 && (
                  <details className="wb-top-todo-done">
                    <summary>{tr(`已完成 ${completedTodos.length} 项`, `${completedTodos.length} completed`)}</summary>
                    {completedTodos.slice(0, 8).map(todo => (
                      <TodoPopoverRow
                        key={todo.id}
                        todo={todo}
                        onStatus={updateTodoStatus}
                        onDelete={deleteTodo}
                      />
                    ))}
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function TodoPopoverRow({
  todo,
  onStatus,
  onDelete
}: {
  todo: ThreadTodo
  onStatus: (todo: ThreadTodo, status: ThreadTodoStatus) => void
  onDelete: (todoId: string) => void
}) {
  const nextStatus: ThreadTodoStatus = todo.status === 'completed' ? 'pending' : 'completed'
  return (
    <div className={'wb-top-todo-row status-' + todo.status}>
      <button
        className="wb-top-todo-check"
        type="button"
        onClick={() => onStatus(todo, nextStatus)}
        title={todo.status === 'completed' ? tr('恢复待办', 'Mark pending') : tr('标记完成', 'Mark done')}
      >
        {todo.status === 'completed' && <Icon d={IC.check} size={12} />}
      </button>
      <button
        className="wb-top-todo-content"
        type="button"
        onClick={() => onStatus(todo, todo.status === 'in_progress' ? 'pending' : 'in_progress')}
        title={todo.content}
      >
        <span>{todo.content}</span>
        <small>{todo.status === 'in_progress' ? tr('进行中', 'In progress') : todo.status === 'completed' ? tr('已完成', 'Done') : tr('待处理', 'Pending')}</small>
      </button>
      <button className="wb-top-todo-delete" type="button" onClick={() => onDelete(todo.id)} title={tr('删除', 'Delete')}>
        <Icon d={IC.x} size={12} />
      </button>
    </div>
  )
}

function WorkbenchInspector({
  width,
  viewportWidth,
  setWidth,
  commitWidth,
  activePanel,
  setPanel,
  workspaceId,
  onClose,
  children
}: {
  width: number
  viewportWidth: number
  setWidth: (width: number) => void
  commitWidth: (width: number) => void
  activePanel: RightPanel
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  onClose: () => void
  children: React.ReactNode
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!drag.current) return
      setWidth(drag.current.startWidth + (drag.current.startX - event.clientX))
    }
    const up = () => {
      if (drag.current) commitWidth(width)
      drag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [setWidth, commitWidth, width])

  return (
    <aside className="wb-right wb-inspector" style={viewportWidth > 820 ? { width: clampInspectorWidth(width, viewportWidth) } : undefined}>
      <div
        className="wb-inspector-resize"
        onMouseDown={event => {
          drag.current = { startX: event.clientX, startWidth: width }
          event.preventDefault()
        }}
      />
      <div className="wb-inspector-tabs">
        {inspectorItems(workspaceId).map(item => (
          <button
            key={item.id}
            className={activePanel === item.id ? 'active' : ''}
            onClick={() => setPanel(item.id)}
            disabled={item.disabled}
            title={item.disabled ? tr('选择工作目录后可用', 'Choose a working folder first') : item.label}
          >
            <Icon d={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        ))}
        <button className="close" onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
      <div className="wb-inspector-body">{children}</div>
    </aside>
  )
}

function WorkbenchBottomDock({
  activePanel,
  setPanel,
  workspaceId,
  onClose,
  children
}: {
  activePanel: Exclude<RightPanel, null>
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <section className="wb-bottom-dock">
      <div className="wb-bottom-dock-tabs">
        {inspectorItems(workspaceId).map(item => (
          <button
            key={item.id}
            className={activePanel === item.id ? 'active' : ''}
            onClick={() => setPanel(item.id)}
            disabled={item.disabled}
            title={item.disabled ? tr('选择工作目录后可用', 'Choose a working folder first') : item.label}
          >
            <Icon d={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        ))}
        <button className="close" onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
      <div className="wb-bottom-dock-body">{children}</div>
    </section>
  )
}

function inspectorItems(workspaceId: string | null): Array<{ id: Exclude<RightPanel, null>; label: string; icon: React.ReactNode; disabled: boolean }> {
  return [
    { id: 'runs', label: tr('运行', 'Runs'), icon: IC.tasks, disabled: false },
    { id: 'git', label: 'Git', icon: IC.git, disabled: !workspaceId },
    { id: 'worktrees', label: tr('工作树', 'Worktrees'), icon: IC.folder, disabled: !workspaceId },
    { id: 'browser', label: tr('浏览器', 'Browser'), icon: IC.search, disabled: false }
  ]
}

function ToolPanelBar({ activePanel, setPanel, workspaceId, iconOnly = false }: { activePanel: RightPanel; setPanel: (panel: RightPanel) => void; workspaceId: string | null; iconOnly?: boolean }) {
  const items: Array<{ id: Exclude<RightPanel, null | 'runs'>; label: string; icon: React.ReactNode; requiresWorkspace?: boolean }> = [
    { id: 'git', label: 'Git', icon: IC.git, requiresWorkspace: true },
    { id: 'worktrees', label: tr('工作树', 'Worktrees'), icon: IC.folder, requiresWorkspace: true },
    { id: 'browser', label: tr('浏览器', 'Browser'), icon: IC.search }
  ]
  return (
    <div className={'wb-tool-panel-bar' + (iconOnly ? ' icon-only' : '')}>
      {items.map(item => {
        const disabled = item.requiresWorkspace && !workspaceId
        return (
          <button
            key={item.id}
            className={'wb-tool-button' + (activePanel === item.id ? ' active' : '')}
            onClick={() => !disabled && setPanel(activePanel === item.id ? null : item.id)}
            disabled={disabled}
            title={disabled ? tr('选择工作目录后可用', 'Available after choosing a working folder') : item.label}
          >
            <Icon d={item.icon} size={14} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function TitlebarMenu({
  id,
  label,
  openMenu,
  setOpenMenu,
  items
}: {
  id: 'file' | 'view' | 'help'
  label: string
  openMenu: 'file' | 'view' | 'help' | null
  setOpenMenu: (menu: 'file' | 'view' | 'help' | null) => void
  items: Array<{ label: string; shortcut?: string; checked?: boolean; action: (event: React.MouseEvent) => void }>
}) {
  const open = openMenu === id
  return (
    <div className="wb-menu-wrap app-no-drag" onPointerDown={event => event.stopPropagation()}>
      <button
        type="button"
        className={'wb-menu' + (open ? ' active' : '')}
        onClick={event => {
          event.stopPropagation()
          setOpenMenu(open ? null : id)
        }}
      >
        {label}
      </button>
      {open && (
        <div className="wb-menu-dropdown">
          {items.map(item => (
            <button key={item.label} type="button" onClick={item.action}>
              <span className="wb-menu-check">{item.checked ? '✓' : ''}</span>
              <span>{item.label}</span>
              {item.shortcut && <small>{item.shortcut}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GitBranchControl({ workspaceId, onOpenGit, compact = false }: { workspaceId: string | null; onOpenGit: () => void; compact?: boolean }) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const branchInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null)
      setBranches([])
      setError(null)
      return
    }
    setLoading(true)
    try {
      const nextStatus = await window.electronAPI.git.status(workspaceId)
      setStatus(nextStatus)
      if (open && nextStatus.isRepo) {
        const branchResponse = await window.electronAPI.git.branches(workspaceId).catch(() => null)
        setBranches(branchResponse?.localBranches || [])
      } else if (!open) {
        setBranches([])
      }
      setError(nextStatus.isRepo ? null : (nextStatus.error || tr('未检测到 Git 仓库。', 'No Git repository detected.')))
    } catch (e: any) {
      setError(e?.message || tr('读取 Git 状态失败。', 'Failed to read Git status.'))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, open])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => branchInputRef.current?.focus(), 0)
    const onPointerDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!workspaceId || !status?.isRepo) {
    const label = !workspaceId
      ? tr('未绑定目录', 'No workspace')
      : tr('不是 Git 仓库', 'Not a Git repo')
    return (
      <div className={'wb-git-branch-control empty' + (compact ? ' compact' : '')} title={error || label}>
        <button type="button" className="wb-git-branch-summary" onClick={onOpenGit}>
          <Icon d={IC.git} size={13} />
          <span>{label}</span>
          <small>Git</small>
        </button>
        <button type="button" className="wb-git-branch-add" onClick={onOpenGit} title={tr('打开 Git 面板', 'Open Git panel')}>
          <Icon d={IC.plus} size={13} />
        </button>
      </div>
    )
  }

  const dirty = status.files.length > 0
  const syncLabel = status.ahead || status.behind ? `↑${status.ahead} ↓${status.behind}` : tr('同步', 'synced')

  const checkout = async (branch: string) => {
    if (!branch || branch === status.branch) return
    try {
      setError(null)
      await window.electronAPI.git.checkoutBranch(workspaceId, branch)
      await refresh()
      setOpen(false)
    } catch (e: any) {
      setError(e?.message || tr('切换分支失败。', 'Failed to checkout branch.'))
      onOpenGit()
    }
  }

  const create = async (branch = query) => {
    if (!branch.trim()) return
    try {
      setError(null)
      await window.electronAPI.git.createBranch(workspaceId, branch.trim(), true)
      await refresh()
      setQuery('')
      setOpen(false)
    } catch (e: any) {
      setError(e?.message || tr('创建分支失败。', 'Failed to create branch.'))
      onOpenGit()
    }
  }

  const filteredBranches = branches.filter(branch => branch.name.toLowerCase().includes(query.trim().toLowerCase()))
  const canCreate = !!query.trim() && !branches.some(branch => branch.name.toLowerCase() === query.trim().toLowerCase())
  const dirtyLabel = dirty ? tr(`未提交：${status.files.length} 个文件`, `Uncommitted: ${status.files.length} files`) : syncLabel

  return (
    <div className={'wb-git-branch-control' + (compact ? ' compact' : '')} title={error || `${status.branch} · ${syncLabel}`} ref={popoverRef}>
      <button type="button" className="wb-git-branch-summary" onClick={() => setOpen(value => !value)}>
        <Icon d={IC.git} size={13} />
        <span>{status.branch || 'HEAD'}</span>
        <small>{dirty ? `${status.files.length} ${tr('变更', 'changes')}` : syncLabel}</small>
      </button>
      <button
        type="button"
        className="wb-git-branch-add"
        onClick={() => {
          setOpen(true)
          window.setTimeout(() => branchInputRef.current?.focus(), 0)
        }}
        disabled={loading}
        title={tr('新建或切换分支', 'Create or switch branch')}
      >
        <Icon d={IC.plus} size={13} />
      </button>
      {open && (
        <div className="wb-git-branch-popover">
          <div className="wb-git-branch-search">
            <Icon d={IC.search} size={14} />
            <input
              ref={branchInputRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  if (canCreate && !dirty) create().catch(() => {})
                  else if (filteredBranches[0] && !dirty) checkout(filteredBranches[0].name).catch(() => {})
                }
              }}
              placeholder={tr('搜索或输入新分支名', 'Search or type a new branch')}
              autoFocus
            />
          </div>
          <div className="wb-git-branch-popover-title">{tr('分支', 'Branches')}</div>
          {dirty && <div className="wb-git-branch-warning">{tr('有未提交变更时暂不切换或创建分支。', 'Commit or save changes before switching or creating branches.')}</div>}
          <div className="wb-git-branch-list">
            {filteredBranches.map(branch => (
              <button
                key={branch.name}
                type="button"
                className={branch.current ? 'active' : ''}
                onClick={() => checkout(branch.name).catch(() => {})}
                disabled={loading || dirty || branch.current}
              >
                <Icon d={IC.broadcast} size={15} />
                <span>
                  <strong>{branch.name}</strong>
                  {branch.current && <small>{dirtyLabel}</small>}
                </span>
                {branch.current && <Icon d={IC.check} size={15} />}
              </button>
            ))}
            {filteredBranches.length === 0 && <div className="wb-muted-box">{tr('没有匹配的分支。', 'No matching branches.')}</div>}
          </div>
          <div className="wb-git-branch-footer">
            <button type="button" onClick={onOpenGit}>{tr('Git 面板', 'Git panel')}</button>
            <button type="button" onClick={() => create().catch(() => {})} disabled={!canCreate || loading || dirty}>
              {canCreate ? `${tr('创建并检出', 'Create and checkout')} ${query.trim()}` : tr('创建并检出新分支...', 'Create and checkout new branch...')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function WorkbenchToolPanel({
  panel,
  workspaceId,
  onClose,
  browserUrl,
  onBrowserUrlConsumed,
  onAttachBrowserCapture
}: {
  panel: Exclude<RightPanel, null | 'runs'>
  workspaceId: string | null
  onClose: () => void
  browserUrl?: string | null
  onBrowserUrlConsumed?: () => void
  onAttachBrowserCapture: (attachment: WorkbenchAttachment) => void
}) {
  if (panel === 'git') return <GitWorkbenchPanel workspaceId={workspaceId} onClose={onClose} />
  if (panel === 'worktrees') return <WorktreePanel workspaceId={workspaceId} onClose={onClose} />
  if (panel === 'browser') return <BrowserPanelV2 workspaceId={workspaceId} onClose={onClose} initialUrl={browserUrl} onInitialUrlConsumed={onBrowserUrlConsumed} onAttach={onAttachBrowserCapture} />
  return null
}
function WorktreePanel({ workspaceId, onClose }: { workspaceId: string | null; onClose: () => void }) {
  const [items, setItems] = useState<WorktreeItem[]>([])
  const [branch, setBranch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setItems([])
      return
    }
    setItems(await window.electronAPI.worktrees.list(workspaceId).catch(() => []))
  }, [workspaceId])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  const create = async () => {
    if (!workspaceId || !branch.trim()) return
    setLoading(true)
    try {
      setError(null)
      await window.electronAPI.worktrees.create({ parentWorkspaceId: workspaceId, branch: branch.trim() })
      setBranch('')
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('创建工作树失败。', 'Failed to create worktree.'))
    } finally {
      setLoading(false)
    }
  }

  const sync = async (id: string) => {
    setLoading(true)
    try {
      setError(null)
      await window.electronAPI.worktrees.sync(id)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('同步工作树失败。', 'Failed to sync worktree.'))
    } finally {
      setLoading(false)
    }
  }

  const open = async (id: string) => {
    try {
      setError(null)
      await window.electronAPI.worktrees.open(id)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('打开工作树失败。', 'Failed to open worktree.'))
    }
  }

  const remove = async (item: WorktreeItem) => {
    const force = item.status === 'dirty'
    const message = force
      ? tr('这个工作树有未提交变更。确认强制删除并移除记录？', 'This worktree has uncommitted changes. Force remove it?')
      : tr('删除这个工作树并移除记录？', 'Remove this worktree and its record?')
    if (!window.confirm(message)) return
    try {
      setError(null)
      await window.electronAPI.worktrees.remove(item.id, force)
      await refresh()
    } catch (e: any) {
      setError(e?.message || tr('删除工作树失败。', 'Failed to remove worktree.'))
    }
  }

  return (
    <div className="wb-tool-panel">
      <PanelTitle title={tr('工作树', 'Worktrees')} subtitle={tr('隔离分支目录', 'Isolated branch folders')} onClose={onClose} onRefresh={refresh} />
      {!workspaceId && <div className="wb-muted-box">{tr('工作树需要先选择 Git 工作目录。', 'Choose a Git working folder to use worktrees.')}</div>}
      {workspaceId && (
        <>
          <div className="wb-tool-inline-form">
            <input value={branch} onChange={e => setBranch(e.target.value)} placeholder={tr('新分支名称', 'New branch name')} />
            <button onClick={create} disabled={loading || !branch.trim()}>{tr('创建', 'Create')}</button>
          </div>
          {items.length === 0 && <div className="wb-muted-box">{tr('还没有工作树。', 'No worktrees yet.')}</div>}
          {items.map(item => (
            <div key={item.id} className="wb-tool-row">
              <strong>{item.branch}</strong>
              <small>{worktreeStatusLabel(item.status)} · {item.path}</small>
              <div className="wb-tool-actions compact">
                <button onClick={() => open(item.id)}>{tr('打开', 'Open')}</button>
                <button onClick={() => sync(item.id)} disabled={loading}>{tr('同步', 'Sync')}</button>
                <button onClick={() => remove(item)} className="danger">{tr('删除', 'Delete')}</button>
              </div>
            </div>
          ))}
          {error && <div className="wb-send-error">{error}</div>}
        </>
      )}
    </div>
  )
}

function worktreeStatusLabel(status: WorktreeItem['status']): string {
  if (status === 'dirty') return tr('有变更', 'Dirty')
  if (status === 'missing') return tr('路径丢失', 'Missing')
  return tr('干净', 'Clean')
}

function BrowserPanelV2({
  workspaceId,
  onClose,
  initialUrl,
  onInitialUrlConsumed,
  onAttach
}: {
  workspaceId: string | null
  onClose: () => void
  initialUrl?: string | null
  onInitialUrlConsumed?: () => void
  onAttach: (attachment: WorkbenchAttachment) => void
}) {
  const [url, setUrl] = useState('')
  const [session, setSession] = useState<BrowserSession | null>(null)
  const [captured, setCaptured] = useState<BrowserContextAttachment | null>(null)
  const [attached, setAttached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [navState, setNavState] = useState({ canGoBack: false, canGoForward: false })
  const webviewRef = useRef<any>(null)

  const open = async (nextUrl = url) => {
    if (!nextUrl.trim()) return
    setLoadError(null)
    const next = await window.electronAPI.browser.open({ workspaceId, url: normalizeUrl(nextUrl) })
    setSession(next)
    setUrl(next.url)
  }

  useEffect(() => {
    if (!initialUrl) return
    setUrl(initialUrl)
    open(initialUrl).catch(e => setLoadError(e?.message || tr('打开网页失败。', 'Failed to open page.')))
    onInitialUrlConsumed?.()
  }, [initialUrl])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !session) return
    const syncNav = () => {
      try {
        setNavState({
          canGoBack: !!webview.canGoBack?.(),
          canGoForward: !!webview.canGoForward?.()
        })
      } catch {}
    }
    const start = () => { setLoading(true); setLoadError(null); syncNav() }
    const stop = () => {
      setLoading(false)
      syncNav()
      try {
        const currentUrl = webview.getURL?.()
        if (currentUrl) setUrl(currentUrl)
      } catch {}
    }
    const fail = (event: any) => {
      setLoading(false)
      const reason = event?.errorDescription || event?.errorCode || tr('页面加载失败。', 'Page failed to load.')
      setLoadError(String(reason))
      syncNav()
    }
    const title = (event: any) => {
      const nextTitle = event?.title || ''
      if (nextTitle) setSession(current => current ? { ...current, title: nextTitle } : current)
    }
    webview.addEventListener?.('did-start-loading', start)
    webview.addEventListener?.('did-stop-loading', stop)
    webview.addEventListener?.('did-navigate', stop)
    webview.addEventListener?.('did-navigate-in-page', stop)
    webview.addEventListener?.('did-fail-load', fail)
    webview.addEventListener?.('page-title-updated', title)
    return () => {
      webview.removeEventListener?.('did-start-loading', start)
      webview.removeEventListener?.('did-stop-loading', stop)
      webview.removeEventListener?.('did-navigate', stop)
      webview.removeEventListener?.('did-navigate-in-page', stop)
      webview.removeEventListener?.('did-fail-load', fail)
      webview.removeEventListener?.('page-title-updated', title)
    }
  }, [session?.id])

  const capture = async () => {
    const webview = webviewRef.current
    if (!webview) return
    const result = await webview.executeJavaScript(`(() => {
      const text = document.body ? document.body.innerText.slice(0, 12000) : ''
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 24).map(el => el.textContent?.trim()).filter(Boolean)
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 40).map(a => ({ text: a.textContent?.trim().slice(0, 80) || a.href, href: a.href }))
      const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map(form => form.getAttribute('aria-label') || form.getAttribute('name') || 'form')
      return { url: location.href, title: document.title, text, headings, links, forms, capturedAt: Date.now() }
    })()`)
    const attachment = await window.electronAPI.browser.capture(result)
    setCaptured(attachment)
    onAttach(browserCaptureToAttachment(attachment))
    setAttached(true)
  }

  return (
    <div className="wb-tool-panel wb-browser-panel">
      <PanelTitle title={tr('浏览器', 'Browser')} subtitle={session?.title || session?.url || tr('空白预览', 'Blank preview')} onClose={onClose} />
      <div className="wb-browser-toolbar">
        <button onClick={() => webviewRef.current?.goBack?.()} disabled={!session || !navState.canGoBack}><Icon d={IC.chev} size={13} style={{ transform: 'rotate(180deg)' }} /></button>
        <button onClick={() => webviewRef.current?.goForward?.()} disabled={!session || !navState.canGoForward}><Icon d={IC.chev} size={13} /></button>
        <button onClick={() => webviewRef.current?.reload?.()} disabled={!session}><Icon d={IC.refresh} size={13} /></button>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') open().catch(err => setLoadError(err?.message || tr('打开网页失败。', 'Failed to open page.'))) }} placeholder={tr('输入网址', 'Enter URL')} />
        <button onClick={() => open().catch(err => setLoadError(err?.message || tr('打开网页失败。', 'Failed to open page.')))} disabled={!url.trim()}>{loading ? tr('载入中', 'Loading') : tr('打开', 'Open')}</button>
        <button onClick={capture} disabled={!session || loading}>{tr('捕获', 'Capture')}</button>
        <button onClick={() => session?.url && window.electronAPI.app.openExternal(session.url)} disabled={!session}><Icon d={IC.link} size={13} /></button>
      </div>
      {loadError && <div className="wb-send-error">{loadError}</div>}
      {captured && <div className="wb-muted-box">{attached ? tr('已加入下一轮上下文：', 'Attached to next prompt: ') : tr('已捕获页面上下文：', 'Captured page context: ')}{captured.title || captured.url}</div>}
      {session
        ? <webview ref={webviewRef} className="wb-browser-webview" src={session.url} allowpopups={false} />
        : <div className="wb-browser-blank"><Icon d={IC.search} size={20} /><strong>{tr('浏览器未打开', 'Browser is blank')}</strong><span>{tr('输入网址后再载入页面。', 'Enter a URL to load a page.')}</span></div>}
    </div>
  )
}

function PanelTitle({ title, subtitle, onClose, onRefresh, loading }: { title: string; subtitle?: string; onClose: () => void; onRefresh?: () => void | Promise<void>; loading?: boolean }) {
  return (
    <div className="wb-timeline-head">
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="wb-timeline-head-actions">
        {onRefresh && <button onClick={() => onRefresh()} disabled={loading} title={tr('刷新', 'Refresh')}><Icon d={IC.refresh} size={14} /></button>}
        <button onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
      </div>
    </div>
  )
}

function normalizeUrl(value: string): string {
  const text = value.trim()
  if (!text) return 'about:blank'
  if (/^(https?|file):\/\//i.test(text)) return text
  return `https://${text}`
}

function parseSlashInput(value: string): { label: string; args: string } | null {
  const match = value.trim().match(/^((?:\/|@)[\w\u4e00-\u9fff][\w\u4e00-\u9fff_-]*(?::[\w\u4e00-\u9fff][\w\u4e00-\u9fff_-]*)?)(?:\s+([\s\S]*))?$/i)
  if (!match) return null
  const rawLabel = match[1].toLowerCase()
  const label = rawLabel.startsWith('@') ? `/agent:${rawLabel.slice(1) === 'minimax-code' ? 'opencode' : rawLabel.slice(1)}` : rawLabel
  return { label, args: (match[2] || '').trim() }
}

function isBufferedRuntimeEvent(event: RuntimeEvent): boolean {
  return event.kind === 'agent:delta' || event.kind === 'agent:activity'
}

function shouldFlushFirstStreamDelta(event: RuntimeEvent, seenKeys: Set<string>): boolean {
  if (event.kind !== 'agent:delta' || event.payload?.channel === 'thinking') return false
  const key = [
    event.threadId,
    event.turnId,
    event.agentId || event.payload?.agentId || 'agent',
    event.payload?.channel || 'content'
  ].join(':')
  if (seenKeys.has(key)) return false
  seenKeys.add(key)
  return true
}

function parseLoopLimit(value: string, fallback = 5): number {
  const match = value.match(/(?:--?(?:n|times|limit|max)|循环|轮数)\s*[=:]?\s*(\d{1,2})/i)
  const n = Math.floor(Number(match?.[1] || fallback) || fallback)
  return Math.max(1, Math.min(20, n))
}

function stripLoopFlags(value: string): string {
  return value.replace(/(?:--?(?:n|times|limit|max)|循环|轮数)\s*[=:]?\s*\d{1,2}/gi, '').trim()
}

function browserCaptureToAttachment(capture: BrowserContextAttachment): WorkbenchAttachment {
  const title = capture.title || capture.url || tr('浏览器捕获', 'Browser capture')
  const headings = (capture.headings || []).filter(Boolean).map(item => `- ${item}`).join('\n')
  const links = (capture.links || []).slice(0, 24).map(link => `- ${link.text}: ${link.href}`).join('\n')
  const forms = (capture.forms || []).filter(Boolean).map(item => `- ${item}`).join('\n')
  const text = [
    `URL: ${capture.url}`,
    `标题: ${capture.title || '-'}`,
    headings ? `\n页面标题:\n${headings}` : '',
    links ? `\n链接摘要:\n${links}` : '',
    forms ? `\n表单:\n${forms}` : '',
    capture.text ? `\n正文:\n${capture.text.slice(0, 12000)}` : ''
  ].filter(Boolean).join('\n')
  return {
    id: `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'text',
    name: `${title.slice(0, 52)}.browser.md`,
    mime: 'text/markdown',
    text,
    createdAt: Date.now()
  }
}

function normalizeAgentSlots(slots: string[], usableAgentIds: string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of slots) {
    if (usableAgentIds.includes(id) && !seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  for (const id of usableAgentIds) {
    if (next.length >= 3) break
    if (!seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  return next.slice(0, 3)
}

function selectableModelOptions(providers: ProviderDef[]): Array<{ providerId: string; modelId: string; label: string; searchable: string }> {
  const options: Array<{ providerId: string; modelId: string; label: string; searchable: string }> = []
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey || !provider.models?.length) continue
    for (const model of provider.models) {
      const label = `${provider.name} / ${model.label || model.id}`
      options.push({
        providerId: provider.id,
        modelId: model.id,
        label,
        searchable: `${provider.id}/${model.id} ${provider.name} ${model.label || ''}`.toLowerCase()
      })
    }
  }
  return options
}

function isSelectableModel(selection: ModelSelection | null, providers: ProviderDef[]): boolean {
  if (!selection) return false
  return providers.some(provider =>
    provider.id === selection.providerId &&
    provider.enabled &&
    !!provider.apiKey &&
    provider.models?.some(model => model.id === selection.modelId)
  )
}

function resolveModelCommand(
  args: string,
  options: Array<{ providerId: string; modelId: string; label: string; searchable: string }>
): { selection?: ModelSelection; label?: string; message?: string } {
  if (options.length === 0) return { message: tr('没有可用模型。请先在设置里启用供应商并填写 Key。', 'No available models. Enable a provider and API key in Settings first.') }
  const raw = args.trim().toLowerCase()
  if (!raw) return { message: tr(`可用模型：${options.slice(0, 8).map(item => `${item.providerId}/${item.modelId}`).join('、')}`, `Available models: ${options.slice(0, 8).map(item => `${item.providerId}/${item.modelId}`).join(', ')}`) }
  const [providerPart, modelPart] = raw.includes('/') ? raw.split('/', 2) : ['', raw]
  const matched = options.find(item => {
    if (providerPart) return item.providerId.toLowerCase() === providerPart && item.modelId.toLowerCase() === modelPart
    return item.modelId.toLowerCase() === modelPart || item.searchable.includes(raw)
  })
  if (!matched) return { message: tr(`没有找到模型：${args}`, `Model not found: ${args}`) }
  return { selection: { providerId: matched.providerId, modelId: matched.modelId, source: 'provider' }, label: matched.label }
}

function reasoningFromCommand(args: string, previous: WorkbenchThinking): WorkbenchThinking | null {
  const value = normalizeReasoningChoice(args)
  return value ? { ...previous, mode: 'enabled', level: value, collapseInUI: true } : null
}

function reasoningLabel(thinking: WorkbenchThinking): string {
  return reasoningChoiceLabel(normalizeReasoningChoice(thinking.level) || 'medium')
}

function normalizeReasoningChoice(value: string): ThinkingLevelChoice | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === '低' || normalized === 'low') return 'low'
  if (normalized === '中' || normalized === 'medium' || normalized === 'mid') return 'medium'
  if (normalized === '高' || normalized === 'high') return 'high'
  if (normalized === '超高' || normalized === '极高' || normalized === 'xhigh' || normalized === 'extra' || normalized === 'max') return 'xhigh'
  return null
}

function reasoningChoiceLabel(value: ThinkingLevelChoice): string {
  if (value === 'low') return tr('低', 'low')
  if (value === 'medium') return tr('中', 'medium')
  if (value === 'high') return tr('高', 'high')
  return tr('超高', 'extra high')
}

function clampInspectorWidth(width: number, viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth): number {
  const sidebarAndMain = viewportWidth > 1160 ? 292 + 560 + 40 : 290 + 420 + 32
  const responsiveMax = Math.max(MIN_INSPECTOR_WIDTH, viewportWidth - sidebarAndMain)
  return Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, responsiveMax, Math.round(width)))
}

async function watchTerminalRun(runId: string, setRuns: React.Dispatch<React.SetStateAction<TerminalRun[]>>) {
  for (let i = 0; i < 24; i++) {
    await new Promise(resolve => setTimeout(resolve, i < 8 ? 500 : 1200))
    const history = await window.electronAPI.terminal.history().catch(() => [])
    const current = history.find(run => run.id === runId)
    setRuns(history)
    if (current && current.status !== 'running') break
  }
}

function modeLabel(mode: DispatchPreset): string {
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

function agentShortName(agentId: string): string {
  return localAgentLabel(agentId)
}
