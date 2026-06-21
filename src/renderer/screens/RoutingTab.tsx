/**
 * RoutingTab: agent routing and failover configuration.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles agent bindings, provider fallback chains, and routing policies.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState, useEffect } from 'react'
import { Icon, IC } from '../glass/ui'
import { AGENT_META, BindingDef, ProviderDef } from '../glass/meta'
import { tr } from '../glass/i18n'

interface BinaryCandidate {
  source: 'desktop' | 'terminal'
  label: string
  path: string
}

export function RoutingTab({ providers, bindings, fallbackChain, onSetBinding, onSetFallback, onTab }: {
  providers: ProviderDef[]
  bindings: BindingDef[]
  fallbackChain: string[]
  onSetBinding: (binding: BindingDef) => void
  onSetFallback: (chain: string[]) => void
  onTab: (tab: string) => void
}) {
  const [located, setLocated] = useState<Record<string, BinaryCandidate[]>>({})
  useEffect(() => { window.electronAPI.agents.locate().then(setLocated).catch(() => {}) }, [])

  const configuredProviders = providers.filter(provider => provider.enabled && provider.apiKey && provider.models.length > 0)
  const toggleFallback = (providerId: string) => {
    onSetFallback(fallbackChain.includes(providerId) ? fallbackChain.filter(id => id !== providerId) : [...fallbackChain, providerId])
  }

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>{tr('Agent 路由', 'Agent routing')}</strong>
          <span>{tr('指定单个 Agent 时只走该 Agent 绑定；调度模式只在未指定 Agent 时展开。', 'A chosen Agent uses only its binding; schedule modes expand only when no Agent is pinned.')}</span>
        </div>
        <button className="ah-btn sm" onClick={() => onTab('local-agents')}>{tr('管理本地 Agent', 'Manage local agents')}</button>
      </div>
      {settingsBindingRows(bindings).map(binding => (
        <BindingRow key={binding.agentId} binding={binding} providers={providers} configuredProviders={configuredProviders}
          candidates={located[binding.agentId] || []} onChange={onSetBinding} />
      ))}
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('故障转移', 'Failover')}</strong>
            <span>{tr('主供应商失败且还没有输出内容时，按顺序尝试备用供应商。', 'When the primary provider fails before output starts, fallback providers are tried in order.')}</span>
          </div>
        </div>
        <div className="wb-chip-row">
          {providers.filter(provider => provider.enabled && provider.apiKey).map(provider => {
            const index = fallbackChain.indexOf(provider.id)
            return (
              <button key={provider.id} className={index >= 0 ? 'ah-chip mint' : 'ah-chip'} onClick={() => toggleFallback(provider.id)}>
                {index >= 0 ? `${index + 1}. ` : ''}{provider.name}
              </button>
            )
          })}
          {providers.filter(provider => provider.enabled && provider.apiKey).length === 0 && <span className="ah-hint">{tr('先配置可用供应商。', 'Configure an available provider first.')}</span>}
        </div>
      </div>
    </div>
  )
}

function settingsBindingRows(bindings: BindingDef[]): BindingDef[] {
  const seen = new Set<string>()
  const result: BindingDef[] = []
  for (const binding of bindings) {
    if (!seen.has(binding.agentId)) {
      seen.add(binding.agentId)
      result.push(binding)
    }
  }
  return result
}

function BindingRow({ binding, providers, configuredProviders, candidates, onChange }: {
  binding: BindingDef
  providers: ProviderDef[]
  configuredProviders: ProviderDef[]
  candidates: BinaryCandidate[]
  onChange: (binding: BindingDef) => void
}) {
  const meta = AGENT_META[binding.agentId]
  return (
    <div className="glass wb-binding-row">
      <div className="wb-binding-head">
        <span>{meta?.name || binding.agentId}</span>
        {binding.protocol === 'acp' && <span className="ah-chip">ACP</span>}
        {binding.protocol === 'stdio-plain' && <span className="ah-chip">CLI</span>}
      </div>
      {binding.protocol === 'stdio-plain' && (
        <label className="wb-field">
          <span>{tr('CLI 路径', 'CLI path')}</span>
          <input className="ah-input mono" value={binding.binary || ''} onChange={e => onChange({ ...binding, binary: e.target.value })} />
        </label>
      )}
      {binding.protocol !== 'stdio-plain' && (
        <div className="wb-binding-models">
          <select className="ah-select" value={binding.providerId || ''} onChange={e => onChange({ ...binding, providerId: e.target.value })}>
            <option value="">{tr('选择供应商', 'Select provider')}</option>
            {configuredProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="ah-select" value={binding.modelId || ''} onChange={e => onChange({ ...binding, modelId: e.target.value })}>
            <option value="">{tr('选择模型', 'Select model')}</option>
            {configuredProviders.find(p => p.id === binding.providerId)?.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
