import React, { useEffect, useMemo, useState } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { ActivityTrail } from '../glass/activity-view'
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'
import { SetupTab, firstRunActionForError } from '../glass/connection-status'
import { MarkdownBlock } from './MarkdownBlock'

export function ThreadView({
  thread,
  turns,
  events,
  onRetry,
  onCancelAgent,
  openSetup,
  onCreateProject,
  onCreateThread,
  hasWorkspace,
  scrollRef,
  onScroll
}: {
  thread: WorkbenchThread | null
  turns: WorkbenchTurn[]
  events: RuntimeEvent[]
  onRetry: (turnId: string) => void
  onCancelAgent: (turnId: string, agentId: string) => void
  openSetup: (tab?: SetupTab | 'appearance') => void
  onCreateProject: () => void
  onCreateThread: () => void
  hasWorkspace: boolean
  scrollRef?: React.RefObject<HTMLElement>
  onScroll?: () => void
}) {
  const byTurn = useMemo(() => groupEvents(events), [events])

  if (!thread && turns.length === 0) {
    return (
      <section className="wb-thread-empty">
        <h1>{tr('开始新对话', 'Start a new chat')}</h1>
        <p>{hasWorkspace
          ? tr('当前对话会使用已绑定工作目录的文件、Git、终端和运行记录。', 'This chat can use the bound folder, Git, terminal, and run history.')
          : tr('普通问答、写作和模型上下文可以直接开始；需要读写本地文件时再绑定工作目录。', 'Chat, writing, and model context can start now; bind a folder when local files are needed.')}</p>
        <div className="wb-empty-actions">
          <button className="primary" onClick={onCreateThread}>
            {tr('新对话', 'New chat')}
          </button>
          <button onClick={onCreateProject}>{tr('添加工作目录', 'Add working folder')}</button>
        </div>
      </section>
    )
  }

  return (
    <section className="wb-thread" ref={scrollRef} onScroll={onScroll}>
      {turns.map(turn => (
        <article key={turn.id} className="wb-turn">
          <div className="wb-user-message">
            <div>
              <strong>{turn.prompt}</strong>
              <small>{turnLabel(turn)} / {statusLabel(turn.status)}</small>
              {turn.attachments?.length ? <AttachmentStrip attachments={turn.attachments} /> : null}
            </div>
            {turn.status !== 'running' && (
              <button onClick={() => onRetry(turn.id)} title={tr('重试', 'Retry')}><Icon d={IC.refresh} size={14} /></button>
            )}
          </div>
          <AgentOutputs turn={turn} events={byTurn.get(turn.id) ?? []} openSetup={openSetup} onCancelAgent={onCancelAgent} />
        </article>
      ))}
    </section>
  )
}

function AgentOutputs({ turn, events, openSetup, onCancelAgent }: { turn: WorkbenchTurn; events: RuntimeEvent[]; openSetup: (tab?: SetupTab | 'appearance') => void; onCancelAgent: (turnId: string, agentId: string) => void }) {
  const grouped = new Map<string, RuntimeEvent[]>()
  const visibleEvents = events.filter(event => event.kind !== 'turn:created' && event.kind !== 'turn:status' && event.kind !== 'run:created' && event.kind !== 'run:status')
  for (const event of visibleEvents) {
    if (!event.agentId && event.kind !== 'orchestrate' && !event.payload?.kind?.startsWith?.('orchestrate:')) continue
    const key = event.agentId || 'orchestrate'
    const bucket = grouped.get(key)
    if (bucket) bucket.push(event)
    else grouped.set(key, [event])
  }
  if (grouped.size === 0 && turn.status === 'running') grouped.set(turn.targetAgent || 'orchestrate', [])

  return (
    <div className="wb-agent-output-list">
      {[...grouped.entries()].map(([agentId, agentEvents]) => {
        const rawText = agentEvents.filter(e => e.kind === 'agent:delta' && e.payload?.channel !== 'thinking').map(e => e.payload?.text || '').join('')
        const done = agentEvents.find(e => e.kind === 'agent:done')
        const error = agentEvents.find(e => e.kind === 'agent:error')
        const steps = dedupeSteps(agentEvents.filter(e => e.kind === 'agent:activity' && e.payload?.step).map(e => e.payload.step))
        const orch = agentEvents.filter(e => e.kind === 'orchestrate' || String(e.payload?.kind || '').startsWith('orchestrate:'))
        const action = error?.payload?.error ? firstRunActionForError(error.payload.error) : null
        const status = outputStatus(turn.status, agentEvents, agentId)
        const text = status === 'running' ? rawText.trim() : normalizeOutput(rawText)
        const doneContent = normalizeOutput(done?.payload?.content || '')

        return (
          <div key={agentId} className={'wb-agent-output ' + status}>
            <div className="wb-agent-output-head">
              {AGENT_META[agentId] ? <AgentMark id={agentId} size={26} radius={7} /> : <div className="wb-system-mark"><Icon d={IC.broadcast} size={14} /></div>}
              <span>{agentOutputName(agentId, agentEvents)}</span>
              <small>{statusLabel(status)}</small>
              {status === 'running' && agentId !== 'orchestrate' && (
                <button className="wb-agent-stop" onClick={() => onCancelAgent(turn.id, agentId)} title={tr('暂停该 Agent', 'Pause this agent')}>
                  <Icon d={IC.stop} size={12} />
                </button>
              )}
            </div>
            {steps.length > 0 && <ActivityTrail steps={steps as any} running={!done && !error} />}
            {orch.length > 0 && <OrchestrateCompact events={orch} turnStatus={turn.status} />}
            {text && (status === 'running' ? <pre className="wb-streaming-text">{text}</pre> : <MarkdownBlock content={text} />)}
            {doneContent && !text && <MarkdownBlock content={doneContent} />}
            {!text && !doneContent && !error && orch.length === 0 && (
              turn.status === 'running'
                ? <ProcessingState events={agentEvents} turn={turn} />
                : <div className="wb-muted-box">{tr('本轮没有可展示的文本输出。', 'No displayable text output for this turn.')}</div>
            )}
            {error && (
              <div className="wb-output-error">
                {friendlyError(error.payload?.error)}
                {action && <button onClick={() => openSetup(action.tab)}>{tr(action.labelZh, action.labelEn)}</button>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OrchestrateCompact({ events, turnStatus }: { events: RuntimeEvent[]; turnStatus: WorkbenchTurnStatus }) {
  const plan = [...events].reverse().find(event => event.payload?.kind === 'orchestrate:plan' && Array.isArray(event.payload?.subtasks) && event.payload.subtasks.length > 0)
  const subtasks = Array.isArray(plan?.payload?.subtasks) ? plan.payload.subtasks : []
  const final = [...events].reverse().find(event => event.payload?.kind === 'orchestrate:final')
  const error = [...events].reverse().find(event => event.payload?.kind === 'orchestrate:error')
  const rows = compactOrchestrateEvents(events)
  return (
    <div className="wb-orchestrate-compact">
      {subtasks.length > 0 && (
        <div className="wb-orchestrate-plan">
          <strong>{tr('任务拆解', 'Plan')}</strong>
          <ol>
            {subtasks.slice(0, 6).map((task: any) => (
              <li key={task.id || task.title}>
                <span>{task.title || task.detail || task.id}</span>
                {task.agentId && <small>{agentOutputName(task.agentId)}</small>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {rows.map(row => (
        <div key={row.key}>
          <span>{row.label}</span>
          <small>{row.detail}</small>
        </div>
      ))}
      {final?.payload?.content && (
        <MarkdownBlock content={normalizeOutput(final.payload.content)} />
      )}
      {error?.payload?.error && (
        <div className="wb-output-error">{friendlyError(error.payload.error)}</div>
      )}
      {!final && !error && turnStatus === 'running' && (
        <div className="wb-muted-box">{tr('编排运行中，正在等待 Agent 返回。', 'Orchestration is running and waiting for agent output.')}</div>
      )}
    </div>
  )
}

function ProcessingState({ events, turn }: { events: RuntimeEvent[]; turn: WorkbenchTurn }) {
  const running = outputStatus(turn.status, events, turn.targetAgent || '') === 'running'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const latestActivity = [...events].reverse().find(event => event.kind === 'agent:activity' && event.payload?.step)
  const latestStep = latestActivity?.payload?.step
  const started = events.find(event => event.kind === 'agent:start')?.createdAt || turn.createdAt
  const seconds = Math.max(0, Math.round(((running ? now : Date.now()) - started) / 1000))
  const stage = latestStep?.label || latestStep?.tool || tr('正在等待输出', 'Waiting for output')
  return (
    <div className="wb-processing-state">
      <span className="wb-processing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>{stage}</span>
      <small>{formatDuration(seconds)}</small>
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

function AttachmentStrip({ attachments }: { attachments: WorkbenchAttachment[] }) {
  return (
    <div className="wb-turn-attachments">
      {attachments.map(att => (
        <div key={att.id} className={'wb-turn-attachment ' + att.kind} title={att.path || att.name}>
          {att.kind === 'image' && att.dataUrl
            ? <img src={att.dataUrl} alt={att.name} />
            : <Icon d={att.kind === 'image' ? IC.image : IC.file} size={14} />}
          <span>{att.name}</span>
          {att.size ? <small>{formatBytes(att.size)}</small> : null}
        </div>
      ))}
    </div>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function groupEvents(events: RuntimeEvent[]): Map<string, RuntimeEvent[]> {
  const grouped = new Map<string, RuntimeEvent[]>()
  for (const event of events) {
    const bucket = grouped.get(event.turnId)
    if (bucket) bucket.push(event)
    else grouped.set(event.turnId, [event])
  }
  return grouped
}

function turnLabel(turn: WorkbenchTurn): string {
  if (turn.modelSelection?.source === 'provider' && !turn.targetAgent) return providerOutputName(turn.modelSelection.providerId, turn.modelSelection.modelId)
  if (turn.targetAgent) return tr(`直连 ${agentOutputName(turn.targetAgent)}`, `Direct ${agentOutputName(turn.targetAgent)}`)
  return ({
    auto: tr('自动路由', 'Auto route'),
    broadcast: tr('广播', 'Broadcast'),
    chain: tr('链式交接', 'Chain handoff'),
    orchestrate: tr('编排', 'Orchestrate'),
    'lead-workers': tr('主控 + 工作者', 'Lead + workers'),
    'parallel-review': tr('并行评审', 'Parallel review'),
    custom: tr('自定义调度', 'Custom schedule')
  } as Record<DispatchPreset, string>)[turn.mode] || turn.mode
}

function agentOutputName(agentId: string, events?: RuntimeEvent[]): string {
  if (agentId.startsWith('provider:')) {
    const payload = [...(events || [])].reverse().find(event => event.payload?.providerId || event.payload?.modelId)?.payload
    return providerOutputName(payload?.providerId || agentId.slice('provider:'.length), payload?.modelId)
  }
  if (agentId === 'orchestrate') return tr('编排器', 'Orchestrator')
  if (agentId === 'system') return tr('系统', 'System')
  if (agentId === 'minimax-code') return 'OpenCode'
  return (AGENT_META[agentId]?.name || agentId).replace(' CLI', '').replace(' Code', '')
}

function providerOutputName(providerId: string, modelId?: string): string {
  const label = ({
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    openrouter: 'OpenRouter',
    minimax: 'MiniMax',
    hunyuan: 'Hunyuan'
  } as Record<string, string>)[providerId] || providerId
  return modelId ? `${label} · ${modelId}` : label
}

function statusLabel(status: WorkbenchTurnStatus | 'done' | 'running' | 'failed'): string {
  if (status === 'completed' || status === 'done') return tr('完成', 'done')
  if (status === 'running' || status === 'queued') return tr('运行中', 'running')
  if (status === 'failed') return tr('失败', 'failed')
  if (status === 'cancelled') return tr('已取消', 'cancelled')
  return status
}

function outputStatus(turnStatus: WorkbenchTurnStatus, events: RuntimeEvent[], agentId: string): WorkbenchTurnStatus {
  if (events.some(event => event.kind === 'agent:error' || event.payload?.kind === 'orchestrate:error')) return 'failed'
  if (events.some(event => event.kind === 'agent:done' || event.payload?.kind === 'orchestrate:final')) return 'completed'
  if (agentId === 'orchestrate' && turnStatus !== 'running' && turnStatus !== 'queued') return turnStatus
  return turnStatus === 'queued' ? 'running' : turnStatus
}

function compactOrchestrateEvents(events: RuntimeEvent[]): Array<{ key: string; label: string; detail: string }> {
  const rows: Array<{ key: string; label: string; detail: string }> = []
  const seen = new Set<string>()
  for (const event of events) {
    const kind = String(event.payload?.kind || '')
    if (kind === 'orchestrate:plan' || kind === 'orchestrate:final' || kind === 'orchestrate:error') continue
    const key = [kind, event.payload?.subtaskId, event.payload?.status, event.payload?.attempt].filter(Boolean).join(':')
    if (seen.has(key)) continue
    seen.add(key)
    if (kind === 'orchestrate:subtask') {
      rows.push({
        key: event.id,
        label: subtaskStatus(event.payload?.status),
        detail: [event.payload?.subtaskId ? tr(`子任务 ${event.payload.subtaskId}`, `Subtask ${event.payload.subtaskId}`) : '', event.payload?.agentId ? agentOutputName(event.payload.agentId) : '', conciseOrchestrateText(event.payload?.content, 96)].filter(Boolean).join(' / ')
      })
    } else if (kind === 'orchestrate:verdict') {
      rows.push({
        key: event.id,
        label: event.payload?.pass ? tr('校验通过', 'Verified') : tr('需要修正', 'Needs fix'),
        detail: [event.payload?.subtaskId ? tr(`子任务 ${event.payload.subtaskId}`, `Subtask ${event.payload.subtaskId}`) : '', event.payload?.attempt ? tr(`第 ${event.payload.attempt} 次`, `attempt ${event.payload.attempt}`) : '', conciseOrchestrateText(event.payload?.note, 96)].filter(Boolean).join(' / ')
      })
    } else if (kind === 'orchestrate:synthesizing') {
      rows.push({ key: event.id, label: tr('汇总中', 'Synthesizing'), detail: tr('正在合并多个 Agent 的结果', 'Combining agent outputs') })
    }
  }
  return rows.slice(-8)
}

function subtaskStatus(status: string): string {
  if (status === 'running') return tr('执行中', 'Running')
  if (status === 'done') return tr('已完成', 'Done')
  if (status === 'error') return tr('出错', 'Error')
  return tr('待处理', 'Pending')
}

function dedupeSteps(steps: any[]): any[] {
  const latest = new Map<string, any>()
  for (const step of steps) latest.set(String(step.id || step.label || latest.size), step)
  return [...latest.values()]
}

function normalizeOutput(value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  const cleaned: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      cleaned.push('')
      continue
    }
    const parsed = parseJsonLine(trimmed)
    if (parsed) {
      if (typeof parsed.text === 'string') cleaned.push(parsed.text)
      else if (typeof parsed.content === 'string') cleaned.push(parsed.content)
      else if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message' && typeof parsed.item.text === 'string') cleaned.push(parsed.item.text)
      else if (Array.isArray(parsed.subtasks) || String(parsed.kind || '').startsWith('orchestrate:')) continue
      else if (typeof parsed.pass === 'boolean') cleaned.push(parsed.pass ? tr('校验通过。', 'Verification passed.') : (parsed.note || tr('需要修正。', 'Needs revision.')))
      continue
    }
    if (/^FAIL:\s*RESULT为空/.test(trimmed)) {
      cleaned.push(tr('结果为空：上游 Agent 没有返回可用内容。请检查本地 CLI 登录状态或改为直连单个 Agent。', 'Empty result: the upstream agent did not return usable content. Check local CLI login or route directly to one agent.'))
      continue
    }
    cleaned.push(line)
  }
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function parseJsonLine(line: string): any | null {
  if (!line.startsWith('{') || !line.endsWith('}')) return null
  try { return JSON.parse(line) } catch { return null }
}

function friendlyError(error: any): string {
  const text = String(error || tr('运行失败。', 'Run failed.')).trim()
  if (/RESULT为空/.test(text)) return tr('结果为空：Agent 没有返回可用内容。请检查登录状态、CLI 路径或切换为直连 Agent。', 'Empty result: the agent returned no usable content. Check login, CLI path, or switch to direct routing.')
  return text
}

function short(value: any, max: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function conciseOrchestrateText(value: any, max: number): string {
  const text = normalizeOutput(String(value || ''))
    .replace(/\b(plan|subtask|verdict|synthesizing|final)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return short(text, max)
}

function describePlan(subtasks: any[]): string {
  const rows = subtasks
    .slice(0, 5)
    .map((task, index) => `${index + 1}. ${task.title || task.detail || task.id || tr('未命名子任务', 'Untitled subtask')}`)
  return [tr('任务拆解：', 'Plan:'), ...rows].join('\n')
}
