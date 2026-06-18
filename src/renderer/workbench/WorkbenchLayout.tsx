import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { BindingDef, ProviderDef, TaskItem } from '../glass/meta'
import { ApprovalDialog, ApprovalItem } from '../glass/approval-dialog'
import { SettingsScreen, MotionLevel } from '../screens/Settings'
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
import { localAgentLabel, localAgentOptions } from './localAgentOptions'

type ViewMode = 'chat' | 'write' | 'tasks' | 'settings'
type RightPanel = 'runs' | 'git' | 'worktrees' | 'browser' | 'memory' | 'updates' | null
type ThinkingLevelChoice = 'low' | 'medium' | 'high' | 'xhigh'
type WorkbenchThinking = { mode: 'off' | 'auto' | 'enabled'; level: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; collapseInUI?: boolean; budgetTokens?: number }

const AGENT_SLOT_STORE_KEY = 'agenthub.workbench.agentSlots.v1'
const INSPECTOR_WIDTH_STORE_KEY = 'agenthub.workbench.inspectorWidth.v1'
const ANNOUNCEMENT_STORE_KEY = 'agenthub.workbench.announcement.v0.5.4'
const DEFAULT_INSPECTOR_WIDTH = 460
const MIN_INSPECTOR_WIDTH = 340
const MAX_INSPECTOR_WIDTH = 760

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
  const [view, setView] = useState<ViewMode>('chat')
  const [settingsTab, setSettingsTab] = useState<SetupTab | 'appearance'>('providers')
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
  const [customSchedule, setCustomSchedule] = useState<SchedulePreview>(() => ({
    preset: 'custom',
    label: tr('自定义调度', 'Custom schedule'),
    description: tr('按你编辑的 Agent 节点和依赖关系执行。', 'Run with the agent nodes and dependencies you edit.'),
    steps: [
      { id: 'custom-1', label: tr('实现 / 分析', 'Implement / analyze'), agentId: 'codex', role: 'worker', mode: 'auto' },
      { id: 'custom-2', label: tr('评审 / 汇总', 'Review / synthesize'), agentId: 'claude', role: 'reviewer', mode: 'auto', dependsOn: ['custom-1'] }
    ]
  }))
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
  const snapshotRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadScrollRef = useRef<HTMLElement | null>(null)
  const shouldStickToBottom = useRef(true)

  const activeThreadId = snapshot.activeThreadId

  const loadWorkbench = useCallback(async (nextWorkspaceId?: string | null) => {
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
      setEvents(await window.electronAPI.runtime.eventsSince(snap.activeThreadId, 0))
    } else {
      setEvents([])
    }
  }, [workspaceId])

  useEffect(() => {
    loadWorkbench().catch(() => {})
  }, [])

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
    return window.electronAPI.runtime.onEvent(event => {
      if (event.threadId === activeThreadId) {
        setEvents(prev => {
          if (prev.some(e => e.id === event.id || e.seq === event.seq)) return prev
          const last = prev[prev.length - 1]
          return !last || event.seq > last.seq ? [...prev, event] : [...prev, event].sort((a, b) => a.seq - b.seq)
        })
      }
      const immediate = event.kind === 'turn:created' || event.kind === 'turn:status' || event.kind === 'agent:done' || event.kind === 'agent:error' || event.kind === 'run:created' || event.kind === 'run:status'
      if (snapshotRefreshTimer.current) clearTimeout(snapshotRefreshTimer.current)
      snapshotRefreshTimer.current = setTimeout(() => {
        window.electronAPI.runtime.snapshot(workspaceId).then(setSnapshot).catch(() => {})
        window.electronAPI.runtime.snapshot(undefined).then(snap => setAllThreads(snap.threads)).catch(() => {})
        snapshotRefreshTimer.current = null
      }, immediate ? 0 : 400)
    })
  }, [activeThreadId, workspaceId])

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
      const bound = selectionForAgentBinding(targetAgent, props.bindings, props.providers)
      if (bound) setModelSelection(bound)
      else if (modelSelection) setModelSelection(null)
      return
    }
    if (modelSelection && isSelectableModel(modelSelection, props.providers, targetAgent)) return
    setModelSelection(selectableModels[0] ? { providerId: selectableModels[0].providerId, modelId: selectableModels[0].modelId, source: 'provider' } : null)
  }, [targetAgent, props.bindings, props.providers, selectableModelSignature])

  const openSetup = (tab: SetupTab | 'appearance' = 'providers') => {
    setSettingsTab(tab)
    setView('settings')
  }

  const closeAnnouncement = () => {
    try { localStorage.setItem(ANNOUNCEMENT_STORE_KEY, 'seen') } catch { /* noop */ }
    setAnnouncementOpen(false)
  }

  const openAnnouncementSetup = (tab: SetupTab | 'appearance') => {
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
    setSnapshot(snap)
    setAllThreads(allSnap.threads)
    setEvents(selected ? await window.electronAPI.runtime.eventsSince(selected, 0) : [])
    shouldStickToBottom.current = true
    setView('chat')
  }

  useEffect(() => {
    if (!shouldStickToBottom.current) return
    const el = threadScrollRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
  }, [activeThreadId, activeTurns.length, events.length])

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
        const panel = params.panel as RightPanel
        if (panel === 'runs' || panel === 'git' || panel === 'worktrees' || panel === 'browser' || panel === 'memory' || panel === 'updates') setRightPanel(panel)
      } else if (action === 'setup') {
        openSetup(params.tab as SetupTab | 'appearance')
      }
    })
  }, [createThread, openCreateProject])

  const pickProjectFolder = async () => {
    const picked = await window.electronAPI.app.pickFolder()
    if (!picked) return
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

  const sendPrompt = async (prompt: string, attachments: WorkbenchAttachment[] = [], overrides: { targetAgent?: string | null; mode?: DispatchPreset } = {}) => {
    if (!prompt.trim() || sending) return
    const requestedTargetAgent = overrides.targetAgent !== undefined ? overrides.targetAgent : targetAgent
    const selectedProviderDirect = !requestedTargetAgent && modelSelection?.source === 'provider'
    const nextTargetAgent = selectedProviderDirect ? null : requestedTargetAgent
    const nextMode = selectedProviderDirect ? 'auto' : (overrides.mode || mode)
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
        modelSelection: modelSelection || undefined,
        attachments,
        customSchedule: selectedProviderDirect ? undefined : (nextMode === 'custom' && !nextTargetAgent ? customSchedule : undefined)
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
        `[ECC 指令: ${command.label}]`,
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
      const panel = command.payload?.panel as RightPanel
      if (panel) setRightPanel(panel)
      if (panel === 'browser' && args) setPendingBrowserUrl(args)
      return true
    }
    if (command.action === 'use-schedule' && command.payload?.preset) {
      setTargetAgent(null)
      setMode(command.payload.preset as DispatchPreset)
      return true
    }
    if (command.action === 'use-agent' && command.payload?.agentId) {
      const agentId = String(command.payload.agentId)
      if (!usableAgentIds.includes(agentId)) {
        setSendError(tr('这个本地 Agent 当前不可用，请先在设置里配置。', 'This local agent is not available. Configure it in Settings first.'))
        return true
      }
      setTargetAgent(agentId)
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
  }, [workspaceId, createThread, sendPrompt, openSetup, usableAgentIds.join('|'), selectableModels, thinking])

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
              setTargetAgent={setTargetAgent}
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
            <>
              <div className="wb-chat-head">
                <WorkbenchChatTopBar
                  title={title}
                  workspaceName={workspaceName}
                  workspaceTitle={activeWorkspace?.rootPath || tr('添加工作目录', 'Add working folder')}
                  openWorkspace={workspaceId ? () => selectWorkspace(workspaceId) : openCreateProject}
                  activePanel={rightPanel}
                  setPanel={setRightPanel}
                  workspaceId={workspaceId}
                  readyLocalAgents={readyLocalAgents}
                />
              </div>

              <ThreadView
                thread={activeThread}
                turns={activeTurns}
                events={events}
                onRetry={retryTurn}
                onCancelAgent={cancelAgent}
                openSetup={openSetup}
                onCreateProject={openCreateProject}
                onCreateThread={createThread}
                hasWorkspace={!!workspaceId}
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
                setTargetAgent={setTargetAgent}
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
                goChat={(agentId) => { setTargetAgent(agentId); setView('chat') }}
                openSetup={openSetup}
              />
            </div>
          )}
        </main>

        {rightPanel && rightPanel !== 'git' && (
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
        )}

        {rightPanel === 'git' && (
          <WorkbenchBottomDock
            workspaceId={workspaceId}
            activePanel={rightPanel}
            setPanel={setRightPanel}
            onClose={() => setRightPanel(null)}
          >
            <GitWorkbenchPanel workspaceId={workspaceId} onClose={() => setRightPanel(null)} />
          </WorkbenchBottomDock>
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
                '本版本把 AgentHub 工作台、Agent 切换、API 厂商直连、Git、Skills、MCP 和统计页面整合到一个桌面流程中。为了避免任务发错 Agent，请按下面顺序完成首次配置。',
                'This release combines the workbench, agent switching, provider direct runs, Git, Skills, MCP, and usage stats into one desktop workflow. Complete the setup below before sending tasks.'
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
                <p>{tr('需要读取项目、查看 Git 或执行终端命令时，请先添加工作目录。Git、MCP、运行记录、使用统计和外观设置都在工作台工具区或设置页中。', 'Add a working folder before reading project files, using Git, or running terminal commands. Git, MCP, run history, usage stats, and appearance settings live in the tool area or Settings.')}</p>
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
  setRightPanel
}: {
  hubRunning: boolean
  search: string
  setSearch: (v: string) => void
  view: ViewMode
  setView: (view: ViewMode) => void
  createThread: () => Promise<void>
  openCreateProject: () => void
  openSetup: (tab?: SetupTab | 'appearance') => void
  setRightPanel: (panel: RightPanel) => void
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
          { label: tr('新建对话', 'New chat'), shortcut: 'Ctrl+N', action: run(createThread) },
          { label: tr('添加工作目录', 'Add working folder'), action: run(openCreateProject) },
          { label: tr('打开 Git 面板', 'Open Git panel'), action: run(() => setRightPanel('git')) },
          { label: tr('打开浏览器', 'Open browser'), action: run(() => setRightPanel('browser')) }
        ]}
      />
      <TitlebarMenu
        id="view"
        label={tr('视图', 'View')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('对话', 'Chat'), checked: view === 'chat', action: run(() => setView('chat')) },
          { label: tr('写作', 'Write'), checked: view === 'write', action: run(() => setView('write')) },
          { label: tr('任务历史', 'Tasks'), checked: view === 'tasks', action: run(() => setView('tasks')) },
          { label: tr('设置', 'Settings'), checked: view === 'settings', action: run(() => setView('settings')) },
          { label: tr('运行面板', 'Runs panel'), action: run(() => setRightPanel('runs')) },
          { label: tr('工作树面板', 'Worktrees panel'), action: run(() => setRightPanel('worktrees')) },
          { label: tr('长期记忆', 'Memory'), action: run(() => setRightPanel('memory')) }
        ]}
      />
      <TitlebarMenu
        id="help"
        label={tr('帮助', 'Help')}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        items={[
          { label: tr('版本与更新', 'Version and updates'), action: run(() => openSetup('updates')) },
          { label: tr('MCP 配置', 'MCP settings'), action: run(() => openSetup('mcp')) },
          { label: tr('使用统计', 'Usage stats'), action: run(() => openSetup('usage')) },
          { label: tr('打开项目主页', 'Open homepage'), action: run(() => window.electronAPI.app.openExternal('https://agenthub.dev')) },
          { label: tr('打开下载页', 'Open download page'), action: run(() => window.electronAPI.updates.openDownload()) }
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
  activePanel,
  setPanel,
  workspaceId,
  readyLocalAgents
}: {
  title: string
  workspaceName: string
  workspaceTitle: string
  openWorkspace: () => void
  activePanel: RightPanel
  setPanel: (panel: RightPanel) => void
  workspaceId: string | null
  readyLocalAgents: number
}) {
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
        <ToolPanelBar activePanel={activePanel} setPanel={setPanel} workspaceId={workspaceId} iconOnly />
        <button
          className={'wb-minimal-tool-button' + (activePanel === 'runs' ? ' active' : '')}
          onClick={() => setPanel(activePanel === 'runs' ? null : 'runs')}
          title={tr('运行', 'Runs')}
        >
          <Icon d={IC.tasks} size={15} />
          {readyLocalAgents > 0 && <small>{readyLocalAgents}</small>}
        </button>
      </div>
    </>
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
    { id: 'git', label: 'Git', icon: IC.file, disabled: !workspaceId },
    { id: 'worktrees', label: tr('工作树', 'Worktrees'), icon: IC.folder, disabled: !workspaceId },
    { id: 'browser', label: tr('浏览器', 'Browser'), icon: IC.search, disabled: false },
    { id: 'memory', label: tr('记忆', 'Memory'), icon: IC.brain, disabled: false },
    { id: 'updates', label: tr('更新', 'Updates'), icon: IC.refresh, disabled: false }
  ]
}

function ToolPanelBar({ activePanel, setPanel, workspaceId, iconOnly = false }: { activePanel: RightPanel; setPanel: (panel: RightPanel) => void; workspaceId: string | null; iconOnly?: boolean }) {
  const items: Array<{ id: Exclude<RightPanel, null | 'runs'>; label: string; icon: React.ReactNode; requiresWorkspace?: boolean }> = [
    { id: 'git', label: 'Git', icon: IC.file, requiresWorkspace: true },
    { id: 'worktrees', label: tr('工作树', 'Worktrees'), icon: IC.folder, requiresWorkspace: true },
    { id: 'browser', label: tr('浏览器', 'Browser'), icon: IC.search },
    { id: 'memory', label: tr('记忆', 'Memory'), icon: IC.brain },
    { id: 'updates', label: tr('更新', 'Updates'), icon: IC.refresh }
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
          <Icon d={IC.file} size={13} />
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
        <Icon d={IC.file} size={13} />
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
  if (panel === 'memory') return <MemoryPanel onClose={onClose} />
  return <UpdatesPanel onClose={onClose} />
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

function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = query.trim()
        ? await window.electronAPI.memory.search(query.trim())
        : await window.electronAPI.memory.list()
      setEntries(next)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    refresh().catch(() => {})
  }, [])

  return (
    <div className="wb-tool-panel">
      <PanelTitle title={tr('长期记忆', 'Long-term memory')} subtitle={`${entries.length} ${tr('条', 'entries')}`} onClose={onClose} onRefresh={refresh} loading={loading} />
      <div className="wb-tool-inline-form">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') refresh().catch(() => {}) }} placeholder={tr('搜索记忆', 'Search memory')} />
        <button onClick={refresh}>{tr('搜索', 'Search')}</button>
      </div>
      {entries.length === 0 && <div className="wb-muted-box">{tr('暂无记忆。', 'No memory entries yet.')}</div>}
      {entries.slice(0, 20).map(entry => (
        <div key={entry.id} className="wb-tool-row">
          <strong>{entry.title || entry.category || entry.id}</strong>
          <small>{String(entry.content || entry.text || '').slice(0, 140)}</small>
        </div>
      ))}
    </div>
  )
}

function UpdatesPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await window.electronAPI.updates.status())
    } finally {
      setLoading(false)
    }
  }, [])

  const check = async () => {
    setLoading(true)
    try {
      setStatus(await window.electronAPI.updates.check(status?.channel || 'stable'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  return (
    <div className="wb-tool-panel">
      <PanelTitle title={tr('版本与更新', 'Version and updates')} subtitle={status?.version || 'AgentHub'} onClose={onClose} onRefresh={refresh} loading={loading} />
      <div className="wb-tool-summary-grid">
        <div><strong>{status?.version || '-'}</strong><span>{tr('当前版本', 'current')}</span></div>
        <div><strong>{status?.latestVersion || '-'}</strong><span>{tr('最新版本', 'latest')}</span></div>
        <div><strong>{status?.channel || 'stable'}</strong><span>{tr('渠道', 'channel')}</span></div>
      </div>
      {status?.error && <div className="wb-send-error">{status.error}</div>}
      <div className="wb-tool-actions">
        <button onClick={check} disabled={loading}>{tr('检查更新', 'Check updates')}</button>
        <button onClick={() => window.electronAPI.updates.openDownload()}>{tr('打开下载页', 'Open download')}</button>
      </div>
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

function isSelectableModel(selection: ModelSelection | null, providers: ProviderDef[], targetAgent?: string | null): boolean {
  if (!selection) return false
  return providers.some(provider =>
    provider.id === selection.providerId &&
    provider.enabled &&
    !!provider.apiKey &&
    provider.models?.some(model => model.id === selection.modelId)
  )
}

function selectionForAgentBinding(agentId: string, bindings: BindingDef[], providers: ProviderDef[]): ModelSelection | null {
  const binding = bindings.find(item => item.agentId === agentId)
  if (!binding || binding.protocol === 'stdio-plain' || binding.protocol === 'acp') return null
  const selection: ModelSelection = { providerId: binding.providerId, modelId: binding.modelId, source: 'provider' }
  return isSelectableModel(selection, providers) ? selection : null
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
    custom: tr('自定义调度', 'Custom schedule')
  })[mode]
}

function agentShortName(agentId: string): string {
  return localAgentLabel(agentId)
}
