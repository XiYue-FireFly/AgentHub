/**
 * ApprovalsTab: approval policy configuration with codex-style presets.
 *
 * Extracted from Settings.tsx to reduce monolith size.
 * Handles approval presets, per-tool policies, and per-agent overrides.
 *
 * P2-2: Settings.tsx splitting.
 */

import React, { useState, useEffect, useCallback } from 'react'
// IC reserved for future icon usage
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'
import {
  approvalDisplayModeFromConfig,
  approvalDisplayModeLabel,
  approvalPresetForDisplayMode
} from '../workbench/utils/approvalMode'

type ApprovalPolicy = 'allow' | 'ask' | 'deny'
type ApprovalPreset = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'

export function ApprovalsTab() {
  const [config, setConfig] = useState<{ preset?: ApprovalPreset; default: { write: ApprovalPolicy; exec: ApprovalPolicy }; overrides: Record<string, { write?: ApprovalPolicy; exec?: ApprovalPolicy }> } | null>(null)
  const [caps, setCaps] = useState<Array<{ agentId: string; name: string }>>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextConfig, nextCaps] = await Promise.all([
        window.electronAPI.agentic.getApprovalConfig(),
        window.electronAPI.agentic.capabilities()
      ])
      setConfig(nextConfig)
      setCaps(nextCaps)
      setError(null)
    } catch (err: any) {
      setError(err?.message || tr('加载权限策略失败', 'Failed to load approval policies'))
    }
  }, [])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  const setPreset = async (preset: ApprovalPreset) => {
    await window.electronAPI.agentic.setApprovalPreset(preset)
    await load()
  }

  const setDefault = async (tool: 'write' | 'exec', policy: ApprovalPolicy) => {
    await window.electronAPI.agentic.setApprovalDefault(tool, policy)
    await load()
  }

  const setOverride = async (agentId: string, tool: 'write' | 'exec', value: string) => {
    await window.electronAPI.agentic.setApprovalOverride(agentId, tool, value === 'default' ? null : value as ApprovalPolicy)
    await load()
  }

  if (!config || !config.default) return <div className="wb-muted-box">{error || tr('正在加载权限策略...', 'Loading approval policies...')}</div>

  const displayMode = approvalDisplayModeFromConfig(config)
  const currentPreset = config.preset || (displayMode === 'custom' ? 'custom' : approvalPresetForDisplayMode(displayMode))

  return (
    <div className="wb-settings-stack">
      {/* Preset selection */}
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('审批模式', 'Approval mode')}</strong>
            <span role="status" aria-label={tr('当前审批模式', 'Current approval mode')} className="ah-chip">
              {approvalDisplayModeLabel(displayMode)}
            </span>
            <span>{tr('"完全访问"等价于 codex Full Access — 永不弹窗。', '"Full access" equals codex Full Access — never prompts.')}</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          <PresetCard id="read-only" current={currentPreset} label={tr('只读', 'Read Only')} description={tr('写入和执行均拒绝。', 'Writes and commands rejected.')} onClick={() => setPreset('read-only')} />
          <PresetCard id="auto" current={currentPreset} label={tr('默认', 'Default')} description={tr('低风险放行；高风险按配置决定。', 'Low-risk approved; high-risk follows config.')} onClick={() => setPreset('auto')} />
          <PresetCard id="full-access" current={currentPreset} label={tr('完全访问', 'Full Access')} description={tr('永不弹窗，直接执行。', 'Never prompts, always executes.')} onClick={() => setPreset('full-access')} />
          <PresetCard id="ask-all" current={currentPreset} label={tr('每次询问', 'Ask Always')} description={tr('每次写入或执行都确认。', 'Every write/exec confirms.')} onClick={() => setPreset('ask-all')} />
        </div>
      </div>

      {/* Custom default policy */}
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('自定义默认策略', 'Custom default policy')}</strong>
            <span>{tr('修改下方任意值会自动切换到「自定义」模式。', 'Editing below switches to Custom mode.')}</span>
          </div>
        </div>
        <div className="wb-form-grid two">
          <PolicySelect label={tr('写文件', 'Write files')} value={config.default.write} onChange={v => setDefault('write', v)} />
          <PolicySelect label={tr('执行命令', 'Run commands')} value={config.default.exec} onChange={v => setDefault('exec', v)} />
        </div>
      </div>

      {/* Per-agent overrides */}
      <div className="glass wb-table-card">
        <div className="wb-table-row head"><span>Agent</span><span>{tr('写文件', 'Write')}</span><span>{tr('执行命令', 'Exec')}</span></div>
        {caps.map(agent => {
          const override = config.overrides[agent.agentId] || {}
          return (
            <div key={agent.agentId} className="wb-table-row">
              <span>{AGENT_META[agent.agentId]?.name || agent.name || agent.agentId}</span>
              <select value={override.write || 'default'} onChange={e => setOverride(agent.agentId, 'write', e.target.value)}>
                <option value="default">{tr('默认', 'Default')}</option>
                <option value="allow">{tr('允许', 'Allow')}</option>
                <option value="ask">{tr('询问', 'Ask')}</option>
                <option value="deny">{tr('拒绝', 'Deny')}</option>
              </select>
              <select value={override.exec || 'default'} onChange={e => setOverride(agent.agentId, 'exec', e.target.value)}>
                <option value="default">{tr('默认', 'Default')}</option>
                <option value="allow">{tr('允许', 'Allow')}</option>
                <option value="ask">{tr('询问', 'Ask')}</option>
                <option value="deny">{tr('拒绝', 'Deny')}</option>
              </select>
            </div>
          )
        })}
      </div>
      {error && <div className="glass wb-error-text">{error}</div>}
    </div>
  )
}

function PresetCard({ id, current, label, description, onClick }: {
  id: ApprovalPreset
  current: ApprovalPreset
  label: string
  description: string
  onClick: () => void
}) {
  const active = current === id
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
        padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
        background: active ? 'var(--mint-soft)' : 'var(--bg-input)',
        border: '1px solid ' + (active ? 'var(--mint-line)' : 'var(--glass-border-default)'),
        color: active ? 'var(--mint)' : 'var(--tx-1)',
        font: 'inherit', transition: 'all 0.15s'
      }}
    >
      <strong style={{ fontSize: 13, fontWeight: 600 }}>{label}{active ? ' ✓' : ''}</strong>
      <span style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.4 }}>{description}</span>
    </button>
  )
}

function PolicySelect({ label, value, onChange }: { label: string; value: ApprovalPolicy; onChange: (v: ApprovalPolicy) => void }) {
  return (
    <label className="wb-field">
      <span>{label}</span>
      <select className="ah-select" value={value} onChange={e => onChange(e.target.value as ApprovalPolicy)}>
        <option value="allow">{tr('允许', 'Allow')}</option>
        <option value="ask">{tr('询问', 'Ask')}</option>
        <option value="deny">{tr('拒绝', 'Deny')}</option>
      </select>
    </label>
  )
}
