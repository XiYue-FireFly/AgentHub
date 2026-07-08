/* ============================================================
   AgentHub — 玻璃拟态壳层（design_handoff_glass_ui 实现）
   背景光斑 + 标题栏 + 侧边栏 + 四页（总览/会话/任务/设置）
   真实 IPC：hub:status /
             providers:* / routing:setBinding / proxy:info
   ============================================================ */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef } from './glass/meta'
import type { MotionLevel } from './screens/Settings'
import { useLang } from './glass/i18n'
import { WorkbenchLayout } from './workbench/WorkbenchLayout'
import { applyAppearance, loadAppearance, readAppearanceLocal, subscribeSystemTheme } from './appearance'
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
  const [runtimeBusyRuns, setRuntimeBusyRuns] = useState<Record<string, Record<string, true>>>({})
  const [providers, setProviders] = useState<ProviderDef[]>([])
  const [configLoadError, setConfigLoadError] = useState<string | null>(null)
  const [bindings, setBindings] = useState<BindingDef[]>([])
  const [fallbackChain, setFallbackChain] = useState<string[]>([])
  const [localAgents, setLocalAgents] = useState<LocalAgentStatus[]>([])
  const [appearance, setAppearance] = useState(readAppearanceLocal)
  const [motion, setMotion] = useState<MotionLevel>(() => {
    try { return readAppearanceLocal().motion || (localStorage.getItem('ah-motion') as MotionLevel) || 'rich' } catch { return 'rich' }
  })

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
    setProviders(nextProviders)  // Always update, even if empty array
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

  /* ---------- 数据加载 ---------- */
  const clearConfigRetryTimer = useCallback(() => {
    if (!configRetryTimer.current) return
    clearTimeout(configRetryTimer.current)
    configRetryTimer.current = null
  }, [])

  const loadConfig = useCallback(async () => {
    const requestId = ++configRequestId.current
    clearConfigRetryTimer()
    const scheduleRetry = () => {
      const retryDelay = nextEmptyProviderConfigRetryDelayMs(configEmptyRetryCount.current)
      if (retryDelay === null) {
        setConfigLoadError('主进程配置暂未就绪，请检查应用日志或点击重试。')
        return
      }
      setConfigLoadError(null)
      configRetryTimer.current = window.setTimeout(() => {
        configRetryTimer.current = null
        if (requestId === configRequestId.current) loadConfig().catch(() => {})
      }, retryDelay)
    }
    try {
      const cfg = await window.electronAPI.providers.get().catch(error => {
        scheduleRetry()
        throw error
      })
      if (requestId !== configRequestId.current) return
      applyProviderConfig(cfg)
      if (!isEmptyProviderConfig(cfg?.providers)) {
        configEmptyRetryCount.current = 0
        setConfigLoadError(null)
        return
      }
      // Increment counter only once when config is empty
      configEmptyRetryCount.current += 1
      scheduleRetry()
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
    const off = window.electronAPI.providers.onConfigChanged?.((cfg) => {
      clearConfigRetryTimer()
      applyProviderConfig(cfg)
      if (!isEmptyProviderConfig(cfg?.providers)) {
        configEmptyRetryCount.current = 0
        setConfigLoadError(null)
      }
    })
    return off
  }, [applyProviderConfig, clearConfigRetryTimer])

  useEffect(() => {
    const off = window.electronAPI?.app?.onDeepLink?.((link) => {
      if (link.action || link.params?.agent) refreshStatus()
    })
    return off
  }, [refreshStatus])

  /* ---------- 派发 ---------- */
  /* ---------- 设置操作 ---------- */
  const onSetEnabled = useCallback(async (id: string, enabled: boolean) => {
    // Capture snapshot before optimistic update to ensure correct rollback
    const prev = providersRef.current
    setProviders(ps => ps.map(p => p.id === id ? { ...p, enabled } : p))
    try { applyProviderConfig(await window.electronAPI.providers.setEnabled(id, enabled)) }
    catch { setProviders(() => prev) }
    refreshStatus()
  }, [applyProviderConfig, refreshStatus])

  const onSetKey = useCallback(async (id: string, key: string) => {
    // Capture snapshot before optimistic update to ensure correct rollback
    const prev = providersRef.current
    setProviders(ps => ps.map(p => p.id === id ? { ...p, apiKey: key, enabled: p.enabled || !!key } : p))
    try { applyProviderConfig(await window.electronAPI.providers.setKey(id, key)) }
    catch { setProviders(() => prev) }
    refreshStatus()
  }, [applyProviderConfig, refreshStatus])

  const onSetBinding = useCallback(async (b: BindingDef) => {
    // Capture snapshot before optimistic update to ensure correct rollback
    const prev = bindingsRef.current
    setBindings(bs => bs.some(x => x.agentId === b.agentId) ? bs.map(x => x.agentId === b.agentId ? b : x) : [...bs, b])
    try {
      await window.electronAPI.routing.setBinding(b)
    }
    catch { setBindings(() => prev) }
    refreshStatus()
  }, [refreshStatus])

  const onSetFallback = useCallback(async (chain: string[]) => {
    // Capture snapshot before optimistic update to ensure correct rollback
    const prev = fallbackChainRef.current
    setFallbackChain(chain)
    try { await window.electronAPI.routing.setFallback(chain) }
    catch { setFallbackChain(() => prev) }
  }, [])

  const onUpsertProvider = useCallback(async (p: any) => {
    try { await window.electronAPI.providers.upsert(p) } catch { /* noop */ }
    refreshStatus()
  }, [refreshStatus])

  const onDeleteProvider = useCallback(async (id: string) => {
    try { await window.electronAPI.providers.delete(id) } catch { /* noop */ }
    refreshStatus()
  }, [refreshStatus])

  const onReorderProvidersForClaude = useCallback(async (orderedIds: string[]) => {
    const byId = new Map(providers.map(provider => [provider.id, provider]))
    setProviders(orderedIds.map(id => byId.get(id)).filter(Boolean) as ProviderDef[])
    try { applyProviderConfig(await window.electronAPI.providers.reorderForClaude(orderedIds)) }
    catch { loadConfig() }
  }, [applyProviderConfig, loadConfig, providers])

  const onRuntimeAgentStatus = useCallback((agentId: string, status: 'busy' | 'idle', runKey: string) => {
    if (!agentId || !runKey) return
    if (status === 'busy') {
      setRuntimeBusyRuns(prev => ({
        ...prev,
        [agentId]: { ...(prev[agentId] || {}), [runKey]: true }
      }))
      return
    }
    setRuntimeBusyRuns(prev => {
      const current = prev[agentId]
      if (!current?.[runKey]) return prev
      const { [runKey]: _run, ...remainingRuns } = current
      if (Object.keys(remainingRuns).length === 0) {
        const { [agentId]: _done, ...rest } = prev
        return rest
      }
      return { ...prev, [agentId]: remainingRuns }
    })
  }, [])

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
      const providerUsable = !!prov && prov.enabled && !!prov.apiKey && !prov.apiKeyLocked
      let st: AgentUIStatus
      if (isStdio && !local?.configured) st = 'off'
      else if (!isStdio && b && !providerUsable) st = 'off'
      else {
        const hub = hubAgents[id]
        st = hub === 'busy' ? 'busy' : hub === 'error' ? 'error' : hub === 'offline' ? 'off' : 'idle'
      }
      if (runtimeBusyRuns[id] && st !== 'off') st = 'busy'
      map[id] = { status: st }
    }
    return map
  }, [bindings, providers, localAgents, hubAgents, runtimeBusyRuns])


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
      onRuntimeAgentStatus={onRuntimeAgentStatus}
      motion={motion}
      setMotion={setMotion}
    />
  )
}
