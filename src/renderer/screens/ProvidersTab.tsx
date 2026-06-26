/**
 * ProvidersTab: provider management settings panel.
 *
 * CCGUI-style Claude provider ordering:
 * local Claude config is fixed, the current Claude route provider is pinned,
 * and all other providers can be reordered without changing the active route.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, Switch } from '../glass/ui'
import { BindingDef, ProviderDef } from '../glass/meta'
import { tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'

type ModelMappingKey = 'main' | 'haiku' | 'sonnet' | 'opus'

export function buildClaudeProviderReorderIds(
  regularProviders: Array<{ id: string; isActive?: boolean }>,
  sourceIndex: number,
  destinationIndex: number
): string[] {
  const activeProvider = regularProviders.find(provider => provider.isActive) ?? null
  const others = regularProviders.filter(provider => !provider.isActive)
  const nextOthers = Array.from(others)
  const [moved] = nextOthers.splice(sourceIndex, 1)
  if (!moved) return regularProviders.map(provider => provider.id)
  const safeDestinationIndex = Math.min(Math.max(destinationIndex, 0), nextOthers.length)
  nextOthers.splice(safeDestinationIndex, 0, moved)
  if (!activeProvider) return nextOthers.map(provider => provider.id)
  const homeIndex = regularProviders.findIndex(provider => provider.id === activeProvider.id)
  const safeHomeIndex = Math.min(Math.max(homeIndex, 0), nextOthers.length)
  const nextFull = Array.from(nextOthers)
  nextFull.splice(safeHomeIndex, 0, activeProvider)
  return nextFull.map(provider => provider.id)
}

export function ProvidersTab({ providers, bindings, onSetEnabled, onSetKey, onReload, onUpsert, onDelete, onReorderForClaude }: {
  providers: ProviderDef[]
  bindings: BindingDef[]
  onSetEnabled: (id: string, enabled: boolean) => void
  onSetKey: (id: string, key: string) => void
  onReload: () => void
  onUpsert: (provider: any) => void
  onDelete: (id: string) => void
  onReorderForClaude: (orderedIds: string[]) => void
}) {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, Record<ModelMappingKey, string>>>({})
  const [modelSuggestions, setModelSuggestions] = useState<Record<string, string[]>>({})
  const [draggingProviderId, setDraggingProviderId] = useState<string | null>(null)
  const [dragOverProviderId, setDragOverProviderId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', baseUrl: 'https://', apiKey: '', kind: 'openai-compatible' })
  const autoFetchSignaturesRef = useRef<Set<string>>(new Set())

  const claudeProviderId = bindings.find(binding => binding.agentId === 'claude')?.providerId ?? null
  const activeClaudeProvider = providers.find(provider => provider.id === claudeProviderId) ?? null
  const otherProviders = providers.filter(provider => provider.id !== claudeProviderId)
  const regularProviders = useMemo(
    () => providers.map(provider => ({ ...provider, isActive: provider.id === claudeProviderId })),
    [providers, claudeProviderId]
  )

  const healthCheck = async (providerId: string) => {
    setChecking(current => ({ ...current, [providerId]: true }))
    try {
      const result = await window.electronAPI.providers.health(providerId)
      setMessage(current => ({
        ...current,
        [providerId]: result?.reachable ? `${tr('可用', 'Reachable')}, ${result.latencyMs ?? '-'}ms` : (result?.error || tr('不可用', 'Unavailable'))
      }))
    } catch (error: any) {
      setMessage(current => ({ ...current, [providerId]: error?.message || tr('健康检查失败', 'Health check failed') }))
    } finally {
      setChecking(current => ({ ...current, [providerId]: false }))
    }
  }

  const fetchModels = async (provider: ProviderDef, options: { automatic?: boolean } = {}) => {
    const providerId = provider.id
    const baseUrl = providerInputBaseUrl(provider)
    const apiKey = providerInputApiKey(provider)
    if (!apiKey) {
      if (options.automatic) return
      setMessage(current => ({ ...current, [providerId]: tr('请先填写 API Key，再获取模型。', 'Enter an API key before fetching models.') }))
      return
    }
    setChecking(current => ({ ...current, [providerId]: true }))
    try {
      const result = await window.electronAPI.providers.fetchModels(providerId, { baseUrl, apiKey, kind: provider.kind })
      const nextProviders: ProviderDef[] = result.config?.providers || []
      const nextProvider = nextProviders.find(provider => provider.id === providerId)
      if (nextProvider?.models?.length) {
        setModelSuggestions(current => ({
          ...current,
          [providerId]: nextProvider.models.map(model => model.id)
        }))
      }
      setMessage(current => ({
        ...current,
        [providerId]: result.ok
          ? tr(`已更新 ${result.count ?? 0} 个模型`, `Updated ${result.count ?? 0} models`)
          : (result.error || tr('获取模型失败', 'Failed to fetch models'))
      }))
      onReload()
    } catch (error: any) {
      setMessage(current => ({ ...current, [providerId]: error?.message || tr('获取模型失败', 'Failed to fetch models') }))
    } finally {
      setChecking(current => ({ ...current, [providerId]: false }))
    }
  }

  const providerInputApiKey = (provider: ProviderDef): string => {
    return (keys[provider.id] ?? provider.apiKey ?? '').trim()
  }

  const providerInputBaseUrl = (provider: ProviderDef): string => {
    return (urls[provider.id] ?? provider.baseUrl ?? '').trim().replace(/\/+$/, '')
  }

  useEffect(() => {
    const timers: number[] = []
    for (const provider of providers) {
      const apiKey = providerInputApiKey(provider)
      const baseUrl = providerInputBaseUrl(provider)
      if (!apiKey || !baseUrl || checking[provider.id]) continue
      const signature = `${provider.id}:${provider.kind}:${baseUrl}:${apiKey}:${provider.models?.length ?? 0}:${provider.modelFetch?.lastSuccessCount ?? -1}`
      if (autoFetchSignaturesRef.current.has(signature)) continue
      autoFetchSignaturesRef.current.add(signature)
      // LOW-18: LRU cleanup — prevent unbounded growth of fetch signatures
      if (autoFetchSignaturesRef.current.size > 20) {
        const entries = [...autoFetchSignaturesRef.current]
        autoFetchSignaturesRef.current = new Set(entries.slice(-20))
      }
      const timer = window.setTimeout(() => {
        fetchModels(provider, { automatic: true }).catch(() => {})
      }, 350)
      timers.push(timer)
    }
    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [providers, keys, urls, checking])

  const _savePendingProviderEdits = async (provider: ProviderDef) => {
    const pendingKey = keys[provider.id]
    const pendingUrl = urls[provider.id]
    const nextKey = pendingKey ?? provider.apiKey ?? ''
    const nextUrl = (pendingUrl ?? provider.baseUrl).trim().replace(/\/$/, '')
    const urlChanged = !!pendingUrl && !!nextUrl && nextUrl !== provider.baseUrl
    const keyChanged = pendingKey != null && nextKey !== (provider.apiKey ?? '')
    if (!urlChanged && !keyChanged) return
    await window.electronAPI.providers.upsert({
      ...provider,
      baseUrl: urlChanged ? nextUrl : provider.baseUrl,
      apiKey: nextKey,
      enabled: provider.enabled || !!nextKey
    })
  }

  const regularProvidersForReorder = () => {
    const active = regularProviders.find(provider => provider.isActive)
    const others = regularProviders.filter(provider => !provider.isActive)
    return active ? insertActiveAtHome(others, active, regularProviders) : regularProviders
  }

  const reorderProviderByIndex = (sourceIndex: number, destinationIndex: number) => {
    if (sourceIndex === destinationIndex) return
    if (sourceIndex < 0 || destinationIndex < 0) return
    const others = regularProviders.filter(provider => !provider.isActive)
    if (destinationIndex >= others.length) return
    const orderedIds = buildClaudeProviderReorderIds(
      regularProvidersForReorder(),
      sourceIndex,
      destinationIndex
    )
    onReorderForClaude(orderedIds)
  }

  const moveProvider = (providerId: string, direction: -1 | 1) => {
    const others = regularProviders.filter(provider => !provider.isActive)
    const sourceIndex = others.findIndex(provider => provider.id === providerId)
    if (sourceIndex < 0) return
    const destinationIndex = sourceIndex + direction
    reorderProviderByIndex(sourceIndex, destinationIndex)
  }

  const handleDragStart = (providerId: string, event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', providerId)
    setDraggingProviderId(providerId)
  }

  const handleDragOver = (providerId: string, event: React.DragEvent<HTMLElement>) => {
    if (!draggingProviderId || draggingProviderId === providerId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverProviderId(providerId)
  }

  const handleDrop = (providerId: string, event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    const sourceId = event.dataTransfer.getData('text/plain') || draggingProviderId
    const sourceIndex = otherProviders.findIndex(provider => provider.id === sourceId)
    const destinationIndex = otherProviders.findIndex(provider => provider.id === providerId)
    reorderProviderByIndex(sourceIndex, destinationIndex)
    setDraggingProviderId(null)
    setDragOverProviderId(null)
  }

  const clearDragState = () => {
    setDraggingProviderId(null)
    setDragOverProviderId(null)
  }

  const saveCustomProvider = () => {
    if (!draft.name.trim() || !draft.baseUrl.trim()) return
    onUpsert({
      id: `custom-${Date.now()}`,
      name: draft.name.trim(),
      kind: draft.kind,
      baseUrl: draft.baseUrl.trim().replace(/\/$/, ''),
      apiKey: draft.apiKey.trim(),
      enabled: !!draft.apiKey.trim(),
      builtIn: false,
      models: [],
      capabilities: {
        protocol: draft.kind === 'anthropic' ? 'messages' : draft.kind === 'gemini' ? 'generate_content' : 'chat_completions',
        stream: true,
        nativeThinking: draft.kind === 'anthropic' || draft.kind === 'gemini',
        budgetTokens: draft.kind === 'anthropic' || draft.kind === 'gemini',
        toolCalls: true,
        systemPrompt: true
      },
      defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true }
    })
    setDraft({ name: '', baseUrl: 'https://', apiKey: '', kind: 'openai-compatible' })
    setAdding(false)
  }

  const renderProviderCard = (provider: ProviderDef, options: { pinned?: boolean; active?: boolean; index?: number; total?: number; draggable?: boolean } = {}) => {
    const mapping = mappingValue(provider, mappingDrafts[provider.id])
    const suggestions = modelSuggestions[provider.id] || provider.models.map(model => model.id)
    const canFetch = !!providerInputApiKey(provider)
    const isClaudeActive = provider.id === claudeProviderId
    const cardClass = [
      'glass',
      'wb-provider-card',
      options.pinned ? 'wb-provider-card-pinned' : '',
      draggingProviderId === provider.id ? 'wb-provider-card-dragging' : '',
      dragOverProviderId === provider.id ? 'wb-provider-card-drop' : ''
    ].filter(Boolean).join(' ')
    return (
      <div
        key={provider.id}
        className={cardClass}
        onDragOver={options.draggable ? event => handleDragOver(provider.id, event) : undefined}
        onDrop={options.draggable ? event => handleDrop(provider.id, event) : undefined}
      >
        <div className="wb-card-head">
          <div>
            <strong>{provider.name}</strong>
            <span>
              {isClaudeActive ? tr('Claude 使用中', 'Claude in use') : provider.builtIn ? tr('内置', 'Built-in') : tr('自定义', 'Custom')}
              {provider.sortOrder != null ? ` · #${provider.sortOrder}` : ''}
            </span>
          </div>
          <div className="wb-provider-head-actions">
            {options.active && <span className="ah-chip mint">{tr('使用中', 'In use')}</span>}
            {!options.pinned && (
              <>
                <span
                  className="wb-provider-drag-handle"
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={tr('拖拽排序', 'Drag to reorder')}
                  title={tr('拖拽排序', 'Drag to reorder')}
                  onDragStart={event => handleDragStart(provider.id, event)}
                  onDragEnd={clearDragState}
                >
                  <span aria-hidden>⋮⋮</span>
                </span>
                <button className="ah-btn icon" disabled={options.index === 0} onClick={() => moveProvider(provider.id, -1)} title={tr('上移', 'Move up')}>↑</button>
                <button className="ah-btn icon" disabled={options.index === (options.total ?? 1) - 1} onClick={() => moveProvider(provider.id, 1)} title={tr('下移', 'Move down')}>↓</button>
              </>
            )}
            <Switch on={provider.enabled} onChange={value => onSetEnabled(provider.id, value)} />
          </div>
        </div>

        <label className="wb-field">
          <span>{tr('接口地址', 'Base URL')}</span>
          <input
            className="ah-input mono"
            value={urls[provider.id] ?? provider.baseUrl}
            disabled={provider.builtIn}
            onChange={event => setUrls(current => ({ ...current, [provider.id]: event.target.value }))}
            onBlur={() => {
              const next = urls[provider.id]
              if (next && next !== provider.baseUrl) onUpsert({ ...provider, baseUrl: next.trim().replace(/\/$/, '') })
            }}
          />
        </label>

        <label className="wb-field">
          <span>API Key</span>
          <input
            className="ah-input mono"
            value={keys[provider.id] ?? provider.apiKey ?? ''}
            placeholder={tr('粘贴 API Key', 'Paste API key')}
            onChange={event => setKeys(current => ({ ...current, [provider.id]: event.target.value }))}
            onBlur={() => onSetKey(provider.id, keys[provider.id] ?? provider.apiKey ?? '')}
            onKeyDown={event => { if (event.key === 'Enter') onSetKey(provider.id, keys[provider.id] ?? provider.apiKey ?? '') }}
          />
        </label>

        {isClaudeActive && (
          <div className="wb-provider-model-mapping">
            <div className="wb-card-head compact">
              <div>
                <strong>{tr('Claude 模型映射', 'Claude model mapping')}</strong>
                <span>{tr('拉取结果只作为输入建议，不会自动覆盖。', 'Fetched models are suggestions and never overwrite values automatically.')}</span>
              </div>
              <button className="ah-btn sm" disabled={!suggestions.length} onClick={() => suggestClaudeMapping(provider)}>
                {tr('按名称推荐填充', 'Suggest by name')}
              </button>
            </div>
            <datalist id={`provider-models-${provider.id}`}>
              {suggestions.map(model => <option key={model} value={model} />)}
            </datalist>
            <div className="wb-form-grid">
              {(['main', 'sonnet', 'opus', 'haiku'] as ModelMappingKey[]).map(key => (
                <label className="wb-field" key={key}>
                  <span>{modelMappingLabel(key)}</span>
                  <input
                    className="ah-input mono"
                    list={`provider-models-${provider.id}`}
                    value={mapping[key] || ''}
                    onChange={event => updateMappingDraft(provider.id, key, event.target.value)}
                    onBlur={() => saveMapping(provider)}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="wb-chip-row">
          {provider.models.slice(0, 8).map(model => <span key={model.id} className="ah-chip">{model.label || model.id}</span>)}
          {provider.models.length > 8 && <span className="ah-chip">+{provider.models.length - 8}</span>}
          {provider.models.length === 0 && <span className="ah-hint">{tr('暂无模型列表', 'No model list yet')}</span>}
        </div>
        <div className="ah-hint">
          {tr(`已有模型 ${provider.models.length} 个`, `${provider.models.length} models saved`)}
          {provider.modelFetch?.lastSuccessCount != null ? tr(` · 上次成功 ${provider.modelFetch.lastSuccessCount} 个`, ` · last success ${provider.modelFetch.lastSuccessCount}`) : ''}
          {provider.modelFetch?.status === 'error' ? tr(` · 获取失败：${provider.modelFetch.error || '未知错误'}，已保留现有模型`, ` · fetch failed: ${provider.modelFetch.error || 'unknown error'}; existing models kept`) : ''}
        </div>

        <div className="wb-card-actions">
          <button className="ah-btn sm" disabled={!!checking[provider.id]} onClick={() => healthCheck(provider.id)}>
            <Icon d={IC.pulse} size={13} /> {tr('健康检查', 'Health check')}
          </button>
          <button className="ah-btn sm" disabled={!!checking[provider.id] || !canFetch} onClick={() => fetchModels(provider)}>
            <Icon d={IC.refresh} size={13} /> {checking[provider.id] ? tr('获取中', 'Fetching') : tr('获取模型', 'Fetch models')}
          </button>
          {!provider.builtIn && (
            <button className="ah-btn sm danger" onClick={async () => {
              try {
                const ok = await styledConfirm({ message: tr(`删除供应商「${provider.name}」？`, `Delete provider "${provider.name}"?`), danger: true })
                if (ok) await onDelete(provider.id)
              } catch (err: any) {
                console.error('Failed to delete provider:', err)
              }
            }}>
              {tr('删除', 'Delete')}
            </button>
          )}
        </div>
        {message[provider.id] && <div className="ah-hint">{message[provider.id]}</div>}
      </div>
    )
  }

  const updateMappingDraft = (providerId: string, key: ModelMappingKey, value: string) => {
    setMappingDrafts(current => ({
      ...current,
      [providerId]: {
        main: current[providerId]?.main || providers.find(provider => provider.id === providerId)?.modelMapping?.main || '',
        haiku: current[providerId]?.haiku || providers.find(provider => provider.id === providerId)?.modelMapping?.haiku || '',
        sonnet: current[providerId]?.sonnet || providers.find(provider => provider.id === providerId)?.modelMapping?.sonnet || '',
        opus: current[providerId]?.opus || providers.find(provider => provider.id === providerId)?.modelMapping?.opus || '',
        [key]: value
      }
    }))
  }

  const saveMapping = (provider: ProviderDef) => {
    const mapping = mappingValue(provider, mappingDrafts[provider.id])
    onUpsert({ ...provider, modelMapping: stripEmptyMapping(mapping) })
  }

  const suggestClaudeMapping = (provider: ProviderDef) => {
    const models = modelSuggestions[provider.id] || provider.models.map(model => model.id)
    const current = mappingValue(provider, mappingDrafts[provider.id])
    const next = {
      main: current.main || models.find(model => /sonnet/i.test(model)) || models[0] || '',
      sonnet: current.sonnet || models.find(model => /sonnet/i.test(model)) || '',
      opus: current.opus || models.find(model => /opus/i.test(model)) || '',
      haiku: current.haiku || models.find(model => /haiku/i.test(model)) || ''
    }
    setMappingDrafts(currentDrafts => ({ ...currentDrafts, [provider.id]: next }))
    onUpsert({ ...provider, modelMapping: stripEmptyMapping(next) })
  }

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>{tr('Claude 供应商顺序', 'Claude provider order')}</strong>
          <span>{tr('本地配置与当前 Claude 供应商固定显示，其他供应商可调整顺序并持久化。', 'Local config and the current Claude provider are pinned; other providers can be reordered and persisted.')}</span>
        </div>
      </div>

      <div className="glass wb-provider-card wb-provider-card-pinned">
        <div className="wb-card-head">
          <div>
            <strong>{tr('Claude 本地配置', 'Claude local config')}</strong>
            <span>{tr('由本机 Claude CLI/settings 决定，不参与排序。', 'Determined by local Claude CLI/settings; not sortable.')}</span>
          </div>
          <span className="ah-chip">{tr('固定', 'Pinned')}</span>
        </div>
      </div>

      {activeClaudeProvider && renderProviderCard(activeClaudeProvider, { pinned: true, active: true })}

      <div className="wb-settings-grid">
        {otherProviders.map((provider, index) => renderProviderCard(provider, { index, total: otherProviders.length, draggable: true }))}
      </div>

      {providers.length === 0 && <div className="glass wb-muted-box">{tr('暂无供应商', 'No providers')}</div>}

      {adding ? (
        <div className="glass wb-provider-card">
          <div className="wb-card-head"><strong>{tr('添加供应商', 'Add provider')}</strong></div>
          <div className="wb-form-grid">
            <input className="ah-input" placeholder={tr('供应商名称', 'Provider name')} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            <select className="ah-select" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
              <option value="openai-compatible">{tr('OpenAI 兼容', 'OpenAI compatible')}</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
            <input className="ah-input mono" placeholder={tr('接口地址', 'Base URL')} value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} />
            <input className="ah-input mono" placeholder="API Key" value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} />
          </div>
          <div className="wb-card-actions">
            <button className="ah-btn sm" onClick={() => setAdding(false)}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" onClick={saveCustomProvider}>{tr('保存', 'Save')}</button>
          </div>
        </div>
      ) : (
        <button className="glass wb-add-card" onClick={() => setAdding(true)}>
          <Icon d={IC.plus} size={16} />
          {tr('添加自定义供应商', 'Add custom provider')}
        </button>
      )}
    </div>
  )
}

function insertActiveAtHome<T extends { id: string; isActive?: boolean }>(others: T[], active: T, regularProviders: T[]): T[] {
  const homeIndex = regularProviders.findIndex(provider => provider.id === active.id)
  const safeHomeIndex = Math.min(Math.max(homeIndex, 0), others.length)
  const next = Array.from(others)
  next.splice(safeHomeIndex, 0, active)
  return next
}

function mappingValue(provider: ProviderDef, draft?: Record<ModelMappingKey, string>): Record<ModelMappingKey, string> {
  return {
    main: draft?.main ?? provider.modelMapping?.main ?? '',
    haiku: draft?.haiku ?? provider.modelMapping?.haiku ?? '',
    sonnet: draft?.sonnet ?? provider.modelMapping?.sonnet ?? '',
    opus: draft?.opus ?? provider.modelMapping?.opus ?? ''
  }
}

function stripEmptyMapping(mapping: Record<ModelMappingKey, string>) {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)
  )
}

function modelMappingLabel(key: ModelMappingKey): string {
  if (key === 'main') return 'Main'
  if (key === 'sonnet') return 'Sonnet'
  if (key === 'opus') return 'Opus'
  return 'Haiku'
}
