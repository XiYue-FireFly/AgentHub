/**
 * ProvidersTab: provider management settings panel.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles provider CRUD, health checks, model fetching, and API key management.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState } from 'react'
import { Icon, IC, Switch } from '../glass/ui'
import { ProviderDef } from '../glass/meta'
import { tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'

export function ProvidersTab({ providers, onSetEnabled, onSetKey, onReload, onUpsert, onDelete }: {
  providers: ProviderDef[]
  onSetEnabled: (id: string, enabled: boolean) => void
  onSetKey: (id: string, key: string) => void
  onReload: () => void
  onUpsert: (provider: any) => void
  onDelete: (id: string) => void
}) {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [checking, setChecking] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', baseUrl: 'https://', apiKey: '', kind: 'openai-compatible' })

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

  const fetchModels = async (providerId: string) => {
    setChecking(current => ({ ...current, [providerId]: true }))
    try {
      const result = await window.electronAPI.providers.fetchModels(providerId)
      setMessage(current => ({ ...current, [providerId]: result.ok ? tr(`已更新 ${result.count ?? 0} 个模型`, `Updated ${result.count ?? 0} models`) : (result.error || tr('获取模型失败', 'Failed to fetch models')) }))
      if (result.ok) onReload()
    } catch (error: any) {
      setMessage(current => ({ ...current, [providerId]: error?.message || tr('获取模型失败', 'Failed to fetch models') }))
    } finally {
      setChecking(current => ({ ...current, [providerId]: false }))
    }
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
      capabilities: ['chat'],
      defaultThinking: { mode: 'auto', level: 'medium', collapseInUI: true }
    })
    setDraft({ name: '', baseUrl: 'https://', apiKey: '', kind: 'openai-compatible' })
    setAdding(false)
  }

  return (
    <div className="wb-settings-stack">
      <div className="wb-settings-grid">
        {providers.map(provider => (
          <div key={provider.id} className="glass wb-provider-card">
            <div className="wb-card-head">
              <div>
                <strong>{provider.name}</strong>
                <span>{provider.builtIn ? tr('内置', 'Built-in') : tr('自定义', 'Custom')}</span>
              </div>
              <Switch on={provider.enabled} onChange={value => onSetEnabled(provider.id, value)} />
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

            <div className="wb-chip-row">
              {provider.models.slice(0, 8).map(model => <span key={model.id} className="ah-chip">{model.label}</span>)}
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
              <button className="ah-btn sm" disabled={!!checking[provider.id] || !(keys[provider.id] ?? provider.apiKey)} onClick={() => fetchModels(provider.id)}>
                <Icon d={IC.refresh} size={13} /> {tr('获取模型', 'Fetch models')}
              </button>
              {!provider.builtIn && (
                <button className="ah-btn sm danger" onClick={async () => {
                  const ok = await styledConfirm({ message: tr(`删除供应商「${provider.name}」？`, `Delete provider "${provider.name}"?`), danger: true })
                  if (ok) onDelete(provider.id)
                }}>
                  {tr('删除', 'Delete')}
                </button>
              )}
            </div>
            {message[provider.id] && <div className="ah-hint">{message[provider.id]}</div>}
          </div>
        ))}
      </div>

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
