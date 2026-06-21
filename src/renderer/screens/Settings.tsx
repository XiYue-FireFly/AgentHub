import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, IC, AgentMark, Seg, Switch } from '../glass/ui'
import { AGENT_META, AGENT_IDS, BindingDef, DEFAULT_STDIO_ARGS, ProviderDef } from '../glass/meta'
import { agentDesc, getLang, setLang, Lang, tr } from '../glass/i18n'
import { styledConfirm } from '../lib/confirm'
import { ProvidersTab } from './ProvidersTab'
import { RoutingTab } from './RoutingTab'
import { ApprovalsTab } from './ApprovalsTab'
import { WorkspacesTab } from './WorkspacesTab'
import { McpSettingsTab } from './McpSettingsTab'
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
import {
  findKeyboardShortcutConflict,
  KEYBOARD_SHORTCUT_COMMANDS,
  KEYBOARD_SHORTCUT_STORE_KEY,
  KEYBOARD_SHORTCUTS_CHANGED,
  KeyboardShortcutCommandId,
  KeyboardShortcutsConfigV1,
  keyboardEventToShortcut,
  normalizeKeyboardShortcuts,
  resolveKeyboardShortcutBindings,
  shortcutDisplay
} from '../keyboard-shortcuts'
// Phase 4 lazy loading: UsageStatsDashboard loaded on demand
const UsageStatsTabFull = React.lazy(() => import('./UsageStatsDashboard').then(m => ({ default: m.UsageStatsDashboard })))

export type MotionLevel = 'off' | 'subtle' | 'rich'

type TabKey = SetupTab | 'appearance' | 'memory' | 'updates' | 'shortcuts' | 'models' | 'plugins' | 'usage'
const MEMORY_CATEGORIES: MemoryCategory[] = ['preference', 'project', 'style', 'decision', 'correction', 'imported_conversation', 'conversation', 'task', 'skill', 'file', 'system']
const MEMORY_SCOPES = ['all', 'user', 'workspace', 'project'] as const
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

  const visibleTab = tab
  const active = VISIBLE_NAV_ITEMS.find(item => item.value === visibleTab) ?? VISIBLE_NAV_ITEMS[0]
  const showSetupNext = visibleTab === 'providers' || visibleTab === 'local-agents' || visibleTab === 'routing' || visibleTab === 'workspaces'

  return (
    <div className="wb-settings wb-settings-shell" data-screen-label={tr('设置', 'Settings')}>
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
            onSetEnabled={props.onSetEnabled}
            onSetKey={props.onSetKey}
            onReload={props.onReload}
            onUpsert={props.onUpsertProvider}
            onDelete={props.onDeleteProvider}
          />
        )}
        {visibleTab === 'local-agents' && <LocalAgentsTab />}
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
        {visibleTab === 'shortcuts' && <ShortcutsSettingsTab />}
        {visibleTab === 'memory' && <MemorySettingsTab />}
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
                <strong>{config.agentId === 'codex' ? 'Codex' : 'Gemini'}</strong>
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
        <span className={agent.configured || agent.installed ? 'ah-chip mint' : 'ah-chip'}>{localAgentStatusLabel(agent, needsPromptArg)}</span>
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

function localAgentStatusLabel(agent: LocalAgentStatus, needsPromptArg: boolean): string {
  if (agent.configured) return tr('可使用', 'Usable')
  if (agent.installed) return tr('已检测', 'Detected')
  if (needsPromptArg) return tr('需要参数', 'Args required')
  if (agent.candidateKind === 'desktop') return tr('桌面候选', 'Desktop candidate')
  if (agent.candidateKind === 'cli') return tr('检测到 CLI，待配置', 'CLI detected, configure to use')
  return tr('候选', 'Candidate')
}

function localAgentDisplayLabel(agent: LocalAgentStatus): string {
  if (getLang() === 'zh') return agent.label
  return agent.label.replace(/\s*\/\s*反重力/g, '')
}

function stdioArgsHint(agentId: string): string {
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

function ShortcutsSettingsTab() {
  const [settings, setSettings] = useState<KeyboardShortcutsConfigV1>({ bindings: {} })
  const [search, setSearch] = useState('')
  const [recording, setRecording] = useState<KeyboardShortcutCommandId | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const bindings = useMemo(() => resolveKeyboardShortcutBindings(settings), [settings])
  const filteredCommands = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return KEYBOARD_SHORTCUT_COMMANDS
    return KEYBOARD_SHORTCUT_COMMANDS.filter(command => [
      command.labelZh,
      command.labelEn,
      command.descriptionZh,
      command.descriptionEn,
      command.id,
      ...(bindings[command.id] || [])
    ].join(' ').toLowerCase().includes(needle))
  }, [search, bindings])

  useEffect(() => {
    let alive = true
    window.electronAPI.store.get(KEYBOARD_SHORTCUT_STORE_KEY)
      .then(value => { if (alive) setSettings(normalizeKeyboardShortcuts(value || { bindings: {} })) })
      .catch(() => { if (alive) setSettings({ bindings: {} }) })
    return () => { alive = false }
  }, [])

  const persist = useCallback(async (next: KeyboardShortcutsConfigV1) => {
    const normalized = normalizeKeyboardShortcuts(next)
    setSettings(normalized)
    await window.electronAPI.store.set(KEYBOARD_SHORTCUT_STORE_KEY, normalized)
    window.dispatchEvent(new CustomEvent(KEYBOARD_SHORTCUTS_CHANGED))
  }, [])

  const setCommandShortcut = async (commandId: KeyboardShortcutCommandId, shortcut: string) => {
    const next = normalizeKeyboardShortcuts({
      bindings: {
        ...settings.bindings,
        [commandId]: [shortcut]
      }
    })
    await persist(next)
    const conflict = findKeyboardShortcutConflict(resolveKeyboardShortcutBindings(next), commandId, shortcut)
    if (conflict) {
      const other = KEYBOARD_SHORTCUT_COMMANDS.find(command => command.id === conflict)
      setMessage(`${shortcut} ${tr('\u5df2\u4e0e', 'also matches')} ${shortcutCommandLabel(other)} ${tr('\u51b2\u7a81\u3002', 'conflicts.')}`)
    } else {
      setMessage(tr('\u5feb\u6377\u952e\u5df2\u4fdd\u5b58\u3002', 'Shortcut saved.'))
    }
  }

  const resetCommand = async (commandId: KeyboardShortcutCommandId) => {
    const nextBindings = { ...settings.bindings }
    delete nextBindings[commandId]
    await persist({ bindings: nextBindings })
    setMessage(tr('\u5df2\u6062\u590d\u9ed8\u8ba4\u5feb\u6377\u952e\u3002', 'Default shortcut restored.'))
  }

  const onRecorderKeyDown = async (event: React.KeyboardEvent, commandId: KeyboardShortcutCommandId) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(null)
      setMessage(null)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      await persist({ bindings: { ...settings.bindings, [commandId]: [] } })
      setRecording(null)
      setMessage(tr('\u5df2\u6e05\u9664\u8be5\u547d\u4ee4\u5feb\u6377\u952e\u3002', 'Shortcut cleared for this command.'))
      return
    }
    const shortcut = keyboardEventToShortcut(event)
    if (!shortcut) return
    if (!event.ctrlKey && !event.metaKey && !event.altKey && shortcut !== 'Shift+Tab') {
      setMessage(tr('\u8bf7\u4f7f\u7528 Ctrl\u3001Alt\u3001Meta \u7ec4\u5408\u952e\uff0c\u6216 Shift+Tab\u3002', 'Use Ctrl, Alt, Meta, or Shift+Tab.'))
      return
    }
    await setCommandShortcut(commandId, shortcut)
    setRecording(null)
  }

  return (
    <div className="wb-settings-stack wb-shortcuts">
      <section className="glass wb-shortcuts-card">
        <div className="wb-card-head">
          <div>
            <strong>{tr('\u5feb\u6377\u952e', 'Keyboard shortcuts')}</strong>
            <span>{tr('\u5f55\u5236\u3001\u91cd\u7f6e\u6216\u641c\u7d22 AgentHub \u5de5\u4f5c\u53f0\u64cd\u4f5c\u3002', 'Record, reset, or search AgentHub workbench actions.')}</span>
          </div>
          <input className="ah-input" value={search} onChange={event => setSearch(event.target.value)} placeholder={tr('\u641c\u7d22\u547d\u4ee4\u6216\u5feb\u6377\u952e', 'Search commands or shortcuts')} />
        </div>

        <div className="wb-shortcuts-list">
          {filteredCommands.map(command => {
            const activeShortcut = shortcutDisplay(bindings[command.id])
            const conflict = activeShortcut ? findKeyboardShortcutConflict(bindings, command.id, activeShortcut) : null
            const isRecording = recording === command.id
            return (
              <div key={command.id} className={'wb-shortcut-row' + (conflict ? ' conflict' : '')}>
                <div>
                  <strong>{shortcutCommandLabel(command)}</strong>
                  <span>{getLang() === 'en' ? command.descriptionEn : command.descriptionZh}</span>
                </div>
                <button
                  className={'wb-shortcut-key' + (isRecording ? ' recording' : '')}
                  onClick={() => { setRecording(command.id); setMessage(tr('\u8bf7\u6309\u4e0b\u65b0\u7684\u5feb\u6377\u952e\uff1bEsc \u53d6\u6d88\uff0cBackspace \u6e05\u9664\u3002', 'Press a new shortcut. Esc cancels, Backspace clears.')) }}
                  onKeyDown={event => onRecorderKeyDown(event, command.id)}
                  autoFocus={isRecording}
                >
                  {isRecording ? tr('\u6b63\u5728\u5f55\u5236...', 'Recording...') : activeShortcut || tr('\u672a\u8bbe\u7f6e', 'Unset')}
                </button>
                <button className="ah-btn sm" onClick={() => resetCommand(command.id)}>{tr('\u9ed8\u8ba4', 'Default')}</button>
                {conflict && <small>{tr('\u51b2\u7a81\uff1a', 'Conflict: ')}{shortcutCommandLabel(KEYBOARD_SHORTCUT_COMMANDS.find(item => item.id === conflict))}</small>}
              </div>
            )
          })}
          {filteredCommands.length === 0 && <div className="wb-memory-kun-empty"><Icon d={IC.terminal} size={24} /><span>{tr('\u6ca1\u6709\u5339\u914d\u7684\u5feb\u6377\u952e\u3002', 'No matching shortcuts.')}</span></div>}
        </div>
      </section>
      {message && <div className="glass wb-shortcut-message">{message}</div>}
    </div>
  )
}

function shortcutCommandLabel(command?: { labelZh: string; labelEn: string }): string {
  if (!command) return ''
  return getLang() === 'en' ? command.labelEn : command.labelZh
}

function ModelsTab({ providers }: { providers: ProviderDef[] }) {
  const [filter, setFilter] = useState('')
  const models = useMemo(() => {
    const all: Array<{ providerId: string; providerName: string; modelId: string; label: string; contextWindow: number; supportsTools: boolean; supportsVision: boolean; supportsThinking: boolean }> = []
    for (const provider of providers) {
      if (!provider.enabled) continue
      for (const model of provider.models) {
        all.push({
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          label: model.label,
          contextWindow: model.contextWindow || 128_000,
          supportsTools: !!model.supportsTools,
          supportsVision: !!model.supportsVision,
          supportsThinking: !!model.supportsThinking
        })
      }
    }
    return all
  }, [providers])

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return models
    return models.filter(m =>
      m.modelId.toLowerCase().includes(needle) ||
      m.label.toLowerCase().includes(needle) ||
      m.providerName.toLowerCase().includes(needle)
    )
  }, [models, filter])

  const formatContext = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n)

  return (
    <div className="wb-settings-stack">
      <section className="glass">
        <div className="wb-settings-section-head">
          <div>
            <strong>{tr('模型能力', 'Model capabilities')}</strong>
            <span>{tr('所有已启用供应商的模型列表，含上下文窗口和支持的能力。', 'All enabled provider models with context windows and capabilities.')}</span>
          </div>
          <input className="ah-input" placeholder={tr('搜索模型...', 'Search models...')} value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
        </div>
        <div className="wb-models-grid">
          {filtered.map(m => (
            <div key={`${m.providerId}::${m.modelId}`} className="wb-model-card glass">
              <div className="wb-model-card-head">
                <strong>{m.label}</strong>
                <span className="ah-chip">{m.providerName}</span>
              </div>
              <small className="mono">{m.modelId}</small>
              <div className="wb-model-card-meta">
                <span title="Context window">{formatContext(m.contextWindow)} ctx</span>
                {m.supportsTools && <span className="wb-model-badge tools" title="Supports tool calls">tools</span>}
                {m.supportsVision && <span className="wb-model-badge vision" title="Supports vision">vision</span>}
                {m.supportsThinking && <span className="wb-model-badge thinking" title="Supports thinking/reasoning">thinking</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="wb-memory-kun-empty"><span>{tr('无匹配模型', 'No matching models')}</span></div>}
        </div>
        <div className="wb-models-summary"><span>{tr(`共 ${filtered.length} 个模型，来自 ${new Set(filtered.map(m => m.providerId)).size} 个供应商`, `${filtered.length} model(s) from ${new Set(filtered.map(m => m.providerId)).size} provider(s)`)}</span></div>
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
    const active = entries.filter(entry => (entry.status || 'approved') === 'approved').length
    const disabled = entries.filter(entry => entry.status === 'disabled').length
    const pending = entries.filter(entry => entry.status === 'candidate').length
    return { active, disabled, pending, total: entries.length }
  }, [entries])

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter(entry => {
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
    const ok = await styledConfirm({ message: tr('删除这条记忆？此操作不可撤销。', 'Delete this memory? This cannot be undone.'), danger: true })
    if (!ok) return
    await window.electronAPI.memory.delete(id)
    if (editing?.id === id) closeEditor()
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
              <MemorySettingsRow key={entry.id} entry={entry} onEdit={openEdit} onApprove={approveCandidate} onDisable={disableMemory} onDelete={deleteMemory} onTogglePinned={togglePinned} />
            ))}
          </div>
        </div>
        {message && <div className="wb-memory-kun-message">{message}</div>}
      </section>
    </div>
  )
}

function LegacyMemorySettingsTab() {
  const [statusFilter, setStatusFilter] = useState<'all' | MemoryEntryStatus>('all')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [candidates, setCandidates] = useState<MemoryEntry[]>([])
  const [editing, setEditing] = useState<MemoryEntry | null>(null)
  const [editDraft, setEditDraft] = useState({
    title: '',
    summary: '',
    content: '',
    tags: '',
    status: 'approved' as MemoryEntryStatus,
    category: 'preference' as MemoryCategory,
    source: '',
    scope: '',
    confidence: 70,
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
      const allEntries: MemoryEntry[] = Array.isArray(catalog?.entries) ? catalog.entries : []
      const q = query.trim().toLowerCase()
      setEntries(allEntries.filter(entry => {
        if (statusFilter !== 'all' && (entry.status || 'approved') !== statusFilter) return false
        if (!q) return true
        return [entry.title, entry.summary, entry.content, entry.category, ...(entry.tags || [])]
          .filter(Boolean).join(' ').toLowerCase().includes(q)
      }))
      setCandidates(allEntries.filter(entry => entry.status === 'candidate'))
    } finally {
      setLoading(false)
    }
  }, [query, statusFilter])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const startEdit = (entry: MemoryEntry) => {
    setEditing(entry)
    setEditDraft({
      title: entry.title || '',
      summary: entry.summary || '',
      content: String(entry.content || ''),
      tags: (entry.tags || []).join(', '),
      status: entry.status || 'approved',
      category: entry.category || 'preference',
      source: entry.source || '',
      scope: String(entry.metadata?.scope || ''),
      confidence: typeof entry.confidence === 'number' ? Math.round(entry.confidence * 100) : 70,
      pinned: !!(entry.metadata?.pinned || entry.metadata?.pin)
    })
  }

  const importConversation = async () => {
    if (!importText.trim()) return
    setLoading(true)
    setMessage(null)
    try {
      const next = await window.electronAPI.memory.importConversation(importSource.trim() || 'Imported conversation', importText)
      setImportText('')
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

  const saveEdit = async () => {
    if (!editing) return
    await window.electronAPI.memory.updateEntry(editing.id, {
      title: editDraft.title,
      summary: editDraft.summary,
      content: editDraft.content,
      tags: editDraft.tags.split(',').map(item => item.trim()).filter(Boolean),
      status: editDraft.status,
      category: editDraft.category,
      source: editDraft.source.trim() || undefined,
      confidence: Math.max(0, Math.min(100, Math.round(editDraft.confidence))) / 100,
      metadata: {
        ...(editing.metadata || {}),
        pinned: editDraft.pinned,
        scope: editDraft.scope.trim() || undefined,
        updatedFrom: 'settings'
      }
    })
    setEditing(null)
    await refresh()
  }

  const deleteMemory = async (id: string) => {
    const ok = await styledConfirm({ message: tr('删除这条记忆？此操作不可撤销。', 'Delete this memory? This cannot be undone.'), danger: true })
    if (!ok) return
    await window.electronAPI.memory.delete(id)
    if (editing?.id === id) setEditing(null)
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
    <div className="wb-settings-stack wb-memory-settings">
      <div className="glass wb-provider-card">
        <div className="wb-provider-head">
          <div>
            <strong>{tr('长期记忆', 'Long-Term Memory')}</strong>
            <span>{tr('管理偏好、项目背景、反复纠正点和导入对话样本。', 'Manage preferences, project context, repeated corrections, and imported conversation samples.')}</span>
          </div>
          <button className="ah-btn sm" onClick={refresh} disabled={loading}><Icon d={IC.refresh} size={14} />{loading ? tr('刷新中', 'Refreshing') : tr('刷新', 'Refresh')}</button>
        </div>
        <div className="wb-tool-inline-form">
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') refresh().catch(() => {}) }} placeholder={tr('搜索记忆', 'Search memories')} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | MemoryEntryStatus)}>
            <option value="all">{tr('全部状态', 'All statuses')}</option>
            <option value="approved">{tr('已学习', 'Learned')}</option>
            <option value="candidate">{tr('待确认', 'Pending')}</option>
            <option value="disabled">{tr('已禁用', 'Disabled')}</option>
          </select>
          <button className="ah-btn sm" onClick={refresh}>{tr('搜索', 'Search')}</button>
        </div>
      </div>

      <div className="glass wb-provider-card wb-memory-settings-card">
        <div className="wb-provider-head"><strong>{tr('导入对话', 'Import Conversation')}</strong><span>{tr('从历史对话提取偏好、风格、项目和纠正记忆。', 'Extract preferences, style, project context, and corrections from chat history.')}</span></div>
        <input className="ah-input" value={importSource} onChange={e => setImportSource(e.target.value)} placeholder={tr('来源名称 / 对话历史标题', 'Source name / chat history title')} />
        <textarea className="ah-textarea" value={importText} onChange={e => setImportText(e.target.value)} placeholder={tr('粘贴对话记录...', 'Paste conversation transcript...')} />
        <div className="wb-tool-actions">
          <button className="ah-btn sm primary" onClick={importConversation} disabled={loading || !importText.trim()}>{tr('导入并提取候选', 'Import and extract candidates')}</button>
          {message && <small>{message}</small>}
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="glass wb-provider-card wb-memory-settings-card">
          <div className="wb-provider-head"><strong>{tr('待确认记忆', 'Pending Memories')}</strong><span>{candidates.length} {tr('条', 'items')}</span></div>
          {candidates.slice(0, 12).map(candidate => (
            <MemorySettingsRow key={candidate.id} entry={candidate} onEdit={startEdit} onApprove={approveCandidate} onDisable={disableMemory} onDelete={deleteMemory} onTogglePinned={togglePinned} />
          ))}
        </div>
      )}

      {editing && (
        <div className="glass wb-provider-card wb-memory-settings-card">
          <div className="wb-provider-head"><strong>{tr('编辑记忆', 'Edit Memory')}</strong><span>{memoryMeta(editing)}</span></div>
          <div className="wb-form-grid two">
            <label className="wb-field">
              <span>{tr('分类', 'Category')}</span>
              <select className="ah-select" value={editDraft.category} onChange={e => setEditDraft({ ...editDraft, category: e.target.value as MemoryCategory })}>
                {MEMORY_CATEGORIES.map(category => <option key={category} value={category}>{memoryCategoryLabel(category)}</option>)}
              </select>
            </label>
            <label className="wb-field">
              <span>{tr('状态', 'Status')}</span>
              <select className="ah-select" value={editDraft.status} onChange={e => setEditDraft({ ...editDraft, status: e.target.value as MemoryEntryStatus })}>
                <option value="approved">{tr('已学习', 'Learned')}</option>
                <option value="candidate">{tr('待确认', 'Pending')}</option>
                <option value="disabled">{tr('已禁用', 'Disabled')}</option>
              </select>
            </label>
          </div>
          <input className="ah-input" value={editDraft.title} onChange={e => setEditDraft({ ...editDraft, title: e.target.value })} placeholder={tr('标题', 'Title')} />
          <input className="ah-input" value={editDraft.summary} onChange={e => setEditDraft({ ...editDraft, summary: e.target.value })} placeholder={tr('摘要', 'Summary')} />
          <textarea className="ah-textarea" value={editDraft.content} onChange={e => setEditDraft({ ...editDraft, content: e.target.value })} placeholder={tr('完整内容 / 规则', 'Full content / rule')} />
          <input className="ah-input" value={editDraft.tags} onChange={e => setEditDraft({ ...editDraft, tags: e.target.value })} placeholder={tr('标签，用逗号分隔', 'Tags, separated by commas')} />
          <div className="wb-form-grid two">
            <label className="wb-field">
              <span>{tr('来源', 'Source')}</span>
              <input className="ah-input" value={editDraft.source} onChange={e => setEditDraft({ ...editDraft, source: e.target.value })} placeholder={tr('来源对话 / 文件 / 规则', 'Source conversation / file / rule')} />
            </label>
            <label className="wb-field">
              <span>{tr('作用域', 'Scope')}</span>
              <input className="ah-input" value={editDraft.scope} onChange={e => setEditDraft({ ...editDraft, scope: e.target.value })} placeholder={tr('全局 / 项目 / 工作目录', 'Global / project / workspace')} />
            </label>
          </div>
          <div className="wb-memory-governance-row">
            <label>
              <input type="checkbox" checked={editDraft.pinned} onChange={e => setEditDraft({ ...editDraft, pinned: e.target.checked })} />
              <span>{tr('置顶并优先注入上下文', 'Pin and prioritize in context')}</span>
            </label>
            <label className="wb-appearance-range">
              <span>{tr('置信度', 'Confidence')}</span>
              <input type="range" min={0} max={100} value={editDraft.confidence} onChange={e => setEditDraft({ ...editDraft, confidence: Number(e.target.value) })} />
              <span>{editDraft.confidence}%</span>
            </label>
          </div>
          <div className="wb-tool-actions">
            <button className="ah-btn sm" onClick={() => setEditing(null)}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" onClick={saveEdit} disabled={!editDraft.title.trim()}>{tr('保存', 'Save')}</button>
            <button className="ah-btn sm danger" onClick={() => deleteMemory(editing.id)}>{tr('删除', 'Delete')}</button>
          </div>
        </div>
      )}

      <div className="glass wb-provider-card wb-memory-settings-card">
        <div className="wb-provider-head"><strong>{tr('记忆库', 'Memory Library')}</strong><span>{entries.length} {tr('条', 'items')}</span></div>
        {entries.length === 0 && <div className="wb-muted-box">{tr('暂无记忆。', 'No memories yet.')}</div>}
        {entries.slice(0, 40).map(entry => (
          <MemorySettingsRow key={entry.id} entry={entry} onEdit={startEdit} onApprove={approveCandidate} onDisable={disableMemory} onDelete={deleteMemory} onTogglePinned={togglePinned} />
        ))}
      </div>
    </div>
  )
}

function MemorySettingsRow({ entry, onEdit, onApprove, onDisable, onDelete, onTogglePinned }: {
  entry: MemoryEntry
  onEdit: (entry: MemoryEntry) => void
  onApprove: (id: string) => void
  onDisable: (id: string) => void
  onDelete: (id: string) => void
  onTogglePinned: (entry: MemoryEntry) => void
}) {
  const pinned = !!(entry.metadata?.pinned || entry.metadata?.pin)
  return (
    <div className={'wb-memory-kun-row wb-memory-settings-row' + (pinned ? ' pinned' : '')}>
      <div className="wb-memory-kun-row-main">
        <strong>{pinned && <span className="wb-memory-pin">{tr('置顶', 'Pinned')}</span>}{entry.title || entry.category || entry.id}</strong>
        <small>{String(entry.summary || entry.content || entry.title || '').slice(0, 220)}</small>
        <div className="wb-memory-kun-row-meta">{memoryMeta(entry)}</div>
      </div>
      <div className="wb-tool-actions">
        <button onClick={() => onEdit(entry)}>{tr('编辑', 'Edit')}</button>
        <button onClick={() => onTogglePinned(entry)}>{pinned ? tr('取消置顶', 'Unpin') : tr('置顶', 'Pin')}</button>
        {entry.status === 'candidate' && <button onClick={() => onApprove(entry.id)}>{tr('批准', 'Approve')}</button>}
        {entry.status !== 'disabled' && <button onClick={() => onDisable(entry.id)}>{tr('禁用', 'Disable')}</button>}
        <button className="danger" onClick={() => onDelete(entry.id)}>{tr('删除', 'Delete')}</button>
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
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="ah-btn sm" onClick={buildGraph} disabled={loading}>
          {loading ? tr('构建中...', 'Building...') : tr('构建图谱', 'Build Graph')}
        </button>
        {graph && (
          <button className="ah-btn sm" onClick={cleanup}>
            {tr('清理建议', 'Cleanup Suggestions')}
          </button>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 4 }}>{error}</div>}
      {graph && (
        <div style={{ marginTop: 8, padding: 12, background: 'var(--bg-input)', borderRadius: 8, fontSize: 12 }}>
          <div>{tr(`节点: ${graph.stats?.totalNodes || 0}，边: ${graph.stats?.totalEdges || 0}，孤立节点: ${graph.stats?.isolatedNodes || 0}`, `Nodes: ${graph.stats?.totalNodes || 0}, Edges: ${graph.stats?.totalEdges || 0}, Isolated: ${graph.stats?.isolatedNodes || 0}`)}</div>
          {graph.stats?.categories && (
            <div style={{ marginTop: 4 }}>
              {Object.entries(graph.stats.categories).map(([cat, count]) => (
                <span key={cat} className="ah-chip" style={{ marginRight: 4, fontSize: 10 }}>{cat}: {count as number}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {cleanupSuggestions.length > 0 && (
        <div className="wb-memory-kun-suggestions" style={{ marginTop: 8 }}>
          <strong>{tr(`发现 ${cleanupSuggestions.length} 条可清理的记忆`, `Found ${cleanupSuggestions.length} memories to clean up`)}</strong>
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {cleanupSuggestions.slice(0, 5).map((item: any, index) => (
              <div key={item.id || item.entryId || index} className="ah-chip" style={{ justifyContent: 'flex-start', whiteSpace: 'normal' }}>
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

        <div className="wb-mcp-clean-list" style={{ marginTop: 12 }}>
          {repositories.map(repo => (
            <div key={repo.id} className="wb-mcp-clean-row">
              <div style={{ flex: 1 }}>
                <strong>{repo.name}</strong>
                <small className="mono">{repo.source || 'builtin'}</small>
                {repo.description && (
                  <div style={{ fontSize: 12, color: 'var(--tx-2)', marginTop: 2 }}>{repo.description}</div>
                )}
                <div className="mono" style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 4 }}>{repo.url}</div>
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
          <div className="wb-mcp-clean-row" style={{ alignItems: 'stretch' }}>
            <div style={{ flex: 1, display: 'grid', gap: 8 }}>
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
              <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
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

        <div className="wb-mcp-clean-list">
          {plugins.map((plugin, idx) => (
            <div key={plugin.id || idx} className="wb-mcp-clean-row">
              <div style={{ flex: 1 }}>
                <strong>{plugin.manifest?.name || plugin.id}</strong>
                <small className="mono">{plugin.manifest?.version || '?'}</small>
                {plugin.manifest?.description && (
                  <div style={{ fontSize: 12, color: 'var(--tx-2)', marginTop: 2 }}>{plugin.manifest.description}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 4 }}>
                  {tr('来源', 'Source')}: {plugin.source || 'unknown'} · {tr('路径', 'Path')}: {plugin.path || '?'}
                </div>
              </div>
            </div>
          ))}
          {plugins.length === 0 && !loading && (
            <div className="wb-memory-kun-empty">
              <span>{tr('暂无已发现的插件。', 'No plugins discovered yet.')}</span>
            </div>
          )}
        </div>
      </section>
    </div>
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
    project: tr('项目', 'Project')
  } as Record<MemoryScopeFilter, string>)[scope]
}

function memoryMeta(entry: Partial<MemoryEntry>): string {
  return [
    memoryCategoryLabel(entry.category || 'conversation'),
    memoryStatusLabel(entry.status || 'approved'),
    typeof entry.confidence === 'number' ? `${Math.round(entry.confidence * 100)}%` : '',
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
            <span>{tr('检查当前版本、渠道和下载页。', 'Check the current version, channel, and download page.')}</span>
          </div>
          <Seg value={status?.channel || 'stable'} onChange={value => setChannel(value as UpdateStatus['channel'])} options={[{ value: 'stable', label: tr('稳定版', 'Stable') }, { value: 'preview', label: tr('预览版', 'Preview') }]} />
        </div>
        <div className="wb-tool-summary-grid">
          <div><strong>{status?.version || '-'}</strong><span>{tr('当前版本', 'Current')}</span></div>
          <div><strong>{status?.latestVersion || '-'}</strong><span>{tr('最新版本', 'Latest')}</span></div>
          <div><strong>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : '-'}</strong><span>{tr('检查时间', 'Checked at')}</span></div>
        </div>
        {status?.error && <div className="wb-error-text">{status.error}</div>}
        <div className="wb-card-actions">
          <button className="ah-btn sm primary" onClick={check} disabled={loading}>{loading ? tr('检查中', 'Checking') : tr('检查更新', 'Check updates')}</button>
          <button className="ah-btn sm" onClick={() => window.electronAPI.updates.openDownload()}>{tr('打开下载页', 'Open download page')}</button>
          <button className="ah-btn sm" onClick={refresh} disabled={loading}>{tr('刷新状态', 'Refresh status')}</button>
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
        <PreferenceRow title={tr('界面语言', 'Interface language')} detail={tr('切换后立即生效。', 'Applies immediately after switching.')}>
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

function formatToken(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k tokens`
  return `${value} tokens`
}
