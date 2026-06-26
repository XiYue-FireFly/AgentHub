/**
 * AgentHub 原生 agentic 工具回环的「写 / 执行」审批门禁（Item K）。
 *
 * 在 0.3.0「默认全员可写/执行」的基础上补一道细粒度闸门：对受管工具
 * （fs_write / exec）按 per-agent × per-tool 策略放行：
 *   - 'allow'：直接执行（默认，零回归——与 0.3.0 行为一致）
 *   - 'deny' ：拒绝执行，把拒绝信息回灌模型（让它换一种方式或收尾）
 *   - 'ask'  ：运行时逐次请求用户审批（dispatcher 经 IPC 弹窗），批准才执行
 *
 * 只读工具（fs_read / fs_list）永不门禁。未绑定工作区时工具回环本就只读
 * （见 tools.ts / executor.ts），审批是叠加其上的二级闸门。
 *
 * 规则（allow/deny）与弹窗（ask）共用同一份策略：'ask' 即「需逐次弹窗」。
 *
 * 落盘 key：agentic.approval.v1
 */
import { store } from '../store'

const STORAGE_KEY = 'agentic.approval.v1'

export type ApprovalPolicy = 'allow' | 'ask' | 'deny'
export type GuardedTool = 'write' | 'exec'
/** Risk level for approval requests, inspired by codex GuardianRiskLevel */
export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical'

/**
 * Approval preset, inspired by codex's `ApprovalPreset` (read-only / auto / full-access).
 * - 'read-only'  : 阻止所有写/执行（等价 codex Read Only）
 * - 'auto'       : 默认放行低风险，高风险询问（等价 codex Default / OnRequest）
 * - 'full-access': 完全放行所有工具，永不询问（等价 codex Full Access / Never）
 * - 'ask-all'    : 每次写/执行都询问（等价 codex UnlessTrusted）
 * - 'custom'     : 走 per-agent + per-tool 自定义策略（保留 0.x 行为）
 */
export type ApprovalPreset = 'read-only' | 'auto' | 'full-access' | 'ask-all' | 'custom'

export const GUARDED_TOOLS: GuardedTool[] = ['write', 'exec']

/** 把工具内部名映射到受管类别；只读工具（fs_read/fs_list）→ null（永不门禁）。 */
export function guardedToolFor(name: string): GuardedTool | null {
  if (name === 'fs_write') return 'write'
  if (name === 'exec') return 'exec'
  return null
}

/** 运行时一次审批请求（executor → dispatcher → 渲染层弹窗）。 */
export interface ApprovalRequest {
  /** 关联的活动步骤 id（与 activity step.id 一致，便于 UI 对应） */
  stepId: string
  agentId: string
  tool: GuardedTool
  /** 工具内部名（fs_write / exec） */
  toolName: string
  label: string
  detail: string
  /** Structured action type: what the tool does */
  action: 'write_file' | 'run_command'
  /** Structured target: file path for writes, command string for exec */
  target: string
  /** Risk level assessed by executor based on tool + args */
  risk: ApprovalRisk
  /** Why this needs approval (policy reason or risk rationale) */
  reason: string
  /** Preview content: truncated content for writes, full command for exec */
  preview: string
}

/** Persisted pending approval for cross-restart recovery */
export interface PersistedPendingApproval {
  id: string
  request: ApprovalRequest
  agentId: string
  createdAt: string
  /** Set when the request was stale-expired on startup */
  staleAt?: string
  status: 'pending' | 'approved' | 'denied' | 'stale'
}

export interface PersistedApproval {
  version: 1
  /** 审批预设（参考 codex ApprovalPreset） */
  preset?: ApprovalPreset
  default: Record<GuardedTool, ApprovalPolicy>
  overrides: Record<string, Partial<Record<GuardedTool, ApprovalPolicy>>>
}

const DEFAULT: PersistedApproval = {
  version: 1,
  preset: 'auto',
  default: { write: 'allow', exec: 'allow' },
  overrides: {}
}

function normPolicy(v: unknown, fallback: ApprovalPolicy): ApprovalPolicy {
  return v === 'allow' || v === 'ask' || v === 'deny' ? v : fallback
}

function normPreset(v: unknown, fallback: ApprovalPreset = 'auto'): ApprovalPreset {
  return v === 'read-only' || v === 'auto' || v === 'full-access' || v === 'ask-all' || v === 'custom' ? v : fallback
}

/** Map preset to default policies (parallels codex builtin_approval_presets). */
export function presetToPolicies(preset: ApprovalPreset): Record<GuardedTool, ApprovalPolicy> {
  switch (preset) {
    case 'read-only':   return { write: 'deny',  exec: 'deny'  }
    case 'full-access': return { write: 'allow', exec: 'allow' }
    case 'ask-all':     return { write: 'ask',   exec: 'ask'   }
    case 'auto':        return { write: 'allow', exec: 'allow' }  // 默认放行（用户已明确批准 agentic）
    case 'custom':      return { write: 'allow', exec: 'allow' }  // 占位，由 default/overrides 接管
  }
}

class ApprovalConfig {
  /** Cached snapshot of the persisted config. Invalidated on every write()
   *  so the hot tool-call path avoids re-reading + re-normalizing the store
   *  on every invocation. */
  private cache: PersistedApproval | null = null

  private read(): PersistedApproval {
    if (this.cache) return this.cache
    const raw: any = store.get(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') { this.cache = cloneDefault(); return this.cache }
    const preset = normPreset(raw.preset, 'auto')
    const def: Record<GuardedTool, ApprovalPolicy> = {
      write: normPolicy(raw.default?.write, 'allow'),
      exec: normPolicy(raw.default?.exec, 'allow')
    }
    const overrides: PersistedApproval['overrides'] = {}
    if (raw.overrides && typeof raw.overrides === 'object') {
      for (const [agentId, o] of Object.entries<any>(raw.overrides)) {
        if (!o || typeof o !== 'object') continue
        const entry: Partial<Record<GuardedTool, ApprovalPolicy>> = {}
        if (o.write !== undefined) entry.write = normPolicy(o.write, def.write)
        if (o.exec !== undefined) entry.exec = normPolicy(o.exec, def.exec)
        if (Object.keys(entry).length) overrides[agentId] = entry
      }
    }
    this.cache = { version: 1, preset, default: def, overrides }
    return this.cache
  }

  private write(s: PersistedApproval): void {
    store.set(STORAGE_KEY, s)
    this.cache = s
  }

  getConfig(): PersistedApproval {
    // LOW-10: Return deep copy to prevent callers from mutating internal cache
    const data = this.read()
    try {
      return JSON.parse(JSON.stringify(data))
    } catch {
      return { ...data, default: { ...data.default }, overrides: { ...data.overrides } }
    }
  }

  /**
   * per-agent 覆盖优先，否则回落全局默认。
   *
   * 关键修正（参照 codex AskForApproval::Never / Full Access）：
   * 当 preset = 'full-access' 时，无视 overrides 强制返回 'allow'，等价于 codex 的 Never 模式
   * （这正是用户期望的"完全审核"行为：永不弹窗、自动放行）。
   */
  policyFor(agentId: string, tool: GuardedTool): ApprovalPolicy {
    const s = this.read()
    // codex full-access：永不弹窗，全部放行
    if (s.preset === 'full-access') return 'allow'
    // codex read-only：写/执行全部拒绝
    if (s.preset === 'read-only') return 'deny'
    // codex unless-trusted：每次都问
    if (s.preset === 'ask-all') return 'ask'
    // 其余（auto / custom）走 per-agent 覆盖 + default 回落
    return s.overrides[agentId]?.[tool] ?? s.default[tool]
  }

  /**
   * 带风险等级的策略决策（auto 预设专用）。
   *
   * auto 模式承诺「低风险自动放行，高风险询问」——此方法让风险等级真正参与决策：
   *   - full-access / read-only / ask-all：与 policyFor 一致，不受 risk 影响
   *   - auto：基础策略为 allow 时，若 risk ∈ {high, critical} → 升级为 ask
   *   - custom：尊重 per-agent 覆盖，不按 risk 升级（用户已显式配置）
   *
   * 这样 UI 文案与实际行为一致：auto 下高危命令（rm -rf / format / 系统路径写入等）必弹窗。
   */
  policyForWithRisk(agentId: string, tool: GuardedTool, risk: ApprovalRisk): ApprovalPolicy {
    const s = this.read()
    // full-access / read-only / ask-all 与 risk 无关
    if (s.preset === 'full-access') return 'allow'
    if (s.preset === 'read-only') return 'deny'
    if (s.preset === 'ask-all') return 'ask'
    // auto 模式：高风险自动升级为 ask
    if (s.preset === 'auto') {
      const base = s.overrides[agentId]?.[tool] ?? s.default[tool]
      if (base === 'allow' && (risk === 'high' || risk === 'critical')) return 'ask'
      return base
    }
    // custom：尊重显式配置
    return s.overrides[agentId]?.[tool] ?? s.default[tool]
  }

  /** 设置审批预设（参考 codex builtin_approval_presets）。 */
  setPreset(preset: ApprovalPreset): PersistedApproval {
    const s = this.read()
    s.preset = normPreset(preset, s.preset || 'auto')
    // 同步 default 以便 UI 显示一致（custom 模式下保留原 default）
    if (preset !== 'custom') {
      s.default = presetToPolicies(preset)
    }
    this.write(s)
    return s
  }

  setDefault(tool: GuardedTool, policy: ApprovalPolicy): PersistedApproval {
    const s = this.read()
    s.default[tool] = normPolicy(policy, s.default[tool])
    // 手动改 default 自动切到 custom 模式（避免 preset 与 default 不一致）
    s.preset = 'custom'
    this.write(s)
    return s
  }

  /** policy=null → 清除该 agent 在该工具上的覆盖（回落默认）。 */
  setOverride(agentId: string, tool: GuardedTool, policy: ApprovalPolicy | null): PersistedApproval {
    const s = this.read()
    const entry = s.overrides[agentId] || {}
    if (policy === null) delete entry[tool]
    else entry[tool] = normPolicy(policy, s.default[tool])
    if (Object.keys(entry).length) s.overrides[agentId] = entry
    else delete s.overrides[agentId]
    this.write(s)
    return s
  }
}

function cloneDefault(): PersistedApproval {
  return { version: 1, preset: 'auto', default: { ...DEFAULT.default }, overrides: {} }
}

let instance: ApprovalConfig | null = null

export function getApprovalConfig(): ApprovalConfig {
  if (!instance) instance = new ApprovalConfig()
  return instance
}

export { DEFAULT as APPROVAL_CONFIG_DEFAULT }

// --- Pending approval persistence ---

const PENDING_STORAGE_KEY = 'agentic.pending-approvals.v1'

export function savePendingApproval(pa: PersistedPendingApproval): void {
  const list = loadPendingApprovals()
  const idx = list.findIndex(item => item.id === pa.id)
  if (idx >= 0) list[idx] = pa
  else list.push(pa)
  store.set(PENDING_STORAGE_KEY, list)
}

export function removePendingApproval(id: string): void {
  const list = loadPendingApprovals().filter(item => item.id !== id)
  store.set(PENDING_STORAGE_KEY, list)
}

export function resolvePendingApproval(id: string, status: 'approved' | 'denied'): void {
  const list = loadPendingApprovals()
  const item = list.find(p => p.id === id)
  if (item) {
    item.status = status
    store.set(PENDING_STORAGE_KEY, list)
  }
}

export function loadPendingApprovals(): PersistedPendingApproval[] {
  const raw: any = store.get(PENDING_STORAGE_KEY)
  return Array.isArray(raw) ? raw : []
}

/** On startup, mark any still-pending requests as stale (task context lost). */
export function expireStalePendingApprovals(): number {
  const list = loadPendingApprovals()
  let expired = 0
  const now = new Date().toISOString()
  for (const item of list) {
    if (item.status === 'pending') {
      item.status = 'stale'
      item.staleAt = now
      expired++
    }
  }
  if (expired > 0) store.set(PENDING_STORAGE_KEY, list)
  return expired
}

// --- Risk assessment ---

/** Assess risk level for a tool invocation. Inspired by codex GuardianRiskLevel. */
export function assessApprovalRisk(toolName: string, args: Record<string, unknown> | undefined): ApprovalRisk {
  if (toolName === 'exec') {
    const cmd = String((args as any)?.command || '').toLowerCase()
    // Critical: destructive system commands, privilege escalation, code injection
    if (/\b(rm\s+-rf|format|del\s+\/[sfq]|rmdir\s+\/s|taskkill|shutdown|reg\s+delete|diskpart|sudo\s+rm|eval\s*\(|exec\s*\()\b/i.test(cmd)) {
      return 'critical'
    }
    // High: network, package install, service management
    if (/\b(curl|wget|npm\s+install|pip\s+install|apt\s+install|brew\s+install|systemctl|sc\s+|net\s+(start|stop))\b/i.test(cmd)) {
      return 'high'
    }
    // Medium: git push, any exec
    if (/\b(git\s+push|git\s+commit)\b/i.test(cmd)) {
      return 'medium'
    }
    return 'medium' // Default for any exec
  }
  if (toolName === 'fs_write') {
    const path = String((args as any)?.path || '')
    // High: writing to system/root-level paths (cover drive-roots, forward/backslash, any drive letter)
    if (/^[a-z]:[\\/]?$/i.test(path) || path === '/' || /^[a-z]:[\\/](?:Windows|Program\s+Files|Program\s+Data|ProgramData|Users|System)/i.test(path) || /^\/(?:etc|usr|bin|sbin|boot|lib|var|tmp|root)\b/.test(path)) {
      return 'high'
    }
    // Medium: any file write
    return 'medium'
  }
  return 'low'
}

/** Generate a human-readable reason for why this action needs approval. */
export function approvalReason(toolName: string, risk: ApprovalRisk, target: string): string {
  if (toolName === 'exec') {
    if (risk === 'critical') return `Destructive command detected: ${target}`
    if (risk === 'high') return `System-altering command: ${target}`
    return `Command execution: ${target}`
  }
  if (toolName === 'fs_write') {
    return `Writing to file: ${target}`
  }
  return `Tool action: ${toolName}`
}
