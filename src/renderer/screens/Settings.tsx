import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, IC, AgentMark, Seg, Switch } from '../glass/ui'
import { AGENT_META, BindingDef, DEFAULT_STDIO_ARGS, ProviderDef } from '../glass/meta'
import { getLang, setLang, Lang, tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'
import { ProvidersTab } from './ProvidersTab'
import { RoutingTab } from './RoutingTab'
import { ApprovalsTab } from './ApprovalsTab'
import { WorkspacesTab } from './WorkspacesTab'
import { McpSettingsTab } from './McpSettingsTab'
import { ShortcutsSettingsTab } from './ShortcutsSettingsTab'
import { AgentLoopSettingsTab } from './AgentLoopSettingsTab'
import { RequirementsTab } from './RequirementsTab'
import { ConnectionSummary, SetupTab } from '../glass/connection-status'
// Phase 4 lazy loading: SkillsTab loaded on demand
const SkillsTab = React.lazy(() => import('./Skills').then(m => ({ default: m.SkillsTab })))
import {
  AppearancePreferences,
  DEFAULT_APPEARANCE,
  DefaultDialogLocation,
  DiffMarkerStyle,
  AgentEnvironment,
  DefaultOpenTarget,
  StartupOpenTarget,
  TerminalShell,
  applyAppearance,
  defaultDialogPath,
  normalizeAppearance,
  readAppearanceLocal,
  rememberDialogPath,
  saveAppearance
} from '../appearance'
// keyboard-shortcuts imports moved to ShortcutsSettingsTab
// Phase 4 lazy loading: UsageStatsDashboard loaded on demand
const UsageStatsTabFull = React.lazy(() => import('./UsageStatsDashboard').then(m => ({ default: m.UsageStatsDashboard })))

export type MotionLevel = 'off' | 'subtle' | 'rich'

type TabKey = SetupTab | 'appearance' | 'memory' | 'updates' | 'shortcuts' | 'models' | 'plugins' | 'usage' | 'agentLoop' | 'requirements' | 'diagnostics'
const MEMORY_CATEGORIES: MemoryCategory[] = ['preference', 'project', 'style', 'decision', 'correction', 'imported_conversation', 'conversation', 'task', 'skill', 'file', 'system']
const MEMORY_SCOPES = ['all', 'user', 'workspace', 'project', 'deleted'] as const
type MemoryScopeFilter = typeof MEMORY_SCOPES[number]

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
  onReorderProvidersForClaude: (orderedIds: string[]) => void
  motion: MotionLevel
  setMotion: (motion: MotionLevel) => void
  initialTab: TabKey
  workspaceId?: string | null
  connectionSummary: ConnectionSummary
  goChat: (agentId: string | null) => void
  openSetup: (tab?: TabKey) => void
  onLocalAgentsChanged?: (agents: LocalAgentStatus[]) => void
}

const NAV_ITEMS: Array<{ value: TabKey; label: string; labelEn: string; description: string; descriptionEn: string; icon: React.ReactNode }> = [
  { value: 'appearance', label: '外观', labelEn: 'Appearance', description: '主题、字体、动效和界面显示偏好。', descriptionEn: 'Theme, fonts, motion, and display preferences.', icon: IC.gear },
  { value: 'providers', label: '供应商', labelEn: 'Providers', description: '管理 API 供应商、Key 和模型列表。', descriptionEn: 'Manage API providers, keys, and model lists.', icon: IC.pulse },
  { value: 'local-agents', label: '本地 Agent', labelEn: 'Local Agents', description: '检测并配置本机可用的 Agent 入口。', descriptionEn: 'Detect and configure local Agent entries.', icon: IC.terminal },
  { value: 'routing', label: '路由', labelEn: 'Routing', description: '设置 Agent 使用的模型、CLI 或 ACP 绑定。', descriptionEn: 'Configure model, CLI, or ACP bindings for Agents.', icon: IC.broadcast },
  { value: 'approvals', label: '权限', labelEn: 'Approvals', description: '控制命令、文件和工具调用的审批策略。', descriptionEn: 'Control approval policies for commands, files, and tools.', icon: IC.check },
  { value: 'workspaces', label: '工作目录', labelEn: 'Workspaces', description: '管理绑定到会话的本地目录。', descriptionEn: 'Manage local folders bound to sessions.', icon: IC.folder },
  { value: 'skills', label: '技能', labelEn: 'Skills', description: '导入和管理本地 Agent 技能。', descriptionEn: 'Import and manage local Agent skills.', icon: IC.bolt },
  { value: 'mcp', label: 'MCP', labelEn: 'MCP', description: '管理本地和工作目录 MCP 服务。', descriptionEn: 'Manage local and workspace MCP services.', icon: IC.link },
  { value: 'plugins', label: '插件', labelEn: 'Plugins', description: '扫描和管理本地插件。', descriptionEn: 'Scan and manage local plugins.', icon: IC.bolt },
  { value: 'usage', label: '用量统计', labelEn: 'Usage', description: '查看 API 用量、Token 消耗和成本统计。', descriptionEn: 'View API usage, token consumption and cost statistics.', icon: IC.pulse },
  { value: 'updates', label: '版本与更新', labelEn: 'Version & Updates', description: '检查当前版本、渠道和下载入口。', descriptionEn: 'Check version, channel, and download entry.', icon: IC.refresh }
]

const memoryNavInsertIndex = NAV_ITEMS.findIndex(item => item.value === 'updates')
NAV_ITEMS.splice(memoryNavInsertIndex >= 0 ? memoryNavInsertIndex : NAV_ITEMS.length, 0, {
  value: 'memory',
  label: '长期记忆',
  labelEn: 'Long-Term Memory',
  description: '管理偏好、项目背景、纠正点和导入对话样本。',
  descriptionEn: 'Manage preferences, project context, corrections, and imported conversation samples.',
  icon: IC.brain
})

// 添加 AgentLoop 导航项
const agentLoopNavInsertIndex = NAV_ITEMS.findIndex(item => item.value === 'memory')
NAV_ITEMS.splice(agentLoopNavInsertIndex >= 0 ? agentLoopNavInsertIndex + 1 : NAV_ITEMS.length, 0, {
  value: 'agentLoop',
  label: 'Agent Loop',
  labelEn: 'Agent Loop',
  description: '多Agent协作自循环系统配置。',
  descriptionEn: 'Multi-Agent collaboration self-loop system configuration.',
  icon: IC.bolt
})

// 添加需求管理导航项
const requirementsNavInsertIndex = NAV_ITEMS.findIndex(item => item.value === 'agentLoop')
NAV_ITEMS.splice(requirementsNavInsertIndex >= 0 ? requirementsNavInsertIndex + 1 : NAV_ITEMS.length, 0, {
  value: 'requirements',
  label: '需求管理',
  labelEn: 'Requirements',
  description: '需求驱动开发，管理需求、计划和验收。',
  descriptionEn: 'Spec-driven development, manage requirements, plans and verification.',
  icon: IC.file
})

const shortcutsNavInsertIndex = NAV_ITEMS.findIndex(item => item.value === 'updates')
NAV_ITEMS.splice(shortcutsNavInsertIndex >= 0 ? shortcutsNavInsertIndex : NAV_ITEMS.length, 0, {
  value: 'shortcuts',
  label: '\u5feb\u6377\u952e',
  labelEn: 'Shortcuts',
  description: '\u7ba1\u7406\u5de5\u4f5c\u53f0\u5feb\u6377\u952e\u548c\u51b2\u7a81\u3002',
  descriptionEn: 'Manage workbench shortcuts and conflicts.',
  icon: IC.terminal
})

const modelsNavInsertIndex = NAV_ITEMS.findIndex(item => item.value === 'providers')
NAV_ITEMS.splice(modelsNavInsertIndex >= 0 ? modelsNavInsertIndex + 1 : NAV_ITEMS.length, 0, {
  value: 'models',
  label: '\u6a21\u578b',
  labelEn: 'Models',
  description: '\u67e5\u770b\u6240\u6709\u4f9b\u5e94\u5546\u6a21\u578b\u7684\u80fd\u529b\u548c\u4e0a\u4e0b\u6587\u7a97\u53e3\u3002',
  descriptionEn: 'View model capabilities and context windows across providers.',
  icon: IC.pulse
})

const diagnosticsNavInsertIndex = NAV_ITEMS.findIndex(item => item.value === 'updates')
NAV_ITEMS.splice(diagnosticsNavInsertIndex >= 0 ? diagnosticsNavInsertIndex : NAV_ITEMS.length, 0, {
  value: 'diagnostics',
  label: '\u8bca\u65ad',
  labelEn: 'Diagnostics',
  description: '\u67e5\u770b\u8fd0\u884c\u68c0\u67e5\u548c\u6700\u8fd1\u5e94\u7528\u4e8b\u4ef6\u65e5\u5fd7\u3002',
  descriptionEn: 'View runtime checks and recent app event logs.',
  icon: IC.pulse
})

const VISIBLE_NAV_ITEMS = NAV_ITEMS

function settingsNavLabel(item: typeof NAV_ITEMS[number]): string {
  return getLang() === 'en' ? item.labelEn : item.label
}

function settingsNavDescription(item: typeof NAV_ITEMS[number]): string {
  return getLang() === 'en' ? item.descriptionEn : item.description
}

export function SettingsScreen(props: SettingsScreenProps) {
  const [tab, setTab] = useState<TabKey>(props.initialTab || 'appearance')
  useEffect(() => setTab(props.initialTab || 'appearance'), [props.initialTab])
  useEffect(() => {
    if (props.providers.length > 0) return
    const timer = window.setTimeout(() => props.onReload(), 350)
    return () => window.clearTimeout(timer)
  }, [props.providers.length, props.onReload])

  const visibleTab = tab
  const active = VISIBLE_NAV_ITEMS.find(item => item.value === visibleTab) ?? VISIBLE_NAV_ITEMS[0]
  const showSetupNext = visibleTab === 'providers' || visibleTab === 'local-agents' || visibleTab === 'routing' || visibleTab === 'workspaces'

  return (
    <div className="wb-settings wb-settings-shell" data-screen-label={tr('设置', 'Settings')}>
      <button
        className="wb-settings-back-btn"
        onClick={() => props.goChat(null)}
        aria-label={tr('返回对话', 'Back to chat')}
      >
        <Icon d={IC.arrowLeft} size={16} />
      </button>
      <aside className="wb-settings-nav">
        <div className="wb-settings-nav-title">
          <strong>{tr('设置', 'Settings')}</strong>
          <span>AgentHub</span>
        </div>
        {VISIBLE_NAV_ITEMS.map(item => (
          <button key={item.value} className={visibleTab === item.value ? 'active' : ''} onClick={() => setTab(item.value)}>
            <Icon d={item.icon} size={15} />
            <span>{settingsNavLabel(item)}</span>
          </button>
        ))}
      </aside>

      <section className="wb-settings-content">
        <div className="wb-settings-page-head">
          <div>
            <h2>{settingsNavLabel(active)}</h2>
            <p>{settingsNavDescription(active)}</p>
          </div>
        </div>

        {showSetupNext && <SetupNextStep summary={props.connectionSummary} onTab={setTab} goChat={props.goChat} />}

        {visibleTab === 'appearance' && <AppearanceTab motion={props.motion} setMotion={props.setMotion} />}
        {visibleTab === 'providers' && (
          <ProvidersTab
            providers={props.providers}
            bindings={props.bindings}
            onSetEnabled={props.onSetEnabled}
            onSetKey={props.onSetKey}
            onReload={props.onReload}
            onUpsert={props.onUpsertProvider}
            onDelete={props.onDeleteProvider}
            onReorderForClaude={props.onReorderProvidersForClaude}
          />
        )}
        {visibleTab === 'local-agents' && <LocalAgentsTab onLocalAgentsChanged={props.onLocalAgentsChanged} />}
        {visibleTab === 'models' && <ModelsTab providers={props.providers} />}
        {visibleTab === 'routing' && (
          <RoutingTab
            providers={props.providers}
            bindings={props.bindings}
            fallbackChain={props.fallbackChain}
            onSetBinding={props.onSetBinding}
            onSetFallback={props.onSetFallback}
            onTab={(tab: string) => setTab(tab as TabKey)}
          />
        )}
        {visibleTab === 'approvals' && <ApprovalsTab />}
        {visibleTab === 'workspaces' && <WorkspacesTab />}
        {visibleTab === 'skills' && <React.Suspense fallback={<div className="wb-muted-box">{tr('加载技能...', 'Loading skills...')}</div>}><SkillsTab /></React.Suspense>}
        {visibleTab === 'mcp' && <McpSettingsTab workspaceId={props.workspaceId ?? null} />}
        {visibleTab === 'plugins' && <PluginSettingsTab workspaceId={props.workspaceId ?? null} />}
        {visibleTab === 'usage' && <React.Suspense fallback={<div className="wb-muted-box">{tr('加载用量统计...', 'Loading usage stats...')}</div>}><UsageStatsTabFull /></React.Suspense>}
        {visibleTab === 'diagnostics' && <DiagnosticsSettingsTab />}
        {visibleTab === 'shortcuts' && <ShortcutsSettingsTab />}
        {visibleTab === 'memory' && <MemorySettingsTab />}
        {visibleTab === 'agentLoop' && <AgentLoopSettingsTab />}
        {visibleTab === 'requirements' && <RequirementsTab workspaceId={props.workspaceId ?? null} />}
        {visibleTab === 'updates' && <UpdatesSettingsTab />}
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
        <strong>{summary.counts.usable > 0 ? tr('已有可用 Agent', 'Agent ready') : tr('还需要完成连接', 'Connection needed')}</strong>
        <span>
          {summary.counts.usable} {tr('可用', 'ready')} / {summary.counts.busy} {tr('运行中', 'running')} / {summary.counts.needsProvider} {tr('缺少 Key', 'missing keys')} / {summary.counts.needsInstall} {tr('待配置本地入口', 'local entries pending')}
        </span>
      </div>
      <div className="wb-setup-actions">
        {next?.action && (
          <button className="ah-btn sm" onClick={() => onTab(next.action!.tab)}>
            {getLang() === 'en' ? next.action.labelEn || 'Continue setup' : next.action.labelZh || '继续配置'}
          </button>
        )}
        <button className="ah-btn sm primary" onClick={() => goChat(readyAgent)}>
          {tr('去对话', 'Open chat')}
        </button>
      </div>
    </div>
  )
}


function LocalAgentsTab({ onLocalAgentsChanged }: { onLocalAgentsChanged?: (agents: LocalAgentStatus[]) => void }) {
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
      onLocalAgentsChanged?.(next)
      setLocalModels(modelConfigs)
      setDrafts(Object.fromEntries(next.map(agent => [agent.agentId, agent.binary || ''])))
      setArgDrafts(Object.fromEntries(next.map(agent => [agent.agentId, agent.args || ''])))
      setProtocolDrafts(Object.fromEntries(next.map(agent => [agent.agentId, agent.protocol === 'acp' ? 'acp' : 'stdio-plain'])))
    } catch (err: any) {
      setError(err?.message || tr('检测本地 Agent 失败', 'Failed to detect local agents'))
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
      onLocalAgentsChanged?.(next)
      setDrafts(Object.fromEntries(next.map(item => [item.agentId, item.binary || ''])))
      setArgDrafts(Object.fromEntries(next.map(item => [item.agentId, item.args || ''])))
      setProtocolDrafts(Object.fromEntries(next.map(item => [item.agentId, item.protocol === 'acp' ? 'acp' : 'stdio-plain'])))
    } catch (err: any) {
      setError(err?.message || tr('配置本地 Agent 失败', 'Failed to configure local agent'))
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
          <strong>{tr('本地引擎', 'Local engines')}</strong>
          <span>{tr('只把检测到或已配置路径的 Agent 标记为可用。', 'Only detected or path-configured agents are marked usable.')}</span>
        </div>
        <button className="ah-btn sm primary" onClick={refresh} disabled={busy}>
          <Icon d={IC.refresh} size={13} /> {busy ? tr('检测中', 'Detecting') : tr('重新检测', 'Detect again')}
        </button>
      </div>
      {localModels.length > 0 && (
        <div className="glass wb-provider-card wb-local-model-card">
          <div className="wb-card-head">
            <div>
              <strong>{tr('本地模型配置', 'Local model config')}</strong>
              <span>{tr('读取 Codex/Gemini 本机配置，仅用于识别认证与模型状态，不会写入配置文件。', 'Read local Codex/Gemini config for auth and model status only; no files are written.')}</span>
            </div>
          </div>
          <div className="wb-local-model-grid">
            {localModels.map(config => (
              <div key={config.agentId} className="wb-local-model-item">
                <strong>{localModelAgentLabel(config)}</strong>
                <span>{localModelStatusLabel(config)} · {config.authMode || 'unknown'}</span>
                <small>{config.modelId || config.models?.[0]?.id || tr('未读取到模型', 'No model found')}</small>
                <code>{config.configPath}</code>
                {config.error && <em>{config.error}</em>}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="glass wb-error-text">{error}</div>}
      {usable.length === 0 && !busy && <EmptyState icon={IC.terminal} title={tr('没有可用本地 Agent', 'No usable local agents')} detail={tr('安装或登录 Codex、Claude、OpenCode 后重新检测。', 'Install or sign in to Codex, Claude, or OpenCode, then detect again.')} />}
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
              <strong>{tr('手动配置', 'Manual configuration')}</strong>
              <span>{tr('未检测到的 Agent 只有在填写可执行文件路径后才会出现在工作台。', 'Undetected agents appear in the workbench only after an executable path is set.')}</span>
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
  return (
    <div className={compact ? 'wb-local-agent compact' : 'glass wb-local-agent'}>
      <div className="wb-local-agent-head">
        {AGENT_META[agent.agentId] ? <AgentMark id={agent.agentId} size={32} radius={9} /> : <span className="wb-agent-fallback">{agent.label.slice(0, 1)}</span>}
        <div>
          <strong>{localAgentDisplayLabel(agent)}</strong>
          <span>{[agent.version, agent.protocol, agent.loginState !== 'unknown' ? agent.loginState : ''].filter(Boolean).join(' · ') || tr('等待检测', 'Waiting for detection')}</span>
        </div>
        <span className={localAgentStatusChipClass(agent, needsPromptArg)}>{localAgentStatusLabel(agent, needsPromptArg)}</span>
      </div>
      <div className="wb-form-grid two">
        <select className="ah-select" value={draft} onChange={event => setDraft(event.target.value)}>
          <option value="">{agent.binary || tr('选择可执行文件路径', 'Choose executable path')}</option>
          {draft && !agent.candidates.some(candidate => candidate.path === draft) && <option value={draft}>{draft}</option>}
          {agent.candidates.map(candidate => <option key={candidate.path} value={candidate.path}>{candidate.label} · {candidate.path}</option>)}
        </select>
        <input className="ah-input mono" placeholder={tr('粘贴可执行文件路径', 'Paste executable path')} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onSave() }} />
      </div>
      {agent.manualOnly && (
        <div className="wb-form-grid two">
          <select className="ah-select" value={protocolDraft} onChange={event => setProtocolDraft(event.target.value as 'stdio-plain' | 'acp')}>
            <option value="stdio-plain">{tr('本地 CLI', 'Local CLI')}</option>
            <option value="acp">ACP</option>
          </select>
          <input
            className="ah-input mono"
            placeholder={agent.requiresPromptArg ? tr('非交互参数，需包含 {prompt}', 'Non-interactive args; must include {prompt}') : tr('参数可选；留空时通过 stdin 发送 prompt', 'Args optional; blank sends prompt through stdin')}
            value={argsDraft}
            onChange={event => setArgsDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onSave() }}
          />
        </div>
      )}
      {agent.note && <div className="ah-hint">{agent.note}</div>}
      <div className="wb-card-actions">
        <button className="ah-btn sm primary" disabled={!canSave} onClick={onSave}>{busy ? tr('保存中', 'Saving') : tr('使用此路径', 'Use this path')}</button>
      </div>
    </div>
  )
}

function localModelStatusLabel(config: LocalModelConfig): string {
  if (config.status === 'ok') return tr('已读取', 'Loaded')
  if (config.status === 'partial') return tr('部分配置', 'Partial')
  if (config.status === 'missing') return tr('未找到配置', 'Config missing')
  return tr('读取失败', 'Read failed')
}

function localModelAgentLabel(config: LocalModelConfig): string {
  if (config.source === 'claude' || config.agentId === 'claude' || config.agentId === 'claude-cli') return 'Claude'
  if (config.source === 'codex' || config.agentId === 'codex') return 'Codex'
  if (config.source === 'gemini' || config.agentId === 'gemini') return 'Gemini'
  return config.agentId
}

function localAgentStatusLabel(agent: LocalAgentStatus, needsPromptArg: boolean): string {
  if (agent.diagnostic) return tr('旧路径失效', 'Stale path')
  if (agent.loginState === 'not-installed') return tr('未安装', 'Not installed')
  if (agent.configured) return tr('可使用', 'Usable')
  if (agent.installed) return tr('已检测', 'Detected')
  if (needsPromptArg) return tr('需要参数', 'Args required')
  if (agent.candidateKind === 'desktop') return tr('桌面候选', 'Desktop candidate')
  if (agent.candidateKind === 'cli') return tr('检测到 CLI，待配置', 'CLI detected, configure to use')
  return tr('候选', 'Candidate')
}

function localAgentStatusChipClass(agent: LocalAgentStatus, needsPromptArg: boolean): string {
  if (agent.configured || agent.installed) return 'ah-chip mint'
  if (agent.diagnostic || needsPromptArg) return 'ah-chip warning'
  return 'ah-chip'
}

function localAgentDisplayLabel(agent: LocalAgentStatus): string {
  if (getLang() === 'zh') return agent.label
  return agent.label.replace(/\s*\/\s*反重力/g, '')
}

function _stdioArgsHint(agentId: string): string {
  if (getLang() === 'zh') return DEFAULT_STDIO_ARGS[agentId] || tr('留空使用默认参数', 'Leave blank to use defaults')
  const englishHints: Record<string, string> = {
    hermes: 'No args; prompt is sent through stdin',
    marvis: 'No official CLI yet; HTTP binding is recommended',
    gemini: 'Candidate only; confirm CLI args manually',
    codebuddy: 'Candidate only; confirm CLI args manually',
    antigravity: 'Candidate only; confirm CLI args manually',
    mimocode: 'Candidate only; confirm CLI args manually',
    zcode: 'Candidate only; confirm CLI args manually',
    reasonix: 'Candidate only; confirm CLI args manually'
  }
  return englishHints[agentId] || DEFAULT_STDIO_ARGS[agentId] || 'Leave blank to use defaults'
}

export function ModelsTab({ providers }: { providers: ProviderDef[] }) {
  const [filter, setFilter] = useState('')
  const [models, setModels] = useState<ModelRouteInfo[]>([])
  const [settings, setSettings] = useState<ModelRouteSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, any>>({})
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<Record<string, string>>({})
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({})
  const [fetchingStatus, setFetchingStatus] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, routeSettings] = await Promise.all([
        window.electronAPI.models.list(),
        window.electronAPI.models.routeSettingsGet()
      ])
      setModels(Array.isArray(list) ? list : [])
      setSettings(routeSettings)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh().catch(error => setMessage(error?.message || String(error))) }, [refresh])

  const activeProviders = useMemo(() => {
    return providers.filter(p => p.enabled && !!p.apiKey && !p.apiKeyLocked)
  }, [providers])
  const routeSelectableModels = useMemo(() => {
    return models.filter(m =>
      m.providerEnabled &&
      m.providerHasKey &&
      !m.providerKeyLocked &&
      m.enabled !== false
    )
  }, [models])

  // Filter providers based on search text (matching provider name or model details)
  const filteredProviders = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return activeProviders
    return activeProviders.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(needle)
      const providerModels = models.filter(m => m.providerId === p.id)
      const modelMatch = providerModels.some(m =>
        m.modelId.toLowerCase().includes(needle) ||
        m.label.toLowerCase().includes(needle) ||
        (m.upstreamModel || '').toLowerCase().includes(needle)
      )
      return nameMatch || modelMatch
    })
  }, [activeProviders, models, filter])

  // Expand the first provider by default when loaded, if none expanded
  useEffect(() => {
    if (!expandedProviderId && filteredProviders.length > 0) {
      setExpandedProviderId(filteredProviders[0].id)
    }
  }, [filteredProviders, expandedProviderId])

  const formatContext = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n)
  const modelRef = (m: ModelRouteInfo) => `${m.providerId}/${m.modelId}`
  const updateModel = async (m: ModelRouteInfo, patch: ModelRoutePatch) => {
    const next = await window.electronAPI.models.updateRoute(m.providerId, m.modelId, patch)
    setModels(current => current.map(item => modelRef(item) === modelRef(m) ? { ...item, ...next } : item))
  }
  const updateSettings = async (patch: Partial<ModelRouteSettings>) => setSettings(await window.electronAPI.models.routeSettingsSet(patch))
  const runTest = async (m: ModelRouteInfo) => {
    const key = modelRef(m)
    setTesting(key)
    try {
      const result = await window.electronAPI.models.test({ providerId: m.providerId, modelId: m.modelId, upstreamModel: m.upstreamModel })
      setTestResult(current => ({ ...current, [key]: result }))
    } finally {
      setTesting(null)
    }
  }
  const exportCatalog = async () => {
    const result = await window.electronAPI.models.exportCodexCatalog()
    setMessage(result.ok
      ? tr(`已导出 ${result.count} 个模型到 ${result.path}`, `Exported ${result.count} model(s) to ${result.path}`)
      : tr(`导出失败：${result.error || '未知错误'}`, `Export failed: ${result.error || 'Unknown error'}`))
  }

  const fetchProviderModels = async (provider: ProviderDef) => {
    setFetchingStatus(prev => ({ ...prev, [provider.id]: true }))
    setFetchErrors(prev => {
      const next = { ...prev }
      delete next[provider.id]
      return next
    })
    try {
      const result = await window.electronAPI.providers.fetchModels(provider.id)
      if (result.ok) {
        await refresh()
      } else {
        setFetchErrors(prev => ({
          ...prev,
          [provider.id]: `${tr('获取失败：', 'Fetch failed: ')}${result.error || 'Unknown Error'} (${tr('已保留现有模型', 'Existing models preserved')})`
        }))
      }
    } catch (err: any) {
      setFetchErrors(prev => ({
        ...prev,
        [provider.id]: `${tr('获取失败：', 'Fetch failed: ')}${err.message || String(err)} (${tr('已保留现有模型', 'Existing models preserved')})`
      }))
    } finally {
      setFetchingStatus(prev => ({ ...prev, [provider.id]: false }))
    }
  }

  const getProviderStatus = (p: ProviderDef) => {
    if (!p.enabled) return { color: 'var(--wb-muted)', label: tr('已关闭', 'Off'), statusClass: 'status-off' }
    const health = p.health as any
    if (!health) return { color: 'var(--wb-green)', label: tr('启用', 'Enabled'), statusClass: 'status-ok' }
    if (health.reachable && health.status === 'ok') {
      return { color: 'var(--wb-green)', label: tr('正常', 'OK'), statusClass: 'status-ok' }
    }
    if (health.status === 'unauthorized') {
      return { color: 'var(--wb-warn)', label: tr('未授权', 'Unauthorized'), statusClass: 'status-unauthorized' }
    }
    return { color: 'var(--wb-red)', label: health.error || tr('异常', 'Error'), statusClass: 'status-error' }
  }

  const getFetchStatusText = (p: ProviderDef) => {
    if (fetchErrors[p.id]) {
      return fetchErrors[p.id]
    }
    const state = p.modelFetch
    if (!state) return ''
    if (state.status === 'error') {
      return `${tr('获取失败：', 'Fetch failed: ')}${state.error || 'Unknown Error'} (${tr('已保留现有模型', 'Existing models preserved')})`
    }
    if (state.status === 'ok') {
      return tr(`上次成功 ${state.lastSuccessCount || 0} 个`, `Last success: ${state.lastSuccessCount || 0}`)
    }
    return ''
  }

  return (
    <div className="wb-settings-stack">
      <section className="glass">
        <div className="wb-settings-section-head">
          <div>
            <strong>{tr('模型路由中心', 'Model routing center')}</strong>
            <span>{tr('按模型管理 provider、真实上游模型、上下文、推理、超时、重试和 Codex catalog。', 'Manage provider, upstream model, context, reasoning, timeout, retry, and Codex catalog per model.')}</span>
          </div>
          <div className="wb-card-actions">
            <input className="ah-input" placeholder={tr('搜索模型...', 'Search models...')} value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
            <button className="ah-btn sm" onClick={refresh} disabled={loading}>{tr('刷新', 'Refresh')}</button>
            <button className="ah-btn sm primary" onClick={exportCatalog}>{tr('导出 Codex Catalog', 'Export Codex Catalog')}</button>
          </div>
        </div>
        {settings && (
          <div className="wb-model-route-settings">
            <label className="wb-field">
              <span>{tr('默认模型', 'Default model')}</span>
              <select
                className="ah-select"
                value={settings.codexDefaultModel || ''}
                onChange={e => updateSettings({ codexDefaultModel: e.target.value || undefined })}
              >
                <option value="">{tr('请选择...', 'Select...')}</option>
                {routeSelectableModels.map(m => (
                  <option key={modelRef(m)} value={modelRef(m)}>{m.providerName} - {m.label} ({modelRef(m)})</option>
                ))}
              </select>
            </label>
            <label className="wb-field">
              <span>{tr('Fallback 模型', 'Fallback model')}</span>
              <select
                className="ah-select"
                value={settings.fallbackModelId || ''}
                onChange={e => updateSettings({ fallbackModelId: e.target.value || undefined })}
              >
                <option value="">{tr('请选择...', 'Select...')}</option>
                {routeSelectableModels.map(m => (
                  <option key={modelRef(m)} value={modelRef(m)}>{m.providerName} - {m.label} ({modelRef(m)})</option>
                ))}
              </select>
            </label>
            <label className="wb-field">
              <span>{tr('Codex 注入模式', 'Codex injection mode')}</span>
              <select className="ah-select" value={settings.codexInjectionMode} onChange={e => updateSettings({ codexInjectionMode: e.target.value as ModelRouteSettings['codexInjectionMode'] })}>
                <option value="official_account">{tr('官方账号', 'Official account')}</option>
                <option value="third_party_api">{tr('第三方 API', 'Third-party API')}</option>
                <option value="lan_share">{tr('局域网共享', 'LAN share')}</option>
              </select>
            </label>
            <PreferenceRow title={tr('Codex 内部模型锁定', 'Codex internal model lock')} detail={tr('Codex 辅助 slot 未配置时使用默认模型，避免误打到错误上游。', 'Use default model for unconfigured Codex slots to avoid accidental upstream routing.')}>
              <Switch on={settings.codexInternalModelLock} onChange={value => updateSettings({ codexInternalModelLock: value })} />
            </PreferenceRow>
          </div>
        )}
        {message && <div className="wb-memory-kun-message">{message}</div>}
        <div className="wb-settings-grid" style={{ marginTop: 16 }}>
          {filteredProviders.map(provider => {
            const providerModels = models.filter(m => m.providerId === provider.id)
            const isExpanded = expandedProviderId === provider.id
            const statusInfo = getProviderStatus(provider)
            const fetchStatusText = getFetchStatusText(provider)
            const activeModelId = selectedModelIds[provider.id] || providerModels[0]?.modelId || ''
            const activeModel = providerModels.find(m => m.modelId === activeModelId)

            return (
              <div
                key={provider.id}
                className={`glass wb-provider-card ${isExpanded ? 'expanded' : ''}`}
                style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                  onClick={() => setExpandedProviderId(isExpanded ? null : provider.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: statusInfo.color
                      }}
                      title={statusInfo.label}
                    />
                    <strong style={{ fontSize: '15px' }}>{provider.name}</strong>
                    <span style={{ fontSize: '12px', color: 'var(--tx-3)' }}>({provider.kind})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: 'var(--tx-2)' }}>
                    <span>{tr(`已有模型 ${providerModels.length} 个`, `${providerModels.length} model(s)`)}</span>
                    {fetchStatusText && (
                      <span style={{ fontSize: '12px', color: fetchStatusText.includes('失败') ? 'var(--wb-red)' : 'var(--wb-green)' }}>
                        {fetchStatusText}
                      </span>
                    )}
                    <span>{isExpanded ? '▼' : '▶'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      borderTop: '1px solid var(--wb-line)',
                      paddingTop: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '16px'
                    }}
                  >
                    {providerModels.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px', color: 'var(--tx-3)' }}>
                        <span>{tr('暂无模型列表', 'No model list yet')}</span>
                        <button
                          className="ah-btn sm primary"
                          disabled={fetchingStatus[provider.id]}
                          onClick={() => fetchProviderModels(provider)}
                        >
                          {fetchingStatus[provider.id] ? tr('获取中...', 'Fetching...') : tr('获取模型列表', 'Fetch models')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <label className="wb-field">
                            <span>{tr('选择模型', 'Select Model')}</span>
                            <select
                              className="ah-select"
                              value={activeModelId}
                              onChange={e => setSelectedModelIds(prev => ({ ...prev, [provider.id]: e.target.value }))}
                            >
                              {providerModels.map(m => (
                                <option key={m.modelId} value={m.modelId}>
                                  {m.label || m.modelId}
                                </option>
                              ))}
                            </select>
                          </label>

                          {activeModel && (
                            <label className="wb-field">
                              <span>{tr('上下文窗口 (API)', 'Context Window (API)')}</span>
                              <div style={{ display: 'flex', alignItems: 'center', height: '34px', padding: '0 12px', border: '1px solid var(--wb-line)', borderRadius: '6px', background: 'var(--bg-task-content)', color: 'var(--tx-2)', fontSize: '13px' }}>
                                {activeModel.contextWindow ? `${activeModel.contextWindow} (${formatContext(activeModel.contextWindow)})` : tr('未知', 'Unknown')}
                              </div>
                            </label>
                          )}
                        </div>

                        {activeModel && (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                              <label className="wb-field">
                                <span>{tr('上游模型', 'Upstream Model')}</span>
                                <input
                                  className="ah-input mono"
                                  value={activeModel.upstreamModel || ''}
                                  placeholder={activeModel.modelId}
                                  onChange={e => updateModel(activeModel, { upstreamModel: e.target.value || undefined })}
                                />
                              </label>

                              <label className="wb-field">
                                <span>{tr('模型能力', 'Capabilities')}</span>
                                <div style={{ display: 'flex', gap: '8px', height: '34px', alignItems: 'center' }}>
                                  {activeModel.supportsTools && (
                                    <span className="wb-model-badge tools" title="Supports tool calls" style={{ background: 'var(--wb-accent-soft)', color: 'var(--wb-accent)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px' }}>tools</span>
                                  )}
                                  {activeModel.supportsVision && (
                                    <span className="wb-model-badge vision" title="Supports vision" style={{ background: 'var(--wb-green-soft)', color: 'var(--wb-green)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px' }}>vision</span>
                                  )}
                                  {activeModel.supportsThinking && (
                                    <span className="wb-model-badge thinking" title="Supports thinking/reasoning" style={{ background: 'var(--wb-warn-soft)', color: 'var(--wb-warn)', padding: '4px 8px', borderRadius: '4px', fontSize: '11px' }}>thinking</span>
                                  )}
                                  {!activeModel.supportsTools && !activeModel.supportsVision && !activeModel.supportsThinking && (
                                    <span style={{ fontSize: '12px', color: 'var(--tx-3)' }}>{tr('基础文本', 'Text only')}</span>
                                  )}
                                </div>
                              </label>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                              <label className="wb-field">
                                <span>{tr('超时时间 (ms)', 'Timeout (ms)')}</span>
                                <input
                                  className="ah-input"
                                  type="number"
                                  min={0}
                                  placeholder="ms"
                                  value={activeModel.timeoutMs || ''}
                                  onChange={e => updateModel(activeModel, { timeoutMs: Number(e.target.value) || undefined })}
                                />
                              </label>

                              <label className="wb-field">
                                <span>{tr('重试次数', 'Retry Count')}</span>
                                <input
                                  className="ah-input"
                                  type="number"
                                  min={0}
                                  max={5}
                                  placeholder="retry"
                                  value={activeModel.retryCount || 0}
                                  onChange={e => updateModel(activeModel, { retryCount: Number(e.target.value) || 0 })}
                                />
                              </label>

                              <label className="wb-field">
                                <span>{tr('启用模型', 'Enable Model')}</span>
                                <div style={{ display: 'flex', alignItems: 'center', height: '34px' }}>
                                  <Switch
                                    on={activeModel.enabled !== false}
                                    onChange={value => updateModel(activeModel, { enabled: value })}
                                  />
                                </div>
                              </label>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                              <div style={{ display: 'flex', gap: '12px' }}>
                                <button
                                  className="ah-btn sm"
                                  onClick={() => runTest(activeModel)}
                                  disabled={testing === modelRef(activeModel)}
                                >
                                  {testing === modelRef(activeModel) ? tr('测试中', 'Testing') : tr('测试模型', 'Test Model')}
                                </button>
                                <button
                                  className="ah-btn sm"
                                  disabled={fetchingStatus[provider.id]}
                                  onClick={() => fetchProviderModels(provider)}
                                >
                                  {fetchingStatus[provider.id] ? tr('刷新中...', 'Refreshing...') : tr('刷新模型列表', 'Fetch models')}
                                </button>
                              </div>
                              {testResult[modelRef(activeModel)] && (
                                <small className={testResult[modelRef(activeModel)].ok ? 'wb-model-test-ok' : 'wb-model-test-error'} style={{ color: testResult[modelRef(activeModel)].ok ? 'var(--wb-green)' : 'var(--wb-red)', fontWeight: 'bold' }}>
                                  {testResult[modelRef(activeModel)].ok ? `OK ${testResult[modelRef(activeModel)].latencyMs}ms` : testResult[modelRef(activeModel)].error}
                                </small>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {filteredProviders.length === 0 && (
            <div className="wb-memory-kun-empty">
              <span>{tr('没有配置了 API Key 的供应商', 'No providers configured with API key')}</span>
            </div>
          )}
        </div>
        <div className="wb-models-summary"><span>{tr(`共 ${filteredProviders.length} 个已配置供应商，模型路由包含 ${models.length} 个模型`, `${filteredProviders.length} provider(s) configured, model routing contains ${models.length} model(s)`)}</span></div>
      </section>
    </div>
  )
}

function MemorySettingsTab() {
  const [scopeFilter, setScopeFilter] = useState<MemoryScopeFilter>('all')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [enabled, setEnabled] = useState(true)
  const [editing, setEditing] = useState<MemoryEntry | null>(null)
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | 'import' | null>(null)
  const [draft, setDraft] = useState({
    title: '',
    summary: '',
    content: '',
    tags: '',
    status: 'approved' as MemoryEntryStatus,
    category: 'preference' as MemoryCategory,
    source: '',
    scope: 'user',
    confidence: 80,
    pinned: false
  })
  const [importSource, setImportSource] = useState('Imported conversation')
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const catalog = await window.electronAPI.memory.catalog()
      setEntries(Array.isArray(catalog?.entries) ? catalog.entries : [])
      setEnabled(catalog?.settings?.enabled !== false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const stats = useMemo(() => {
    const active = entries.filter(entry => !entry.deletedAt && (entry.status || 'approved') === 'approved').length
    const disabled = entries.filter(entry => !entry.deletedAt && entry.status === 'disabled').length
    const pending = entries.filter(entry => !entry.deletedAt && entry.status === 'candidate').length
    const deleted = entries.filter(entry => entry.deletedAt).length
    return { active, disabled, pending, deleted, total: entries.length }
  }, [entries])

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter(entry => {
      // 已删除筛选
      if (scopeFilter === 'deleted') {
        return !!entry.deletedAt
      }
      // 其他筛选：排除已删除
      if (entry.deletedAt) return false
      if (scopeFilter !== 'all' && memoryScopeOf(entry) !== scopeFilter) return false
      if (!needle) return true
      return [entry.title, entry.summary, entry.content, entry.category, entry.source, ...(entry.tags || [])]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [entries, query, scopeFilter])

  const openCreate = () => {
    setEditing(null)
    setEditorMode('create')
    setDraft({
      title: '',
      summary: '',
      content: '',
      tags: '',
      status: 'approved',
      category: 'preference',
      source: '',
      scope: scopeFilter === 'all' ? 'user' : scopeFilter,
      confidence: 80,
      pinned: false
    })
  }

  const openEdit = (entry: MemoryEntry) => {
    setEditing(entry)
    setEditorMode('edit')
    setDraft({
      title: entry.title || '',
      summary: entry.summary || '',
      content: String(entry.content || entry.summary || ''),
      tags: (entry.tags || []).join(', '),
      status: entry.status || 'approved',
      category: entry.category || 'preference',
      source: entry.source || '',
      scope: String(entry.metadata?.scope || memoryScopeOf(entry)),
      confidence: typeof entry.confidence === 'number' ? Math.round(entry.confidence * 100) : 80,
      pinned: !!(entry.metadata?.pinned || entry.metadata?.pin)
    })
  }

  const closeEditor = () => {
    setEditing(null)
    setEditorMode(null)
    setMessage(null)
  }

  const toggleEnabled = async (nextEnabled: boolean) => {
    setEnabled(nextEnabled)
    const next = await window.electronAPI.memory.updateSettings({ enabled: nextEnabled })
    setEnabled(next.enabled)
    await refresh()
  }

  const saveDraft = async () => {
    const title = draft.title.trim() || draft.content.trim().slice(0, 64)
    if (!title || !draft.content.trim()) return
    const patch = {
      title,
      summary: draft.summary.trim() || draft.content.trim().slice(0, 180),
      content: draft.content.trim(),
      tags: draft.tags.split(',').map(item => item.trim()).filter(Boolean),
      status: draft.status,
      category: draft.category,
      source: draft.source.trim() || undefined,
      confidence: Math.max(0, Math.min(100, Math.round(draft.confidence))) / 100,
      metadata: {
        ...(editing?.metadata || {}),
        pinned: draft.pinned,
        scope: draft.scope,
        updatedFrom: 'settings'
      }
    }
    if (editorMode === 'edit' && editing) {
      await window.electronAPI.memory.updateEntry(editing.id, patch)
    } else {
      await window.electronAPI.memory.addEntry(patch)
    }
    closeEditor()
    await refresh()
  }

  const importConversation = async () => {
    if (!importText.trim()) return
    setLoading(true)
    setMessage(null)
    try {
      const next = await window.electronAPI.memory.importConversation(importSource.trim() || 'Imported conversation', importText)
      setImportText('')
      setEditorMode(null)
      setMessage(tr(`已生成 ${next.length} 条候选记忆`, `Generated ${next.length} memory candidates`))
      await refresh()
    } catch (e: any) {
      setMessage(e?.message || tr('导入失败', 'Import failed'))
    } finally {
      setLoading(false)
    }
  }

  const approveCandidate = async (id: string) => {
    await window.electronAPI.memory.approveCandidate(id)
    await refresh()
  }

  const disableMemory = async (id: string) => {
    await window.electronAPI.memory.disableEntry(id)
    await refresh()
  }

  const deleteMemory = async (id: string) => {
    const ok = await styledConfirm({ message: tr('删除这条记忆？', 'Delete this memory?'), danger: true })
    if (!ok) return
    await window.electronAPI.memory.delete(id)
    if (editing?.id === id) closeEditor()
    await refresh()
  }

  const restoreMemory = async (id: string) => {
    await window.electronAPI.memory.restore(id)
    await refresh()
  }

  const togglePinned = async (entry: MemoryEntry) => {
    await window.electronAPI.memory.updateEntry(entry.id, {
      metadata: {
        ...(entry.metadata || {}),
        pinned: !(entry.metadata?.pinned || entry.metadata?.pin),
        pin: undefined
      }
    })
    await refresh()
  }

  return (
    <div className="wb-settings-stack wb-memory-settings wb-memory-kun">
      <section className="glass wb-memory-kun-card">
        <header className="wb-memory-kun-title">
          <div>
            <strong>{tr('长期记忆', 'Long-term memory')}</strong>
            <span>{tr('记忆会跨会话保存事实和偏好，并在下一轮对话中自动注入上下文。', 'Memory persists facts and preferences across sessions and is injected into context on future turns.')}</span>
          </div>
          <span className="wb-memory-kun-save">{tr('修改会自动生效', 'Changes apply automatically')}</span>
        </header>

        <div className="wb-memory-kun-section wb-memory-kun-enable">
          <div>
            <strong>{tr('启用记忆', 'Enable memory')}</strong>
            <span>{tr('关闭后不会注入或自动提取新记忆，已有记录会保留在这里。', 'When off, AgentHub will not inject memory or extract new candidates; existing records stay here.')}</span>
          </div>
          <Switch on={enabled} onChange={toggleEnabled} />
        </div>

        <div className="wb-memory-kun-section">
          <div className="wb-memory-kun-copy">
            <strong>{tr('概览', 'Overview')}</strong>
            <span>{tr('记忆记录会保存偏好、项目背景、格式规则和反复纠正点。', 'Memory records store preferences, project context, format rules, and repeated corrections.')}</span>
          </div>
          <div className="wb-memory-kun-stats">
            <div><span>{tr('活跃', 'Active')}</span><strong>{stats.active}</strong></div>
            <div><span>{tr('待确认', 'Pending')}</span><strong>{stats.pending}</strong></div>
            <div><span>{tr('已删除', 'Deleted')}</span><strong>{stats.deleted}</strong></div>
            <div><span>{tr('状态', 'Status')}</span><strong>{enabled ? tr('开启', 'On') : tr('关闭', 'Off')}</strong></div>
          </div>
        </div>

        {/* Memory Graph Visualization */}
        <MemoryGraphSection entries={entries} />

        <div className="wb-memory-kun-section">
          <div className="wb-memory-kun-record-head">
            <div>
              <strong>{tr('记忆记录', 'Memory records')}</strong>
              <span>{tr('新建、编辑、禁用或删除记忆记录。修改会在下一轮对话生效。', 'Create, edit, disable, or delete memories. Changes apply on the next turn.')}</span>
            </div>
            <div className="wb-memory-kun-actions">
              <button className="ah-btn sm" onClick={refresh} disabled={loading}><Icon d={IC.refresh} size={13} />{tr('刷新', 'Refresh')}</button>
              <button className="ah-btn sm" onClick={() => { setEditorMode(editorMode === 'import' ? null : 'import'); setEditing(null) }}>{tr('导入', 'Import')}</button>
              <button className="ah-btn sm primary" onClick={openCreate}><Icon d={IC.plus} size={13} />{tr('新建', 'New')}</button>
            </div>
          </div>

          <div className="wb-memory-kun-toolbar">
            <div className="wb-memory-kun-tabs">
              {MEMORY_SCOPES.map(scope => (
                <button key={scope} className={scopeFilter === scope ? 'active' : ''} onClick={() => setScopeFilter(scope)}>
                  {memoryScopeLabel(scope)}
                </button>
              ))}
            </div>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder={tr('搜索记忆', 'Search memories')} />
          </div>

          {editorMode === 'import' && (
            <div className="wb-memory-kun-editor">
              <div className="wb-memory-kun-editor-head">
                <strong>{tr('导入对话', 'Import conversation')}</strong>
                <button className="ah-btn sm" onClick={closeEditor}>{tr('取消', 'Cancel')}</button>
              </div>
              <input className="ah-input" value={importSource} onChange={e => setImportSource(e.target.value)} placeholder={tr('来源名称 / 对话标题', 'Source name / chat title')} />
              <textarea className="ah-textarea" value={importText} onChange={e => setImportText(e.target.value)} placeholder={tr('粘贴对话记录...', 'Paste conversation transcript...')} />
              <div className="wb-tool-actions">
                <button className="ah-btn sm primary" onClick={importConversation} disabled={loading || !importText.trim()}>{tr('导入并提取候选', 'Import and extract')}</button>
              </div>
            </div>
          )}

          {(editorMode === 'create' || editorMode === 'edit') && (
            <div className="wb-memory-kun-editor">
              <div className="wb-memory-kun-editor-head">
                <strong>{editorMode === 'create' ? tr('新建记忆', 'Create memory') : tr('编辑记忆', 'Edit memory')}</strong>
                <button className="ah-btn sm" onClick={closeEditor}>{tr('取消', 'Cancel')}</button>
              </div>
              <textarea className="ah-textarea" value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} placeholder={tr('想让助手记住什么？例如：偏好 TypeScript，2 空格缩进。', 'What should AgentHub remember?')} />
              <div className="wb-memory-kun-edit-grid">
                <input className="ah-input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder={tr('标题', 'Title')} />
                <select className="ah-select" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as MemoryCategory })}>
                  {MEMORY_CATEGORIES.map(category => <option key={category} value={category}>{memoryCategoryLabel(category)}</option>)}
                </select>
                <select className="ah-select" value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })}>
                  <option value="user">{tr('用户', 'User')}</option>
                  <option value="workspace">{tr('工作区', 'Workspace')}</option>
                  <option value="project">{tr('项目', 'Project')}</option>
                </select>
                <input className="ah-input" value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder={tr('标签，逗号分隔', 'Tags, comma-separated')} />
              </div>
              <div className="wb-memory-governance-row">
                <label>
                  <input type="checkbox" checked={draft.pinned} onChange={e => setDraft({ ...draft, pinned: e.target.checked })} />
                  <span>{tr('置顶并优先注入上下文', 'Pin and prioritize in context')}</span>
                </label>
                <label className="wb-appearance-range">
                  <span>{tr('置信度', 'Confidence')}</span>
                  <input type="range" min={0} max={100} value={draft.confidence} onChange={e => setDraft({ ...draft, confidence: Number(e.target.value) })} />
                  <span>{draft.confidence}%</span>
                </label>
              </div>
              <div className="wb-tool-actions">
                <button className="ah-btn sm primary" onClick={saveDraft} disabled={!draft.content.trim()}>{tr('保存', 'Save')}</button>
                {editing && <button className="ah-btn sm danger" onClick={() => deleteMemory(editing.id)}>{tr('删除', 'Delete')}</button>}
              </div>
            </div>
          )}

          <div className="wb-memory-kun-list">
            {visibleEntries.length === 0 ? (
              <div className="wb-memory-kun-empty">
                <Icon d={IC.brain} size={26} />
                <span>{tr('暂无记忆记录。助手会在了解你的偏好后自动创建，也可以手动添加。', 'No memory records yet. AgentHub will create them as it learns your preferences, or you can add one manually.')}</span>
              </div>
            ) : visibleEntries.slice(0, 80).map(entry => (
              <MemorySettingsRow key={entry.id} entry={entry} onEdit={openEdit} onApprove={approveCandidate} onDisable={disableMemory} onDelete={deleteMemory} onRestore={restoreMemory} onTogglePinned={togglePinned} />
            ))}
          </div>
        </div>
        {message && <div className="wb-memory-kun-message">{message}</div>}
      </section>
    </div>
  )
}

function MemorySettingsRow({ entry, onEdit, onApprove, onDisable, onDelete, onRestore, onTogglePinned }: {
  entry: MemoryEntry
  onEdit: (entry: MemoryEntry) => void
  onApprove: (id: string) => void
  onDisable: (id: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onTogglePinned: (entry: MemoryEntry) => void
}) {
  const pinned = !!(entry.metadata?.pinned || entry.metadata?.pin)
  const deleted = !!entry.deletedAt
  return (
    <div className={'wb-memory-kun-row wb-memory-settings-row' + (pinned ? ' pinned' : '') + (deleted ? ' deleted' : '')}>
      <div className="wb-memory-kun-row-main">
        <strong>{pinned && <span className="wb-memory-pin">{tr('置顶', 'Pinned')}</span>}{deleted && <span className="wb-memory-deleted-badge">{tr('已删除', 'Deleted')}</span>}{entry.title || entry.category || entry.id}<span className="wb-memory-category-badge">{memoryCategoryLabel(entry.category)}</span></strong>
        <small>{String(entry.summary || entry.content || entry.title || '').slice(0, 220)}</small>
        <div className="wb-memory-kun-row-meta">{memoryMeta(entry)}</div>
      </div>
      <div className="wb-tool-actions">
        {deleted ? (
          <button onClick={() => onRestore(entry.id)}>{tr('恢复', 'Restore')}</button>
        ) : (
          <>
            <button onClick={() => onEdit(entry)}>{tr('编辑', 'Edit')}</button>
            <button onClick={() => onTogglePinned(entry)}>{pinned ? tr('取消置顶', 'Unpin') : tr('置顶', 'Pin')}</button>
            {entry.status === 'candidate' && <button onClick={() => onApprove(entry.id)}>{tr('批准', 'Approve')}</button>}
            {entry.status !== 'disabled' && <button onClick={() => onDisable(entry.id)}>{tr('禁用', 'Disable')}</button>}
            <button className="danger" onClick={() => onDelete(entry.id)}>{tr('删除', 'Delete')}</button>
          </>
        )}
      </div>
    </div>
  )
}

function MemoryGraphSection({ entries }: { entries: MemoryEntry[] }) {
  const [graph, setGraph] = useState<any>(null)
  const [cleanupSuggestions, setCleanupSuggestions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildGraph = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.memoryGraph.build(entries)
      setGraph(result)
      setCleanupSuggestions([])
    } catch (err: any) {
      setError(err?.message || tr('构建记忆图谱失败', 'Failed to build memory graph'))
    } finally {
      setLoading(false)
    }
  }

  const cleanup = async () => {
    if (!graph) return
    try {
      const suggestions = await window.electronAPI.memoryGraph.cleanupSuggestions(graph)
      setCleanupSuggestions(Array.isArray(suggestions) ? suggestions : [])
    } catch (err: any) {
      setError(err?.message || tr('获取清理建议失败', 'Failed to get cleanup suggestions'))
    }
  }

  if (entries.length === 0) return null

  return (
    <div className="wb-memory-kun-section">
      <div className="wb-memory-kun-copy">
        <strong>{tr('记忆图谱', 'Memory Graph')}</strong>
        <span>{tr('可视化记忆条目之间的关系，查看清理建议。', 'Visualize relationships between memory entries and view cleanup suggestions.')}</span>
      </div>
      <div className="wb-memory-graph-actions">
        <button className="ah-btn sm" onClick={buildGraph} disabled={loading}>
          {loading ? tr('构建中...', 'Building...') : tr('构建图谱', 'Build Graph')}
        </button>
        {graph && (
          <button className="ah-btn sm" onClick={cleanup}>
            {tr('清理建议', 'Cleanup Suggestions')}
          </button>
        )}
      </div>
      {error && <div className="wb-memory-graph-error">{error}</div>}
      {graph && (
        <div className="wb-memory-graph-stats">
          <div>{tr(`节点: ${graph.stats?.totalNodes || 0}，边: ${graph.stats?.totalEdges || 0}，孤立节点: ${graph.stats?.isolatedNodes || 0}`, `Nodes: ${graph.stats?.totalNodes || 0}, Edges: ${graph.stats?.totalEdges || 0}, Isolated: ${graph.stats?.isolatedNodes || 0}`)}</div>
          {graph.stats?.categories && (
            <div className="wb-memory-graph-categories">
              {Object.entries(graph.stats.categories).map(([cat, count]) => (
                <span key={cat} className="ah-chip">{cat}: {count as number}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {cleanupSuggestions.length > 0 && (
        <div className="wb-memory-kun-suggestions">
          <strong>{tr(`发现 ${cleanupSuggestions.length} 条可清理的记忆`, `Found ${cleanupSuggestions.length} memories to clean up`)}</strong>
          <div className="wb-memory-graph-suggestions-grid">
            {cleanupSuggestions.slice(0, 5).map((item: any, index) => (
              <div key={item.id || item.entryId || index} className="ah-chip wb-memory-graph-suggestion-chip">
                {String(item.title || item.reason || item.summary || item.id || item.entryId || tr('清理建议', 'Cleanup suggestion')).slice(0, 160)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PluginSettingsTab({ workspaceId }: { workspaceId: string | null }) {
  const [plugins, setPlugins] = useState<any[]>([])
  const [repositories, setRepositories] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const [repoBranch, setRepoBranch] = useState('')
  const [contributions, setContributions] = useState<any>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Get workspace root if workspaceId is provided
      let workspaceRoot: string | undefined
      if (workspaceId) {
        try {
          const workspaces = await window.electronAPI.workspaces.list()
          const ws = workspaces?.find((w: any) => w.id === workspaceId)
          workspaceRoot = ws?.rootPath
        } catch { /* ignore */ }
      }
      const list = await window.electronAPI.plugins.scan(workspaceRoot)
      setPlugins(Array.isArray(list) ? list : [])
      if (list && list.length > 0) {
        const contribs = await window.electronAPI.plugins.contributions(list)
        setContributions(contribs)
      } else {
        setContributions(null)
      }
    } catch (err: any) {
      setError(err?.message || tr('扫描插件失败', 'Failed to scan plugins'))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const loadRepositories = useCallback(async () => {
    try {
      const list = await window.electronAPI.plugins.repositories()
      setRepositories(Array.isArray(list) ? list : [])
    } catch { /* ignore startup races */ }
  }, [])

  const importRepository = useCallback(async (input: { url: string; id?: string; name?: string; branch?: string }, clearAfter = false) => {
    if (!input.url.trim()) {
      setError(tr('请输入 GitHub 或 GitCode 仓库地址', 'Enter a GitHub or GitCode repository URL'))
      return
    }
    const key = input.id || input.url
    setImporting(key)
    setError(null)
    setImportMessage(null)
    try {
      const result = await window.electronAPI.plugins.importRepository(input)
      if (!result?.ok) {
        setError(result?.error || tr('导入插件仓库失败', 'Failed to import plugin repository'))
        return
      }
      const count = Array.isArray(result.plugins) ? result.plugins.length : result.plugin ? 1 : 0
      setImportMessage(tr(`已导入 ${input.name || result.plugin?.manifest?.name || '插件仓库'}，发现 ${count} 个插件入口。`, `Imported ${input.name || result.plugin?.manifest?.name || 'plugin repository'} with ${count} plugin entr${count === 1 ? 'y' : 'ies'}.`))
      if (clearAfter) {
        setRepoUrl('')
        setRepoBranch('')
      }
      await refresh()
    } catch (err: any) {
      setError(err?.message || tr('导入插件仓库失败', 'Failed to import plugin repository'))
    } finally {
      setImporting(null)
    }
  }, [refresh])

  useEffect(() => {
    refresh()
    loadRepositories()
  }, [refresh, loadRepositories])

  return (
    <div className="wb-settings-stack">
      <section className="glass wb-mcp-clean-card">
        <div className="wb-mcp-clean-head">
          <div>
            <strong>{tr('插件管理', 'Plugin Manager')}</strong>
            <span>{tr('扫描本地插件目录，查看已安装插件的贡献点。', 'Scan local plugin directories and view installed plugin contributions.')}</span>
          </div>
          <button className="ah-btn sm" onClick={refresh} disabled={loading}>
            {loading ? tr('扫描中...', 'Scanning...') : tr('扫描插件', 'Scan Plugins')}
          </button>
        </div>

        {error && <div className="glass wb-error-text">{error}</div>}
        {importMessage && <div className="glass" style={{ padding: 10, color: 'var(--ok)', fontSize: 12 }}>{importMessage}</div>}

        <div className="wb-plugin-repo-list" style={{ marginTop: 12 }}>
          {repositories.map(repo => (
            <div key={repo.id} className="wb-plugin-row">
              <div className="wb-plugin-row-main">
                <strong>{repo.name}</strong>
                <small className="mono">{repo.source || 'builtin'}</small>
                {repo.description && (
                  <div>{repo.description}</div>
                )}
                <code>{repo.url}</code>
              </div>
              <button
                className="ah-btn sm"
                disabled={!!importing}
                onClick={() => importRepository({ id: repo.id, name: repo.name, url: repo.url })}
              >
                {importing === repo.id ? tr('导入中...', 'Importing...') : tr('导入', 'Import')}
              </button>
            </div>
          ))}
          <div className="wb-plugin-import-row">
            <div className="wb-plugin-row-main">
              <strong>{tr('从仓库 URL 导入', 'Import from repository URL')}</strong>
              <input
                className="ah-input mono"
                value={repoUrl}
                onChange={event => setRepoUrl(event.target.value)}
                placeholder="https://github.com/owner/plugin.git"
              />
              <input
                className="ah-input mono"
                value={repoBranch}
                onChange={event => setRepoBranch(event.target.value)}
                placeholder={tr('分支，可选', 'Branch, optional')}
              />
              <span>
                {tr('仅支持 HTTPS GitHub/GitCode 仓库。导入后只扫描 manifest 和 SKILL.md，不执行远程代码。', 'Only HTTPS GitHub/GitCode repositories are supported. AgentHub scans manifest and SKILL.md files only; remote code is not executed.')}
              </span>
            </div>
            <button
              className="ah-btn sm"
              disabled={!!importing || !repoUrl.trim()}
              onClick={() => importRepository({ url: repoUrl.trim(), branch: repoBranch.trim() || undefined }, true)}
            >
              {importing === repoUrl.trim() ? tr('导入中...', 'Importing...') : tr('导入仓库', 'Import Repo')}
            </button>
          </div>
        </div>

        <div className="wb-mcp-clean-stats">
          <div><span>{tr('已发现', 'Found')}</span><strong>{plugins.length}</strong></div>
          {contributions && (
            <>
              <div><span>{tr('命令', 'Commands')}</span><strong>{contributions.commands?.length || 0}</strong></div>
              <div><span>{tr('技能', 'Skills')}</span><strong>{contributions.skills?.length || 0}</strong></div>
              <div><span>{tr('提示词', 'Prompts')}</span><strong>{contributions.prompts?.length || 0}</strong></div>
            </>
          )}
        </div>

        <div className="wb-plugin-installed-list">
          {plugins.map((plugin, idx) => {
            const integrity = plugin.integrity
            const integrityLabel = !integrity
              ? null
              : integrity.status === 'ok'
                ? tr('完整性：通过', 'Integrity: OK')
                : integrity.status === 'unsigned'
                  ? tr('完整性：未签名', 'Integrity: unsigned')
                  : integrity.status === 'mismatch'
                    ? tr('完整性：校验失败', 'Integrity: mismatch')
                    : integrity.status === 'missing'
                      ? tr('完整性：文件缺失', 'Integrity: missing files')
                      : tr('完整性：错误', 'Integrity: error')
            const integrityColor =
              integrity?.status === 'ok' ? 'var(--ok)'
                : integrity?.status === 'unsigned' ? 'var(--muted, #888)'
                  : 'var(--danger, #c44)'
            const signature = plugin.signature
            const signatureLabel = !signature
              ? null
              : signature.status === 'ok'
                ? tr('签名：通过', 'Signature: OK')
                : signature.status === 'none'
                  ? tr('签名：无', 'Signature: none')
                  : signature.status === 'untrusted'
                    ? tr('签名：发布者未信任', 'Signature: untrusted publisher')
                    : signature.status === 'invalid'
                      ? tr('签名：无效', 'Signature: invalid')
                      : tr('签名：错误', 'Signature: error')
            const signatureColor =
              signature?.status === 'ok' ? 'var(--ok)'
                : signature?.status === 'none' || signature?.status === 'untrusted' ? 'var(--muted, #888)'
                  : 'var(--danger, #c44)'
            return (
              <div key={plugin.id || idx} className="wb-plugin-row">
                <div className="wb-plugin-row-main">
                  <strong>{plugin.manifest?.name || plugin.id}</strong>
                  <small className="mono">{plugin.manifest?.version || '?'}</small>
                  {plugin.manifest?.description && (
                    <div>{plugin.manifest.description}</div>
                  )}
                  <code>
                    {tr('来源', 'Source')}: {plugin.source || 'unknown'} · {tr('路径', 'Path')}: {plugin.path || '?'}
                    {plugin.enabled === false ? ` · ${tr('已禁用', 'Disabled')}` : ''}
                  </code>
                  {integrityLabel && (
                    <div style={{ fontSize: 12, marginTop: 4, color: integrityColor }} title={integrity?.message || ''}>
                      {integrityLabel}
                      {integrity?.message ? ` — ${integrity.message}` : ''}
                    </div>
                  )}
                  {signatureLabel && (
                    <div style={{ fontSize: 12, marginTop: 2, color: signatureColor }} title={signature?.message || ''}>
                      {signatureLabel}
                      {signature?.publisher ? ` (${signature.publisher})` : ''}
                      {signature?.message ? ` — ${signature.message}` : ''}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {plugins.length === 0 && !loading && (
            <div className="wb-memory-kun-empty">
              <span>{tr('暂无已发现的插件。', 'No plugins discovered yet.')}</span>
            </div>
          )}
        </div>
      </section>

      <PluginMarketplaceCard onInstalled={() => void refresh()} />
    </div>
  )
}

function PluginMarketplaceCard({ onInstalled }: { onInstalled: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; name: string; version: string; description?: string; publisher: string; repositoryUrl: string; source: string }>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [registryUrl, setRegistryUrl] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await window.electronAPI.plugins.marketplaceList(registryUrl.trim() || undefined)
      setItems(Array.isArray(result?.plugins) ? result.plugins : [])
      if (result?.error) setMsg(result.error)
    } catch (e: any) {
      setItems([])
      setMsg(e?.message || tr('加载市场失败', 'Failed to load marketplace'))
    }
  }, [registryUrl])

  useEffect(() => { void load() }, [load])

  const install = async (id: string) => {
    setBusy(id)
    setMsg(null)
    try {
      const result = await window.electronAPI.plugins.marketplaceInstall(id, { registryUrl: registryUrl.trim() || undefined })
      if (!result?.ok) setMsg(result?.error || tr('安装失败', 'Install failed'))
      else {
        setMsg(tr(`已安装 ${id}`, `Installed ${id}`))
        onInstalled()
      }
    } catch (e: any) {
      setMsg(e?.message || tr('安装失败', 'Install failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="glass wb-mcp-clean-card">
      <div className="wb-mcp-clean-head">
        <div>
          <strong>{tr('插件市场', 'Plugin marketplace')}</strong>
          <span>{tr('浏览内置/远程目录（HTTPS 白名单）。安装走 git 克隆 + 完整性/签名校验。', 'Browse built-in/remote catalogs (HTTPS allowlist). Install uses git clone + integrity/signature checks.')}</span>
        </div>
        <button className="ah-btn sm" onClick={() => void load()} disabled={!!busy}>{tr('刷新目录', 'Refresh catalog')}</button>
      </div>
      {msg && <div className="wb-git-notice" style={{ margin: '8px 0' }}>{msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          className="ah-input mono"
          value={registryUrl}
          onChange={e => setRegistryUrl(e.target.value)}
          placeholder={tr('可选远程 catalog JSON URL（HTTPS）', 'Optional remote catalog JSON URL (HTTPS)')}
          aria-label={tr('远程市场 URL', 'Remote marketplace URL')}
          style={{ flex: 1 }}
        />
      </div>
      <div className="wb-plugin-repo-list">
        {items.map(item => (
          <div key={item.id} className="wb-plugin-row">
            <div className="wb-plugin-row-main">
              <strong>{item.name}</strong>
              <small className="mono">{item.version} · {item.publisher} · {item.source}</small>
              {item.description && <div>{item.description}</div>}
              <code>{item.repositoryUrl}</code>
            </div>
            <button className="ah-btn sm" disabled={!!busy} onClick={() => void install(item.id)}>
              {busy === item.id ? tr('安装中...', 'Installing...') : tr('安装', 'Install')}
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="wb-muted-box">{tr('目录为空。', 'Catalog is empty.')}</div>}
      </div>
    </section>
  )
}

function memoryScopeOf(entry: Partial<MemoryEntry>): Exclude<MemoryScopeFilter, 'all'> {
  const scope = String(entry.metadata?.scope || '').toLowerCase()
  if (scope === 'user' || scope === 'workspace' || scope === 'project') return scope
  if (entry.category === 'project' || entry.category === 'file' || entry.category === 'task') return 'project'
  return 'user'
}

function memoryScopeLabel(scope: MemoryScopeFilter): string {
  return ({
    all: tr('全部', 'All'),
    user: tr('用户', 'User'),
    workspace: tr('工作区', 'Workspace'),
    project: tr('项目', 'Project'),
    deleted: tr('已删除', 'Deleted')
  } as Record<MemoryScopeFilter, string>)[scope]
}

function memoryMeta(entry: Partial<MemoryEntry>): string {
  const timestamp = entry.updatedAt || entry.createdAt
  const updatedAt = timestamp && !Number.isNaN(Date.parse(timestamp))
    ? `${tr('更新', 'Updated')}:${new Date(timestamp).toLocaleDateString()}`
    : ''
  return [
    memoryCategoryLabel(entry.category || 'conversation'),
    memoryStatusLabel(entry.status || 'approved'),
    typeof entry.confidence === 'number' ? `${Math.round(entry.confidence * 100)}%` : '',
    updatedAt,
    entry.metadata?.pinned || entry.metadata?.pin ? tr('置顶', 'Pinned') : '',
    entry.metadata?.scope ? `${tr('作用域', 'Scope')}:${entry.metadata.scope}` : '',
    entry.source ? `${tr('来源', 'Source')}:${entry.source}` : '',
    entry.tags?.length ? `#${entry.tags.slice(0, 3).join(' #')}` : ''
  ].filter(Boolean).join(' / ')
}

function memoryCategoryLabel(category: MemoryCategory): string {
  return ({
    preference: tr('偏好', 'Preference'),
    project: tr('项目', 'Project'),
    style: tr('风格', 'Style'),
    decision: tr('决策', 'Decision'),
    correction: tr('纠正', 'Correction'),
    imported_conversation: tr('导入对话', 'Imported conversation'),
    conversation: tr('会话', 'Conversation'),
    task: tr('任务', 'Task'),
    skill: tr('技能', 'Skill'),
    file: tr('文件', 'File'),
    system: tr('系统', 'System')
  } as Record<MemoryCategory, string>)[category] || category
}

function memoryStatusLabel(status: MemoryEntryStatus): string {
  return ({ approved: tr('已学习', 'Learned'), candidate: tr('待确认', 'Pending'), disabled: tr('已禁用', 'Disabled') } as Record<MemoryEntryStatus, string>)[status] || status
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

  const download = async () => {
    setLoading(true)
    try {
      setStatus(await window.electronAPI.updates.download())
    } finally {
      setLoading(false)
    }
  }

  const install = async () => {
    setLoading(true)
    try {
      setStatus(await window.electronAPI.updates.install())
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
            <strong>{tr('版本与更新', 'Version & Updates')}</strong>
            <span>{tr('检查、下载并安装 GitHub Release 更新。', 'Check, download, and install GitHub Release updates.')}</span>
          </div>
          <Seg value={status?.channel || 'stable'} onChange={value => setChannel(value as UpdateStatus['channel'])} options={[{ value: 'stable', label: tr('稳定版', 'Stable') }, { value: 'preview', label: tr('预览版', 'Preview') }]} />
        </div>
        <div className="wb-tool-summary-grid">
          <div><strong>{status?.version || '-'}</strong><span>{tr('当前版本', 'Current')}</span></div>
          <div><strong>{status?.latestVersion || '-'}</strong><span>{tr('最新版本', 'Latest')}</span></div>
          <div><strong>{updateStateLabel(status)}</strong><span>{tr('状态', 'State')}</span></div>
          <div><strong>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : '-'}</strong><span>{tr('检查时间', 'Checked at')}</span></div>
        </div>
        {typeof status?.downloadProgress === 'number' && (
          <div className="wb-update-progress" aria-label={tr('下载进度', 'Download progress')}>
            <span style={{ width: `${Math.max(0, Math.min(100, status.downloadProgress))}%` }} />
          </div>
        )}
        {status?.devMode && <div className="wb-note-text">{tr('开发/测试模式不会访问 GitHub；打包后的 Release 版本才会检查远程更新。', 'Development/test mode does not contact GitHub; packaged release builds check remote updates.')}</div>}
        {status?.error && <div className="wb-error-text">{status.error}</div>}
        <div className="wb-card-actions">
          <button className="ah-btn sm primary" onClick={check} disabled={loading || status?.canCheck === false}>{loading && status?.state === 'checking' ? tr('检查中', 'Checking') : tr('检查更新', 'Check updates')}</button>
          <button className="ah-btn sm" onClick={download} disabled={loading || !status?.canDownload}>{status?.state === 'downloading' ? tr('下载中', 'Downloading') : tr('下载更新', 'Download update')}</button>
          <button className="ah-btn sm" onClick={install} disabled={loading || !status?.canInstall}>{tr('重启安装', 'Restart to install')}</button>
          <button className="ah-btn sm" onClick={() => window.electronAPI.updates.openDownload()}>{tr('打开下载页', 'Open download page')}</button>
          <button className="ah-btn sm" onClick={refresh} disabled={loading}>{tr('刷新状态', 'Refresh status')}</button>
        </div>
      </div>
    </div>
  )
}

function updateStateLabel(status: UpdateStatus | null): string {
  if (!status?.state) return '-'
  const labels: Record<string, string> = {
    idle: tr('空闲', 'Idle'),
    checking: tr('检查中', 'Checking'),
    available: tr('可更新', 'Available'),
    'not-available': tr('已是最新', 'Up to date'),
    downloading: tr('下载中', 'Downloading'),
    downloaded: tr('已下载', 'Downloaded'),
    error: tr('错误', 'Error')
  }
  return labels[status.state] || status.state
}

function DiagnosticsSettingsTab() {
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<ElectronAPI['diagnostics']['run']>> | null>(null)
  const [logs, setLogs] = useState<RecentAppEventLogs | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextDiagnostics, nextLogs] = await Promise.all([
        window.electronAPI.diagnostics.run(),
        window.electronAPI.diagnostics.recentLogs(100)
      ])
      setDiagnostics(nextDiagnostics)
      setLogs(nextLogs)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const recentErrors = useMemo(() => {
    return (logs?.entries || []).filter(entry => {
      const kind = String(entry.kind || '')
      return kind.includes('error') || kind.includes('Exception') || kind.includes('Rejection') || !!entry.parseError
    }).slice(-20).reverse()
  }, [logs])
  const recentEvents = useMemo(() => [...(logs?.entries || [])].slice(-80).reverse(), [logs])

  return (
    <div className="wb-settings-stack wb-diagnostics-tab">
      <div className="glass wb-inline-panel">
        <div>
          <strong>{tr('\u8bca\u65ad\u4e0e\u65e5\u5fd7', 'Diagnostics and logs')}</strong>
          <span>{tr('\u8fd0\u884c\u5feb\u901f\u68c0\u67e5\uff0c\u5e76\u67e5\u770b\u6700\u8fd1\u7684\u7ed3\u6784\u5316\u5e94\u7528\u4e8b\u4ef6\u3002', 'Run quick checks and inspect recent structured app events.')}</span>
        </div>
        <button className="ah-btn sm primary" onClick={refresh} disabled={loading}>
          <Icon d={IC.refresh} size={13} /> {loading ? tr('\u8bca\u65ad\u4e2d', 'Running') : tr('\u5237\u65b0\u8bca\u65ad', 'Refresh diagnostics')}
        </button>
      </div>

      {error && <div className="glass wb-error-text">{error}</div>}

      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('\u7cfb\u7edf\u68c0\u67e5', 'System checks')}</strong>
            <span>{diagnostics?.timestamp ? new Date(diagnostics.timestamp).toLocaleString() : tr('\u5c1a\u672a\u8fd0\u884c', 'Not run yet')}</span>
          </div>
        </div>
        <div className="wb-tool-summary-grid">
          <div><strong>{diagnostics?.summary.pass ?? 0}</strong><span>Pass</span></div>
          <div><strong>{diagnostics?.summary.warn ?? 0}</strong><span>Warn</span></div>
          <div><strong>{diagnostics?.summary.fail ?? 0}</strong><span>Fail</span></div>
          <div><strong>{diagnostics?.summary.skip ?? 0}</strong><span>Skip</span></div>
        </div>
        <div className="wb-diagnostics-checks">
          {(diagnostics?.results || []).map(result => (
            <div key={result.id} className={`wb-diagnostics-check ${result.status}`}>
              <span>{result.status}</span>
              <div>
                <strong>{getLang() === 'en' ? result.name : (result as any).nameZh || result.name}</strong>
                <small>{result.message}</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('\u6700\u8fd1\u9519\u8bef', 'Recent errors')}</strong>
            <span>{tr('\u6765\u81ea\u4e3b\u8fdb\u7a0b app-event-log\uff0c\u7528\u4e8e\u5feb\u901f\u5b9a\u4f4d IPC \u6216\u672a\u5904\u7406\u5f02\u5e38\u3002', 'From the main-process app-event-log for quick IPC and unhandled error triage.')}</span>
          </div>
        </div>
        {recentErrors.length === 0 ? (
          <div className="wb-empty-row">{tr('\u6700\u8fd1\u65e5\u5fd7\u91cc\u6ca1\u6709\u9519\u8bef\u4e8b\u4ef6\u3002', 'No error events in the recent log window.')}</div>
        ) : (
          <div className="wb-diagnostics-log-list">
            {recentErrors.map((entry, index) => <DiagnosticsLogRow key={`${entry.ts || 'error'}-${index}`} entry={entry} />)}
          </div>
        )}
      </div>

      <div className="glass wb-provider-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('\u6700\u8fd1\u4e8b\u4ef6', 'Recent events')}</strong>
            <span className="mono">{logs?.path || '-'}</span>
          </div>
        </div>
        {logs?.error && <div className="wb-error-text">{logs.error}</div>}
        <div className="wb-tool-summary-grid">
          <div><strong>{logs?.entries.length ?? 0}</strong><span>{tr('\u5df2\u8bfb\u53d6', 'Loaded')}</span></div>
          <div><strong>{logs?.scannedLines ?? 0}</strong><span>{tr('\u626b\u63cf\u884c', 'Scanned')}</span></div>
          <div><strong>{logs?.truncated ? tr('\u662f', 'Yes') : tr('\u5426', 'No')}</strong><span>{tr('\u5df2\u622a\u65ad', 'Truncated')}</span></div>
          <div><strong>{logs?.parseWarnings.length ?? 0}</strong><span>{tr('\u89e3\u6790\u8b66\u544a', 'Parse warnings')}</span></div>
        </div>
        <div className="wb-diagnostics-log-list">
          {recentEvents.map((entry, index) => <DiagnosticsLogRow key={`${entry.ts || 'event'}-${index}`} entry={entry} />)}
        </div>
      </div>
    </div>
  )
}

function DiagnosticsLogRow({ entry }: { entry: AppEventLogEntry }) {
  const kind = String(entry.kind || (entry.parseError ? 'parse:error' : 'event'))
  const details = Object.entries(entry)
    .filter(([key]) => key !== 'ts' && key !== 'kind')
    .reduce<Record<string, unknown>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
  return (
    <div className={`wb-diagnostics-log-row ${kind.includes('error') || entry.parseError ? 'error' : ''}`}>
      <div>
        <strong>{kind}</strong>
        <span>{entry.ts ? new Date(String(entry.ts)).toLocaleString() : '-'}</span>
      </div>
      <pre>{JSON.stringify(details, null, 2)}</pre>
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
              <p>{tr('主题和字体会立即应用到工作台。', 'Theme and fonts apply to the workbench immediately.')}</p>
              <code>+ preview.diff</code>
            </main>
          </div>
        </div>
        <div>
          <strong>{tr('外观', 'Appearance')}</strong>
          <span>{tr('调整主题、字体、动效和编辑体验。设置会自动保存。', 'Adjust theme, fonts, motion, and editing feel. Preferences are saved automatically.')}</span>
        </div>
        <button className="ah-btn sm" onClick={reset}>{tr('恢复默认', 'Reset defaults')}</button>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('主题', 'Theme')}</strong>
            <span>{tr('可跟随系统，也可以固定为浅色或深色。', 'Follow the system, or pin light or dark mode.')}</span>
          </div>
        </div>
        <div className="wb-appearance-row">
          <div><strong>{tr('主题模式', 'Theme mode')}</strong><span>{tr('选择工作台整体明暗风格。', 'Choose the workbench light/dark style.')}</span></div>
          <Seg value={prefs.themeMode} onChange={value => update(themeModePatch(value as AppearancePreferences['themeMode']))} options={[
            { value: 'light', label: tr('浅色', 'Light') },
            { value: 'dark', label: tr('深色', 'Dark') },
            { value: 'system', label: tr('系统', 'System') }
          ]} />
        </div>
        <div className="wb-appearance-theme-grid">
          <ThemePresetCard active={prefs.themeMode === 'light'} title="AgentHub Light" detail={tr('明亮桌面工作台', 'Bright desktop workbench')} colors={['#f7f8fb', '#ffffff', prefs.accentColor]} onClick={() => update({ themeMode: 'light', backgroundColor: '#f7f8fb', foregroundColor: '#20242c' })} />
          <ThemePresetCard active={prefs.themeMode === 'dark'} title="AgentHub Dark" detail={tr('低亮度专注模式', 'Low-light focus mode')} colors={['#10141c', '#161b24', prefs.accentColor]} onClick={() => update({ themeMode: 'dark', backgroundColor: '#10141c', foregroundColor: '#e7edf7' })} />
        </div>
        <div className="wb-appearance-row">
          <div><strong>{tr('界面风格', 'UI Style')}</strong><span>{tr('窗口控制样式：macOS 红绿灯或 Windows 按钮。', 'Window controls: macOS traffic lights or Windows buttons.')}</span></div>
          <Seg value={prefs.uiStyle} onChange={value => {
            const next = normalizeAppearance({ ...prefs, uiStyle: value as 'mac' | 'win' })
            setPrefs(next)
            applyAppearance(next)
            void saveAppearance(next)
          }} options={[
            { value: 'mac', label: 'macOS' },
            { value: 'win', label: 'Windows' }
          ]} />
        </div>
        <div className="wb-ui-style-preview-grid">
          {(['mac', 'win'] as const).map(style => (
            <button
              key={style}
              className={`wb-ui-style-preview ${prefs.uiStyle === style ? 'active' : ''}`}
              data-preview-style={style}
              onClick={() => update({ uiStyle: style })}
            >
              <div className="wb-ui-style-window">
                <div className="wb-ui-style-titlebar">
                  {style === 'mac' ? <span className="traffic"><i /><i /><i /></span> : <span className="win-controls"><i /><i /><i /></span>}
                </div>
                <div className="wb-ui-style-body">
                  <aside><i /><i /><i /></aside>
                  <main><strong>{style === 'mac' ? 'Mac Preview' : 'Windows Preview'}</strong><span /></main>
                </div>
              </div>
              <strong>{style === 'mac' ? 'macOS' : 'Windows'}</strong>
              <span>{style === 'mac' ? tr('红绿灯窗口控制', 'Traffic light controls') : tr('标准窗口按钮', 'Standard window buttons')}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('颜色', 'Colors')}</strong>
            <span>{tr('保留简洁风格，只调整核心色值。', 'Keep the simple style while tuning core colors.')}</span>
          </div>
        </div>
        <div className="wb-appearance-grid three">
          <ColorField label={tr('强调色', 'Accent')} value={prefs.accentColor} onChange={value => update({ accentColor: value })} />
          <ColorField label={tr('背景色', 'Background')} value={prefs.backgroundColor} onChange={value => update({ backgroundColor: value })} />
          <ColorField label={tr('前景色', 'Foreground')} value={prefs.foregroundColor} onChange={value => update({ foregroundColor: value })} />
        </div>
        <RangeRow label={tr('对比度', 'Contrast')} detail={tr('增强或降低界面边界与文字层级。', 'Increase or soften UI boundaries and text hierarchy.')} value={prefs.contrast} min={80} max={125} suffix="%" onChange={value => update({ contrast: value })} />
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('字体', 'Fonts')}</strong>
            <span>{tr('UI 字体作用于界面，代码字体作用于终端、Diff 和代码块。', 'UI font affects the interface; code font affects terminal, diff, and code blocks.')}</span>
          </div>
        </div>
        <div className="wb-appearance-grid two">
          <label className="wb-field">
            <span>{tr('UI 字体', 'UI font')}</span>
            <input className="ah-input" value={prefs.uiFont} onChange={event => update({ uiFont: event.target.value })} />
          </label>
          <label className="wb-field">
            <span>{tr('代码字体', 'Code font')}</span>
            <input className="ah-input mono" value={prefs.codeFont} onChange={event => update({ codeFont: event.target.value })} />
          </label>
        </div>
        <div className="wb-appearance-grid two">
          <StepperRow label={tr('UI 字号', 'UI size')} value={prefs.uiFontSize} min={12} max={18} onChange={value => update({ uiFontSize: value })} />
          <StepperRow label={tr('代码字号', 'Code size')} value={prefs.codeFontSize} min={11} max={18} onChange={value => update({ codeFontSize: value })} />
        </div>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('交互', 'Interaction')}</strong>
            <span>{tr('控制侧栏、光标、动效和 Diff 标记的呈现。', 'Control sidebar, cursor, motion, and diff marker behavior.')}</span>
          </div>
        </div>
        <PreferenceRow title={tr('半透明侧栏', 'Translucent sidebar')} detail={tr('让左侧栏轻微透出桌面背景。', 'Let the sidebar subtly show the desktop background.')}>
          <Switch on={prefs.translucentSidebar} onChange={value => update({ translucentSidebar: value })} />
        </PreferenceRow>
        <PreferenceRow title={tr('按钮使用指针光标', 'Pointer cursor on buttons')} detail={tr('关闭后按钮不再强制显示手型光标。', 'When off, buttons no longer force a pointer cursor.')}>
          <Switch on={prefs.usePointerCursor} onChange={value => update({ usePointerCursor: value })} />
        </PreferenceRow>
        <PreferenceRow title={tr('动效强度', 'Motion level')} detail={tr('影响弹层、面板和列表的过渡动画。', 'Affects transitions for popovers, panels, and lists.')}>
          <Seg value={prefs.motion} onChange={value => update({ motion: value as MotionLevel })} options={[
            { value: 'off', label: tr('关闭', 'Off') },
            { value: 'subtle', label: tr('简洁', 'Subtle') },
            { value: 'rich', label: tr('丰富', 'Rich') }
          ]} />
        </PreferenceRow>
        <PreferenceRow title={tr('Agent 运行超时', 'Agent run timeout')} detail={tr('单个 Agent 超过该时长会自动停止，并标记为超时失败。', 'An Agent is stopped and marked timed out after this duration.')}>
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
            <span>{tr(`${runTimeoutMinutes} 分钟`, `${runTimeoutMinutes} min`)}</span>
          </div>
        </PreferenceRow>
        <PreferenceRow title={tr('Diff 标记', 'Diff marker')} detail={tr('选择只用颜色，或同时显示 +/- 标记。', 'Choose color-only markers or show +/- signs too.')}>
          <Seg value={prefs.diffMarker} onChange={value => update({ diffMarker: value as DiffMarkerStyle })} options={[
            { value: 'color', label: tr('颜色', 'Color') },
            { value: 'sign', label: '+/-' }
          ]} />
        </PreferenceRow>
      </div>

      <div className="glass wb-provider-card wb-appearance-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('通用偏好', 'General preferences')}</strong>
            <span>{tr('这些选项会保存到本机设置；已有运行时支持的项目会直接生效。', 'These options are saved locally; runtime-supported items apply immediately.')}</span>
          </div>
        </div>
        <PreferenceRow title={tr('启动打开区域', 'Startup area')} detail={tr('应用启动后优先进入的区域。', 'Choose which area opens first when the app starts.')}>
          <select className="ah-select" value={prefs.startupOpenTarget} onChange={event => update({ startupOpenTarget: event.target.value as StartupOpenTarget })}>
            <option value="chat">{tr('新对话', 'New chat')}</option>
            <option value="last">{tr('上次位置', 'Last location')}</option>
            <option value="settings">{tr('设置', 'Settings')}</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title={tr('默认打开目标', 'Default open target')} detail={tr('点击文件路径或文件夹时使用的打开方式。', 'Choose how file and folder references open.')}>
          <select className="ah-select" value={prefs.defaultOpenTarget} onChange={event => update({ defaultOpenTarget: event.target.value as DefaultOpenTarget })}>
            <option value="antigravity">Antigravity</option>
            <option value="explorer">{tr('文件管理器', 'File Explorer')}</option>
            <option value="system">{tr('系统默认', 'System default')}</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title={tr('默认附件位置', 'Default attachment location')} detail={tr('添加文件或图片附件时优先打开的位置。', 'Preferred starting folder when adding file or image attachments.')}>
          <DialogLocationControl
            value={prefs.defaultFileLocation}
            customPath={prefs.defaultFilePath}
            kind="file"
            onModeChange={value => update({ defaultFileLocation: value })}
            onPathChange={value => update({ defaultFilePath: value })}
          />
        </PreferenceRow>
        <PreferenceRow title={tr('默认文件夹位置', 'Default folder location')} detail={tr('添加或编辑工作目录时优先打开的位置。', 'Preferred starting folder when adding or editing working folders.')}>
          <DialogLocationControl
            value={prefs.defaultFolderLocation}
            customPath={prefs.defaultFolderPath}
            kind="folder"
            onModeChange={value => update({ defaultFolderLocation: value })}
            onPathChange={value => update({ defaultFolderPath: value })}
          />
        </PreferenceRow>
        <PreferenceRow title={tr('Agent 环境', 'Agent environment')} detail={tr('控制后续 Agent 进程继承环境的偏好。', 'Controls how future Agent processes inherit the environment.')}>
          <select className="ah-select" value={prefs.agentEnvironment} onChange={event => update({ agentEnvironment: event.target.value as AgentEnvironment })}>
            <option value="inherit">{tr('继承当前环境', 'Inherit current environment')}</option>
            <option value="clean">{tr('干净环境', 'Clean environment')}</option>
            <option value="login-shell">{tr('登录 Shell', 'Login shell')}</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title={tr('集成终端 Shell', 'Integrated terminal shell')} detail={tr('/terminal 会使用这个 Shell 执行命令。', '/terminal uses this shell to run commands.')}>
          <select className="ah-select" value={prefs.terminalShell} onChange={event => update({ terminalShell: event.target.value as TerminalShell })}>
            <option value="system">{tr('系统默认', 'System default')}</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">Cmd</option>
            <option value="git-bash">Git Bash</option>
            <option value="wsl">WSL</option>
          </select>
        </PreferenceRow>
        <PreferenceRow title={tr('界面语言', 'Interface language')} detail={tr('切换后立即生效（整页按语言重挂载）。', 'Applies immediately (app remounts for language).')}>
          <Seg value={prefs.language} onChange={value => update({ language: value as AppearancePreferences['language'] })} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
        </PreferenceRow>
      </div>

      {/* F-W8: backup create / restore entry */}
      <BackupSettingsCard />
      {/* Wave4 P2: encrypted multi-machine sync */}
      <ConfigSyncSettingsCard />
      {/* Wave4+: WebDAV auto sync */}
      <WebDavSyncSettingsCard />
    </div>
  )
}

function WebDavSyncSettingsCard() {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [autoMinutes, setAutoMinutes] = useState(0)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [passwordSet, setPasswordSet] = useState(false)

  const reload = useCallback(async () => {
    try {
      const cfg = await window.electronAPI.sync.webdavGetConfig()
      setUrl(cfg?.url || '')
      setUsername(cfg?.username || '')
      setEnabled(Boolean(cfg?.enabled))
      setAutoMinutes(cfg?.autoSyncMinutes || 0)
      setPasswordSet(Boolean(cfg?.passwordSet))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const view = await window.electronAPI.sync.webdavSetConfig({
        url,
        username,
        password: password || undefined,
        enabled,
        autoSyncMinutes: autoMinutes
      })
      setPasswordSet(Boolean(view?.passwordSet))
      setPassword('')
      setMsg(tr('WebDAV 配置已保存', 'WebDAV settings saved'))
    } catch (e: any) {
      setMsg(e?.message || tr('保存失败', 'Save failed'))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.sync.webdavTest({
        url,
        username,
        password: password || undefined
      })
      setMsg(result?.ok
        ? tr(`连接成功 (${result.status || 200})`, `Connected (${result.status || 200})`)
        : (result?.error || tr('连接失败', 'Connection failed')))
    } catch (e: any) {
      setMsg(e?.message || tr('连接失败', 'Connection failed'))
    } finally {
      setBusy(false)
    }
  }

  const push = async () => {
    if (passphrase.length < 8) {
      setMsg(tr('同步口令至少 8 位', 'Passphrase must be at least 8 characters'))
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.sync.webdavPush(passphrase)
      setMsg(result?.ok
        ? tr(`已推送到 WebDAV（${result.keys?.length || 0} 键）`, `Pushed to WebDAV (${result.keys?.length || 0} keys)`)
        : (result?.error || tr('推送失败', 'Push failed')))
    } catch (e: any) {
      setMsg(e?.message || tr('推送失败', 'Push failed'))
    } finally {
      setBusy(false)
    }
  }

  const pull = async () => {
    if (passphrase.length < 8) {
      setMsg(tr('同步口令至少 8 位', 'Passphrase must be at least 8 characters'))
      return
    }
    const ok = await styledConfirm({
      message: tr('确认从 WebDAV 拉取并覆盖本地配置键？', 'Pull from WebDAV and overwrite local config keys?'),
      danger: true
    })
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.sync.webdavPull(passphrase)
      setMsg(result?.ok
        ? tr(`已拉取并恢复 ${result.restored?.length || 0} 项`, `Pulled and restored ${result.restored?.length || 0} keys`)
        : (result?.error || tr('拉取失败', 'Pull failed')))
    } catch (e: any) {
      setMsg(e?.message || tr('拉取失败', 'Pull failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass wb-provider-card wb-appearance-card">
      <div className="wb-card-head">
        <div>
          <strong>{tr('WebDAV 自动同步', 'WebDAV auto sync')}</strong>
          <span>{tr('将口令加密的同步包上传/下载到自建 WebDAV（仅 HTTPS）。Provider 密钥仍为本机绑定。', 'Upload/download passphrase-encrypted sync packages to your WebDAV (HTTPS only). Provider keys remain machine-bound.')}</span>
        </div>
      </div>
      {msg && <div className="wb-git-notice" style={{ margin: '8px 0' }}>{msg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <input className="ah-input mono" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://dav.example/remote.php/dav/files/user/agenthub/" aria-label="WebDAV URL" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="ah-input" value={username} onChange={e => setUsername(e.target.value)} placeholder={tr('用户名', 'Username')} aria-label={tr('用户名', 'Username')} style={{ minWidth: 140 }} />
          <input className="ah-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={passwordSet ? tr('密码（留空保留）', 'Password (blank keeps)') : tr('密码', 'Password')} aria-label={tr('密码', 'Password')} style={{ minWidth: 140 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            {tr('启用', 'Enabled')}
          </label>
          <input className="ah-input" type="number" min={0} max={1440} value={autoMinutes} onChange={e => setAutoMinutes(Number(e.target.value) || 0)} title={tr('自动同步间隔（分钟，0=关）', 'Auto-sync minutes (0=off)')} aria-label={tr('自动同步分钟', 'Auto-sync minutes')} style={{ width: 100 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="ah-btn sm" disabled={busy} onClick={() => void save()}>{tr('保存', 'Save')}</button>
          <button className="ah-btn sm" disabled={busy} onClick={() => void test()}>{tr('测试连接', 'Test')}</button>
          <input className="ah-input" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder={tr('包口令 ≥8', 'Package passphrase ≥8')} aria-label={tr('同步包口令', 'Sync passphrase')} style={{ minWidth: 140 }} />
          <button className="ah-btn sm" disabled={busy} onClick={() => void push()}>{tr('推送', 'Push')}</button>
          <button className="ah-btn sm" disabled={busy} onClick={() => void pull()}>{tr('拉取', 'Pull')}</button>
        </div>
      </div>
    </div>
  )
}

function ConfigSyncSettingsCard() {
  const [items, setItems] = useState<Array<{ filename: string; createdAt: string; sizeBytes: number; keys: string[] }>>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [exportPass, setExportPass] = useState('')
  const [importPass, setImportPass] = useState('')

  const reload = useCallback(async () => {
    try {
      const list = await window.electronAPI.sync.list()
      setItems((list || []).slice(0, 8))
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const doExport = async () => {
    if (exportPass.length < 8) {
      setMsg(tr('导出口令至少 8 位', 'Export passphrase must be at least 8 characters'))
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.sync.export(exportPass)
      if (!result?.ok) setMsg(result?.error || tr('导出失败', 'Export failed'))
      else setMsg(tr(`已导出同步包 ${result.filename || ''}`, `Sync package exported ${result.filename || ''}`))
      setExportPass('')
      await reload()
    } catch (e: any) {
      setMsg(e?.message || tr('导出失败', 'Export failed'))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (filename: string) => {
    if (importPass.length < 8) {
      setMsg(tr('导入口令至少 8 位', 'Import passphrase must be at least 8 characters'))
      return
    }
    const preview = await window.electronAPI.sync.preview(filename).catch(() => null)
    const keys = preview?.keys?.join(', ') || filename
    const ok = await styledConfirm({
      message: tr(`确认导入同步包？将覆盖配置键：${keys}`, `Import sync package? This overwrites config keys: ${keys}`),
      danger: true
    })
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.sync.import(filename, importPass)
      if (!result?.ok) setMsg(result?.error || tr('导入失败', 'Import failed'))
      else setMsg(tr(
        `已导入 ${result.restored?.length || 0} 项。建议重启应用。`,
        `Imported ${result.restored?.length || 0} keys. Restart the app if needed.`
      ))
      setImportPass('')
    } catch (e: any) {
      setMsg(e?.message || tr('导入失败', 'Import failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass wb-provider-card wb-appearance-card">
      <div className="wb-card-head">
        <div>
          <strong>{tr('配置同步 / 迁移', 'Config sync / migrate')}</strong>
          <span>{tr('用口令加密导出后可拷贝到另一台机器导入。Provider API Key 由本机 safeStorage 绑定，跨机导入后需重新填写。', 'Password-encrypt export, then import on another machine. Provider API keys are machine-bound (OS safeStorage); re-enter keys after cross-machine import.')}</span>
        </div>
      </div>
      {msg && <div className="wb-git-notice" style={{ margin: '8px 0' }}>{msg}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input
          className="ah-input"
          type="password"
          value={exportPass}
          onChange={e => setExportPass(e.target.value)}
          placeholder={tr('导出口令（≥8）', 'Export passphrase (≥8)')}
          aria-label={tr('导出口令', 'Export passphrase')}
          style={{ minWidth: 160 }}
        />
        <button className="ah-btn sm" disabled={busy} onClick={() => void doExport()}>{tr('加密导出', 'Encrypt & export')}</button>
        <input
          className="ah-input"
          type="password"
          value={importPass}
          onChange={e => setImportPass(e.target.value)}
          placeholder={tr('导入口令', 'Import passphrase')}
          aria-label={tr('导入口令', 'Import passphrase')}
          style={{ minWidth: 160 }}
        />
      </div>
      {items.length === 0 ? (
        <div className="wb-muted-box">{tr('暂无同步包。', 'No sync packages yet.')}</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map(item => (
            <li key={item.filename} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-1)' }}>
              <span style={{ fontSize: 12 }}>
                <code>{item.filename}</code>
                <small style={{ marginLeft: 8, opacity: 0.7 }}>{item.createdAt}</small>
              </span>
              <button className="ah-btn sm" disabled={busy} onClick={() => void doImport(item.filename)} aria-label={tr('导入同步包', 'Import sync package')}>
                {tr('导入', 'Import')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BackupSettingsCard() {
  const [items, setItems] = useState<Array<{ filename: string; createdAt: string; sizeBytes: number }>>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const list = await window.electronAPI.backup.list()
      setItems((list || []).slice(0, 8).map((b: any) => ({
        filename: b.filename,
        createdAt: b.createdAt,
        sizeBytes: b.sizeBytes || 0
      })))
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const create = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.backup.create()
      if (result?.error) setMsg(result.error)
      else setMsg(tr(`已创建备份 ${result.filename || ''}`, `Backup created ${result.filename || ''}`))
      await reload()
    } catch (e: any) {
      setMsg(e?.message || tr('创建失败', 'Create failed'))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (filename: string) => {
    const ok = await styledConfirm({
      message: tr(`确认从备份恢复？将覆盖本地配置键：${filename}`, `Restore from backup? This overwrites local config keys: ${filename}`),
      danger: true
    })
    if (!ok) return
    setBusy(true)
    setMsg(null)
    try {
      const result = await window.electronAPI.backup.restore(filename)
      if (result?.error) setMsg(result.error)
      else setMsg(tr(
        `已恢复 ${result.restored?.length || 0} 项。部分配置可能需要重启应用后完全生效。`,
        `Restored ${result.restored?.length || 0} keys. Restart the app if some settings do not apply fully.`
      ))
    } catch (e: any) {
      setMsg(e?.message || tr('恢复失败', 'Restore failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass wb-provider-card wb-appearance-card">
      <div className="wb-card-head">
        <div>
          <strong>{tr('配置备份', 'Config backup')}</strong>
          <span>{tr('创建加密形态的本地备份，并可从备份恢复。', 'Create local backups (keys stay encrypted) and restore them.')}</span>
        </div>
        <button className="ah-btn sm" disabled={busy} onClick={() => void create()}>{tr('立即备份', 'Backup now')}</button>
      </div>
      {msg && <div className="wb-git-notice" style={{ margin: '8px 0' }}>{msg}</div>}
      {items.length === 0 ? (
        <div className="wb-muted-box">{tr('暂无备份文件。', 'No backups yet.')}</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map(item => (
            <li key={item.filename} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-1)' }}>
              <span style={{ fontSize: 12 }}>
                <code>{item.filename}</code>
                <small style={{ marginLeft: 8, opacity: 0.7 }}>{item.createdAt}</small>
              </span>
              <button className="ah-btn sm" disabled={busy} onClick={() => void restore(item.filename)}>{tr('恢复', 'Restore')}</button>
            </li>
          ))}
        </ul>
      )}
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

function DialogLocationControl({ value, customPath, kind, onModeChange, onPathChange }: {
  value: DefaultDialogLocation
  customPath: string
  kind: 'file' | 'folder'
  onModeChange: (value: DefaultDialogLocation) => void
  onPathChange: (value: string) => void
}) {
  const pickCustomPath = async () => {
    const picked = await window.electronAPI.app.pickFolder({ defaultPath: customPath || defaultDialogPath('folder') })
    if (!picked) return
    rememberDialogPath('folder', picked)
    onPathChange(picked)
    onModeChange('custom')
  }
  return (
    <div className="wb-dialog-location-control">
      <select className="ah-select" value={value} onChange={event => onModeChange(event.target.value as DefaultDialogLocation)}>
        <option value="last">{tr('上次使用位置', 'Last used location')}</option>
        <option value="workspace">{tr('当前工作目录', 'Current workspace')}</option>
        <option value="custom">{tr('自定义目录', 'Custom folder')}</option>
      </select>
      {value === 'custom' && (
        <div className="wb-folder-picker">
          <input className="ah-input mono" value={customPath} onChange={event => onPathChange(event.target.value)} placeholder={kind === 'file' ? tr('附件默认目录', 'Attachment default folder') : tr('文件夹默认目录', 'Folder default location')} />
          <button className="ah-btn sm" onClick={pickCustomPath}>{tr('选择', 'Choose')}</button>
        </div>
      )}
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

function _formatToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k tokens`
  return `${value} tokens`
}
