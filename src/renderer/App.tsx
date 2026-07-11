/* ============================================================
   AgentHub — 玻璃拟态壳层（design_handoff_glass_ui 实现）
   背景光斑 + 标题栏 + 侧边栏 + 四页（总览/会话/任务/设置）
   真实 IPC：hub:status /
             providers:* / routing:setBinding / proxy:info
   ============================================================ */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef } from './glass/meta'
import type { MotionLevel } from './screens/Settings'
import { setLang, useLang } from './glass/i18n'
import { WorkbenchLayout } from './workbench/WorkbenchLayout'
import { applyAppearance, loadAppearance, normalizeAppearance, readAppearanceLocal, subscribeSystemTheme } from './appearance'
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
    try {
      const appearanceMotion = readAppearanceLocal().motion
      if (appearanceMotion && ['off', 'subtle', 'rich'].includes(appearanceMotion)) return appearanceMotion
      const stored = localStorage.getItem('ah-motion')
      if (stored && ['off', 'subtle', 'rich'].includes(stored)) return stored as MotionLevel
      return 'rich'
    } catch { return 'rich' }
  })

  const configRequestId = useRef(0)
  const configEmptyRetryCount = useRef(0)
  const configRetryTimer = useRef<number | null>(null)
  const configMutationRevision = useRef(0)
  const configMutationResourceRevisions = useRef(new Map<string, number>())
  const pendingConfigMutationRevisions = useRef(new Set<number>())
  const configMutationReloadNeeded = useRef(false)
  const mountedRef = useRef(false)

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
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return
      const next = normalizeAppearance(detail)
      setAppearance(next)
      setMotion(next.motion)
    }
    window.addEventListener('agenthub:appearance-change', handler)
    return () => window.removeEventListener('agenthub:appearance-change', handler)
  }, [])

  useEffect(() => {
    const next = { ...appearance, motion }
    applyAppearance(next)
    if (next.language === 'zh' || next.language === 'en') setLang(next.language)
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
    if (!mountedRef.current) return
    const requestId = ++configRequestId.current
    const mutationRevision = configMutationRevision.current
    clearConfigRetryTimer()
    const scheduleRetry = () => {
      if (!mountedRef.current) return
      const retryDelay = nextEmptyProviderConfigRetryDelayMs(configEmptyRetryCount.current)
      if (retryDelay === null) {
        setConfigLoadError('主进程配置暂未就绪，请检查应用日志或点击重试。')
        return
      }
      setConfigLoadError(null)
      configRetryTimer.current = window.setTimeout(() => {
        configRetryTimer.current = null
        if (mountedRef.current && requestId === configRequestId.current) loadConfig().catch(() => {})
      }, retryDelay)
    }
    try {
      const cfg = await window.electronAPI.providers.get().catch(error => {
        if (mountedRef.current && requestId === configRequestId.current) {
          configEmptyRetryCount.current += 1
          scheduleRetry()
        }
        throw error
      })
      if (
        !mountedRef.current ||
        requestId !== configRequestId.current ||
        mutationRevision !== configMutationRevision.current ||
        pendingConfigMutationRevisions.current.size > 0
      ) return
      applyProviderConfig(cfg)
      if (!isEmptyProviderConfig(cfg?.providers)) {
        configEmptyRetryCount.current = 0
        configMutationReloadNeeded.current = false
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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      configRequestId.current += 1
      configMutationRevision.current += 1
      pendingConfigMutationRevisions.current.clear()
      configMutationReloadNeeded.current = false
      clearConfigRetryTimer()
    }
  }, [clearConfigRetryTimer])

  const refreshStatus = useCallback(async () => {
    try {
      const st = await window.electronAPI.hub.getStatus()
      if (!mountedRef.current) return
      setHubRunning(!!st?.running)
      const m: Record<string, string> = {}
      for (const a of st?.agents ?? []) m[a.id] = a.status
      setHubAgents(m)
    } catch { /* noop */ }
    try {
      const nextLocalAgents = await window.electronAPI.localAgents.status()
      if (mountedRef.current) setLocalAgents(nextLocalAgents)
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
    const off = window.electronAPI.providers.onConfigChanged?.(() => {
      if (!mountedRef.current) return
      configMutationReloadNeeded.current = true
      if (pendingConfigMutationRevisions.current.size === 0) loadConfig()
    })
    return off
  }, [loadConfig])

  useEffect(() => {
    const off = window.electronAPI?.app?.onDeepLink?.((link) => {
      if (!link) return
      if (link.action || link.params?.agent) refreshStatus()
    })
    return off
  }, [refreshStatus])

  /* ---------- 派发 ---------- */
  /* ---------- 设置操作 ---------- */
  const beginConfigMutation = useCallback((resourceKey: string) => {
    configRequestId.current += 1
    const revision = ++configMutationRevision.current
    configMutationResourceRevisions.current.set(resourceKey, revision)
    pendingConfigMutationRevisions.current.add(revision)
    return revision
  }, [])

  const finishConfigMutation = useCallback((resourceKey: string, revision: number, failed: boolean) => {
    pendingConfigMutationRevisions.current.delete(revision)
    if (!mountedRef.current) return
    if (failed && configMutationResourceRevisions.current.get(resourceKey) === revision) {
      configMutationReloadNeeded.current = true
    }
    if (configMutationReloadNeeded.current && pendingConfigMutationRevisions.current.size === 0) {
      loadConfig()
    }
  }, [loadConfig])

  const applyConfigMutationResponse = useCallback((cfg: any, revision: number) => {
    if (!mountedRef.current || !cfg || revision !== configMutationRevision.current) return

    const pendingResources = new Set<string>()
    for (const [resourceKey, resourceRevision] of configMutationResourceRevisions.current) {
      if (
        resourceRevision !== revision &&
        pendingConfigMutationRevisions.current.has(resourceRevision)
      ) pendingResources.add(resourceKey)
    }

    const nextProviders: ProviderDef[] = Array.isArray(cfg.providers) ? cfg.providers : []
    const pendingProviderIds = new Set(
      [...pendingResources]
        .filter(resourceKey => resourceKey.startsWith('provider:'))
        .map(resourceKey => resourceKey.slice('provider:'.length))
    )
    setProviders(current => {
      const currentById = new Map(current.map(provider => [provider.id, provider]))
      const nextById = new Map(nextProviders.map(provider => [provider.id, provider]))
      const ordered = pendingResources.has('provider-order')
        ? [
            ...current.map(provider => nextById.get(provider.id) ?? provider),
            ...nextProviders.filter(provider => !currentById.has(provider.id))
          ]
        : [...nextProviders]
      const merged = ordered.map(provider => (
        pendingProviderIds.has(provider.id) ? currentById.get(provider.id) ?? provider : provider
      ))
      for (const providerId of pendingProviderIds) {
        const currentProvider = currentById.get(providerId)
        if (currentProvider && !merged.some(provider => provider.id === providerId)) merged.push(currentProvider)
      }
      return merged
    })

    const nextBindings: BindingDef[] = cfg.routing?.bindings ?? []
    const pendingBindingAgentIds = new Set(
      [...pendingResources]
        .filter(resourceKey => resourceKey.startsWith('binding:'))
        .map(resourceKey => resourceKey.slice('binding:'.length))
    )
    setBindings(current => {
      const currentByAgentId = new Map(current.map(binding => [binding.agentId, binding]))
      const merged = nextBindings.map(binding => (
        pendingBindingAgentIds.has(binding.agentId)
          ? currentByAgentId.get(binding.agentId) ?? binding
          : binding
      ))
      for (const agentId of pendingBindingAgentIds) {
        const currentBinding = currentByAgentId.get(agentId)
        if (currentBinding && !merged.some(binding => binding.agentId === agentId)) merged.push(currentBinding)
      }
      return merged
    })

    if (!pendingResources.has('fallback')) {
      setFallbackChain(cfg.routing?.fallbackChain ?? [])
    }
  }, [])

  const onSetEnabled = useCallback(async (id: string, enabled: boolean) => {
    const resourceKey = `provider:${id}`
    const revision = beginConfigMutation(resourceKey)
    setProviders(ps => ps.map(p => p.id === id ? { ...p, enabled } : p))
    try {
      const cfg = await window.electronAPI.providers.setEnabled(id, enabled)
      applyConfigMutationResponse(cfg, revision)
      finishConfigMutation(resourceKey, revision, false)
    }
    catch { finishConfigMutation(resourceKey, revision, true) }
    refreshStatus()
  }, [applyConfigMutationResponse, beginConfigMutation, finishConfigMutation, refreshStatus])

  const onSetKey = useCallback(async (id: string, key: string) => {
    const resourceKey = `provider:${id}`
    const revision = beginConfigMutation(resourceKey)
    setProviders(ps => ps.map(p => p.id === id ? { ...p, apiKey: key, enabled: p.enabled || !!key } : p))
    try {
      const cfg = await window.electronAPI.providers.setKey(id, key)
      applyConfigMutationResponse(cfg, revision)
      finishConfigMutation(resourceKey, revision, false)
    }
    catch { finishConfigMutation(resourceKey, revision, true) }
    refreshStatus()
  }, [applyConfigMutationResponse, beginConfigMutation, finishConfigMutation, refreshStatus])

  const onSetBinding = useCallback(async (b: BindingDef) => {
    const resourceKey = `binding:${b.agentId}`
    const revision = beginConfigMutation(resourceKey)
    setBindings(bs => bs.some(x => x.agentId === b.agentId) ? bs.map(x => x.agentId === b.agentId ? b : x) : [...bs, b])
    try {
      await window.electronAPI.routing.setBinding(b)
      finishConfigMutation(resourceKey, revision, false)
    }
    catch { finishConfigMutation(resourceKey, revision, true) }
    refreshStatus()
  }, [beginConfigMutation, finishConfigMutation, refreshStatus])

  const onSetFallback = useCallback(async (chain: string[]) => {
    const resourceKey = 'fallback'
    const revision = beginConfigMutation(resourceKey)
    setFallbackChain(chain)
    try {
      await window.electronAPI.routing.setFallback(chain)
      finishConfigMutation(resourceKey, revision, false)
    }
    catch { finishConfigMutation(resourceKey, revision, true) }
  }, [beginConfigMutation, finishConfigMutation])

  const onUpsertProvider = useCallback(async (p: any) => {
    try { await window.electronAPI.providers.upsert(p) } catch { /* noop */ }
    refreshStatus()
  }, [refreshStatus])

  const onDeleteProvider = useCallback(async (id: string) => {
    try { await window.electronAPI.providers.delete(id) } catch { /* noop */ }
    refreshStatus()
  }, [refreshStatus])

  const onReorderProvidersForClaude = useCallback(async (orderedIds: string[]) => {
    const resourceKey = 'provider-order'
    const revision = beginConfigMutation(resourceKey)
    const byId = new Map(providers.map(provider => [provider.id, provider]))
    const reordered = orderedIds.map(id => byId.get(id)).filter((p): p is ProviderDef => !!p)
    if (reordered.length !== orderedIds.length) {
      finishConfigMutation(resourceKey, revision, true)
      return
    }
    setProviders(reordered)
    try {
      const cfg = await window.electronAPI.providers.reorderForClaude(orderedIds)
      applyConfigMutationResponse(cfg, revision)
      finishConfigMutation(resourceKey, revision, false)
    }
    catch { finishConfigMutation(resourceKey, revision, true) }
  }, [applyConfigMutationResponse, beginConfigMutation, finishConfigMutation, providers])

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


  useLang() // 订阅语言变化并在保留 Workbench 本地状态的同时重渲染文案

  return (
    <WorkbenchLayout
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
