import React from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'
import { SetupTab } from '../glass/connection-status'
import { localAgentOptions } from './localAgentOptions'

export function RunTimeline({
  events,
  turns,
  localAgents,
  setLocalAgents,
  schedules,
  mode,
  setMode,
  customSchedule,
  setCustomSchedule,
  openSetup,
  onClose,
  terminalRuns,
  setTerminalRuns
}: {
  events: RuntimeEvent[]
  turns: WorkbenchTurn[]
  localAgents: LocalAgentStatus[]
  setLocalAgents: (agents: LocalAgentStatus[]) => void
  schedules: SchedulePreview[]
  mode: DispatchPreset
  setMode: (mode: DispatchPreset) => void
  customSchedule: SchedulePreview
  setCustomSchedule: (schedule: SchedulePreview) => void
  openSetup: (tab?: SetupTab | 'appearance') => void
  onClose: () => void
  terminalRuns?: TerminalRun[]
  setTerminalRuns?: (runs: TerminalRun[]) => void
}) {
  const schedule = mode === 'custom' ? customSchedule : schedules.find(s => s.preset === mode)
  const recent = [...events].slice(-14).reverse()
  const [detecting, setDetecting] = React.useState(false)
  const runningTurns = turns.filter(turn => turn.status === 'running' || turn.status === 'queued').length
  const completedTurns = turns.filter(turn => turn.status === 'completed').length
  const failedTurns = turns.filter(turn => turn.status === 'failed').length
  const usableAgentIds = localAgentOptions(localAgents)
  const readyAgents = usableAgentIds.length
  const displayAgents = [...localAgents].sort((a, b) => agentRank(a, usableAgentIds) - agentRank(b, usableAgentIds))

  const refreshAgents = async () => {
    setDetecting(true)
    try {
      const next = await window.electronAPI.localAgents.detect()
      setLocalAgents(next)
    } finally {
      setDetecting(false)
    }
  }

  const refreshTerminal = async () => {
    if (!setTerminalRuns) return
    setTerminalRuns(await window.electronAPI.terminal.history().catch(() => []))
  }

  return (
    <div className="wb-timeline">
      <div className="wb-timeline-head">
        <div>
          <strong>{tr('运行工作台', 'Run workspace')}</strong>
          <span>{runningTurns} {tr('运行中', 'running')} / {completedTurns} {tr('完成', 'done')} / {failedTurns} {tr('失败', 'failed')}</span>
        </div>
        <div className="wb-timeline-head-actions">
          <button onClick={refreshAgents} disabled={detecting} title={tr('检测本地 Agent', 'Detect local agents')}>
            <Icon d={IC.refresh} size={14} />
          </button>
          <button onClick={onClose} title={tr('关闭', 'Close')}><Icon d={IC.x} size={14} /></button>
        </div>
      </div>

      <div className="wb-run-summary">
        <div>
          <strong>{readyAgents}</strong>
          <span>{tr('可用 Agent', 'ready agents')}</span>
        </div>
        <div>
          <strong>{schedule?.steps.length ?? 0}</strong>
          <span>{tr('调度步骤', 'schedule steps')}</span>
        </div>
        <div>
          <strong>{events.length}</strong>
          <span>{tr('事件', 'events')}</span>
        </div>
      </div>

      <section>
        <div className="wb-right-title">{tr('本地 Agent', 'Local agents')}</div>
        <div className="wb-local-agents">
          {displayAgents.map(agent => (
            <div key={agent.agentId} className={'wb-local-agent ' + localAgentClass(agent, usableAgentIds)}>
              <AgentMark id={agent.agentId} size={26} radius={7} />
              <div>
                <strong>{agent.label || agentName(agent.agentId)}</strong>
                <small>{agentStatusLine(agent)}</small>
              </div>
              <span className={'ah-dot ' + dotClass(agent, usableAgentIds)}></span>
              <LocalAgentPicker agent={agent} onChange={setLocalAgents} />
            </div>
          ))}
          {displayAgents.length === 0 && (
            <div className="wb-muted-box">{tr('还没有本地 Agent 候选。点击刷新重新检测。', 'No local agent candidates yet. Refresh to detect again.')}</div>
          )}
        </div>
      </section>

      <section>
        <div className="wb-right-title">{tr('调度', 'Schedule')}</div>
        <div className="wb-schedule-card">
          <div className="wb-schedule-mode-row">
            <strong>{scheduleLabel(schedule, mode)}</strong>
            <select value={mode} onChange={event => setMode(event.target.value as DispatchPreset)}>
              {schedules.map(item => <option key={item.preset} value={item.preset}>{scheduleLabel(item, item.preset)}</option>)}
            </select>
          </div>
          <p>{scheduleDescription(schedule, mode)}</p>
          {mode === 'custom'
            ? <CustomScheduleEditor schedule={customSchedule} setSchedule={setCustomSchedule} localAgents={localAgents} />
            : schedule?.steps.map((step, index) => (
              <div key={step.id} className="wb-schedule-step">
                <em>{index + 1}</em>
                {AGENT_META[step.agentId] ? <AgentMark id={step.agentId} size={20} radius={5} /> : <Icon d={IC.broadcast} size={15} />}
                <span>
                  {step.label}
                  <small>{roleLabel(step.role)}{step.dependsOn?.length ? ` / 依赖 ${step.dependsOn.length} 步` : ''}</small>
                </span>
              </div>
            ))}
        </div>
      </section>

      <section>
        <div className="wb-right-title">{tr('运行时间线', 'Run timeline')}</div>
        {recent.length === 0 && <div className="wb-muted-box">{tr('Agent 工作事件会显示在这里。', 'Events will appear here as agents work.')}</div>}
        {recent.map(event => (
          <div key={event.id} className="wb-event-row">
            <span className="wb-event-kind">{event.kind.replace('agent:', '').replace('turn:', '')}</span>
            <span>
              {event.agentId ? AGENT_META[event.agentId]?.name || event.agentId : event.payload?.status || event.payload?.mode || 'system'}
              <small>{eventSummary(event)} / {relativeEventTime(event.createdAt)}</small>
            </span>
          </div>
        ))}
      </section>

      {terminalRuns && (
        <section>
          <div className="wb-right-title wb-section-title-row">
            <span>{tr('终端输出', 'Terminal output')}</span>
            <button onClick={refreshTerminal}><Icon d={IC.refresh} size={13} /></button>
          </div>
          {terminalRuns.length === 0 && <div className="wb-muted-box">{tr('通过 /terminal 运行的命令会显示在这里。', 'Commands run with /terminal appear here.')}</div>}
          {terminalRuns.slice(0, 6).map(run => (
            <div key={run.id} className={'wb-terminal-run ' + run.status}>
              <div className="wb-terminal-run-head">
                <code>{run.command}</code>
                <span>{terminalStatus(run)}</span>
              </div>
              <small>{run.cwd}</small>
              {(run.stdout || run.stderr) && <pre>{[run.stdout, run.stderr].filter(Boolean).join('\n')}</pre>}
            </div>
          ))}
        </section>
      )}

      {turns.some(t => t.status === 'failed') && (
        <button className="wb-wide-button" onClick={() => openSetup('routing')}>{tr('检查路由', 'Check routing')}</button>
      )}
    </div>
  )
}

function agentRank(agent: LocalAgentStatus, usableIds: string[]): number {
  if (usableIds.includes(agent.agentId)) return 0
  if (agent.configured) return 1
  if (agent.installed || agent.candidates.length > 0) return 2
  return 3
}

function localAgentClass(agent: LocalAgentStatus, usableIds: string[]): string {
  if (usableIds.includes(agent.agentId)) return 'ready'
  if (agent.configured) return 'configured'
  if (agent.installed || agent.candidates.length > 0) return 'candidate'
  return 'missing'
}

function dotClass(agent: LocalAgentStatus, usableIds: string[]): string {
  if (usableIds.includes(agent.agentId)) return 'idle'
  if (agent.configured || agent.installed || agent.candidates.length > 0) return 'busy'
  return 'off'
}

function agentStatusLine(agent: LocalAgentStatus): string {
  if (agent.configured) {
    const parts = [
      tr('已配置', 'configured'),
      agent.protocol || 'stdio',
      agent.version,
      agent.args ? tr('有启动参数', 'args set') : ''
    ].filter(Boolean)
    return parts.join(' / ')
  }
  if (agent.manualOnly) {
    if (agent.candidates.length > 0) return tr('检测到候选，需要填写非交互参数后才能调度。', 'Candidate detected. Add non-interactive args before dispatch.')
    return tr('需手动配置路径和参数。', 'Manual path and args required.')
  }
  if (agent.installed) return tr('已检测到，尚未绑定。', 'Detected, not bound yet.')
  return agent.error || tr('未安装', 'not installed')
}

function terminalStatus(run: TerminalRun): string {
  if (run.status === 'running') return tr('运行中', 'running')
  if (run.status === 'completed') return run.exitCode === 0 ? tr('完成', 'done') : `${tr('退出', 'exit')} ${run.exitCode}`
  if (run.status === 'cancelled') return tr('已取消', 'cancelled')
  return `${tr('失败', 'failed')}${run.exitCode !== null ? ` ${run.exitCode}` : ''}`
}

function CustomScheduleEditor({
  schedule,
  setSchedule,
  localAgents
}: {
  schedule: SchedulePreview
  setSchedule: (schedule: SchedulePreview) => void
  localAgents: LocalAgentStatus[]
}) {
  const agents = localAgentOptions(localAgents)
  const updateStep = (stepId: string, patch: Partial<SchedulePreview['steps'][number]>) => {
    setSchedule({
      ...schedule,
      steps: schedule.steps.map(step => step.id === stepId ? { ...step, ...patch } : step)
    })
  }
  const addStep = () => {
    const index = schedule.steps.length + 1
    setSchedule({
      ...schedule,
      steps: [
        ...schedule.steps,
        {
          id: `custom-${Date.now().toString(36)}`,
          label: tr(`步骤 ${index}`, `Step ${index}`),
          agentId: agents[0] || 'auto',
          role: 'worker',
          mode: 'auto',
          dependsOn: schedule.steps.length ? [schedule.steps[schedule.steps.length - 1].id] : []
        }
      ]
    })
  }
  const removeStep = (stepId: string) => {
    const nextSteps = schedule.steps
      .filter(step => step.id !== stepId)
      .map(step => ({ ...step, dependsOn: step.dependsOn?.filter(dep => dep !== stepId) }))
    setSchedule({ ...schedule, steps: nextSteps.length ? nextSteps : schedule.steps })
  }
  const toggleDependency = (stepId: string, depId: string) => {
    const step = schedule.steps.find(item => item.id === stepId)
    if (!step || step.id === depId) return
    const deps = new Set(step.dependsOn ?? [])
    if (deps.has(depId)) deps.delete(depId)
    else deps.add(depId)
    updateStep(stepId, { dependsOn: [...deps] })
  }

  return (
    <div className="wb-custom-schedule">
      {schedule.steps.map((step, index) => (
        <div key={step.id} className="wb-custom-step">
          <div className="wb-custom-step-head">
            <em>{index + 1}</em>
            {AGENT_META[step.agentId] ? <AgentMark id={step.agentId} size={22} radius={6} /> : <Icon d={IC.broadcast} size={15} />}
            <input value={step.label} onChange={event => updateStep(step.id, { label: event.target.value })} />
            <button onClick={() => removeStep(step.id)} disabled={schedule.steps.length <= 1} title={tr('删除步骤', 'Delete step')}>
              <Icon d={IC.trash} size={13} />
            </button>
          </div>
          <div className="wb-custom-step-grid">
            <select value={step.agentId} onChange={event => updateStep(step.id, { agentId: event.target.value })}>
              {agents.length === 0 && <option value="auto">{tr('无可用本地 Agent', 'No local agents ready')}</option>}
              {agents.map(agentId => <option key={agentId} value={agentId}>{agentName(agentId)}</option>)}
            </select>
            <select value={step.role} onChange={event => updateStep(step.id, { role: event.target.value as any })}>
              <option value="lead">{tr('主控', 'Lead')}</option>
              <option value="worker">{tr('执行', 'Worker')}</option>
              <option value="reviewer">{tr('评审', 'Reviewer')}</option>
              <option value="synthesizer">{tr('汇总', 'Synthesizer')}</option>
              <option value="target">{tr('目标', 'Target')}</option>
            </select>
          </div>
          <div className="wb-custom-deps">
            <span>{tr('依赖', 'Depends on')}</span>
            {schedule.steps.filter(candidate => candidate.id !== step.id).map(candidate => (
              <label key={candidate.id}>
                <input
                  type="checkbox"
                  checked={step.dependsOn?.includes(candidate.id) ?? false}
                  onChange={() => toggleDependency(step.id, candidate.id)}
                />
                {candidate.label || candidate.id}
              </label>
            ))}
            {schedule.steps.length <= 1 && <small>{tr('添加更多步骤后可设置依赖关系。', 'Add more steps to set dependencies.')}</small>}
          </div>
        </div>
      ))}
      <button className="wb-wide-button" onClick={addStep}><Icon d={IC.plus} size={14} /> {tr('添加步骤', 'Add step')}</button>
    </div>
  )
}

function roleLabel(role: string): string {
  if (role === 'lead') return tr('主控', 'lead')
  if (role === 'worker') return tr('执行', 'worker')
  if (role === 'reviewer') return tr('评审', 'review')
  if (role === 'synthesizer') return tr('汇总', 'synthesis')
  if (role === 'target') return tr('目标', 'target')
  return role
}

function agentName(agentId: string): string {
  if (agentId === 'minimax-code') return 'OpenCode'
  return (AGENT_META[agentId]?.name || agentId).replace(' CLI', '').replace(' Code', '')
}

function eventSummary(event: RuntimeEvent): string {
  const payload = event.payload || {}
  if (payload.error) return String(payload.error).slice(0, 56)
  if (payload.status) return String(payload.status)
  if (payload.channel) return String(payload.channel)
  if (payload.text) return String(payload.text).slice(0, 56)
  if (payload.content) return String(payload.content).slice(0, 56)
  if (payload.kind) return String(payload.kind).replace('orchestrate:', '')
  return `seq ${event.seq}`
}

function relativeEventTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return tr('刚刚', 'now')
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}${tr('分钟前', 'm ago')}`
  return `${Math.round(diff / 3_600_000)}${tr('小时前', 'h ago')}`
}

function LocalAgentPicker({ agent, onChange }: { agent: LocalAgentStatus; onChange: (agents: LocalAgentStatus[]) => void }) {
  const [binary, setBinary] = React.useState(agent.binary || '')
  const [protocol, setProtocol] = React.useState<'stdio-plain' | 'acp'>((agent.protocol === 'acp' ? 'acp' : 'stdio-plain'))
  const [args, setArgs] = React.useState(agent.args || '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setBinary(agent.binary || '')
    setProtocol(agent.protocol === 'acp' ? 'acp' : 'stdio-plain')
    setArgs(agent.args || '')
  }, [agent.binary, agent.protocol, agent.args, agent.candidates])

  const save = async () => {
    if (!binary.trim()) return
    setSaving(true)
    setError(null)
    try {
      const next = await window.electronAPI.localAgents.configure(agent.agentId, {
        binary: binary.trim(),
        protocol,
        args: args.trim()
      })
      onChange(next)
    } catch (e: any) {
      setError(e?.message || tr('保存本地 Agent 配置失败。', 'Failed to save local agent config.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wb-local-agent-config">
      {agent.candidates.length > 0
        ? (
          <select value={binary} onChange={e => setBinary(e.target.value)}>
            <option value="">{tr('选择可执行文件路径', 'Choose executable path')}</option>
            {agent.binary && !agent.candidates.some(c => c.path === agent.binary) && <option value={agent.binary}>{agent.binary}</option>}
            {agent.candidates.map(c => <option key={c.path} value={c.path}>{c.label}</option>)}
          </select>
        )
        : (
          <input value={binary} onChange={e => setBinary(e.target.value)} placeholder={tr('填写 CLI 路径', 'Enter CLI path')} />
        )}
      <select value={protocol} onChange={e => setProtocol(e.target.value as 'stdio-plain' | 'acp')}>
        <option value="stdio-plain">stdio</option>
        <option value="acp">ACP</option>
      </select>
      <input
        value={args}
        onChange={e => setArgs(e.target.value)}
        placeholder={protocol === 'acp' ? tr('ACP 可留空', 'ACP args optional') : tr('启动参数，含 {prompt}', 'Args with {prompt}')}
      />
      <button onClick={save} disabled={saving || !binary.trim() || (agent.manualOnly && protocol !== 'acp' && !/\{prompt\}/i.test(args))}>{saving ? tr('保存中', 'Saving') : tr('使用', 'Use')}</button>
      {error && <small className="wb-local-agent-error">{error}</small>}
    </div>
  )
}

function scheduleLabel(schedule: SchedulePreview | undefined, mode: DispatchPreset): string {
  if (!schedule) return mode
  return ({
    auto: tr('自动路由', 'Auto route'),
    broadcast: tr('广播', 'Broadcast'),
    chain: tr('链式交接', 'Chain handoff'),
    orchestrate: tr('编排', 'Orchestrate'),
    'lead-workers': tr('主控 + 工作者', 'Lead + workers'),
    'parallel-review': tr('并行评审', 'Parallel review'),
    custom: tr('自定义调度', 'Custom schedule')
  } as Record<DispatchPreset, string>)[schedule.preset] || schedule.label
}

function scheduleDescription(schedule: SchedulePreview | undefined, mode: DispatchPreset): string {
  if (!schedule) return tr('暂无调度预览。', 'No schedule preview available.')
  return ({
    auto: tr('让 AgentHub 为本轮选择最合适的可用 Agent。', 'Let AgentHub choose the best available agent for this turn.'),
    broadcast: tr('并行询问每个已配置的 Agent。', 'Ask every configured agent in parallel.'),
    chain: tr('把上游输出交给下一个本地编码 Agent。', 'Pass the upstream output into the next local coding agent.'),
    orchestrate: tr('使用计划、执行、验证与汇总路径。', 'Use the planning, execution, verification, and synthesis path.'),
    'lead-workers': tr('Claude/Codex 规划，Codex/OpenCode 执行，Claude 汇总。', 'Claude/Codex plan, Codex/OpenCode execute, Claude synthesizes.'),
    'parallel-review': tr('Codex、Claude、OpenCode 并行回答，再比较差异。', 'Run Codex, Claude, and OpenCode together, then compare outputs.'),
    custom: tr('按你编辑的 Agent 节点和依赖关系执行；无依赖步骤可并行运行。', 'Run the agent nodes and dependencies you edit; independent steps can run in parallel.')
  } as Record<DispatchPreset, string>)[mode] || schedule.description
}
