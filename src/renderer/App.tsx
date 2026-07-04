/* ============================================================
   AgentHub — 玻璃拟态壳层（design_handoff_glass_ui 实现）
   背景光斑 + 标题栏 + 侧边栏 + 四页（总览/会话/任务/设置）
   真实 IPC：hub:status / hub:dispatch / dispatch:stream /
             providers:* / routing:setBinding / proxy:info
   ============================================================ */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef, TaskItem, ChatMessage,
  DispatchMode
} from './glass/meta'
import { MotionLevel } from './screens/Settings'
import { useLang } from './glass/i18n'
import { applyOrchestrateEvent } from './glass/orchestrate-reducer'
import { upsertStep } from './glass/chat-transcript'
import { ApprovalItem } from './glass/approval-dialog'
import { WorkbenchLayout } from './workbench/WorkbenchLayout'
import { applyAppearance, loadAppearance, readAppearanceLocal, subscribeSystemTheme } from './appearance'
import { styledConfirm } from './lib/confirm'
import { hasRunningTask, nextMemorySaveDelayMs } from './memory-save-policy'
import { isEmptyProviderConfig, nextEmptyProviderConfigRetryDelayMs } from './provider-config-load-policy'

type AgentMap = Record<string, { status: AgentUIStatus }>

// P1-3: Wrapper that guards electronAPI availability before mounting AppInner,
// so all hooks in AppInner are unconditional (Rules of Hooks compliant).
export default function App() {
  if (!window.electronAPI) {
    return (
      <div className="ah-electron-required">
        <div>
          <h1>AgentHub 需要在桌面端中运行</h1>
          <p>请通过 Electron 应用打开工作台。当前浏览器预览缺少本地 IPC 能力，因此终端、Git、本地 Agent 和设置无法使用。</p>
        </div>
      </div>
    )
  }
  return <AppInner />
}

function AppInner() {
  const [hubRunning, setHubRunning] = useState(false)
  const [proxyHost, setProxyHost] = useState('127.0.0.1:9528')
  const [hubAgents, setHubAgents] = useState<Record<string, string>>({})   // 注册表原始状态
  const [busyOverride, setBusyOverride] = useState<Record<string, AgentUIStatus | undefined>>({}) // 流式期间的即时状态
  const [providers, setProviders] = useState<ProviderDef[]>([])
  const [configLoadError, setConfigLoadError] = useState<string | null>(null)
  const [bindings, setBindings] = useState<BindingDef[]>([])
  const [fallbackChain, setFallbackChain] = useState<string[]>([])
  const [localAgents, setLocalAgents] = useState<LocalAgentStatus[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [runtimeRefreshNonce, setRuntimeRefreshNonce] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [approvals, setApprovals] = useState<ApprovalItem[]>([])  // 写/执行待审批队列（'ask' 策略）
  const [appearance, setAppearance] = useState(readAppearanceLocal)
  const [motion, setMotion] = useState<MotionLevel>(() => {
    try { return readAppearanceLocal().motion || (localStorage.getItem('ah-motion') as MotionLevel) || 'rich' } catch { return 'rich' }
  })

  /* 流式派发簿记 */
  const taskToMsg = useRef<Map<string, string>>(new Map())
  const pendingMsgId = useRef<string | null>(null)
  const ignoredTasks = useRef<Set<string>>(new Set())
  const ignoredMsgs = useRef<Set<string>>(new Set())
  const activeTaskIds = useRef<Set<string>>(new Set())
  const localTaskId = useRef<Map<string, string>>(new Map()) // 后端 taskId → 本地任务行 id
  const memoryReady = useRef(false)
  const lastRunningMemorySaveAt = useRef(0)
  const orchestrateTasks = useRef<Set<string>>(new Set())  // 编排模式任务 id（其内部 agent 事件不渲染气泡）
  const configRequestId = useRef(0)
  const configEmptyRetryCount = useRef(0)
  const configRetryTimer = useRef<number | null>(null)
  const providersRef = useRef<ProviderDef[]>([])
  const bindingsRef = useRef<BindingDef[]>([])
  const fallbackChainRef = useRef<string[]>([])

  useEffect(() => { providersRef.current = providers }, [providers])
  useEffect(() => { bindingsRef.current = bindings }, [bindings])
  useEffect(() => { fallbackChainRef.current = fallbackChain }, [fallbackChain])

  const applyProviderConfig = useCallback((cfg: any) => {
    if (!cfg) return
    const nextProviders = Array.isArray(cfg.providers) ? cfg.providers : []
    setProviders(current => nextProviders.length > 0 ? nextProviders : current)
    setBindings(cfg.routing?.bindings ?? [])
    setFallbackChain(cfg.routing?.fallbackChain ?? [])
  }, [])

  /* 外观偏好 → html[data-theme] / html[data-motion] / CSS vars */
  useEffect(() => {
    let alive = true
    loadAppearance()
      .then(next => {
        if (!alive) return
        setAppearance(next)
        setMotion(next.motion)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent).detail
      if (!next) return
      setAppearance(next)
      setMotion(next.motion)
    }
    window.addEventListener('agenthub:appearance-change', handler)
    return () => window.removeEventListener('agenthub:appearance-change', handler)
  }, [])

  useEffect(() => {
    const next = { ...appearance, motion }
    applyAppearance(next)
    try { localStorage.setItem('ah-motion', motion) } catch { /* noop */ }
    return subscribeSystemTheme(next, () => applyAppearance(next))
  }, [appearance, motion])

  useEffect(() => {
    let alive = true
    const memoryApi = window.electronAPI?.memory
    if (!memoryApi?.loadState) {
      memoryReady.current = true
      return () => { alive = false }
    }
    memoryApi.loadState()
      .then(state => {
        if (!alive) return
        if (Array.isArray(state?.messages) && state.messages.length > 0) setMessages(state.messages as ChatMessage[])
        if (Array.isArray(state?.tasks) && state.tasks.length > 0) setTasks(state.tasks as TaskItem[])
      })
      .catch(() => {})
      .finally(() => { if (alive) memoryReady.current = true })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!memoryReady.current) return
    const memoryApi = window.electronAPI?.memory
    if (!memoryApi?.saveState) return
    const running = hasRunningTask(tasks)
    const delay = nextMemorySaveDelayMs(running, Date.now(), lastRunningMemorySaveAt.current)
    const saveState = () => {
      if (running) lastRunningMemorySaveAt.current = Date.now()
      memoryApi.saveState({ messages, tasks }).catch(() => {})
    }
    if (running && delay === 0) {
      saveState()
      return
    }
    const timer = setTimeout(saveState, delay)
    return () => clearTimeout(timer)
  }, [messages, tasks])

  /* ---------- 数据加载 ---------- */
  const clearConfigRetryTimer = useCallback(() => {
    if (!configRetryTimer.current) return
    clearTimeout(configRetryTimer.current)
    configRetryTimer.current = null
  }, [])

  const loadConfig = useCallback(async () => {
    const requestId = ++configRequestId.current
    clearConfigRetryTimer()
    const retryLoadConfig = () => {
      const retryDelay = nextEmptyProviderConfigRetryDelayMs(configEmptyRetryCount.current)
      if (retryDelay === null) {
        setConfigLoadError('主进程配置暂未就绪，请检查应用日志或点击重试。')
        return
      }
      setConfigLoadError(null)
      configEmptyRetryCount.current += 1
      configRetryTimer.current = window.setTimeout(() => {
        configRetryTimer.current = null
        if (requestId === configRequestId.current) loadConfig().catch(() => {})
      }, retryDelay)
    }
    try {
      const cfg = await window.electronAPI.providers.get().catch(error => {
        retryLoadConfig()
        throw error
      })
      if (requestId !== configRequestId.current) return
      applyProviderConfig(cfg)
      if (!isEmptyProviderConfig(cfg?.providers)) {
        configEmptyRetryCount.current = 0
        setConfigLoadError(null)
        return
      }
      const retryDelay = nextEmptyProviderConfigRetryDelayMs(configEmptyRetryCount.current)
      if (retryDelay !== null) {
        setConfigLoadError(null)
        configEmptyRetryCount.current += 1
        configRetryTimer.current = window.setTimeout(() => {
          configRetryTimer.current = null
          if (requestId === configRequestId.current) loadConfig().catch(() => {})
        }, retryDelay)
      } else {
        setConfigLoadError('主进程配置暂未就绪，请检查应用日志或点击重试。')
      }
    } catch { /* main 进程未就绪 */ }
  }, [applyProviderConfig, clearConfigRetryTimer])

  const reloadConfig = useCallback(() => {
    configEmptyRetryCount.current = 0
    setConfigLoadError(null)
    loadConfig()
  }, [loadConfig])

  useEffect(() => clearConfigRetryTimer, [clearConfigRetryTimer])

  const refreshStatus = useCallback(async () => {
    try {
      const st = await window.electronAPI.hub.getStatus()
      setHubRunning(!!st?.running)
      const m: Record<string, string> = {}
      for (const a of st?.agents ?? []) m[a.id] = a.status
      setHubAgents(m)
      if (st?.tasks) {
        setTasks(prev => {
          const known = new Set(prev.map(t => t.id))
          const fromHub: TaskItem[] = (st.tasks as any[])
            .filter(t => !known.has(t.id) && ![...localTaskId.current.values()].includes(t.id) && !taskToMsg.current.has(t.id))
            .map(t => ({
              id: t.id, text: t.text, mode: (t.mode || 'auto') as DispatchMode,
              status: t.status === 'pending' ? 'running' : t.status,
              agents: [], durationMs: null,
              createdAt: t.createdAt ? new Date(t.createdAt).toTimeString().slice(0, 5) : ''
            }))
          return fromHub.length ? [...prev, ...fromHub] : prev
        })
      }
    } catch { /* noop */ }
    try {
      setLocalAgents(await window.electronAPI.localAgents.status())
    } catch { /* noop */ }
  }, [])

  useEffect(() => {
    loadConfig()
    refreshStatus()
    window.electronAPI?.proxy?.info().then(info => {
      try {
        const u = new URL(info.url)
        setProxyHost(u.host)
      } catch { /* noop */ }
    }).catch(() => {})
    const poll = setInterval(refreshStatus, 8000)
    return () => clearInterval(poll)
  }, [loadConfig, refreshStatus])

  useEffect(() => {
    const off = window.electronAPI.providers.onWarning?.((warning) => {
      window.electronAPI.notifications?.push?.({
        title: 'Provider key storage warning',
        body: `Provider ${warning.providerId} could not encrypt its API key for this save. The setting was kept, but secure storage is unavailable on this system.`,
        category: 'error',
        action: { type: 'navigate', target: 'settings' }
      }).catch(() => {})
    })
    return off
  }, [])

  /* 深链 */
  useEffect(() => {
    const off = window.electronAPI?.app?.onDeepLink?.((link) => {
      if (link.action || link.params?.agent) refreshStatus()
    })
    return off
  }, [refreshStatus])

  /* ---------- 流式事件 ---------- */
  // P2-13: Guard against hub.onStream not being ready at mount time;
  // without this, `off` is undefined and stream events are silently lost.
  useEffect(() => {
    const hubApi = window.electronAPI?.hub
    if (!hubApi?.onStream) {
      console.warn('[App] hub.onStream not available — stream events will not be received')
      return
    }
    const off = hubApi.onStream((e: any) => {
      const tid: string = e.taskId
      if (!tid || ignoredTasks.current.has(tid)) return

      // 写/执行审批请求：交给全局覆盖层弹窗，不依赖消息簿记（不入 msgId 流程）
      if (e.kind === 'approval' && e.request) {
        const req = e.request
        setApprovals(qs => qs.some(q => q.id === req.id) ? qs
          : [...qs, { id: req.id, taskId: tid, agentId: e.agentId, tool: req.tool, toolName: req.toolName, label: req.label, detail: req.detail }])
        return
      }

      if (e.__runtimeTurnId || e.turnId) return

      let msgId = taskToMsg.current.get(tid)
      if (!msgId && pendingMsgId.current) {
        msgId = pendingMsgId.current
        taskToMsg.current.set(tid, msgId)
        activeTaskIds.current.add(tid)
      }
      if (!msgId || ignoredMsgs.current.has(msgId)) return
      const localId = localTaskId.current.get(tid) ?? tid

      // 编排模式：orchestrate:* 事件经 reducer 聚合到该消息的 orchestration；标记该任务
      if (typeof e.kind === 'string' && e.kind.startsWith('orchestrate:')) {
        orchestrateTasks.current.add(tid)
        setMessages(ms => ms.map(m => m.id === msgId
          ? { ...m, orchestration: applyOrchestrateEvent(m.orchestration, e) } : m))
        if (e.kind === 'orchestrate:final' || e.kind === 'orchestrate:error') {
          setBusyOverride(o => ({ ...o }))
          setTasks(ts => ts.map(t => t.id === localId
            ? { ...t, results: { ...(t.results || {}), orchestrate: e.content || t.results?.orchestrate || '' } } : t))
        }
        return
      }
      // 编排任务的内部 agent 事件（lead 分解/子任务/汇总）不渲染为普通气泡
      if (orchestrateTasks.current.has(tid)) return

      if (e.kind === 'start') {
        setBusyOverride(o => ({ ...o, [e.agentId]: 'busy' }))
        setMessages(ms => ms.map(m => {
          if (m.id !== msgId) return m
          if (m.replies.some(r => r.agentId === e.agentId)) return m
          return { ...m, replies: [...m.replies, { agentId: e.agentId, thinking: '', text: '', done: false }] }
        }))
        setTasks(ts => ts.map(t => t.id === localId && !t.agents.includes(e.agentId)
          ? { ...t, agents: [...t.agents, e.agentId] } : t))
      } else if (e.kind === 'delta') {
        setMessages(ms => ms.map(m => m.id === msgId
          ? {
              ...m,
              replies: m.replies.map(r => r.agentId === e.agentId
                ? (e.channel === 'thinking'
                    ? { ...r, thinking: r.thinking + e.text }
                    : { ...r, text: r.text + e.text })
                : r)
            }
          : m))
      } else if (e.kind === 'activity' && e.step) {
        // Track A/B：结构化活动步骤（工具调用/思考），按 step.id upsert 进对应 reply 的 steps[]
        setMessages(ms => ms.map(m => {
          if (m.id !== msgId) return m
          const exists = m.replies.some(r => r.agentId === e.agentId)
          const replies = exists
            ? m.replies.map(r => r.agentId === e.agentId ? { ...r, steps: upsertStep(r.steps, e.step) } : r)
            : [...m.replies, { agentId: e.agentId, thinking: '', text: '', done: false, steps: upsertStep(undefined, e.step) }]
          return { ...m, replies }
        }))
        // 同时落进任务历史，重启后仍可复查 agent 做了什么
        setTasks(ts => ts.map(t => t.id === localId
          ? { ...t, steps: { ...(t.steps || {}), [e.agentId]: upsertStep(t.steps?.[e.agentId], e.step) } }
          : t))
      } else if (e.kind === 'done') {
        setBusyOverride(o => ({ ...o, [e.agentId]: undefined }))
        setMessages(ms => ms.map(m => m.id === msgId
          ? { ...m, replies: m.replies.map(r => r.agentId === e.agentId ? { ...r, done: true } : r) }
          : m))
        setTasks(ts => ts.map(t => t.id === localId
          ? {
              ...t,
              results: { ...(t.results || {}), [e.agentId]: e.content },
              usage: e.usage ? { ...(t.usage || {}), [e.agentId]: { ...e.usage, modelId: e.modelId } } : t.usage
            }
          : t))
      } else if (e.kind === 'error') {
        setBusyOverride(o => ({ ...o, [e.agentId]: undefined }))
        setMessages(ms => ms.map(m => m.id === msgId
          ? { ...m, replies: m.replies.map(r => r.agentId === e.agentId ? { ...r, done: true, error: e.error } : r) }
          : m))
        setTasks(ts => ts.map(t => t.id === localId
          ? { ...t, errors: { ...(t.errors || {}), [e.agentId]: e.error } }
          : t))
      }
    })
    return off
  }, [])

  /* ---------- 派发 ---------- */
  const onApprovalDecide = useCallback((item: ApprovalItem, approved: boolean, remember: boolean) => {
    if (remember) window.electronAPI?.agentic?.setApprovalOverride?.(item.agentId, item.tool, approved ? 'allow' : 'deny').catch(() => {})
    window.electronAPI?.agentic?.resolveApproval?.(item.id, approved).catch(() => {})
    setApprovals(qs => qs.filter(q => q.id !== item.id))
  }, [])

  const onDeleteTask = useCallback(async (id: string) => {
    const ok = await styledConfirm({ message: '删除这条任务历史？对应的运行详情也会从当前会话记录中移除。', danger: true })
    if (!ok) return
    try { await window.electronAPI.tasks.delete(id) } catch { /* noop */ }
    setTasks(ts => ts.filter(t => t.id !== id))
    setRuntimeRefreshNonce(n => n + 1)
    refreshStatus()
  }, [refreshStatus])

  const onClearCompletedTasks = useCallback(async () => {
    const ok = await styledConfirm({ message: '清理所有已结束的任务历史？对应的运行详情也会从当前会话记录中移除。', danger: true })
    if (!ok) return
    try { await window.electronAPI.tasks.clearCompleted() } catch { /* noop */ }
    setTasks(ts => ts.filter(t => t.status === 'running'))
    setRuntimeRefreshNonce(n => n + 1)
    refreshStatus()
  }, [refreshStatus])

  /* ---------- 设置操作 ---------- */
  const onSetEnabled = useCallback(async (id: string, enabled: boolean) => {
    const prev = providersRef.current
    setProviders(ps => ps.map(p => p.id === id ? { ...p, enabled } : p))
    try { applyProviderConfig(await window.electronAPI.providers.setEnabled(id, enabled)) }
    catch { setProviders(prev) }
    loadConfig(); refreshStatus()
  }, [applyProviderConfig, loadConfig, refreshStatus])

  const onSetKey = useCallback(async (id: string, key: string) => {
    const prev = providersRef.current
    setProviders(ps => ps.map(p => p.id === id ? { ...p, apiKey: key, enabled: p.enabled || !!key } : p))
    try { applyProviderConfig(await window.electronAPI.providers.setKey(id, key)) }
    catch { setProviders(prev) }
    loadConfig(); refreshStatus()
  }, [applyProviderConfig, loadConfig, refreshStatus])

  const onSetBinding = useCallback(async (b: BindingDef) => {
    const prev = bindingsRef.current
    setBindings(bs => bs.some(x => x.agentId === b.agentId) ? bs.map(x => x.agentId === b.agentId ? b : x) : [...bs, b])
    try { setBindings(await window.electronAPI.routing.setBinding(b)) }
    catch { setBindings(prev) }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetFallback = useCallback(async (chain: string[]) => {
    const prev = fallbackChainRef.current
    setFallbackChain(chain)
    try { await window.electronAPI.routing.setFallback(chain) }
    catch { setFallbackChain(prev) }
    loadConfig()
  }, [loadConfig])

  const onUpsertProvider = useCallback(async (p: any) => {
    try { await window.electronAPI.providers.upsert(p) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onDeleteProvider = useCallback(async (id: string) => {
    try { await window.electronAPI.providers.delete(id) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onReorderProvidersForClaude = useCallback(async (orderedIds: string[]) => {
    const byId = new Map(providers.map(provider => [provider.id, provider]))
    setProviders(orderedIds.map(id => byId.get(id)).filter(Boolean) as ProviderDef[])
    try { applyProviderConfig(await window.electronAPI.providers.reorderForClaude(orderedIds)) }
    catch { loadConfig() }
  }, [applyProviderConfig, loadConfig, providers])

  /* ---------- Agent 展示状态 ----------
     off：HTTP 绑定的提供商未启用或无 Key（如 hermes/gemini）；stdio 绑定不受影响 */
  // P1-6: useMemo prevents WorkbenchLayout (112KB subtree) from re-rendering
  // on every parent render when agents identity hasn't actually changed.
  const agents: AgentMap = useMemo(() => {
    const map: AgentMap = {}
    for (const id of AGENT_IDS) {
      const b = bindings.find(x => x.agentId === id)
      const prov = providers.find(p => p.id === b?.providerId)
      const isStdio = b?.protocol === 'stdio-plain' || b?.protocol === 'acp'
      const local = localAgents.find(agent => agent.agentId === id)
      const providerUsable = !!prov && prov.enabled && !!prov.apiKey
      let st: AgentUIStatus
      if (isStdio && !local?.configured) st = 'off'
      else if (!isStdio && b && !providerUsable) st = 'off'
      else {
        const hub = hubAgents[id]
        st = hub === 'busy' ? 'busy' : hub === 'error' ? 'error' : hub === 'offline' ? 'off' : 'idle'
      }
      const ov = busyOverride[id]
      if (ov && st !== 'off') st = ov
      map[id] = { status: st }
    }
    return map
  }, [bindings, providers, localAgents, hubAgents, busyOverride])


  const lang = useLang() // 语言切换时整树重挂载（key），组件内 tr() 直接生效

  return (
    <WorkbenchLayout
      key={lang}
      hubRunning={hubRunning}
      proxyHost={proxyHost}
      agents={agents}
      providers={providers}
      bindings={bindings}
      fallbackChain={fallbackChain}
      approvals={approvals}
      runtimeRefreshNonce={runtimeRefreshNonce}
      onApprovalDecide={onApprovalDecide}
      onDeleteTask={onDeleteTask}
      onClearCompletedTasks={onClearCompletedTasks}
      providerActions={{
        onSetEnabled,
        onSetKey,
        onSetBinding,
        onSetFallback,
        onReload: reloadConfig,
        onUpsertProvider,
        onDeleteProvider,
        onReorderProvidersForClaude
      }}
      configLoadError={configLoadError}
      motion={motion}
      setMotion={setMotion}
    />
  )
}
