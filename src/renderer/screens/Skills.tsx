/* ============================================================
   AgentHub 玻璃拟态 UI — 技能(Skill)页
   三块：能力矩阵（确认每个 agent 真实能力）/ 技能目录（增删 + 全部安装）/
   安装矩阵（单格=单独安装，行列「全部」=集体安装）。
   ============================================================ */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon, IC, Enter, AgentMark, Switch, Seg } from '../glass/ui'
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'

type Pol = 'allow' | 'ask' | 'deny'
interface ApprovalCfg {
  version: 1
  default: { write: Pol; exec: Pol }
  overrides: Record<string, { write?: Pol; exec?: Pol }>
}

interface SkillDef {
  id: string; name: string; description: string; instructions: string
  tags: string[]; source: string; createdAt: number; updatedAt: number
  category?: SkillCategoryId | { id?: string; label?: string }
}
interface CapState {
  agentId: string; name: string; protocol: 'http' | 'stdio-plain' | 'acp'
  nativeCli: boolean; httpAgentic: boolean; capabilities: string[]
}
type Installs = Record<string, string[]>

type SkillCategoryId =
  | 'coding'
  | 'review'
  | 'testing'
  | 'writing'
  | 'research'
  | 'planning'
  | 'design'
  | 'data'
  | 'operations'
  | 'automation'
  | 'memory'
  | 'terminal'
  | 'general'
type SkillFilter = 'all' | 'installed' | 'local' | SkillCategoryId
type SkillBrowserItem =
  | { kind: 'installed'; id: string; skill: SkillDef }
  | { kind: 'local'; id: string; candidate: LocalSkillCandidate; importedSkill?: SkillDef }

const LEGACY_SKILL_CATEGORIES: Array<{ id: SkillCategoryId; zh: string; en: string; hint: string }> = [
  { id: 'coding', zh: '编码', en: 'Coding', hint: '代码实现、重构、架构' },
  { id: 'review', zh: '审查', en: 'Review', hint: '代码审查、安全审查' },
  { id: 'testing', zh: '测试', en: 'Testing', hint: 'TDD、回归、验证' },
  { id: 'writing', zh: '写作', en: 'Writing', hint: '文档、润色、改写' },
  { id: 'research', zh: '研究', en: 'Research', hint: '资料整理、检索、归纳' },
  { id: 'automation', zh: '自动化', en: 'Automation', hint: '循环、调度、工作流' },
  { id: 'memory', zh: '记忆', en: 'Memory', hint: '知识库、上下文、沉淀' },
  { id: 'terminal', zh: '终端', en: 'Terminal', hint: 'Shell、Git、本地工具' },
  { id: 'general', zh: '通用', en: 'General', hint: '未归类或通用技能' }
]

void LEGACY_SKILL_CATEGORIES

const SKILL_CATEGORIES: Array<{ id: SkillCategoryId; zh: string; en: string; hint: string }> = [
  { id: 'coding', zh: '编码', en: 'Coding', hint: '代码实现、重构、代码审查与安全审查' },
  { id: 'testing', zh: '测试', en: 'Testing', hint: 'TDD、回归、验证与质量门禁' },
  { id: 'writing', zh: '写作', en: 'Writing', hint: '文档、润色、改写与草稿' },
  { id: 'research', zh: '研究', en: 'Research', hint: '资料整理、检索、归纳与证据' },
  { id: 'planning', zh: '规划', en: 'Planning', hint: '计划、路线、架构和分阶段实施' },
  { id: 'design', zh: '设计', en: 'Design', hint: 'UI、交互、信息架构和视觉打磨' },
  { id: 'data', zh: '数据', en: 'Data', hint: '分析、报表、指标和数据处理' },
  { id: 'operations', zh: '运维', en: 'Operations', hint: '自动化、终端、Git、发布和工作流' },
  { id: 'general', zh: '通用', en: 'General', hint: '未归类或通用技能' }
]

const CAP_ORDER = ['fs-read', 'fs-write', 'exec', 'agentic-loop', 'skills'] as const
const CAP_LABEL: Record<string, { zh: string; en: string }> = {
  'fs-read': { zh: '读文件', en: 'Read files' },
  'fs-write': { zh: '写文件', en: 'Write files' },
  'exec': { zh: '执行命令', en: 'Run commands' },
  'agentic-loop': { zh: '多步自驱', en: 'Agentic loop' },
  'skills': { zh: '技能', en: 'Skills' }
}

const api = () => (window as any).electronAPI
const SKILL_UI = {
  skillCatalog: '\u6280\u80fd\u76ee\u5f55',
  importedSuffix: '\u4e2a\u5df2\u5bfc\u5165',
  installed: '\u5df2\u5b89\u88c5',
  localFolders: '\u672c\u5730\u76ee\u5f55',
  addSkill: '\u6dfb\u52a0\u6280\u80fd',
  searchPlaceholder: '\u641c\u7d22 Skill \u540d\u79f0\u3001\u6807\u7b7e\u3001\u6765\u6e90\u6216\u8def\u5f84',
  all: '\u5168\u90e8',
  local: '\u672c\u5730',
  editSkill: '\u7f16\u8f91\u6280\u80fd',
  newSkill: '\u65b0\u5efa\u6280\u80fd',
  name: '\u540d\u79f0',
  namePlaceholder: '\u7ed9\u8fd9\u4e2a\u6280\u80fd\u8d77\u4e2a\u540d\u5b57',
  tags: '\u6807\u7b7e',
  category: '\u5206\u7c7b',
  description: '\u4e00\u884c\u63cf\u8ff0',
  instructions: 'SKILL.md \u6307\u4ee4\u6b63\u6587',
  templates: '\u5185\u7f6e\u6a21\u677f',
  cancel: '\u53d6\u6d88',
  save: '\u4fdd\u5b58',
  create: '\u521b\u5efa',
  imported: '\u5df2\u5bfc\u5165',
  noImported: '\u6682\u65e0\u5df2\u5bfc\u5165 Skill',
  noLocal: '\u6ca1\u6709\u5339\u914d\u7684\u672c\u5730 SKILL.md',
  selectPrompt: '\u9009\u62e9\u5de6\u4fa7 Skill \u67e5\u770b\u8be6\u60c5\u3002',
  noSelection: '\u672a\u9009\u62e9 Skill',
  edit: '\u7f16\u8f91',
  remove: '\u5220\u9664',
  importing: '\u5bfc\u5165\u4e2d',
  import: '\u5bfc\u5165',
  source: '\u6765\u6e90',
  status: '\u72b6\u6001',
  preview: '\u672c\u5730\u9884\u89c8',
  installs: '\u5b89\u88c5',
  importFirst: '\u5bfc\u5165\u540e\u53ef\u5b89\u88c5',
  localNote: '\u6b64 Skill \u6765\u81ea\u672c\u5730\u76ee\u5f55\uff0c\u53ef\u76f4\u63a5\u9884\u89c8\u3002\u5bfc\u5165\u540e\u5373\u53ef\u5b89\u88c5\u5230\u5177\u4f53 Agent\u3002',
  installToAgents: '\u5b89\u88c5\u5230 Agent',
  uninstallAll: '\u5168\u90e8\u5378\u8f7d',
  installAll: '\u5168\u90e8\u5b89\u88c5',
  importFailed: '\u5bfc\u5165\u672c\u5730 Skill \u5931\u8d25',
  noContent: '\u6ca1\u6709\u53ef\u663e\u793a\u7684 Skill \u5185\u5bb9\u3002'
} as const

export function SkillsTab() {
  const [caps, setCaps] = useState<CapState[]>([])
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [localSkills, setLocalSkills] = useState<LocalSkillCandidate[]>([])
  const [installs, setInstalls] = useState<Installs>({})
  const [mode, setMode] = useState<'all' | 'selected'>('all')
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [c, s, i, m, local] = await Promise.all([
        api()?.agentic?.capabilities?.() as Promise<CapState[]>,
        api()?.skills?.list?.() as Promise<SkillDef[]>,
        api()?.skills?.getInstalls?.() as Promise<Installs>,
        api()?.agentic?.getMode?.() as Promise<'all' | 'selected'>,
        api()?.skills?.scanLocal?.() as Promise<LocalSkillCandidate[]>
      ])
      if (Array.isArray(c)) setCaps(c)
      if (Array.isArray(s)) setSkills(s)
      setInstalls(i && typeof i === 'object' ? i : {})
      if (m === 'all' || m === 'selected') setMode(m)
      if (Array.isArray(local)) setLocalSkills(local)
    } catch (e: any) { setErr(e?.message || 'load failed') }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const agentIds = caps.map(c => c.agentId)

  const setAgentic = async (agentId: string, on: boolean) => {
    try { await api()?.agentic?.setEnabled?.(agentId, on); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const setAgenticMode = async (m: 'all' | 'selected') => {
    try { await api()?.agentic?.setMode?.(m); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const editSkill = async (id: string, patch: { name: string; description: string; instructions: string; tags: string[] }) => {
    try { await api()?.skills?.update?.(id, patch); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const isInstalled = (agentId: string, skillId: string) => (installs[agentId] || []).includes(skillId)
  const toggleInstall = async (agentId: string, skillId: string) => {
    try {
      if (isInstalled(agentId, skillId)) await api()?.skills?.uninstall?.(agentId, skillId)
      else await api()?.skills?.install?.(agentId, skillId)
      const i = await api()?.skills?.getInstalls?.(); setInstalls(i || {})
    } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const installAllForSkill = async (skillId: string, on: boolean) => {
    try { await api()?.skills?.[on ? 'install' : 'uninstall']?.('*', skillId); const i = await api()?.skills?.getInstalls?.(); setInstalls(i || {}) }
    catch (e: any) { setErr(e?.message || 'failed') }
  }
  const installAllForAgent = async (agentId: string, on: boolean) => {
    try {
      for (const s of skills) await api()?.skills?.[on ? 'install' : 'uninstall']?.(agentId, s.id)
      const i = await api()?.skills?.getInstalls?.(); setInstalls(i || {})
    } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const removeSkill = async (id: string, name: string) => {
    if (!window.confirm(tr(`删除技能「${name}」？已安装的 agent 会一并卸载。`, `Delete skill "${name}"? It will be uninstalled from all agents.`))) return
    try { await api()?.skills?.remove?.(id); await refresh() } catch (e: any) { setErr(e?.message || 'failed') }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="ah-hint" style={{ padding: '0 4px' }}>
        {tr('技能 = 一段注入给 agent 的指令包。可给单个 agent 装（点格子），或一键给全部 agent 装。开启「Agentic」后，HTTP 接入的模型也能像 codex/claude 一样在工作区读写文件、跑命令。',
            'A skill is an instruction pack injected into an agent. Install it per-agent (click a cell) or for all at once. Turn on "Agentic" so HTTP models also read/write files and run commands in the workspace, like codex/claude.')}
      </div>

      <CapabilityMatrix caps={caps} onToggleAgentic={setAgentic} mode={mode} onSetMode={setAgenticMode} />

      {caps.length > 0 && <ApprovalPolicyPanel caps={caps} />}

      <SkillCatalog skills={skills} localSkills={localSkills} onChanged={refresh} onRemove={removeSkill} onEdit={editSkill}
        onInstallAll={installAllForSkill} onToggleInstall={toggleInstall} installs={installs} agentIds={agentIds} />

      {skills.length > 0 && agentIds.length > 0 && (
        <InstallMatrix skills={skills} caps={caps} isInstalled={isInstalled}
          onToggle={toggleInstall} onInstallAllForSkill={installAllForSkill} onInstallAllForAgent={installAllForAgent} />
      )}

      {err && <div className="glass" style={{ padding: '10px 14px', color: 'var(--st-error)', fontSize: 12 }}>{err}</div>}
    </div>
  )
}

function LocalSkillImport({ skills, localSkills, onChanged }: {
  skills: SkillDef[]
  localSkills: LocalSkillCandidate[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const imported = new Set(skills.map(skill => skill.source))
  const visibleLocalSkills = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return localSkills
    return localSkills.filter(candidate => [
      candidate.name,
      candidate.description,
      candidate.agentSource,
      candidate.sourcePath,
      candidate.category?.id,
      candidate.category?.label,
      ...(candidate.tags || [])
    ].join(' ').toLowerCase().includes(needle))
  }, [localSkills, query])
  const importSkill = async (candidate: LocalSkillCandidate) => {
    setBusy(candidate.sourcePath)
    setError(null)
    try {
      await api()?.skills?.importLocal?.(candidate.sourcePath)
      await onChanged()
    } catch (e: any) {
      setError(e?.message || '导入本地 Skill 失败')
    } finally {
      setBusy(null)
    }
  }
  const refreshLocal = async () => {
    setBusy('__refresh__')
    setError(null)
    try { await onChanged() } catch (e: any) { setError(e?.message || '刷新本地 Skill 失败') } finally { setBusy(null) }
  }

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={40}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.folder} size={17} style={{ color: 'var(--mint)' }} />
        <div style={{ fontWeight: 700 }}>本地 Skill</div>
        <span className="ah-hint">读取 Codex、Claude、OpenCode 和本地 agents 的 SKILL.md</span>
        <span className="ah-chip" style={{ fontSize: 10 }}>{localSkills.length}</span>
        <div style={{ flex: 1 }} />
        <button className="ah-btn sm" disabled={busy === '__refresh__'} onClick={refreshLocal}>
          <Icon d={IC.refresh} size={13} /> 刷新
        </button>
      </div>
      {localSkills.length > 0 && (
        <input
          className="ah-input"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索本地 Skill 名称、来源、路径"
        />
      )}
      {error && <div className="ah-hint" style={{ color: 'var(--st-error)' }}>{error}</div>}
      {localSkills.length === 0 && (
        <div className="ah-hint" style={{ padding: '8px 2px' }}>没有扫描到本地 SKILL.md。已检查 ~/.codex/skills、~/.agents/skills、~/.claude/skills、~/.opencode/skills。</div>
      )}
      {localSkills.length > 0 && visibleLocalSkills.length === 0 && (
        <div className="ah-hint" style={{ padding: '8px 2px' }}>没有找到匹配的本地 Skill。</div>
      )}
      {visibleLocalSkills.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {visibleLocalSkills.map(candidate => {
            const done = imported.has(candidate.sourcePath)
            return (
              <div key={candidate.id} className="glass" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.name}</strong>
                  {candidate.category?.label && <span className="ah-chip mint" style={{ fontSize: 10 }}>{candidate.category.label}</span>}
                  <span className="ah-chip" style={{ fontSize: 10 }}>{candidate.agentSource}</span>
                </div>
                {candidate.description && <div className="ah-hint" style={{ lineHeight: 1.45 }}>{candidate.description}</div>}
                <div className="ah-hint" title={candidate.sourcePath} style={{ fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.sourcePath}</div>
                <button className={'ah-btn sm' + (done ? '' : ' primary')} disabled={done || busy === candidate.sourcePath} onClick={() => importSkill(candidate)}>
                  {done ? '已导入' : busy === candidate.sourcePath ? '导入中' : '导入'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Enter>
  )
}

/* ---------- 能力矩阵 ---------- */
function CapabilityMatrix({ caps, onToggleAgentic, mode, onSetMode }: {
  caps: CapState[]; onToggleAgentic: (id: string, on: boolean) => void
  mode: 'all' | 'selected'; onSetMode: (m: 'all' | 'selected') => void
}) {
  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.pulse} size={17} style={{ color: 'var(--ag-codex)' }} />
        <div style={{ fontWeight: 700 }}>{tr('能力矩阵', 'Capability matrix')}</div>
        <span className="ah-hint">{tr('确认每个接入 agent 的真实 agent 能力', 'confirm what each connected agent can really do')}</span>
        <div style={{ flex: 1 }} />
        <span className="ah-hint" style={{ fontSize: 11.5 }} title={tr('开启后所有 HTTP agent 默认具备 agentic（可逐个关闭）；关闭则改为按需启用', 'On: every HTTP agent is agentic by default (toggle off individually). Off: enable per agent.')}>
          {tr('默认全员 Agentic', 'Agentic for all')}
        </span>
        <Switch on={mode === 'all'} onChange={v => onSetMode(v ? 'all' : 'selected')} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--tx-3)', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Agent</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{tr('后端', 'Backend')}</th>
              {CAP_ORDER.map(c => (
                <th key={c} style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>{tr(CAP_LABEL[c].zh, CAP_LABEL[c].en)}</th>
              ))}
              <th style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'center' }}>Agentic</th>
            </tr>
          </thead>
          <tbody>
            {caps.map(a => (
              <tr key={a.agentId} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {AGENT_META[a.agentId] ? <AgentMark id={a.agentId} size={22} radius={6} /> : null}
                    <span style={{ fontWeight: 600 }}>{AGENT_META[a.agentId]?.name || a.name}</span>
                  </span>
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <span className="ah-chip" style={{ fontSize: 10.5 }}>{a.protocol === 'acp' ? 'ACP' : a.protocol === 'stdio-plain' ? (a.nativeCli ? 'StdIO·CLI' : 'StdIO') : 'HTTP'}</span>
                </td>
                {CAP_ORDER.map(c => (
                  <td key={c} style={{ padding: '8px 10px', textAlign: 'center' }}>
                    {a.capabilities.includes(c)
                      ? <Icon d={IC.check} size={15} style={{ color: 'var(--mint)' }} />
                      : <span style={{ color: 'var(--tx-3)' }}>·</span>}
                  </td>
                ))}
                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                  {a.protocol === 'http'
                    ? <span style={{ display: 'inline-flex' }}><Switch on={a.httpAgentic} onChange={v => onToggleAgentic(a.agentId, v)} /></span>
                    : <span className="ah-hint" title={tr('stdio 原生 agentic', 'native stdio agentic')}>{tr('原生', 'native')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ah-hint" style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
        {tr('开启 Agentic 需该 agent 走 HTTP 绑定；建议先在「设置 → 工作区」指定一个项目目录，否则只读（禁止写文件/执行命令）。',
            'Enabling Agentic requires an HTTP binding; set a workspace under Settings → Workspaces first, otherwise it stays read-only (no writes / no command execution).')}
      </div>
    </Enter>
  )
}

/* ---------- 审批策略（写/执行门禁） ---------- */
function ApprovalPolicyPanel({ caps }: { caps: CapState[] }) {
  const [cfg, setCfg] = useState<ApprovalCfg | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const c = await api()?.agentic?.getApprovalConfig?.() as ApprovalCfg
      if (c && c.default) setCfg(c)
    } catch (e: any) { setErr(e?.message || 'load failed') }
  }, [])
  useEffect(() => { load() }, [load])
  if (!cfg) return null

  const setDefault = async (tool: 'write' | 'exec', policy: Pol) => {
    try { await api()?.agentic?.setApprovalDefault?.(tool, policy); await load() } catch (e: any) { setErr(e?.message || 'failed') }
  }
  const setOverride = async (agentId: string, tool: 'write' | 'exec', policy: Pol | null) => {
    try { await api()?.agentic?.setApprovalOverride?.(agentId, tool, policy); await load() } catch (e: any) { setErr(e?.message || 'failed') }
  }

  const POL_OPTS = [
    { value: 'allow', label: tr('允许', 'Allow') },
    { value: 'ask', label: tr('询问', 'Ask') },
    { value: 'deny', label: tr('拒绝', 'Deny') }
  ]
  const OVR_OPTS = [{ value: 'default', label: tr('默认', 'Default') }, ...POL_OPTS]

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={90}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.bolt} size={17} style={{ color: 'var(--st-busy)' }} />
        <div style={{ fontWeight: 700 }}>{tr('审批策略', 'Approval policy')}</div>
        <span className="ah-hint">{tr('agentic 写文件 / 执行命令前的放行规则', 'gate writes & command execution in the agentic loop')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="ah-label">{tr('全局默认', 'Global default')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 92, fontSize: 12.5 }}>{tr('写文件', 'Write files')}</span>
          <Seg options={POL_OPTS} value={cfg.default.write} onChange={v => setDefault('write', v as Pol)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 92, fontSize: 12.5 }}>{tr('执行命令', 'Run commands')}</span>
          <Seg options={POL_OPTS} value={cfg.default.exec} onChange={v => setDefault('exec', v as Pol)} />
        </div>
      </div>

      <div className="ah-label" style={{ marginTop: 4 }}>{tr('按 Agent 覆盖', 'Per-agent overrides')}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: 'var(--tx-3)', textAlign: 'left' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>Agent</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{tr('写文件', 'Write')}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{tr('执行命令', 'Exec')}</th>
            </tr>
          </thead>
          <tbody>
            {caps.map(a => {
              const o = cfg.overrides[a.agentId] || {}
              return (
                <tr key={a.agentId} style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {AGENT_META[a.agentId] ? <AgentMark id={a.agentId} size={22} radius={6} /> : null}
                      <span style={{ fontWeight: 600 }}>{AGENT_META[a.agentId]?.name || a.name}</span>
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Seg options={OVR_OPTS} value={o.write ?? 'default'} onChange={v => setOverride(a.agentId, 'write', v === 'default' ? null : (v as Pol))} />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Seg options={OVR_OPTS} value={o.exec ?? 'default'} onChange={v => setOverride(a.agentId, 'exec', v === 'default' ? null : (v as Pol))} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="ah-hint" style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
        {tr('「询问」会在运行时弹窗逐次审批；「拒绝」直接挡下并告知模型。只读（读/列文件）永不受限。默认全部「允许」，与旧版行为一致。',
            'Ask prompts you at run time; Deny blocks and tells the model. Read-only tools are never gated. Defaults to Allow (same as before).')}
      </div>
      {err && <div style={{ color: 'var(--st-error)', fontSize: 12 }}>{err}</div>}
    </Enter>
  )
}

/* ---------- 技能目录 + 添加 ---------- */
function LegacySkillCatalog({ skills, onChanged, onRemove, onEdit, onInstallAll, installs, agentIds }: {
  skills: SkillDef[]; onChanged: () => void; onRemove: (id: string, name: string) => void
  onEdit: (id: string, patch: { name: string; description: string; instructions: string; tags: string[] }) => void
  onInstallAll: (skillId: string, on: boolean) => void; installs: Installs; agentIds: string[]
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', tags: '', category: 'general' as SkillCategoryId })
  const [builtins, setBuiltins] = useState<Array<{ name: string; description?: string; instructions: string; tags?: string[]; source?: string }>>([])
  const [activeFilter, setActiveFilter] = useState<SkillFilter>('all')
  const [query, setQuery] = useState('')

  useEffect(() => { api()?.skills?.builtins?.().then((b: any) => setBuiltins(Array.isArray(b) ? b : [])).catch(() => {}) }, [])

  const categoryCounts = useMemo(() => buildSkillCategoryCounts(skills), [skills])
  const installedSkillIds = useMemo(() => new Set(Object.values(installs).flat()), [installs])
  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return skills.filter(skill => {
      const category = skillCategoryOf(skill)
      if (activeFilter === 'installed' && !installedSkillIds.has(skill.id)) return false
      if (activeFilter === 'local' && !isLocalSkill(skill)) return false
      if (isSkillCategory(activeFilter) && category !== activeFilter) return false
      if (!needle) return true
      return [skill.name, skill.description, skill.source, category, ...(skill.tags || [])]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [activeFilter, installedSkillIds, query, skills])

  const resetForm = () => { setDraft({ name: '', description: '', instructions: '', tags: '', category: 'general' }); setEditingId(null); setAdding(false) }
  const startAdd = () => { setEditingId(null); setDraft({ name: '', description: '', instructions: '', tags: '', category: defaultCategoryForFilter(activeFilter) }); setAdding(v => editingId ? true : !v) }
  const startEdit = (s: SkillDef) => {
    setEditingId(s.id)
    setDraft({ name: s.name, description: s.description, instructions: s.instructions, tags: publicSkillTags(s).join(', '), category: skillCategoryOf(s) })
    setAdding(true)
  }

  const installedCount = (skillId: string) => agentIds.filter(a => (installs[a] || []).includes(skillId)).length
  const save = async () => {
    if (!draft.name.trim() || !draft.instructions.trim()) return
    const tags = normalizedSkillTags(draft.tags, draft.category)
    const patch = {
      name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions,
      tags,
      category: draft.category
    }
    if (editingId) onEdit(editingId, patch)
    else await api()?.skills?.add?.({ ...patch, source: 'paste' })
    resetForm(); if (!editingId) onChanged()
  }
  const addBuiltin = async (b: typeof builtins[0]) => {
    const category = inferSkillCategoryClean({ name: b.name, description: b.description || '', tags: b.tags || [], source: b.source || 'builtin' })
    await api()?.skills?.add?.({ ...b, category, tags: normalizedSkillTags((b.tags || []).join(', '), category) })
    onChanged()
  }

  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={60}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <Icon d={IC.bolt} size={17} style={{ color: 'var(--ag-claude)' }} />
        <div style={{ fontWeight: 700 }}>{tr('技能目录', 'Skill catalog')}</div>
        <span className="ah-hint">{skills.length} {tr('个技能', 'skills')}</span>
        <span className="ah-chip mint" style={{ fontSize: 10 }}>{tr('已安装', 'Installed')} {installedSkillIds.size}</span>
        <span className="ah-chip" style={{ fontSize: 10 }}>{tr('本地', 'Local')} {skills.filter(isLocalSkill).length}</span>
        <div style={{ flex: 1 }} />
        <button className="ah-btn sm primary" onClick={startAdd}>
          <Icon d={IC.plus} size={13} /> {tr('添加技能', 'Add skill')}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="ah-input"
          style={{ minWidth: 220, flex: '1 1 220px' }}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tr('搜索技能名称、标签、来源', 'Search skill name, tags, or source')}
        />
        <button className={filterButtonClass(activeFilter === 'all')} onClick={() => setActiveFilter('all')}>
          {tr('全部', 'All')} {skills.length}
        </button>
        <button className={filterButtonClass(activeFilter === 'installed')} onClick={() => setActiveFilter('installed')}>
          {tr('已安装', 'Installed')} {installedSkillIds.size}
        </button>
        <button className={filterButtonClass(activeFilter === 'local')} onClick={() => setActiveFilter('local')}>
          {tr('本地', 'Local')} {skills.filter(isLocalSkill).length}
        </button>
        {SKILL_CATEGORIES.map(category => (
          <button key={category.id} className={filterButtonClass(activeFilter === category.id)} onClick={() => setActiveFilter(category.id)} title={category.hint}>
            {tr(category.zh, category.en)} {categoryCounts[category.id] || 0}
          </button>
        ))}
      </div>

      {adding && (
        <div className="glass" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--mint-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
            <Icon d={editingId ? IC.pencil : IC.plus} size={14} style={{ color: 'var(--mint)' }} />
            {editingId ? tr('编辑技能', 'Edit skill') : tr('新建技能', 'New skill')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('名称', 'Name')}</div>
              <input className="ah-input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder={tr('给这个技能起个名字', 'Name this skill')} />
            </div>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('标签（逗号分隔）', 'Tags (comma-separated)')}</div>
              <input className="ah-input" value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
                placeholder="review, coding" />
            </div>
            <div>
              <div className="ah-label" style={{ marginBottom: 5 }}>{tr('分类', 'Category')}</div>
              <select className="ah-select" value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value as SkillCategoryId }))}>
                {SKILL_CATEGORIES.map(category => (
                  <option key={category.id} value={category.id}>{tr(category.zh, category.en)} · {category.hint}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('一行描述', 'One-line description')}</div>
            <input className="ah-input" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
          </div>
          <div>
            <div className="ah-label" style={{ marginBottom: 5 }}>{tr('指令正文（SKILL.md 风格，会注入给 agent）', 'Instructions (SKILL.md style, injected to the agent)')}</div>
            <textarea className="ah-input mono" style={{ minHeight: 120, resize: 'vertical', width: '100%' }}
              value={draft.instructions} onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))}
              placeholder={tr('When the user asks for X, do Y…', 'When the user asks for X, do Y…')} />
          </div>
          {builtins.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="ah-label">{tr('内置模板', 'Templates')}:</span>
              {builtins.map((b, i) => (
                <button key={i} className="ah-btn sm" onClick={() => addBuiltin(b)} title={b.description}>
                  <Icon d={IC.plus} size={12} /> {b.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ah-btn sm" onClick={resetForm}>{tr('取消', 'Cancel')}</button>
            <button className="ah-btn sm primary" disabled={!draft.name.trim() || !draft.instructions.trim()} onClick={save}>
              <Icon d={IC.check} size={13} /> {editingId ? tr('保存', 'Save') : tr('创建', 'Create')}
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 && !adding && (
        <div className="ah-hint" style={{ padding: '12px 4px', textAlign: 'center' }}>
          {tr('还没有技能。点「添加技能」粘贴一段 SKILL.md，或用内置模板。', 'No skills yet. Click "Add skill" to paste a SKILL.md, or use a template.')}
        </div>
      )}

      {skills.length > 0 && filteredSkills.length === 0 && (
        <div className="ah-hint" style={{ padding: '12px 4px', textAlign: 'center' }}>
          {tr('没有找到匹配的技能。换一个分类或关键词试试。', 'No matching skills. Try another category or search term.')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filteredSkills.map(s => {
          const n = installedCount(s.id)
          const allOn = n >= agentIds.length && agentIds.length > 0
          const category = skillCategoryOf(s)
          return (
            <div key={s.id} className="glass" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                <button className="ah-btn sm" onClick={() => startEdit(s)} title={tr('编辑', 'Edit')}><Icon d={IC.pencil} size={13} /></button>
                <button className="ah-btn sm danger" onClick={() => onRemove(s.id, s.name)} title={tr('删除', 'Delete')}><Icon d={IC.trash} size={13} /></button>
              </div>
              {s.description && <div className="ah-hint" style={{ lineHeight: 1.5 }}>{s.description}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                <span className="ah-chip mint" style={{ fontSize: 10 }}>{skillCategoryLabel(category)}</span>
                {isLocalSkill(s) && <span className="ah-chip" style={{ fontSize: 10 }}>{tr('本地', 'Local')}</span>}
                {publicSkillTags(s).map(t => <span key={t} className="ah-chip" style={{ fontSize: 10 }}>{t}</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <span className="ah-hint">{tr(`已装 ${n}/${agentIds.length}`, `${n}/${agentIds.length} agents`)}</span>
                <div style={{ flex: 1 }} />
                <button className="ah-btn sm" onClick={() => onInstallAll(s.id, !allOn)}>
                  {allOn ? tr('全部卸载', 'Uninstall all') : tr('全部安装', 'Install all')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </Enter>
  )
}


function SkillCatalog({ skills, localSkills, onChanged, onRemove, onEdit, onInstallAll, onToggleInstall, installs, agentIds }: {
  skills: SkillDef[]
  localSkills: LocalSkillCandidate[]
  onChanged: () => void | Promise<void>
  onRemove: (id: string, name: string) => void
  onEdit: (id: string, patch: { name: string; description: string; instructions: string; tags: string[] }) => void
  onInstallAll: (skillId: string, on: boolean) => void
  onToggleInstall: (agentId: string, skillId: string) => void
  installs: Installs
  agentIds: string[]
}) {
  const [activeFilter, setActiveFilter] = useState<SkillFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', tags: '', category: 'general' as SkillCategoryId })
  const [builtins, setBuiltins] = useState<Array<{ name: string; description?: string; instructions: string; tags?: string[]; source?: string }>>([])
  const [busyLocalPath, setBusyLocalPath] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => { api()?.skills?.builtins?.().then((b: any) => setBuiltins(Array.isArray(b) ? b : [])).catch(() => {}) }, [])

  const installedSkillIds = useMemo(() => new Set(Object.values(installs).flat()), [installs])
  const importedBySource = useMemo(() => new Map(skills.map(skill => [skill.source, skill])), [skills])
  const categoryCounts = useMemo(() => buildSkillCategoryCounts(skills), [skills])
  const treeItems = useMemo<SkillBrowserItem[]>(() => {
    const needle = query.trim().toLowerCase()
    const skillMatches = (skill: SkillDef) => {
      const category = skillCategoryOf(skill)
      if (activeFilter === 'installed' && !installedSkillIds.has(skill.id)) return false
      if (activeFilter === 'local' && !isLocalSkill(skill)) return false
      if (isSkillCategory(activeFilter) && category !== activeFilter) return false
      if (!needle) return true
      return [skill.name, skill.description, skill.source, category, ...(skill.tags || [])].join(' ').toLowerCase().includes(needle)
    }
    const localMatches = (candidate: LocalSkillCandidate) => {
      const category = localSkillCategory(candidate)
      if (activeFilter === 'installed') return false
      if (isSkillCategory(activeFilter) && category !== activeFilter) return false
      if (!needle) return true
      return [candidate.name, candidate.description, candidate.sourcePath, candidate.agentSource, category, ...(candidate.tags || [])].join(' ').toLowerCase().includes(needle)
    }
    return [
      ...skills.filter(skillMatches).map(skill => ({ kind: 'installed' as const, id: `installed:${skill.id}`, skill })),
      ...localSkills.filter(localMatches).map(candidate => ({
        kind: 'local' as const,
        id: `local:${candidate.id}`,
        candidate,
        importedSkill: importedBySource.get(candidate.sourcePath)
      }))
    ]
  }, [activeFilter, importedBySource, installedSkillIds, localSkills, query, skills])

  const installedItems = treeItems.filter(item => item.kind === 'installed')
  const localItems = treeItems.filter(item => item.kind === 'local')
  const selectedItem = treeItems.find(item => item.id === selectedId) || treeItems[0] || null

  useEffect(() => {
    if (!treeItems.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !treeItems.some(item => item.id === selectedId)) setSelectedId(treeItems[0].id)
  }, [selectedId, treeItems])

  const installedCount = (skillId: string) => agentIds.filter(agentId => (installs[agentId] || []).includes(skillId)).length
  const isInstalledForAgent = (agentId: string, skillId: string) => (installs[agentId] || []).includes(skillId)
  const resetForm = () => { setDraft({ name: '', description: '', instructions: '', tags: '', category: 'general' }); setEditingId(null); setAdding(false) }
  const startAdd = () => { setEditingId(null); setDraft({ name: '', description: '', instructions: '', tags: '', category: defaultCategoryForFilter(activeFilter) }); setAdding(v => editingId ? true : !v) }
  const startEdit = (skill: SkillDef) => {
    setEditingId(skill.id)
    setDraft({ name: skill.name, description: skill.description, instructions: skill.instructions, tags: publicSkillTags(skill).join(', '), category: skillCategoryOf(skill) })
    setAdding(true)
  }
  const save = async () => {
    if (!draft.name.trim() || !draft.instructions.trim()) return
    const tags = normalizedSkillTags(draft.tags, draft.category)
    const patch = { name: draft.name.trim(), description: draft.description.trim(), instructions: draft.instructions, tags, category: draft.category }
    if (editingId) onEdit(editingId, patch)
    else await api()?.skills?.add?.({ ...patch, source: 'paste' })
    resetForm()
    if (!editingId) await Promise.resolve(onChanged())
  }
  const addBuiltin = async (builtin: typeof builtins[0]) => {
    const category = inferSkillCategoryClean({ name: builtin.name, description: builtin.description || '', tags: builtin.tags || [], source: builtin.source || 'builtin' })
    await api()?.skills?.add?.({ ...builtin, category, tags: normalizedSkillTags((builtin.tags || []).join(', '), category) })
    await Promise.resolve(onChanged())
  }
  const importLocal = async (candidate: LocalSkillCandidate) => {
    setBusyLocalPath(candidate.sourcePath)
    setLocalError(null)
    try {
      await api()?.skills?.importLocal?.(candidate.sourcePath)
      await Promise.resolve(onChanged())
    } catch (e: any) {
      setLocalError(e?.message || SKILL_UI.importFailed)
    } finally {
      setBusyLocalPath(null)
    }
  }

  return (
    <Enter className="glass wb-skill-browser" delay={60}>
      <div className="wb-skill-browser-head">
        <Icon d={IC.bolt} size={17} style={{ color: 'var(--ag-claude)' }} />
        <div className="wb-skill-browser-title">{SKILL_UI.skillCatalog}</div>
        <span className="ah-hint">{skills.length} {SKILL_UI.importedSuffix}</span>
        <span className="ah-chip mint" style={{ fontSize: 10 }}>{SKILL_UI.installed} {installedSkillIds.size}</span>
        <span className="ah-chip" style={{ fontSize: 10 }}>{SKILL_UI.localFolders} {localSkills.length}</span>
        <div className="wb-flex-spacer" />
        <button className="ah-btn sm primary" onClick={startAdd}><Icon d={IC.plus} size={13} /> {SKILL_UI.addSkill}</button>
      </div>

      <div className="wb-skill-browser-tools">
        <input className="ah-input" value={query} onChange={event => setQuery(event.target.value)} placeholder={SKILL_UI.searchPlaceholder} />
        <button className={filterButtonClass(activeFilter === 'all')} onClick={() => setActiveFilter('all')}>{SKILL_UI.all} {skills.length + localSkills.length}</button>
        <button className={filterButtonClass(activeFilter === 'installed')} onClick={() => setActiveFilter('installed')}>{SKILL_UI.installed} {installedSkillIds.size}</button>
        <button className={filterButtonClass(activeFilter === 'local')} onClick={() => setActiveFilter('local')}>{SKILL_UI.local} {localSkills.length}</button>
        {SKILL_CATEGORIES.map(category => (
          <button key={category.id} className={filterButtonClass(activeFilter === category.id)} onClick={() => setActiveFilter(category.id)} title={category.hint}>
            {skillCategoryLabel(category.id)} {categoryCounts[category.id] || 0}
          </button>
        ))}
      </div>

      {localError && <div className="ah-hint" style={{ color: 'var(--st-error)' }}>{localError}</div>}

      {adding && (
        <div className="glass" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--mint-line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
            <Icon d={editingId ? IC.pencil : IC.plus} size={14} style={{ color: 'var(--mint)' }} />
            {editingId ? SKILL_UI.editSkill : SKILL_UI.newSkill}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div><div className="ah-label" style={{ marginBottom: 5 }}>{SKILL_UI.name}</div><input className="ah-input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder={SKILL_UI.namePlaceholder} /></div>
            <div><div className="ah-label" style={{ marginBottom: 5 }}>{SKILL_UI.tags}</div><input className="ah-input" value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} placeholder="review, coding" /></div>
            <div><div className="ah-label" style={{ marginBottom: 5 }}>{SKILL_UI.category}</div><select className="ah-select" value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value as SkillCategoryId }))}>{SKILL_CATEGORIES.map(category => <option key={category.id} value={category.id}>{skillCategoryLabel(category.id)} · {category.hint}</option>)}</select></div>
          </div>
          <div><div className="ah-label" style={{ marginBottom: 5 }}>{SKILL_UI.description}</div><input className="ah-input" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></div>
          <div><div className="ah-label" style={{ marginBottom: 5 }}>{SKILL_UI.instructions}</div><textarea className="ah-input mono" style={{ minHeight: 120, resize: 'vertical', width: '100%' }} value={draft.instructions} onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))} placeholder="When the user asks for X, do Y..." /></div>
          {builtins.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span className="ah-label">{SKILL_UI.templates}:</span>{builtins.map((b, i) => <button key={i} className="ah-btn sm" onClick={() => addBuiltin(b)} title={b.description}><Icon d={IC.plus} size={12} /> {b.name}</button>)}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="ah-btn sm" onClick={resetForm}>{SKILL_UI.cancel}</button>
            <button className="ah-btn sm primary" disabled={!draft.name.trim() || !draft.instructions.trim()} onClick={save}><Icon d={IC.check} size={13} /> {editingId ? SKILL_UI.save : SKILL_UI.create}</button>
          </div>
        </div>
      )}

      <div className="wb-skill-browser-grid">
        <div className="wb-skill-tree">
          <div className="wb-skill-tree-section"><span>{SKILL_UI.imported}</span><small>{installedItems.length}</small></div>
          {installedItems.map(item => item.kind === 'installed' && (
            <button key={item.id} className={selectedItem?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
              <Icon d={IC.file} size={13} /><span>{item.skill.name}</span><small>{skillCategoryLabel(skillCategoryOf(item.skill))}</small>
            </button>
          ))}
          {!installedItems.length && <div className="wb-skill-empty">{SKILL_UI.noImported}</div>}
          <div className="wb-skill-tree-section"><span>{SKILL_UI.localFolders}</span><small>{localItems.length}</small></div>
          {localItems.map(item => item.kind === 'local' && (
            <button key={item.id} className={selectedItem?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
              <Icon d={item.importedSkill ? IC.check : IC.folder} size={13} /><span>{item.candidate.name}</span><small>{item.importedSkill ? SKILL_UI.imported : item.candidate.agentSource}</small>
            </button>
          ))}
          {!localItems.length && <div className="wb-skill-empty">{SKILL_UI.noLocal}</div>}
        </div>

        <div className="wb-skill-detail">
          {selectedItem ? <SkillDetailPane
            item={selectedItem}
            agentIds={agentIds}
            busyLocalPath={busyLocalPath}
            installedCount={installedCount}
            isInstalledForAgent={isInstalledForAgent}
            onEdit={startEdit}
            onRemove={onRemove}
            onImportLocal={importLocal}
            onInstallAll={onInstallAll}
            onToggleInstall={onToggleInstall}
          /> : <div className="wb-skill-empty">{SKILL_UI.selectPrompt}</div>}
        </div>
      </div>
    </Enter>
  )
}

function SkillDetailPane({ item, agentIds, busyLocalPath, installedCount, isInstalledForAgent, onEdit, onRemove, onImportLocal, onInstallAll, onToggleInstall }: {
  item: SkillBrowserItem
  agentIds: string[]
  busyLocalPath: string | null
  installedCount: (skillId: string) => number
  isInstalledForAgent: (agentId: string, skillId: string) => boolean
  onEdit: (skill: SkillDef) => void
  onRemove: (id: string, name: string) => void
  onImportLocal: (candidate: LocalSkillCandidate) => void
  onInstallAll: (skillId: string, on: boolean) => void
  onToggleInstall: (agentId: string, skillId: string) => void
}) {
  const selectedSkill = item.kind === 'installed' ? item.skill : item.importedSkill
  const candidate = item.kind === 'local' ? item.candidate : null
  const name = selectedSkill?.name || candidate?.name || SKILL_UI.noSelection
  const description = selectedSkill?.description || candidate?.description || ''
  const instructions = selectedSkill?.instructions || candidate?.instructions || ''
  const source = selectedSkill?.source || candidate?.sourcePath || ''
  const category = selectedSkill ? skillCategoryOf(selectedSkill) : candidate ? localSkillCategory(candidate) : 'general'
  const installCount = selectedSkill ? installedCount(selectedSkill.id) : 0
  const allOn = selectedSkill ? installCount >= agentIds.length && agentIds.length > 0 : false
  const tags = selectedSkill ? publicSkillTags(selectedSkill) : (candidate?.tags || [])

  return (
    <>
      <div className="wb-skill-detail-head">
        <div>
          <span className="ah-chip mint" style={{ fontSize: 10 }}>{skillCategoryLabel(category)}</span>
          <h3>{name}</h3>
          {description && <p>{description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {selectedSkill ? <>
            <button className="ah-btn sm" onClick={() => onEdit(selectedSkill)}><Icon d={IC.pencil} size={13} /> {SKILL_UI.edit}</button>
            <button className="ah-btn sm danger" onClick={() => onRemove(selectedSkill.id, selectedSkill.name)}><Icon d={IC.trash} size={13} /> {SKILL_UI.remove}</button>
          </> : candidate ? <button className="ah-btn sm primary" disabled={busyLocalPath === candidate.sourcePath} onClick={() => onImportLocal(candidate)}><Icon d={IC.plus} size={13} /> {busyLocalPath === candidate.sourcePath ? SKILL_UI.importing : SKILL_UI.import}</button> : null}
        </div>
      </div>

      <div className="wb-skill-meta-grid">
        <div><span>{SKILL_UI.source}</span><strong title={source}>{source || '-'}</strong></div>
        <div><span>{SKILL_UI.status}</span><strong>{selectedSkill ? SKILL_UI.imported : SKILL_UI.preview}</strong></div>
        <div><span>{SKILL_UI.installs}</span><strong>{selectedSkill ? `${installCount}/${agentIds.length}` : SKILL_UI.importFirst}</strong></div>
      </div>

      {candidate && !selectedSkill && <div className="wb-skill-local-note">{SKILL_UI.localNote}</div>}

      {selectedSkill && <div className="wb-skill-agent-installs">
        <div className="wb-skill-agent-installs-head"><strong>{SKILL_UI.installToAgents}</strong><button className="ah-btn sm" onClick={() => onInstallAll(selectedSkill.id, !allOn)}>{allOn ? SKILL_UI.uninstallAll : SKILL_UI.installAll}</button></div>
        <div className="wb-skill-agent-list">
          {agentIds.map(agentId => {
            const on = isInstalledForAgent(agentId, selectedSkill.id)
            return <button key={agentId} className={on ? 'installed' : ''} onClick={() => onToggleInstall(agentId, selectedSkill.id)}>
              {AGENT_META[agentId] ? <AgentMark id={agentId} size={22} radius={6} /> : null}
              {AGENT_META[agentId]?.name || agentId}
              {on && <Icon d={IC.check} size={13} />}
            </button>
          })}
        </div>
      </div>}

      <div className="wb-skill-md-head"><strong>SKILL.md</strong><span>{tags.join(' / ')}</span></div>
      <pre className="wb-skill-md">{instructions || SKILL_UI.noContent}</pre>
    </>
  )
}

function skillCategoryOf(skill: SkillDef): SkillCategoryId {
  const explicitValue = typeof skill.category === 'string' ? skill.category : skill.category?.id
  const explicit = explicitValue && isSkillCategory(explicitValue) ? explicitValue : null
  if (explicit) return explicit
  return inferSkillCategoryClean({
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    source: skill.source
  })
}

function localSkillCategory(candidate: LocalSkillCandidate): SkillCategoryId {
  const explicit = candidate.category?.id
  if (explicit && isSkillCategory(explicit)) return explicit
  return inferSkillCategoryClean({
    name: candidate.name,
    description: candidate.description,
    tags: candidate.tags,
    source: candidate.sourcePath
  })
}

function inferSkillCategory(input: { name: string; description?: string; tags?: string[]; source?: string }): SkillCategoryId {
  const haystack = [
    input.name,
    input.description || '',
    ...(input.tags || []),
    input.source || ''
  ].join(' ').toLowerCase()
  if (/(review|审查|audit|security|code review)/i.test(haystack)) return 'review'
  if (/(test|tdd|testing|vitest|jest|spec)/i.test(haystack)) return 'testing'
  if (/(write|writing|doc|docs|文档|润色|rewrite|essay|blog)/i.test(haystack)) return 'writing'
  if (/(research|search|study|analysis|find|调研|检索)/i.test(haystack)) return 'research'
  if (/(loop|workflow|automation|agentic|orchestrate|dispatch|loop engineering|调度)/i.test(haystack)) return 'automation'
  if (/(memory|记忆|memory-bank|knowledge)/i.test(haystack)) return 'memory'
  if (/(terminal|shell|cmd|bash|powershell|git|cli|command)/i.test(haystack)) return 'terminal'
  if (/(code|coding|implement|refactor|build|feature|fix|design|frontend|backend)/i.test(haystack)) return 'coding'
  return 'general'
}

void inferSkillCategory

function inferSkillCategoryClean(input: { name: string; description?: string; tags?: string[]; source?: string }): SkillCategoryId {
  const haystack = [
    input.name,
    input.description || '',
    ...(input.tags || []),
    input.source || ''
  ].join(' ').toLowerCase()
  if (/(review|审查|audit|security|code review)/i.test(haystack)) return 'coding'
  if (/(test|tdd|testing|vitest|jest|spec|验证|质量)/i.test(haystack)) return 'testing'
  if (/(write|writing|doc|docs|document|rewrite|essay|blog|写作|文档|润色)/i.test(haystack)) return 'writing'
  if (/(research|search|study|source|evidence|find|研究|检索|资料|证据)/i.test(haystack)) return 'research'
  if (/(plan|planning|roadmap|strategy|architecture|规划|计划|架构|路线)/i.test(haystack)) return 'planning'
  if (/(design|ui|ux|interface|mockup|prototype|layout|frontend|设计|交互|界面)/i.test(haystack)) return 'design'
  if (/(data|analytics|metric|report|dashboard|table|csv|excel|memory|knowledge|数据|指标|记忆|知识库)/i.test(haystack)) return 'data'
  if (/(loop|workflow|automation|agentic|orchestrate|dispatch|terminal|shell|cmd|bash|powershell|git|cli|command|deploy|release|ops|调度|自动化|终端|运维|发布)/i.test(haystack)) return 'operations'
  if (/(code|coding|implement|refactor|build|feature|fix|backend|编码|代码|实现|重构)/i.test(haystack)) return 'coding'
  return 'general'
}

function isSkillCategory(value: string): value is SkillCategoryId {
  return SKILL_CATEGORIES.some(category => category.id === value)
}

function buildSkillCategoryCounts(skills: SkillDef[]): Record<SkillCategoryId, number> {
  const counts = Object.fromEntries(SKILL_CATEGORIES.map(category => [category.id, 0])) as Record<SkillCategoryId, number>
  for (const skill of skills) counts[skillCategoryOf(skill)] += 1
  return counts
}

function skillCategoryLabel(category: SkillCategoryId): string {
  return SKILL_CATEGORIES.find(item => item.id === category)?.zh || '通用'
}

function isLocalSkill(skill: SkillDef): boolean {
  return skill.source.startsWith('/') || skill.source.startsWith('~') || skill.source.startsWith('.')
    || skill.source.includes('\\') || skill.source.includes('/')
}

function publicSkillTags(skill: SkillDef): string[] {
  return (skill.tags || []).filter(tag => !tag.startsWith('cat:') && tag !== 'local')
}

function normalizedSkillTags(rawTags: string | string[], _category: SkillCategoryId): string[] {
  const list = Array.isArray(rawTags)
    ? rawTags
    : rawTags.split(',').map(tag => tag.trim()).filter(Boolean)
  return Array.from(new Set(list.filter(tag => !tag.startsWith('cat:') && tag !== 'local')))
}

function defaultCategoryForFilter(filter: SkillFilter): SkillCategoryId {
  return isSkillCategory(filter) ? filter : 'general'
}

function filterButtonClass(active: boolean): string {
  return active ? 'ah-btn sm primary' : 'ah-btn sm'
}

/* ---------- 安装矩阵（agent×skill） ---------- */
function InstallMatrix({ skills, caps, isInstalled, onToggle, onInstallAllForSkill, onInstallAllForAgent }: {
  skills: SkillDef[]; caps: CapState[]
  isInstalled: (agentId: string, skillId: string) => boolean
  onToggle: (agentId: string, skillId: string) => void
  onInstallAllForSkill: (skillId: string, on: boolean) => void
  onInstallAllForAgent: (agentId: string, on: boolean) => void
}) {
  const agentAllOn = (agentId: string) => skills.every(s => isInstalled(agentId, s.id))
  const skillAllOn = (skillId: string) => caps.every(c => isInstalled(c.agentId, skillId))
  return (
    <Enter className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} delay={120}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon d={IC.tasks} size={17} style={{ color: 'var(--ag-openclaw)' }} />
        <div style={{ fontWeight: 700 }}>{tr('安装矩阵', 'Install matrix')}</div>
        <span className="ah-hint">{tr('点格子=单独装，行/列「全部」=集体装', 'click a cell to install one; use row/column "all" for bulk')}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--tx-3)', fontWeight: 600 }}>{tr('技能 \\ Agent', 'Skill \\ Agent')}</th>
              {caps.map(c => (
                <th key={c.agentId} style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    {AGENT_META[c.agentId] ? <AgentMark id={c.agentId} size={22} radius={6} /> : <span style={{ fontWeight: 600 }}>{c.name}</span>}
                    <button className="ah-btn sm" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => onInstallAllForAgent(c.agentId, !agentAllOn(c.agentId))}>
                      {agentAllOn(c.agentId) ? tr('清空', 'clear') : tr('全部', 'all')}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skills.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <button className="ah-btn sm" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => onInstallAllForSkill(s.id, !skillAllOn(s.id))}>
                      {skillAllOn(s.id) ? tr('清空', 'clear') : tr('全部', 'all')}
                    </button>
                  </div>
                </td>
                {caps.map(c => {
                  const on = isInstalled(c.agentId, s.id)
                  return (
                    <td key={c.agentId} style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button onClick={() => onToggle(c.agentId, s.id)} title={on ? tr('点按卸载', 'click to uninstall') : tr('点按安装', 'click to install')}
                        style={{
                          width: 24, height: 24, borderRadius: 7, cursor: 'pointer',
                          border: '1px solid ' + (on ? 'var(--mint-line)' : 'var(--glass-border)'),
                          background: on ? 'var(--mint-soft)' : 'transparent',
                          color: on ? 'var(--mint)' : 'var(--tx-3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                        {on ? <Icon d={IC.check} size={14} /> : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Enter>
  )
}
