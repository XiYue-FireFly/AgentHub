import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, IC, AgentMark, Seg, Switch } from '../glass/ui'
import { AGENT_META, AGENT_IDS, BindingDef, DEFAULT_STDIO_ARGS, ProviderDef } from '../glass/meta'
import { getLang, setLang, Lang } from '../glass/i18n'
import { ConnectionSummary, SetupTab } from '../glass/connection-status'
import { SkillsTab } from './Skills'
import {
  AppearancePreferences,
  DEFAULT_APPEARANCE,
  DiffMarkerStyle,
  AgentEnvironment,
  DefaultOpenTarget,
  TerminalShell,
  applyAppearance,
  normalizeAppearance,
  readAppearanceLocal,
  saveAppearance
} from '../appearance'

export type MotionLevel = 'off' | 'subtle' | 'rich'

type TabKey = SetupTab | 'appearance' | 'updates'

interface SettingsScreenProps {
  providers: ProviderDef[]
  bindings: BindingDef[]
  fallbackChain: string[]
  onSetEnabled: (id: string, enabled: boolean) => void
  onSetKey: (id: string, key: string) => void
  onSetBinding: (binding: BindingDef) => void
  onSetFallback: (chain: string[]) => void
  onReload: () => void
  onUpsertProvider: (provider: any) => void
  onDeleteProvider: (id: string) => void
  motion: MotionLevel
  setMotion: (motion: MotionLevel) => void
  initialTab: TabKey
  workspaceId?: string | null
  connectionSummary: ConnectionSummary
  goChat: (agentId: string | null) => void
  openSetup: (tab?: TabKey) => void
}

interface BinaryCandidate {
  source: 'desktop' | 'terminal'
  label: string
  path: string
}

type ApprovalPolicy = 'allow' | 'ask' | 'deny'

const NAV_ITEMS: Array<{ value: TabKey; label: string; description: string; icon: React.ReactNode }> = [
  { value: 'appearance', label: '外观', description: '主题、字体、动效和界面显示偏好。', icon: IC.gear },
  { value: 'providers', label: '供应商', description: '管理 API 供应商、Key 和模型列表。', icon: IC.pulse },
  { value: 'local-agents', label: '本地 Agent', description: '检测并配置本机可用的 Agent 入口。', icon: IC.terminal },
  { value: 'routing', label: '路由', description: '设置 Agent 使用的模型、CLI 或 ACP 绑定。', icon: IC.broadcast },
  { value: 'approvals', label: '权限', description: '控制命令、文件和工具调用的审批策略。', icon: IC.check },
  { value: 'workspaces', label: '工作目录', description: '管理绑定到会话的本地目录。', icon: IC.folder },
  { value: 'skills', label: '技能', description: '导入和管理本地 Agent 技能。', icon: IC.bolt },
  { value: 'mcp', label: 'MCP', description: '管理本地和工作目录 MCP 服务。', icon: IC.link },
  { value: 'usage', label: '使用统计', description: '查看会话、消息和 Token 使用情况。', icon: IC.pulse },
  { value: 'updates', label: '版本与更新', description: '检查当前版本、渠道和下载入口。', icon: IC.refresh }
]

export function SettingsScreen(props: SettingsScreenProps) {
  const [tab, setTab] = useState<TabKey>(props.initialTab || 'appearance')
  useEffect(() => setTab(props.initialTab || 'appearance'), [props.initialTab])

  const active = NAV_ITEMS.find(item => item.value === tab) ?? NAV_ITEMS[0]

  return (
    <div className="wb-settings wb-settings-shell" data-screen-label="设置">
      <aside className="wb-settings-nav">
        <div className="wb-settings-nav-title">
          <strong>设置</strong>
          <span>AgentHub</span>
        </div>
        {NAV_ITEMS.map(item => (
          <button key={item.value} className={tab === item.value ? 'active' : ''} onClick={() => setTab(item.value)}>
            <Icon d={item.icon} size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </aside>

      <section className="wb-settings-content">
        <div className="wb-settings-page-head">
          <div>
            <h2>{active.label}</h2>
            <p>{active.description}</p>
          </div>
        </div>

        <SetupNextStep summary={props.connectionSummary} onTab={setTab} goChat={props.goChat} />

        {tab === 'appearance' && <AppearanceTab motion={props.motion} setMotion={props.setMotion} />}
        {tab === 'providers' && (
          <ProvidersTab
            providers={props.providers}
            onSetEnabled={props.onSetEnabled}
            onSetKey={props.onSetKey}
            onReload={props.onReload}
            onUpsert={props.onUpsertProvider}
            onDelete={props.onDeleteProvider}
          />
        )}
        {tab === 'local-agents' && <LocalAgentsTab />}
        {tab === 'routing' && (
          <RoutingTab
            providers={props.providers}
            bindings={props.bindings}
            fallbackChain={props.fallbackChain}
            onSetBinding={props.onSetBinding}
            onSetFallback={props.onSetFallback}
            onTab={setTab}
          />
        )}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'workspaces' && <WorkspacesTab />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'mcp' && <McpSettingsTab workspaceId={props.workspaceId ?? null} />}
        {tab === 'usage' && <UsageStatsTabV2 />}
        {tab === 'updates' && <UpdatesSettingsTab />}
      </section>
    </div>
  )
}

function SetupNextStep({ summary, onTab, goChat }: {
  summary: ConnectionSummary
  onTab: (tab: TabKey) => void
  goChat: (agentId: string | null) => void
}) {
  const readyAgent = summary.items.find(item => item.state === 'usable')?.agentId ?? null
  const next = summary.items.find(item => item.action)
  return (
    <div className="glass wb-setup-next">
      <div>
        <strong>{summary.counts.usable > 0 ? '已有可用 Agent' : '还需要完成连接'}</strong>
        <span>
          {summary.counts.usable} 可用 / {summary.counts.busy} 运行中 / {summary.counts.needsProvider} 缺少 Key / {summary.counts.needsInstall} 待配置本地入口
        </span>
      </div>
      <div className="wb-setup-actions">
        {next?.action && (
          <button className="ah-btn sm" onClick={() => onTab(next.action!.tab)}>
            {next.action.labelZh || '继续配置'}
          </button>
        )}
        <button className="ah-btn sm primary" onClick={() => goChat(readyAgent)}>
          去对话
        </button>
      </div>
    </div>
  )
}

function ProvidersTab({ providers, onSetEnabled, onSetKey, onReload, onUpsert, onDelete }: {
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
        [providerId]: result?.reachable ? `可用，${result.latencyMs ?? '-'}ms` : (result?.error || '不可用')
      }))
    } catch (error: any) {
      setMessage(current => ({ ...current, [providerId]: error?.message || '健康检查失败' }))
    } finally {
      setChecking(current => ({ ...current, [providerId]: false }))
    }
  }

  const fetchModels = async (providerId: string) => {
    setChecking(current => ({ ...current, [providerId]: true }))
    try {
      const result = await window.electronAPI.providers.fetchModels(providerId)
      setMessage(current => ({ ...current, [providerId]: result.ok ? `已更新 ${result.count ?? 0} 个模型` : (result.error || '获取模型失败') }))
      if (result.ok) onReload()
    } catch (error: any) {
      setMessage(current => ({ ...current, [providerId]: error?.message || '获取模型失败' }))
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
                <span>{provider.builtIn ? '内置' : '自定义'}</span>
              </div>
              <Switch on={provider.enabled} onChange={value => onSetEnabled(provider.id, value)} />
            </div>

            <label className="wb-field">
              <span>接口地址</span>
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
                placeholder="粘贴 API Key"
                onChange={event => setKeys(current => ({ ...current, [provider.id]: event.target.value }))}
                onBlur={() => onSetKey(provider.id, keys[provider.id] ?? provider.apiKey ?? '')}
                onKeyDown={event => { if (event.key === 'Enter') onSetKey(provider.id, keys[provider.id] ?? provider.apiKey ?? '') }}
              />
            </label>

            <div className="wb-chip-row">
              {provider.models.slice(0, 8).map(model => <span key={model.id} className="ah-chip">{model.label}</span>)}
              {provider.models.length > 8 && <span className="ah-chip">+{provider.models.length - 8}</span>}
              {provider.models.length === 0 && <span className="ah-hint">暂无模型列表</span>}
            </div>
            <div className="ah-hint">
              已有模型 {provider.models.length} 个
              {provider.modelFetch?.lastSuccessCount != null ? ` · 上次成功 ${provider.modelFetch.lastSuccessCount} 个` : ''}
              {provider.modelFetch?.status === 'error' ? ` · 获取失败：${provider.modelFetch.error || '未知错误'}，已保留现有模型` : ''}
            </div>

            <div className="wb-card-actions">
              <button className="ah-btn sm" disabled={!!checking[provider.id]} onClick={() => healthCheck(provider.id)}>
                <Icon d={IC.pulse} size={13} /> 健康检查
              </button>
              <button className="ah-btn sm" disabled={!!checking[provider.id] || !(keys[provider.id] ?? provider.apiKey)} onClick={() => fetchModels(provider.id)}>
                <Icon d={IC.refresh} size={13} /> 获取模型
              </button>
              {!provider.builtIn && (
                <button className="ah-btn sm danger" onClick={() => window.confirm(`删除供应商「${provider.name}」？`) && onDelete(provider.id)}>
                  删除
                </button>
              )}
            </div>
            {message[provider.id] && <div className="ah-hint">{message[provider.id]}</div>}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="glass wb-provider-card">
          <div className="wb-card-head"><strong>添加供应商</strong></div>
          <div className="wb-form-grid">
            <input className="ah-input" placeholder="供应商名称" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            <select className="ah-select" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
              <option value="openai-compatible">OpenAI 兼容</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
            <input className="ah-input mono" placeholder="接口地址" value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} />
            <input className="ah-input mono" placeholder="API Key" value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} />
          </div>
          <div className="wb-card-actions">
            <button className="ah-btn sm" onClick={() => setAdding(false)}>取消</button>
            <button className="ah-btn sm primary" onClick={saveCustomProvider}>保存</button>
          </div>
        </div>
      ) : (
        <button className="glass wb-add-card" onClick={() => setAdding(true)}>
          <Icon d={IC.plus} size={16} />
          添加自定义供应商
        </button>
      )}
    </div>
  )
}

function LocalAgentsTab() {
  const [agents, setAgents] = useState<LocalAgentStatus[]>([])
  const [localModels, setLocalModels] = useState<LocalModelConfig[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [argDrafts, setArgDrafts] = useState<Record<string, string>>({})
  const [protocolDrafts, setProtocolDrafts] = useState<Record<string, 'stdio-plain' | 'acp'>>({})
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [next, modelConfigs] = await Promise.all([
        window.electronAPI.localAgents.detect(),
        window.electronAPI.localModels.scan().catch(() => [] as LocalModelConfig[])
      ])
      setAgents(next)
      setLocalModels(modelConfigs)
      setDrafts(Object.fromEntries(next.map(agent => [agent.agentId, agent.binary || ''])))
      setArgDrafts(Object.fromEntries(next.map(agent => [agent.agentId, agent.args || ''])))
      setProtocolDrafts(Object.fromEntries(next.map(agent => [agent.agentId, agent.protocol === 'acp' ? 'acp' : 'stdio-plain'])))
    } catch (err: any) {
      setError(err?.message || '检测本地 Agent 失败')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const configure = async (agent: LocalAgentStatus) => {
    const binary = (drafts[agent.agentId] || '').trim()
    if (!binary) return
    const protocol = protocolDrafts[agent.agentId] || 'stdio-plain'
    const args = (argDrafts[agent.agentId] || '').trim()
    setSaving(current => ({ ...current, [agent.agentId]: true }))
    try {
      const next = await window.electronAPI.localAgents.configure(agent.agentId, { binary, protocol, args })
      setAgents(next)
      setDrafts(Object.fromEntries(next.map(item => [item.agentId, item.binary || ''])))
      setArgDrafts(Object.fromEntries(next.map(item => [item.agentId, item.args || ''])))
      setProtocolDrafts(Object.fromEntries(next.map(item => [item.agentId, item.protocol === 'acp' ? 'acp' : 'stdio-plain'])))
    } catch (err: any) {
      setError(err?.message || '配置本地 Agent 失败')
    } finally {
      setSaving(current => ({ ...current, [agent.agentId]: false }))
    }
  }

  const usable = agents.filter(agent => agent.configured || agent.installed)
  const manual = agents.filter(agent => !agent.configured && !agent.installed)

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>本地引擎</strong>
          <span>只把检测到或已配置路径的 Agent 标记为可用。</span>
        </div>
        <button className="ah-btn sm primary" onClick={refresh} disabled={busy}>
          <Icon d={IC.refresh} size={13} /> {busy ? '检测中' : '重新检测'}
        </button>
      </div>
      {localModels.length > 0 && (
        <div className="glass wb-provider-card wb-local-model-card">
          <div className="wb-card-head">
            <div>
              <strong>本地模型配置</strong>
              <span>读取 Codex/Gemini 本机配置，仅用于识别认证与模型状态，不会写入配置文件。</span>
            </div>
          </div>
          <div className="wb-local-model-grid">
            {localModels.map(config => (
              <div key={config.agentId} className="wb-local-model-item">
                <strong>{config.agentId === 'codex' ? 'Codex' : 'Gemini'}</strong>
                <span>{localModelStatusLabel(config)} · {config.authMode || 'unknown'}</span>
                <small>{config.modelId || config.models?.[0]?.id || '未读取到模型'}</small>
                <code>{config.configPath}</code>
                {config.error && <em>{config.error}</em>}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="glass wb-error-text">{error}</div>}
      {usable.length === 0 && !busy && <EmptyState icon={IC.terminal} title="没有可用本地 Agent" detail="安装或登录 Codex、Claude、OpenCode 后重新检测。" />}
      {usable.map(agent => (
        <LocalAgentRow key={agent.agentId} agent={agent} draft={drafts[agent.agentId] || ''} busy={!!saving[agent.agentId]}
          setDraft={value => setDrafts(current => ({ ...current, [agent.agentId]: value }))}
          argsDraft={argDrafts[agent.agentId] || ''}
          setArgsDraft={value => setArgDrafts(current => ({ ...current, [agent.agentId]: value }))}
          protocolDraft={protocolDrafts[agent.agentId] || 'stdio-plain'}
          setProtocolDraft={value => setProtocolDrafts(current => ({ ...current, [agent.agentId]: value }))}
          onSave={() => configure(agent)}
        />
      ))}
      {manual.length > 0 && (
        <div className="glass wb-provider-card">
          <div className="wb-card-head">
            <div>
              <strong>手动配置</strong>
              <span>未检测到的 Agent 只有在填写可执行文件路径后才会出现在工作台。</span>
            </div>
          </div>
          <div className="wb-settings-stack tight">
            {manual.map(agent => (
              <LocalAgentRow key={agent.agentId} agent={agent} compact draft={drafts[agent.agentId] || ''} busy={!!saving[agent.agentId]}
                setDraft={value => setDrafts(current => ({ ...current, [agent.agentId]: value }))}
                argsDraft={argDrafts[agent.agentId] || ''}
                setArgsDraft={value => setArgDrafts(current => ({ ...current, [agent.agentId]: value }))}
                protocolDraft={protocolDrafts[agent.agentId] || 'stdio-plain'}
                setProtocolDraft={value => setProtocolDrafts(current => ({ ...current, [agent.agentId]: value }))}
                onSave={() => configure(agent)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LocalAgentRow({ agent, draft, argsDraft, protocolDraft, busy, setDraft, setArgsDraft, setProtocolDraft, onSave, compact = false }: {
  agent: LocalAgentStatus
  draft: string
  argsDraft: string
  protocolDraft: 'stdio-plain' | 'acp'
  busy: boolean
  setDraft: (value: string) => void
  setArgsDraft: (value: string) => void
  setProtocolDraft: (value: 'stdio-plain' | 'acp') => void
  onSave: () => void
  compact?: boolean
}) {
  const needsPromptArg = !!agent.manualOnly && !!agent.requiresPromptArg && protocolDraft !== 'acp'
  const canSave = !!draft.trim() && !busy && (!needsPromptArg || /\{prompt\}/i.test(argsDraft))
  const statusLabel = agent.configured ? '可使用' : agent.installed ? '已检测' : needsPromptArg ? '需要参数' : agent.candidateKind === 'desktop' ? '桌面候选' : '候选'
  return (
    <div className={compact ? 'wb-local-agent compact' : 'glass wb-local-agent'}>
      <div className="wb-local-agent-head">
        {AGENT_META[agent.agentId] ? <AgentMark id={agent.agentId} size={32} radius={9} /> : <span className="wb-agent-fallback">{agent.label.slice(0, 1)}</span>}
        <div>
          <strong>{agent.label}</strong>
          <span>{[agent.version, agent.protocol, agent.loginState !== 'unknown' ? agent.loginState : ''].filter(Boolean).join(' · ') || '等待检测'}</span>
        </div>
        <span className={agent.configured || agent.installed ? 'ah-chip mint' : 'ah-chip'}>{localAgentStatusLabel(agent, needsPromptArg)}</span>
      </div>
      <div className="wb-form-grid two">
        <select className="ah-select" value={draft} onChange={event => setDraft(event.target.value)}>
          <option value="">{agent.binary || '选择可执行文件路径'}</option>
          {draft && !agent.candidates.some(candidate => candidate.path === draft) && <option value={draft}>{draft}</option>}
          {agent.candidates.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.label} · {candidate.path}</option>)}
        </select>
        <input className="ah-input mono" placeholder="粘贴可执行文件路径" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onSave() }} />
      </div>
      {agent.manualOnly && (
        <div className="wb-form-grid two">
          <select className="ah-select" value={protocolDraft} onChange={event => setProtocolDraft(event.target.value as 'stdio-plain' | 'acp')}>
            <option value="stdio-plain">本地 CLI</option>
            <option value="acp">ACP</option>
          </select>
          <input
            className="ah-input mono"
            placeholder={agent.requiresPromptArg ? '非交互参数，需包含 {prompt}' : '参数可选；留空时通过 stdin 发送 prompt'}
            value={argsDraft}
            onChange={event => setArgsDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onSave() }}
          />
        </div>
      )}
      {agent.note && <div className="ah-hint">{agent.note}</div>}
      <div className="wb-card-actions">
        <button className="ah-btn sm primary" disabled={!canSave} onClick={onSave}>{busy ? '保存中' : '使用此路径'}</button>
      </div>
    </div>
  )
}

function localModelStatusLabel(config: LocalModelConfig): string {
  if (config.status === 'ok') return '已读取'
  if (config.status === 'partial') return '部分配置'
  if (config.status === 'missing') return '未找到配置'
  return '读取失败'
}

function localAgentStatusLabel(agent: LocalAgentStatus, needsPromptArg: boolean): string {
  if (agent.configured) return '可使用'
  if (agent.installed) return '已检测'
  if (needsPromptArg) return '需要参数'
  if (agent.candidateKind === 'desktop') return '桌面候选'
  if (agent.candidateKind === 'cli') return '检测到 CLI，待配置'
  return '候选'
}

function RoutingTab({ providers, bindings, fallbackChain, onSetBinding, onSetFallback, onTab }: {
  providers: ProviderDef[]
  bindings: BindingDef[]
  fallbackChain: string[]
  onSetBinding: (binding: BindingDef) => void
  onSetFallback: (chain: string[]) => void
  onTab: (tab: TabKey) => void
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
          <strong>Agent 路由</strong>
          <span>指定单个 Agent 时只走该 Agent 绑定；调度模式只在未指定 Agent 时展开。</span>
        </div>
        <button className="ah-btn sm" onClick={() => onTab('local-agents')}>管理本地 Agent</button>
      </div>
      {settingsBindingRows(bindings).map(binding => (
        <BindingRow key={binding.agentId} binding={binding} providers={providers} configuredProviders={configuredProviders}
          candidates={located[binding.agentId] || []} onChange={onSetBinding} />
      ))}
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>故障转移</strong>
            <span>主供应商失败且还没有输出内容时，按顺序尝试备用供应商。</span>
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
          {providers.filter(provider => provider.enabled && provider.apiKey).length === 0 && <span className="ah-hint">先配置可用供应商。</span>}
        </div>
      </div>
    </div>
  )
}

function BindingRow({ binding, providers, configuredProviders, candidates, onChange }: {
  binding: BindingDef
  providers: ProviderDef[]
  configuredProviders: ProviderDef[]
  candidates: BinaryCandidate[]
  onChange: (binding: BindingDef) => void
}) {
  const meta = AGENT_META[binding.agentId]
  const provider = providers.find(item => item.id === binding.providerId)
  const modelValue = provider && binding.modelId ? `${binding.providerId}/${binding.modelId}` : ''
  const protocol = binding.protocol || 'http'

  const patch = (changes: Partial<BindingDef>) => onChange({ ...binding, ...changes, thinking: { ...binding.thinking, ...(changes.thinking || {}) } })

  return (
    <div className="glass wb-binding-row">
      <div className="wb-local-agent-head">
        {meta ? <AgentMark id={binding.agentId} size={34} radius={9} /> : <span className="wb-agent-fallback">{binding.agentId.slice(0, 1)}</span>}
        <div>
          <strong>{meta?.name || binding.agentId}</strong>
          <span>{meta?.desc || '自定义 Agent'}</span>
        </div>
      </div>
      <div className="wb-form-grid three">
        <label className="wb-field">
          <span>后端</span>
          <select className="ah-select" value={protocol} onChange={event => patch({ protocol: event.target.value as BindingDef['protocol'] })}>
            <option value="http">HTTP 模型</option>
            <option value="stdio-plain">本地 CLI</option>
            <option value="acp">ACP</option>
          </select>
        </label>
        {protocol === 'http' ? (
          <label className="wb-field wide">
            <span>模型</span>
            <select className="ah-select" value={modelValue} onChange={event => {
              const [providerId, ...modelParts] = event.target.value.split('/')
              patch({ providerId, modelId: modelParts.join('/') })
            }}>
              {!modelValue && <option value="">选择模型</option>}
              {configuredProviders.map(item => (
                <optgroup key={item.id} label={item.name}>
                  {item.models.map(model => <option key={`${item.id}/${model.id}`} value={`${item.id}/${model.id}`}>{model.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="wb-field">
              <span>可执行文件</span>
              <select className="ah-select" value={binding.binary || ''} onChange={event => patch({ binary: event.target.value })}>
                <option value="">自动检测</option>
                {candidates.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.label} · {candidate.path}</option>)}
              </select>
            </label>
            <label className="wb-field wide">
              <span>参数</span>
              <input className="ah-input mono" value={binding.args || ''} placeholder={DEFAULT_STDIO_ARGS[binding.agentId] || '留空使用默认参数'} onChange={event => patch({ args: event.target.value })} />
            </label>
          </>
        )}
        <label className="wb-field">
          <span>温度</span>
          <input className="ah-input" type="number" min={0} max={2} step={0.1} value={binding.temperature ?? 0.3} onChange={event => patch({ temperature: Number(event.target.value) })} />
        </label>
      </div>
    </div>
  )
}

function settingsBindingRows(bindings: BindingDef[]): BindingDef[] {
  const byAgent = new Map(bindings.map(binding => [binding.agentId, binding]))
  const rows: BindingDef[] = []
  for (const agentId of AGENT_IDS) {
    rows.push(byAgent.get(agentId) || defaultCandidateBinding(agentId))
  }
  for (const binding of bindings) {
    if (!AGENT_IDS.includes(binding.agentId)) rows.push(binding)
  }
  return rows
}

function defaultCandidateBinding(agentId: string): BindingDef {
  return {
    agentId,
    providerId: '',
    modelId: 'local',
    protocol: 'stdio-plain',
    thinkingAllow: ['off', 'auto', 'enabled'],
    thinking: { mode: 'auto', level: 'medium', collapseInUI: true },
    temperature: 0.2,
    maxOutputTokens: 8192
  }
}

function ApprovalsTab() {
  const [config, setConfig] = useState<{ default: { write: ApprovalPolicy; exec: ApprovalPolicy }; overrides: Record<string, { write?: ApprovalPolicy; exec?: ApprovalPolicy }> } | null>(null)
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
      setError(err?.message || '加载权限策略失败')
    }
  }, [])

  useEffect(() => { load().catch(() => {}) }, [load])

  const setDefault = async (tool: 'write' | 'exec', policy: ApprovalPolicy) => {
    await window.electronAPI.agentic.setApprovalDefault(tool, policy)
    await load()
  }

  const setOverride = async (agentId: string, tool: 'write' | 'exec', value: string) => {
    await window.electronAPI.agentic.setApprovalOverride(agentId, tool, value === 'default' ? null : value as ApprovalPolicy)
    await load()
  }

  if (!config) return <EmptyState icon={IC.check} title="正在加载权限策略" detail={error || '请稍候。'} />

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>默认策略</strong>
            <span>读取文件不会拦截；写入和执行可按需确认。</span>
          </div>
        </div>
        <div className="wb-form-grid two">
          <PolicySelect label="写文件" value={config.default.write} onChange={value => setDefault('write', value)} />
          <PolicySelect label="执行命令" value={config.default.exec} onChange={value => setDefault('exec', value)} />
        </div>
      </div>
      <div className="glass wb-table-card">
        <div className="wb-table-row head"><span>Agent</span><span>写文件</span><span>执行命令</span></div>
        {caps.map(agent => {
          const override = config.overrides[agent.agentId] || {}
          return (
            <div key={agent.agentId} className="wb-table-row">
              <span>{AGENT_META[agent.agentId]?.name || agent.name || agent.agentId}</span>
              <select value={override.write || 'default'} onChange={event => setOverride(agent.agentId, 'write', event.target.value)}>
                <option value="default">默认</option><option value="allow">允许</option><option value="ask">询问</option><option value="deny">拒绝</option>
              </select>
              <select value={override.exec || 'default'} onChange={event => setOverride(agent.agentId, 'exec', event.target.value)}>
                <option value="default">默认</option><option value="allow">允许</option><option value="ask">询问</option><option value="deny">拒绝</option>
              </select>
            </div>
          )
        })}
      </div>
      {error && <div className="glass wb-error-text">{error}</div>}
    </div>
  )
}

function PolicySelect({ label, value, onChange }: { label: string; value: ApprovalPolicy; onChange: (value: ApprovalPolicy) => void }) {
  return (
    <label className="wb-field">
      <span>{label}</span>
      <select className="ah-select" value={value} onChange={event => onChange(event.target.value as ApprovalPolicy)}>
        <option value="allow">允许</option>
        <option value="ask">询问</option>
        <option value="deny">拒绝</option>
      </select>
    </label>
  )
}

function WorkspacesTab() {
  const [items, setItems] = useState<Array<{ id: string; name: string; rootPath: string }>>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id?: string; name: string; rootPath: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.electronAPI.workspaces.list(),
      window.electronAPI.workspaces.getActive()
    ])
    setItems(list)
    setActiveId(active)
  }, [])

  useEffect(() => { refresh().catch((err: any) => setError(err?.message || '加载工作目录失败')) }, [refresh])

  const save = async () => {
    if (!editing?.name.trim() || !editing.rootPath.trim()) return
    try {
      if (editing.id) await window.electronAPI.workspaces.update(editing.id, { name: editing.name.trim(), rootPath: editing.rootPath.trim() })
      else await window.electronAPI.workspaces.create({ name: editing.name.trim(), rootPath: editing.rootPath.trim() })
      setEditing(null)
      await refresh()
    } catch (err: any) {
      setError(err?.message || '保存工作目录失败')
    }
  }

  const pickFolder = async () => {
    const path = await window.electronAPI.app.pickFolder()
    if (path) setEditing(current => ({ id: current?.id, name: current?.name || path.split(/[\\/]/).filter(Boolean).pop() || '工作目录', rootPath: path }))
  }

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>工作目录是可选上下文</strong>
          <span>普通对话和写作不需要目录；终端、Git、工作树和项目文件操作才需要。</span>
        </div>
        <button className="ah-btn sm primary" onClick={() => setEditing({ name: '', rootPath: '' })}>
          <Icon d={IC.plus} size={13} /> 添加工作目录
        </button>
      </div>
      {editing && (
        <div className="glass wb-provider-card">
          <div className="wb-card-head"><strong>{editing.id ? '编辑工作目录' : '添加工作目录'}</strong></div>
          <div className="wb-form-grid two">
            <input className="ah-input" placeholder="给这个目录起个名字" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
            <div className="wb-folder-picker">
              <input className="ah-input mono" placeholder="选择本地目录" value={editing.rootPath} onChange={event => setEditing({ ...editing, rootPath: event.target.value })} />
              <button className="ah-btn sm" onClick={pickFolder}>选择</button>
            </div>
          </div>
          <div className="wb-card-actions">
            <button className="ah-btn sm" onClick={() => setEditing(null)}>取消</button>
            <button className="ah-btn sm primary" onClick={save}>保存</button>
          </div>
        </div>
      )}
      {items.length === 0 && <EmptyState icon={IC.folder} title="还没有工作目录" detail="可以直接新建对话；需要本地文件能力时再添加目录。" />}
      {items.map(item => (
        <div key={item.id} className="glass wb-workspace-row">
          <div>
            <strong>{item.name}</strong>
            {activeId === item.id && <span className="ah-chip mint">当前</span>}
            <p>{item.rootPath}</p>
          </div>
          <div className="wb-card-actions">
            {activeId !== item.id && <button className="ah-btn sm" onClick={async () => { await window.electronAPI.workspaces.setActive(item.id); await refresh() }}>设为当前</button>}
            <button className="ah-btn sm" onClick={() => setEditing({ id: item.id, name: item.name, rootPath: item.rootPath })}>编辑</button>
            <button className="ah-btn sm danger" onClick={async () => {
              if (!window.confirm(`移除工作目录「${item.name}」？磁盘文件不会被删除。`)) return
              await window.electronAPI.workspaces.remove(item.id)
              await refresh()
            }}>移除</button>
          </div>
        </div>
      ))}
      {error && <div className="glass wb-error-text">{error}</div>}
    </div>
  )
}

function McpSettingsTab({ workspaceId }: { workspaceId: string | null }) {
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', transport: 'stdio' as McpServerConfig['transport'], command: '', args: '', url: '' })

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setServers(await window.electronAPI.mcp.list(workspaceId))
      setError(null)
    } catch (err: any) {
      setError(err?.message || '加载 MCP 失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const add = async () => {
    if (!draft.name.trim()) return
    await window.electronAPI.mcp.upsert({
      name: draft.name.trim(),
      transport: draft.transport,
      command: draft.transport === 'stdio' ? draft.command.trim() : undefined,
      args: draft.args.split(/\s+/).map(item => item.trim()).filter(Boolean),
      url: draft.transport !== 'stdio' ? draft.url.trim() : undefined,
      enabled: true
    })
    setDraft({ name: '', transport: 'stdio', command: '', args: '', url: '' })
    await refresh()
  }

  const scan = async () => {
    setLoading(true)
    try {
      setServers(await window.electronAPI.mcp.scanLocal(workspaceId))
    } catch (err: any) {
      setError(err?.message || '扫描 MCP 失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-inline-panel">
        <div>
          <strong>MCP 服务</strong>
          <span>读取全局、工作目录和 Kun/ECC 风格配置，启用后同步给支持 ACP 的 Agent。</span>
        </div>
        <div className="wb-card-actions">
          <button className="ah-btn sm" onClick={scan} disabled={loading}>扫描本地</button>
          <button className="ah-btn sm" onClick={refresh} disabled={loading}>刷新</button>
        </div>
      </div>

      <div className="glass wb-mcp-editor">
        <input className="ah-input" placeholder="服务名称" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
        <select className="ah-select" value={draft.transport} onChange={event => setDraft({ ...draft, transport: event.target.value as McpServerConfig['transport'] })}>
          <option value="stdio">stdio</option>
          <option value="sse">sse</option>
          <option value="http">http</option>
        </select>
        {draft.transport === 'stdio' ? (
          <>
            <input className="ah-input mono" placeholder="启动命令" value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} />
            <input className="ah-input mono" placeholder="参数" value={draft.args} onChange={event => setDraft({ ...draft, args: event.target.value })} />
          </>
        ) : (
          <input className="ah-input mono wide" placeholder="服务 URL" value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} />
        )}
        <button className="ah-btn sm primary" onClick={add}>添加</button>
      </div>

      <div className="glass wb-table-card wb-mcp-table">
        <div className="wb-table-row head"><span>名称</span><span>来源</span><span>命令 / URL</span><span>状态</span><span>启用</span><span>操作</span></div>
        {servers.map(server => (
          <div key={server.id} className="wb-table-row">
            <span>{server.name}</span>
            <span>{server.source}</span>
            <span className="mono">{server.transport === 'stdio' ? [server.command, ...(server.args || [])].filter(Boolean).join(' ') : server.url}</span>
            <span>{server.status || 'unknown'}</span>
            <Switch on={server.enabled} onChange={async value => { await window.electronAPI.mcp.setEnabled(server.id, value); await refresh() }} />
            <span className="wb-card-actions">
              <button className="ah-btn sm" onClick={async () => { await window.electronAPI.mcp.test(server.id, workspaceId); await refresh() }}>测试</button>
              {server.source === 'user' && <button className="ah-btn sm danger" onClick={async () => { if (!window.confirm(`删除 MCP 服务「${server.name}」？`)) return; await window.electronAPI.mcp.remove(server.id); await refresh() }}>删除</button>}
            </span>
          </div>
        ))}
        {servers.length === 0 && <div className="wb-empty-row">暂无 MCP 服务。</div>}
      </div>
      {error && <div className="glass wb-error-text">{error}</div>}
    </div>
  )
}

function UsageStatsTab() {
  const [range, setRange] = useState<UsageRange>('all')
  const [view, setView] = useState<UsageView>('overview')
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<UsageHeatmapDay | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    window.electronAPI.usage.stats(range, view)
      .then(result => {
        if (!alive) return
        setStats(result)
        const nextSelected = result.heatmap.find(day => day.selected) || result.heatmap.find(day => day.turns > 0 || day.tokens > 0) || result.heatmap.at(-1) || null
        setSelectedDay(nextSelected)
      })
      .catch((err: any) => {
        if (!alive) return
        setStats(null)
        setSelectedDay(null)
        setError(err?.message || '加载使用统计失败')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range, view])

  const cards = useMemo(() => {
    if (!stats) return []
    return [
      ['会话', String(stats.sessions)],
      ['消息', String(stats.messages)],
      ['总 Token', formatUsageTokens(stats.totalTokens, stats.hasEstimated)],
      ['活跃天数', String(stats.activeDays)],
      ['当前连续', `${stats.currentStreak} 天`],
      ['最长连续', `${stats.longestStreak} 天`],
      ['费用', stats.cost == null ? '-' : `$${stats.cost.toFixed(2)}`],
      ['缓存节省', stats.cacheSavings == null ? '-' : formatToken(stats.cacheSavings)]
    ]
  }, [stats])

  const selectedStats = selectedDay
    ? {
        date: selectedDay.date,
        turns: selectedDay.turns,
        tokens: selectedDay.tokens,
        actualTokens: selectedDay.actualTokens,
        estimatedTokens: selectedDay.estimatedTokens,
        hasEstimated: selectedDay.hasEstimated,
        rate: stats?.heatmap.find(day => day.date === selectedDay.date)?.level || 0
      }
    : null

  return (
    <div className="wb-usage-shell">
      <div className="wb-usage-top">
        <Seg value={view} onChange={value => setView(value as UsageView)} options={[{ value: 'overview', label: '概览' }, { value: 'models', label: '模型' }]} />
        <Seg value={range} onChange={value => setRange(value as UsageRange)} options={[{ value: 'all', label: '全部' }, { value: '90d', label: '90天' }, { value: '30d', label: '30天' }, { value: '7d', label: '7天' }]} />
      </div>
      {loading && <div className="wb-usage-state">加载中…</div>}
      {error && <div className="wb-usage-state error">{error}</div>}
      {!loading && !error && stats && (
        <>
          <div className="wb-usage-cards">
            {cards.map(([label, value]) => <button key={label} type="button" className="wb-usage-card"><span>{label}</span><strong>{value}</strong></button>)}
          </div>
          <div className="wb-usage-body">
            <div className="wb-usage-chart">
              {view === 'models' ? (
                stats.models.length ? (
                  <div className="wb-usage-models">
                    {stats.models.map(row => <button key={`${row.agentId}:${row.modelId}`} type="button" className="wb-usage-model-row"><span>{row.agentId || 'agent'} / {row.modelId}</span><strong>{formatToken(row.tokens)}</strong><small>{row.turns} 次</small></button>)}
                  </div>
                ) : (
                  <div className="wb-usage-empty">暂无模型用量数据。</div>
                )
              ) : (
                <div className="wb-usage-heatmap">
                  {stats.heatmap.map(day => (
                    <button
                      key={day.date}
                      type="button"
                      className={`wb-usage-day level-${day.level}${day.selected || selectedDay?.date === day.date ? ' selected' : ''}`}
                      title={`${day.date} / ${day.turns} 消息 / ${formatToken(day.tokens)}`}
                      onClick={() => setSelectedDay(day)}
                    />
                  ))}
                </div>
              )}
            </div>
            <aside className="wb-usage-detail">
              <strong>{selectedStats?.date || '—'}</strong>
              <span>{selectedStats ? `${selectedStats.turns} 条记录` : '选择一天查看详情'}</span>
              <small>{selectedStats ? `${formatToken(selectedStats.tokens)} · 等级 ${selectedStats.rate}` : ' '}</small>
              <div className="wb-usage-mini-metrics">
                <div><span>Token</span><strong>{formatToken(stats.totalTokens)}</strong></div>
                <div><span>活跃</span><strong>{stats.activeDays}</strong></div>
                <div><span>连续</span><strong>{stats.currentStreak}</strong></div>
              </div>
            </aside>
          </div>
          <div className="wb-usage-foot">最近共使用 {formatToken(stats.totalTokens)}，活跃 {stats.activeDays} 天。</div>
        </>
      )}
    </div>
  )
}

void UsageStatsTab

function UsageStatsTabV2() {
  const [range, setRange] = useState<UsageRange>('all')
  const [view, setView] = useState<UsageView>('overview')
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<UsageHeatmapDay | null>(null)
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    window.electronAPI.usage.stats(range, view)
      .then(result => {
        if (!alive) return
        setStats(result)
        const nextSelected = result.heatmap.find(day => day.selected)
          || result.heatmap.find(day => day.turns > 0 || day.tokens > 0)
          || result.heatmap.at(-1)
          || null
        setSelectedDay(nextSelected)
      })
      .catch((err: any) => {
        if (!alive) return
        setStats(null)
        setSelectedDay(null)
        setError(err?.message || '加载使用统计失败')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range, view])

  useEffect(() => {
    if (!stats?.models.length) {
      setSelectedModelKey(null)
      return
    }
    if (!stats.models.some(row => usageModelKey(row) === selectedModelKey)) {
      setSelectedModelKey(usageModelKey(stats.models[0]))
    }
  }, [stats, selectedModelKey])

  const cards = useMemo(() => {
    if (!stats) return []
    return [
      ['会话', String(stats.sessions)],
      ['消息', String(stats.messages)],
      ['总 Token', formatUsageTokens(stats.totalTokens, stats.hasEstimated)],
      ['活跃天数', String(stats.activeDays)],
      ['当前连续', `${stats.currentStreak} 天`],
      ['最长连续', `${stats.longestStreak} 天`],
      ['费用', stats.cost == null ? '-' : `$${stats.cost.toFixed(2)}`],
      ['缓存节省', stats.cacheSavings == null ? '-' : formatToken(stats.cacheSavings)]
    ]
  }, [stats])

  const selectedStats = selectedDay
    ? {
        date: selectedDay.date,
        turns: selectedDay.turns,
        tokens: selectedDay.tokens,
        actualTokens: selectedDay.actualTokens,
        estimatedTokens: selectedDay.estimatedTokens,
        hasEstimated: selectedDay.hasEstimated,
        rate: stats?.heatmap.find(day => day.date === selectedDay.date)?.level || 0
      }
    : null
  const selectedModel = stats?.models.find(row => usageModelKey(row) === selectedModelKey) || null

  return (
    <div className="wb-usage-shell">
      <div className="wb-usage-top">
        <Seg value={view} onChange={value => setView(value as UsageView)} options={[{ value: 'overview', label: '概览' }, { value: 'models', label: '模型' }]} />
        <Seg value={range} onChange={value => setRange(value as UsageRange)} options={[{ value: 'all', label: '全部' }, { value: '90d', label: '90天' }, { value: '30d', label: '30天' }, { value: '7d', label: '7天' }]} />
      </div>
      {loading && <div className="wb-usage-state">加载中…</div>}
      {error && <div className="wb-usage-state error">{error}</div>}
      {!loading && !error && stats && (
        <>
          <div className="wb-usage-cards">
            {cards.map(([label, value]) => (
              <button key={label} type="button" className="wb-usage-card" onClick={() => setView(label.includes('Token') ? 'models' : 'overview')}>
                <span>{label}</span>
                <strong>{value}</strong>
              </button>
            ))}
          </div>
          <div className="wb-usage-body">
            <div className="wb-usage-chart">
              {view === 'models' ? (
                stats.models.length ? (
                  <div className="wb-usage-models">
                    {stats.models.map(row => {
                      const key = usageModelKey(row)
                      return (
                        <button key={key} type="button" className={'wb-usage-model-row' + (selectedModelKey === key ? ' selected' : '')} onClick={() => setSelectedModelKey(key)}>
                          <span>{row.agentId || 'Agent'} / {row.modelId}</span>
                          <strong>{formatUsageTokens(row.tokens, row.hasEstimated)}</strong>
                          <small>{row.turns} 次{row.hasEstimated ? ` · 含估算 ${formatToken(row.estimatedTokens)}` : ''}</small>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="wb-usage-empty">暂无模型用量数据。</div>
                )
              ) : (
                <div className="wb-usage-heatmap">
                  {stats.heatmap.map(day => (
                    <button
                      key={day.date}
                      type="button"
                      className={`wb-usage-day level-${day.level}${day.selected || selectedDay?.date === day.date ? ' selected' : ''}`}
                      title={`${day.date} / ${day.turns} 条 / ${formatUsageTokens(day.tokens, day.hasEstimated)}`}
                      onClick={() => setSelectedDay(day)}
                    />
                  ))}
                </div>
              )}
            </div>
            <aside className="wb-usage-detail">
              <strong>{view === 'models' ? (selectedModel?.modelId || '未选择模型') : (selectedStats?.date || '未选择日期')}</strong>
              <span>
                {view === 'models'
                  ? (selectedModel ? `${selectedModel.turns} 次调用` : '选择一个模型查看详情')
                  : (selectedStats ? `${selectedStats.turns} 条记录` : '选择一天查看详情')}
              </span>
              <small>
                {view === 'models'
                  ? (selectedModel ? `${selectedModel.agentId || 'Agent'} · ${formatUsageTokens(selectedModel.tokens, selectedModel.hasEstimated)}` : ' ')
                  : (selectedStats ? `${formatUsageTokens(selectedStats.tokens, selectedStats.hasEstimated)} · 等级 ${selectedStats.rate}` : ' ')}
              </small>
              {(view === 'models' ? selectedModel?.hasEstimated : selectedStats?.hasEstimated) && (
                <small>
                  真实 {formatToken(view === 'models' ? selectedModel?.actualTokens || 0 : selectedStats?.actualTokens || 0)}
                  {' · '}
                  估算 {formatToken(view === 'models' ? selectedModel?.estimatedTokens || 0 : selectedStats?.estimatedTokens || 0)}
                </small>
              )}
              <div className="wb-usage-mini-metrics">
                <div><span>Token</span><strong>{formatUsageTokens(stats.totalTokens, stats.hasEstimated)}</strong></div>
                <div><span>活跃</span><strong>{stats.activeDays}</strong></div>
                <div><span>连续</span><strong>{stats.currentStreak}</strong></div>
              </div>
            </aside>
          </div>
          <div className="wb-usage-foot">
            当前范围共使用 {formatUsageTokens(stats.totalTokens, stats.hasEstimated)}，活跃 {stats.activeDays} 天。
            {stats.hasEstimated && <> 其中真实 {formatToken(stats.actualTokens)}，估算 {formatToken(stats.estimatedTokens)}。</>}
          </div>
        </>
      )}
    </div>
  )
}

function usageModelKey(row: UsageModelRow): string {
  return `${row.agentId || 'agent'}:${row.modelId}`
}

function UpdatesSettingsTab() {
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

  const setChannel = async (channel: UpdateStatus['channel']) => {
    setStatus(await window.electronAPI.updates.setChannel(channel))
  }

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  return (
    <div className="wb-settings-stack">
      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>版本与更新</strong>
            <span>检查当前版本、渠道和下载页。</span>
          </div>
          <Seg value={status?.channel || 'stable'} onChange={value => setChannel(value as UpdateStatus['channel'])} options={[{ value: 'stable', label: '稳定版' }, { value: 'preview', label: '预览版' }]} />
        </div>
        <div className="wb-tool-summary-grid">
          <div><strong>{status?.version || '-'}</strong><span>当前版本</span></div>
          <div><strong>{status?.latestVersion || '-'}</strong><span>最新版本</span></div>
          <div><strong>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : '-'}</strong><span>检查时间</span></div>
        </div>
        {status?.error && <div className="wb-error-text">{status.error}</div>}
        <div className="wb-card-actions">
          <button className="ah-btn sm primary" onClick={check} disabled={loading}>{loading ? '检查中' : '检查更新'}</button>
          <button className="ah-btn sm" onClick={() => window.electronAPI.updates.openDownload()}>打开下载页</button>
          <button className="ah-btn sm" onClick={refresh} disabled={loading}>刷新状态</button>
        </div>
      </div>
    </div>
  )
}

function AppearanceTab({ motion, setMotion }: { motion: MotionLevel; setMotion: (motion: MotionLevel) => void }) {
  const [prefs, setPrefs] = useState<AppearancePreferences>(() => normalizeAppearance({ ...readAppearanceLocal(), motion, language: getLang() }))
  const [runTimeoutMinutes, setRunTimeoutMinutes] = useState(10)

  useEffect(() => {
    setPrefs(current => {
      if (current.motion === motion) return current
      return { ...current, motion }
    })
  }, [motion])

  useEffect(() => {
    let alive = true
    window.electronAPI.settings.getRunTimeout()
      .then(result => { if (alive) setRunTimeoutMinutes(Math.round(result.value / 60000)) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const update = useCallback((patch: Partial<AppearancePreferences>) => {
    setPrefs(current => {
      const next = normalizeAppearance({ ...current, ...patch })
      applyAppearance(next)
      if (patch.motion) setMotion(next.motion)
      if (patch.language) setLang(next.language as Lang)
      void saveAppearance(next)
      return next
    })
  }, [setMotion])

  const reset = () => update(DEFAULT_APPEARANCE)

  return (
    <div className="wb-settings-stack wb-appearance">
      <div className="glass wb-appearance-hero">
        <div className="wb-appearance-preview" aria-hidden="true">
          <div className="wb-appearance-preview-bar">
            <span />
            <span />
            <span />
          </div>
          <div className="wb-appearance-preview-body">
            <aside>
              <b />
              <i />
              <i />
            </aside>
            <main>
              <strong>AgentHub</strong>
              <p>主题和字体会立即应用到工作台。</p>
              <code>+ preview.diff</code>
            </main>
          </div>
        </div>
        <div>
          <strong>外观</strong>
          <span>调整主题、字体、动效和编辑体验。设置会自动保存。</span>
        </div>
        <button className="ah-btn sm" onClick={reset}>恢复默认</button>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>主题</strong>
            <span>可跟随系统，也可以固定为浅色或深色。</span>
          </div>
        </div>
        <div className="wb-appearance-row">
          <div><strong>主题模式</strong><span>选择工作台整体明暗风格。</span></div>
          <Seg value={prefs.themeMode} onChange={value => update(themeModePatch(value as AppearancePreferences['themeMode']))} options={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
            { value: 'system', label: '系统' }
          ]} />
        </div>
        <div className="wb-appearance-theme-grid">
          <ThemePresetCard active={prefs.themeMode === 'light'} title="AgentHub Light" detail="明亮桌面工作台" colors={['#f7f8fb', '#ffffff', prefs.accentColor]} onClick={() => update({ themeMode: 'light', backgroundColor: '#f7f8fb', foregroundColor: '#20242c' })} />
          <ThemePresetCard active={prefs.themeMode === 'dark'} title="AgentHub Dark" detail="低亮度专注模式" colors={['#10141c', '#161b24', prefs.accentColor]} onClick={() => update({ themeMode: 'dark', backgroundColor: '#10141c', foregroundColor: '#e7edf7' })} />
        </div>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>颜色</strong>
            <span>保留简洁风格，只调整核心色值。</span>
          </div>
        </div>
        <div className="wb-appearance-grid three">
          <ColorField label="强调色" value={prefs.accentColor} onChange={value => update({ accentColor: value })} />
          <ColorField label="背景色" value={prefs.backgroundColor} onChange={value => update({ backgroundColor: value })} />
          <ColorField label="前景色" value={prefs.foregroundColor} onChange={value => update({ foregroundColor: value })} />
        </div>
        <RangeRow label="对比度" detail="增强或降低界面边界与文字层级。" value={prefs.contrast} min={80} max={125} suffix="%" onChange={value => update({ contrast: value })} />
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>字体</strong>
            <span>UI 字体作用于界面，代码字体作用于终端、Diff 和代码块。</span>
          </div>
        </div>
        <div className="wb-appearance-grid two">
          <label className="wb-field">
            <span>UI 字体</span>
            <input className="ah-input" value={prefs.uiFont} onChange={event => update({ uiFont: event.target.value })} />
          </label>
          <label className="wb-field">
            <span>代码字体</span>
            <input className="ah-input mono" value={prefs.codeFont} onChange={event => update({ codeFont: event.target.value })} />
          </label>
        </div>
        <div className="wb-appearance-grid two">
          <StepperRow label="UI 字号" value={prefs.uiFontSize} min={12} max={18} onChange={value => update({ uiFontSize: value })} />
          <StepperRow label="代码字号" value={prefs.codeFontSize} min={11} max={18} onChange={value => update({ codeFontSize: value })} />
        </div>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>交互</strong>
            <span>控制侧栏、光标、动效和 Diff 标记的呈现。</span>
          </div>
        </div>
        <PreferenceRow title="半透明侧栏" detail="让左侧栏轻微透出桌面背景。">
          <Switch on={prefs.translucentSidebar} onChange={value => update({ translucentSidebar: value })} />
        </PreferenceRow>
        <PreferenceRow title="按钮使用指针光标" detail="关闭后按钮不再强制显示手型光标。">
          <Switch on={prefs.usePointerCursor} onChange={value => update({ usePointerCursor: value })} />
        </PreferenceRow>
        <PreferenceRow title="动效强度" detail="影响弹层、面板和列表的过渡动画。">
          <Seg value={prefs.motion} onChange={value => update({ motion: value as MotionLevel })} options={[
            { value: 'off', label: '关闭' },
            { value: 'subtle', label: '简洁' },
            { value: 'rich', label: '丰富' }
          ]} />
        </PreferenceRow>
        <PreferenceRow title="Agent 运行超时" detail="单个 Agent 超过该时长会自动停止，并标记为超时失败。">
          <div className="wb-timeout-control">
            <input
              type="range"
              min={1}
              max={60}
              value={runTimeoutMinutes}
              onChange={event => {
                const next = Number(event.target.value)
                setRunTimeoutMinutes(next)
                window.electronAPI.settings.setRunTimeout(next * 60000)
                  .then(result => setRunTimeoutMinutes(Math.round(result.value / 60000)))
                  .catch(() => {})
              }}
            />
            <span>{runTimeoutMinutes} 分钟</span>
          </div>
        </PreferenceRow>
        <PreferenceRow title="Diff 标记" detail="选择只用颜色，或同时显示 +/- 标记。">
          <Seg value={prefs.diffMarker} onChange={value => update({ diffMarker: value as DiffMarkerStyle })} options={[
            { value: 'color', label: '颜色' },
            { value: 'sign', label: '+/-' }
          ]} />
        </PreferenceRow>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>通用偏好</strong>
            <span>这些选项会保存到本机设置；已有运行时支持的项目会直接生效。</span>
          </div>
        </div>
        <PreferenceRow title="默认打开目标" detail="应用启动后优先进入的区域。">
          <select className="ah-select" value={prefs.defaultOpenTarget} onChange={event => update({ defaultOpenTarget: event.target.value as DefaultOpenTarget })}>
            <option value="chat">新对话</option>
            <option value="last">上次位置</option>
            <option value="settings">设置</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title="Agent 环境" detail="控制后续 Agent 进程继承环境的偏好。">
          <select className="ah-select" value={prefs.agentEnvironment} onChange={event => update({ agentEnvironment: event.target.value as AgentEnvironment })}>
            <option value="inherit">继承当前环境</option>
            <option value="clean">干净环境</option>
            <option value="login-shell">登录 Shell</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title="集成终端 Shell" detail="/terminal 会使用这个 Shell 执行命令。">
          <select className="ah-select" value={prefs.terminalShell} onChange={event => update({ terminalShell: event.target.value as TerminalShell })}>
            <option value="system">系统默认</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">Cmd</option>
            <option value="git-bash">Git Bash</option>
            <option value="wsl">WSL</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title="界面语言" detail="切换后立即生效。">
          <Seg value={prefs.language} onChange={value => update({ language: value as AppearancePreferences['language'] })} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
        </PreferenceRow>
      </div>
    </div>
  )
}

function ThemePresetCard({ active, title, detail, colors, onClick }: { active: boolean; title: string; detail: string; colors: string[]; onClick: () => void }) {
  return (
    <button type="button" className={'wb-theme-card' + (active ? ' active' : '')} onClick={onClick}>
      <div className="wb-theme-swatches">{colors.map(color => <span key={color} style={{ background: color }} />)}</div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  )
}

function themeModePatch(themeMode: AppearancePreferences['themeMode']): Partial<AppearancePreferences> {
  if (themeMode === 'light') return { themeMode, backgroundColor: '#f7f8fb', foregroundColor: '#20242c' }
  if (themeMode === 'dark') return { themeMode, backgroundColor: '#10141c', foregroundColor: '#e7edf7' }
  return { themeMode }
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="wb-field wb-color-field">
      <span>{label}</span>
      <div>
        <input type="color" value={value} onChange={event => onChange(event.target.value)} />
        <input className="ah-input mono" value={value} onChange={event => onChange(event.target.value)} />
      </div>
    </label>
  )
}

function PreferenceRow({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="wb-appearance-row">
      <div><strong>{title}</strong><span>{detail}</span></div>
      {children}
    </div>
  )
}

function StepperRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="wb-appearance-stepper">
      <span>{label}</span>
      <div>
        <button className="ah-btn sm" disabled={value <= min} onClick={() => onChange(value - 1)}>-</button>
        <strong>{value}px</strong>
        <button className="ah-btn sm" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  )
}

function RangeRow({ label, detail, value, min, max, suffix, onChange }: { label: string; detail: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <div className="wb-appearance-row">
      <div><strong>{label}</strong><span>{detail}</span></div>
      <label className="wb-appearance-range">
        <input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} />
        <span>{value}{suffix}</span>
      </label>
    </div>
  )
}

function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="glass wb-empty-state">
      <Icon d={icon} size={28} sw={1.4} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function formatToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k tokens`
  return `${value} tokens`
}

function formatUsageTokens(value: number, hasEstimated?: boolean): string {
  return `${hasEstimated ? '约 ' : ''}${formatToken(value)}${hasEstimated ? '（含估算）' : ''}`
}
