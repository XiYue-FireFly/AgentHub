/**
 * RoutingTab: agent routing and failover configuration.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles agent bindings, provider fallback chains, and routing policies.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState, useEffect } from 'react'
// IC reserved for future icon usage
import { AgentMark } from '../glass/ui'
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
  const [located, setLocated] = useState<LocalAgentStatus[]>([])
  useEffect(() => { window.electronAPI.agents.locate().then(setLocated).catch(() => {}) }, [])

  const configuredProviders = providers.filter(provider =>
    provider.enabled &&
    provider.apiKey &&
    !provider.apiKeyLocked &&
    provider.models.some(model => model.enabled !== false)
  )
  const toggleFallback = (providerId: string) => {
    onSetFallback(fallbackChain.includes(providerId) ? fallbackChain.filter(id => id !== providerId) : [...fallbackChain, providerId])
  }

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>{tr('Agent 路由', 'Agent routing')}</strong>
          <span>{tr('Pinned agents use only their binding; schedule modes expand only when no agent is pinned.', 'Pinned agents use only their binding; schedule modes expand only when no agent is pinned.')}</span>
        </div>
        <button className="ah-btn sm" onClick={() => onTab('local-agents')}>{tr('Manage local agents', 'Manage local agents')}</button>
      </div>
      {settingsBindingRows(bindings).map(binding => (
        <BindingRow key={binding.agentId} binding={binding} providers={providers} configuredProviders={configuredProviders}
          candidates={located.find(agent => agent.agentId === binding.agentId)?.candidates || []}
          onChange={onSetBinding}
        />
      ))}
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('Failover', 'Failover')}</strong>
            <span>{tr('Fallback providers are tried in order when the primary provider fails before producing output.', 'Fallback providers are tried in order when the primary provider fails before producing output.')}</span>
          </div>
        </div>
        <div className="wb-chip-row">
          {providers.filter(provider => provider.enabled && provider.apiKey && !provider.apiKeyLocked).map(provider => {
            const index = fallbackChain.indexOf(provider.id)
            return (
              <button key={provider.id} className={index >= 0 ? 'ah-chip mint' : 'ah-chip'} onClick={() => toggleFallback(provider.id)}>
                {index >= 0 ? `${index + 1}. ` : ''}{provider.name}
              </button>
            )
          })}
          {providers.filter(provider => provider.enabled && provider.apiKey && !provider.apiKeyLocked).length === 0 && <span className="ah-hint">{tr('Configure an available provider first.', 'Configure an available provider first.')}</span>}
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

function BindingRow({ binding, providers: _providers, configuredProviders, candidates: _candidates, onChange }: {
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
        <div className="wb-binding-agent-head">
          {meta ? <AgentMark id={binding.agentId} size={34} radius={10} /> : <span className="wb-agent-fallback">{binding.agentId.slice(0, 1).toUpperCase()}</span>}
          <div>
            <strong>{meta?.name || binding.agentId}</strong>
            <span>{meta?.desc || binding.agentId}</span>
          </div>
        </div>
        <div className="wb-binding-badges">
          {binding.protocol === 'acp' && <span className="ah-chip">ACP</span>}
          {binding.protocol === 'stdio-plain' && <span className="ah-chip">CLI</span>}
        </div>
      </div>
      {binding.protocol === 'stdio-plain' && (
        <label className="wb-field">
          <span>{tr('CLI path', 'CLI path')}</span>
          <input className="ah-input mono" value={binding.binary || ''} onChange={e => onChange({ ...binding, binary: e.target.value })} />
        </label>
      )}
      {binding.protocol !== 'stdio-plain' && (
        <div className="wb-binding-models">
          <select className="ah-select" value={binding.providerId || ''} onChange={e => onChange({ ...binding, providerId: e.target.value })}>
            <option value="">{tr('Select provider', 'Select provider')}</option>
            {configuredProviders.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="ah-select" value={binding.modelId || ''} onChange={e => onChange({ ...binding, modelId: e.target.value })}>
            <option value="">{tr('Select model', 'Select model')}</option>
            {configuredProviders.find(p => p.id === binding.providerId)?.models.filter(m => m.enabled !== false).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
