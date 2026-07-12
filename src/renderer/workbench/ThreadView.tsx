import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
// ActivityTrail reserved for future activity view integration

import { ToolCallStream } from '../glass/ToolCallStream'
import { ExecutionReport } from '../glass/ExecutionReport'
import { InlineEditAffordance } from './InlineEditAffordance'
import { ForkButton } from './ForkButton'
import { ContextLedger } from './ContextLedger'
import { AGENT_META } from '../glass/meta'
import { tr } from '../glass/i18n'
import { SetupTab, firstRunActionForError } from '../glass/connection-status'
import { MarkdownBlock } from './MarkdownBlock'
import { isTerminalTurnStatus } from '../../shared/turn-status'

const INTERNAL_TIMELINE_AGENT_IDS = new Set(['prompt-optimizer', 'budget-guard', 'dispatch-planner'])

export function ThreadView({
  thread,
  turns,
  events,
  onRetry,
  onCancelAgent,
  openSetup,
  onCreateProject,
  onCreateThread,
  onForkThread,
  hasWorkspace,
  workspaceRoot,
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
  /** F-N4: navigate to forked thread after success */
  onForkThread?: (threadId: string) => void
  hasWorkspace: boolean
  workspaceRoot?: string | null
  scrollRef?: React.RefObject<HTMLElement>
  onScroll?: () => void
}) {
  const byTurn = useMemo(() => groupEvents(events), [events])

  // LOW-14: Low-frequency timer to refresh time-relative labels (such as "刚刚", "5分钟前")
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

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
        <article key={turn.id} className="wb-turn" data-turn-id={turn.id}>
          <div className="wb-user-message">
            <div>
              <strong>{turn.prompt}</strong>
              <small>{turnLabel(turn)} / {statusLabel(turn.status)}</small>
              {turn.attachments?.length ? <AttachmentStrip attachments={turn.attachments} /> : null}
            </div>
            {isTerminalTurnStatus(turn.status) && turn.status !== 'interrupted' && (
              <button onClick={() => onRetry(turn.id)} title={tr('重试', 'Retry')}><Icon d={IC.refresh} size={14} /></button>
            )}
          </div>
          {turn.status === 'interrupted' && <InterruptedDecisionRecovery turnId={turn.id} />}
          <AgentOutputs turn={turn} events={byTurn.get(turn.id) ?? []} openSetup={openSetup} onCancelAgent={onCancelAgent} workspaceRoot={workspaceRoot} threadId={thread?.id} onForkThread={onForkThread} />
        </article>
      ))}
    </section>
  )
}

function InterruptedDecisionRecovery({ turnId }: { turnId: string }) {
  const [rerunning, setRerunning] = useState(false)
  const [rerunComplete, setRerunComplete] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)
  const rerunInFlight = useRef(false)

  const rerunTurn = async () => {
    if (rerunInFlight.current) return
    rerunInFlight.current = true
    setRerunning(true)
    setRerunError(null)
    try {
      await window.electronAPI.turns.rerunInterrupted(turnId)
      setRerunComplete(true)
    } catch {
      setRerunError('Unable to rerun turn. Try again.')
    } finally {
      rerunInFlight.current = false
      setRerunning(false)
    }
  }

  return (
    <div className="wb-decision-recovery" role="status">
      <span>Turn interrupted by restart</span>
      <button type="button" disabled={rerunning || rerunComplete} onClick={() => { void rerunTurn() }}>
        {rerunComplete ? 'Turn rerun' : rerunning ? 'Rerunning Turn…' : 'Rerun Turn'}
      </button>
      {rerunError && <span role="alert">{rerunError}</span>}
    </div>
  )
}

function AgentOutputs({ turn, events, openSetup, onCancelAgent, workspaceRoot, threadId, onForkThread }: { turn: WorkbenchTurn; events: RuntimeEvent[]; openSetup: (tab?: SetupTab | 'appearance') => void; onCancelAgent: (turnId: string, agentId: string) => void; workspaceRoot?: string | null; threadId?: string; onForkThread?: (threadId: string) => void }) {
  const grouped = new Map<string, RuntimeEvent[]>()
  const visibleEvents = events.filter(isChatVisibleRuntimeEvent)
  for (const event of visibleEvents) {
    if (!event.agentId && event.kind !== 'orchestrate' && event.kind !== 'route:decision' && event.kind !== 'guard:verdict' && !event.payload?.kind?.startsWith?.('orchestrate:')) continue
    const key = eventGroupKey(event)
    const bucket = grouped.get(key)
    if (bucket) bucket.push(event)
    else grouped.set(key, [event])
  }
  if (grouped.size === 0 && !isTerminalTurnStatus(turn.status)) grouped.set(turn.targetAgent || 'orchestrate', [])

  return (
    <div className="wb-agent-output-list">
      {[...grouped.entries()].map(([groupId, agentEvents]) => {
        const agentId = agentEvents.find(event => event.agentId)?.agentId || groupId
        const summary = summarizeAgentEvents(agentEvents)
        const nonBlockingGuardFailure = isNonBlockingGuardFailureSummary(summary)
        const rawText = summary.rawText
        const action = summary.error?.payload?.error && !nonBlockingGuardFailure ? firstRunActionForError(summary.error.payload.error) : null
        const status = nonBlockingGuardFailure ? 'completed' : outputStatus(turn.status, summary, agentId)
        const text = normalizeOutput(rawText)
        const doneContent = summary.done?.payload?.visibility === 'run' ? '' : normalizeOutput(summary.done?.payload?.content || '')

        return (
          <div key={groupId} className={'wb-agent-output ' + status}>
            <div className="wb-agent-output-head">
              {AGENT_META[agentId] ? <AgentMark id={agentId} size={26} radius={7} /> : <div className="wb-system-mark"><Icon d={IC.broadcast} size={14} /></div>}
              <span>{agentOutputName(agentId, summary.providerPayload)}{summary.scheduleRole ? ` · ${roleName(summary.scheduleRole)}` : ''}</span>
              <small>{statusLabel(status)}</small>
              {!isTerminalTurnStatus(status) && agentId !== 'orchestrate' && (
                <button className="wb-agent-stop" onClick={() => onCancelAgent(turn.id, agentId)} title={tr('暂停该 Agent', 'Pause this agent')}>
                  <Icon d={IC.stop} size={12} />
                </button>
              )}
            </div>
            <ProcessDetails
              agentId={agentId}
              events={agentEvents}
              summary={summary}
              status={status}
              workspaceRoot={workspaceRoot}
            />
            {summary.steps.length > 0 && (
              <div className="wb-tool-call-area">
                <ToolCallStream
                  calls={stepsToToolCalls(summary.steps, status, terminalEventTime(agentEvents))}
                  defaultOpen={!isTerminalTurnStatus(status)}
                  collapseWhenComplete={isTerminalTurnStatus(status)}
                />
              </div>
            )}
            {summary.orch.length > 0 && <OrchestrateCompact events={summary.orch} turnStatus={turn.status} workspaceRoot={workspaceRoot} />}
            {(summary.routeEvents.length > 0 || summary.guardEvents.length > 0) && (
              <RoleEvents routeEvents={summary.routeEvents} guardEvents={summary.guardEvents} />
            )}
            {text && (!isTerminalTurnStatus(status) ? <pre className="wb-streaming-text">{text}</pre> : <MarkdownBlock content={text} workspaceRoot={workspaceRoot} />)}
            {doneContent && !text && <MarkdownBlock content={doneContent} workspaceRoot={workspaceRoot} />}
            {!text && !doneContent && !summary.error && summary.orch.length === 0 && summary.routeEvents.length === 0 && summary.guardEvents.length === 0 && (
              !isTerminalTurnStatus(status)
                ? <ProcessingState events={agentEvents} turn={turn} />
                : <div className="wb-muted-box">{emptyOutputText(summary)}</div>
            )}
            {summary.error && !nonBlockingGuardFailure && (
              <div className="wb-output-error">
                {friendlyError(summary.error.payload?.error)}
                {action && <button onClick={() => openSetup(action.tab)}>{tr(action.labelZh, action.labelEn)}</button>}
              </div>
            )}
            {isTerminalTurnStatus(status) && <CompletionSummary agentId={agentId} events={agentEvents} summary={summary} status={status} />}
            {/* Context Ledger for completed turns */}
            {status === 'completed' && threadId && (
              <ContextLedger threadId={threadId} turnId={turn.id} compact />
            )}
            {/* Fork button for completed turns */}
            {status === 'completed' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <ForkButton
                  turnId={turn.id}
                  threadId={threadId || turn.threadId || ''}
                  messageContent={text || doneContent || ''}
                  onFork={onForkThread}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface AgentEventSummary {
  rawText: string
  done?: RuntimeEvent
  error?: RuntimeEvent
  steps: any[]
  orch: RuntimeEvent[]
  routeEvents: RuntimeEvent[]
  guardEvents: RuntimeEvent[]
  providerPayload?: any
  scheduleRole?: string
  hasDone: boolean
  hasError: boolean
  hasOrchestrateFinal: boolean
  hasOrchestrateError: boolean
  latestAgentStatus?: WorkbenchTurnStatus
}

function ProcessDetails({
  agentId,
  events,
  summary,
  status,
  workspaceRoot
}: {
  agentId: string
  events: RuntimeEvent[]
  summary: AgentEventSummary
  status: WorkbenchTurnStatus
  workspaceRoot?: string | null
}) {
  const [open, setOpen] = useState(!isTerminalTurnStatus(status))
  const processRows = buildProcessRows(agentId, events, summary)
  useEffect(() => {
    setOpen(!isTerminalTurnStatus(status))
  }, [status])
  if (processRows.length === 0) return null
  const completed = status === 'completed'
  return (
    <div className={'wb-agent-process' + (open ? ' open' : '')}>
      <button className="wb-agent-process-head" type="button" onClick={() => setOpen(value => !value)}>
        <Icon d={IC.chev} size={12} />
        <span>{completed ? tr('查看执行过程', 'View run process') : tr('执行过程', 'Run process')}</span>
        <small>{processRows.length} {tr('项活动', 'activities')}</small>
      </button>
      {open && (
        <div className="wb-agent-process-list">
          {processRows.map(row => (
            <div key={row.id} className={'wb-agent-process-row ' + row.kind}>
              <span className="wb-agent-process-icon"><Icon d={row.icon} size={13} /></span>
              <div style={{ flex: 1 }}>
                <strong>{row.title}</strong>
                {row.detail && row.filePath
                  ? <MarkdownBlock content={`\`${row.filePath}${row.line ? `:${row.line}` : ''}\` ${row.detail}`} workspaceRoot={workspaceRoot} />
                  : row.detail ? <small>{row.detail}</small> : null}
                {/* Inline Edit affordance for code-related tool outputs */}
                {(row.kind === 'activity' && row.detail && /write|edit|create|update|patch|apply/i.test(row.title || '')) && (
                  <InlineEditAffordance
                    code={row.detail || ''}
                    filePath={row.filePath}
                    startLine={row.line}
                    workspaceRoot={workspaceRoot || undefined}
                  />
                )}
              </div>
              <em>{relativeEventTime(row.createdAt)}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CompletionSummary({
  agentId: _agentId,
  events,
  summary,
  status
}: {
  agentId: string
  events: RuntimeEvent[]
  summary: AgentEventSummary
  status: WorkbenchTurnStatus
}) {
  const stats = completionStats(events, summary, status)
  if (status === 'cancelled' && stats.activities === 0) return null

  // Use ExecutionReport for a richer completion summary
  const toolCalls = stepsToToolCalls(summary.steps, status, terminalEventTime(events))
  const failedRunCount = status === 'failed' ? 1 : 0
  const successfulRunCount = failedRunCount || toolCalls.length > 0 ? 0 : status === 'completed' || summary.hasDone || summary.hasOrchestrateFinal ? 1 : 0
  const visibleFailedTools = status === 'failed' ? toolCalls.filter(c => c.status === 'failed').length : 0
  const historicalFailedAttempts = status === 'completed' ? toolCalls.filter(c => c.status === 'failed').length : 0
  const hasReportableWork = toolCalls.length > 0 || failedRunCount > 0 || stats.files.length > 0
  if (!hasReportableWork) return null
  const execReport = {
    totalTools: toolCalls.length + failedRunCount + successfulRunCount,
    successfulTools: toolCalls.filter(c => c.status === 'succeeded').length + successfulRunCount,
    failedTools: visibleFailedTools + failedRunCount + historicalFailedAttempts,
    totalDuration: eventDurationMs(events),
    filesModified: stats.files || [],
    outcome: status === 'failed' ? 'failed' as const : status === 'cancelled' || status === 'interrupted' ? 'cancelled' as const : 'completed' as const
  }

  return (
    <div className="wb-completion-wrapper">
      <ExecutionReport stats={execReport} />
      {status === 'failed' && summary.error?.payload?.error && (
        <div className="wb-output-error">
          {friendlyError(summary.error.payload.error)}
        </div>
      )}
    </div>
  )
}

type ProcessRow = {
  id: string
  kind: string
  title: string
  detail?: string
  icon: React.ReactNode
  createdAt: number
  filePath?: string
  line?: number
}

function buildProcessRows(agentId: string, events: RuntimeEvent[], summary: AgentEventSummary): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const event of events) {
    if (event.kind === 'route:decision') {
      rows.push({
        id: event.id,
        kind: 'route',
        title: tr('路由决策', 'Route decision'),
        detail: `${event.payload?.state || 'chat'} -> ${event.payload?.selectedAgentId || agentId}`,
        icon: IC.git,
        createdAt: event.createdAt
      })
      continue
    }
    if (event.kind === 'guard:verdict') {
      rows.push({
        id: event.id,
        kind: 'guard',
        title: roleName(event.payload?.role || 'guard'),
        detail: guardStatusText(event.payload),
        icon: IC.check,
        createdAt: event.createdAt
      })
      continue
    }
    if (event.kind === 'agent:activity' && event.payload?.step) {
      const step = event.payload.step
      const filePath = filePathFromText(`${step.label || ''}\n${step.detail || ''}`)
      rows.push({
        id: event.id,
        kind: 'activity',
        title: step.label || step.tool || tr('活动', 'Activity'),
        detail: step.detail || step.output || step.status,
        icon: iconForProcessStep(step),
        createdAt: event.createdAt,
        filePath: filePath?.path,
        line: filePath?.line
      })
      continue
    }
    const payloadKind = String(event.payload?.kind || '')
    if (event.kind === 'orchestrate' || payloadKind.startsWith('orchestrate:')) {
      rows.push({
        id: event.id,
        kind: 'orchestrate',
        title: payloadKind.replace('orchestrate:', '') || tr('编排', 'Orchestrate'),
        detail: conciseOrchestrateText(event.payload?.content || event.payload?.note || event.payload?.status || event.payload?.error || '', 140),
        icon: IC.broadcast,
        createdAt: event.createdAt
      })
    }
  }
  if ((summary.hasDone || summary.hasError) && events.length > 0) {
    const finalIsError = summary.hasError && !isNonBlockingGuardFailureSummary(summary)
    rows.push({
      id: `final-${events[events.length - 1]?.id || agentId}`,
      kind: finalIsError ? 'error' : 'done',
      title: finalIsError ? tr('执行失败', 'Run failed') : tr('执行完成', 'Run completed'),
      detail: finalIsError ? friendlyError(summary.error?.payload?.error) : doneSummaryText(summary),
      icon: finalIsError ? IC.x : IC.check,
      createdAt: summary.error?.createdAt || summary.done?.createdAt || events[events.length - 1]?.createdAt || Date.now()
    })
  }
  return rows.slice(-28)
}

function stepsToToolCalls(steps: any[], runStatus: WorkbenchTurnStatus = 'running', terminalTime?: number): Array<{ id: string; tool: string; status: 'started' | 'succeeded' | 'failed' | 'declined'; startTime: number; endTime?: number; input?: string; output?: string; error?: string }> {
  return steps.map(step => {
    const approvalRequired = isApprovalRequiredStep(step)
    const rawStatus = step.status === 'running' || step.status === 'awaiting' ? 'started'
      : step.status === 'error' ? approvalRequired ? 'declined' : 'failed'
      : step.status === 'cancelled' ? 'declined'
      : 'succeeded'
    const status = rawStatus === 'started' && runStatus === 'completed' ? 'succeeded'
      : rawStatus === 'started' && runStatus === 'failed' ? 'failed'
      : rawStatus === 'started' && isTerminalTurnStatus(runStatus) ? 'declined'
      : rawStatus
    const startTime = step.createdAt || Date.now()
    const fallbackEndTime = terminalTime && terminalTime >= startTime ? terminalTime : step.updatedAt && step.updatedAt >= startTime ? step.updatedAt : startTime
    const endTime = step.status === 'done' || step.status === 'error'
      ? (step.updatedAt && step.updatedAt >= startTime ? step.updatedAt : startTime)
      : status === 'failed' || status === 'declined'
      ? fallbackEndTime
      : undefined
    return {
      id: step.id || `step-${Math.random().toString(36).slice(2, 8)}`,
      tool: step.tool || step.label || step.kind || 'tool',
      status,
      startTime,
      endTime,
      input: step.detail || undefined,
      output: step.output || undefined,
      error: status === 'failed' ? (step.output || step.error || undefined) : undefined
    }
  })
}

function iconForProcessStep(step: any): React.ReactNode {
  const haystack = `${step.kind || ''} ${step.tool || ''} ${step.label || ''}`
  if (/bash|shell|exec|command|terminal|run|cmd/i.test(haystack)) return IC.terminal
  if (/write|edit|create|update|patch|apply/i.test(haystack)) return IC.pencil
  if (/read|grep|glob|search|find|list|ls|cat|view/i.test(haystack)) return IC.search
  if (/fetch|web|http|browse|url/i.test(haystack)) return IC.link
  return IC.bolt
}

function completionStats(events: RuntimeEvent[], summary: AgentEventSummary, status: WorkbenchTurnStatus) {
  const files = extractModifiedFiles(events)
  return {
    activities: summary.steps.length + summary.orch.filter(event => String(event.payload?.kind || '').includes('subtask')).length,
    guardVerdicts: summary.guardEvents.length,
    routeDecisions: summary.routeEvents.length,
    files,
    finalPreview: ''
  }
}

function doneSummaryText(summary: AgentEventSummary): string {
  const content = normalizeOutput(summary.done?.payload?.content || summary.rawText || '')
  if (!content) return tr('本轮已完成，没有额外文本输出。', 'This run completed with no extra text output.')
  const firstMeaningful = content.split(/\r?\n/).map(line => line.trim()).find(Boolean) || ''
  return short(firstMeaningful.replace(/^[-*]\s*/, ''), 150)
}

function emptyOutputText(summary: AgentEventSummary): string {
  if (summary.steps.length > 0) {
    return tr('Agent 没有返回最终文本，但上方已保留执行过程。', 'The agent did not return final text, but the run process above was preserved.')
  }
  return tr('本轮没有可展示的文本输出。', 'No displayable text output for this turn.')
}

function isNonBlockingGuardFailureSummary(summary: AgentEventSummary): boolean {
  return !!summary.error && summary.guardEvents.some(event =>
    event.payload?.nonBlocking === true ||
    event.payload?.source === 'guard-step-fallback' ||
    String(event.payload?.reasons?.join?.('; ') || '').includes('Continuing with the latest main-agent output')
  )
}

function _completionTitle(status: WorkbenchTurnStatus): string {
  if (status === 'failed') return tr('执行未完成', 'Run did not complete')
  if (status === 'cancelled') return tr('已停止执行', 'Run stopped')
  return tr('执行完成总结', 'Completion summary')
}

function eventDurationMs(events: RuntimeEvent[]): number {
  if (events.length === 0) return 0
  const explicitDurations = events
    .filter(event => event.kind === 'agent:done' || event.kind === 'agent:error')
    .map(event => event.payload?.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  if (explicitDurations.length > 0) return explicitDurations.reduce((sum, value) => sum + value, 0)
  const started = events.find(event => event.kind === 'run:created' || event.kind === 'agent:start')?.createdAt || events[0].createdAt
  const ended = terminalEventTime(events) || events[events.length - 1].createdAt
  return Math.max(0, ended - started)
}

function isApprovalRequiredStep(step: any): boolean {
  const text = `${step?.output || ''}\n${step?.detail || ''}`
  return /requires approval|approval required|This command requires approval/i.test(text)
}

function terminalEventTime(events: RuntimeEvent[]): number | undefined {
  return [...events]
    .reverse()
    .find(event =>
      event.kind === 'agent:done' ||
      event.kind === 'agent:error' ||
      (event.kind === 'run:status' && event.payload?.status && isTerminalTurnStatus(event.payload.status)) ||
      event.payload?.kind === 'orchestrate:final' ||
      event.payload?.kind === 'orchestrate:error'
    )?.createdAt
}

function _formatEventDuration(events: RuntimeEvent[]): string {
  return formatDuration(Math.round(eventDurationMs(events) / 1000))
}

function roleName(role: string): string {
  if (role === 'reviewer') return 'reviewer'
  if (role === 'gatekeeper') return 'gatekeeper'
  if (role === 'executor') return 'executor'
  if (role === 'router') return 'router'
  return role || 'guard'
}

function summarizeAgentEvents(events: RuntimeEvent[]): AgentEventSummary {
  const textParts: string[] = []
  const steps = new Map<string, any>()
  const orch: RuntimeEvent[] = []
  const routeEvents: RuntimeEvent[] = []
  const guardEvents: RuntimeEvent[] = []
  let done: RuntimeEvent | undefined
  let error: RuntimeEvent | undefined
  let providerPayload: any
  let scheduleRole: string | undefined
  let hasOrchestrateFinal = false
  let hasOrchestrateError = false
  let latestAgentStatus: WorkbenchTurnStatus | undefined

  for (const event of events) {
    if (event.payload?.providerId || event.payload?.modelId) providerPayload = event.payload
    if (!scheduleRole && event.payload?.scheduleRole) scheduleRole = String(event.payload.scheduleRole)
    if (event.kind === 'run:created') {
      latestAgentStatus = event.payload?.status || 'running'
      continue
    }
    if (event.kind === 'run:status') {
      latestAgentStatus = event.payload?.status || latestAgentStatus
      continue
    }
    if (event.kind === 'agent:start') latestAgentStatus = 'running'
    if (event.kind === 'agent:delta' && event.payload?.channel !== 'thinking') {
      latestAgentStatus = 'running'
      if (event.payload?.visibility !== 'run') textParts.push(event.payload?.text || '')
      continue
    }
    if (event.kind === 'agent:done') {
      done = event
      latestAgentStatus = 'completed'
      continue
    }
    if (event.kind === 'agent:error') {
      error = event
      latestAgentStatus = 'failed'
      continue
    }
    if (event.kind === 'agent:activity' && event.payload?.step) {
      const step = event.payload.step
      steps.set(String(step.id || step.label || steps.size), step)
      latestAgentStatus = step.status === 'error'
        ? 'failed'
        : step.status === 'done'
        ? latestAgentStatus
        : 'running'
      continue
    }
    const payloadKind = String(event.payload?.kind || '')
    if (event.kind === 'orchestrate' || payloadKind.startsWith('orchestrate:')) {
      orch.push(event)
      if (payloadKind === 'orchestrate:final') hasOrchestrateFinal = true
      if (payloadKind === 'orchestrate:error') hasOrchestrateError = true
      continue
    }
    if (event.kind === 'route:decision') routeEvents.push(event)
    else if (event.kind === 'guard:verdict') guardEvents.push(event)
  }
  const terminal = [...events].reverse().find(event =>
    event.kind === 'agent:error' ||
    event.kind === 'agent:done' ||
    (event.kind === 'run:status' && event.payload?.status && isTerminalTurnStatus(event.payload.status))
  )
  if (terminal?.kind === 'agent:error') latestAgentStatus = 'failed'
  else if (terminal?.kind === 'agent:done') latestAgentStatus = 'completed'
  else if (terminal?.kind === 'run:status') latestAgentStatus = terminal.payload?.status || latestAgentStatus

  return {
    rawText: textParts.join(''),
    done,
    error,
    steps: [...steps.values()],
    orch,
    routeEvents,
    guardEvents,
    providerPayload,
    scheduleRole,
    hasDone: !!done,
    hasError: !!error,
    hasOrchestrateFinal,
    hasOrchestrateError,
    latestAgentStatus
  }
}

function eventGroupKey(event: RuntimeEvent): string {
  if (event.kind === 'orchestrate' || event.payload?.kind?.startsWith?.('orchestrate:')) return 'orchestrate'
  const agentId = event.agentId || 'system'
  const role = event.payload?.scheduleRole || event.payload?.role
  const stepId = event.payload?.scheduleStepId || event.payload?.sourceStepId || event.payload?.failedStepId
  return role ? `${agentId}:${role}:${stepId || role}` : agentId
}

function RoleEvents({
  routeEvents,
  guardEvents
}: {
  routeEvents: RuntimeEvent[]
  guardEvents: RuntimeEvent[]
}) {
  return (
    <div className="wb-role-events">
      {routeEvents.slice(-2).map(event => (
        <div key={event.id} className="wb-role-event route">
          <strong>Route</strong>
          <span>{`${event.payload?.state || 'chat'} -> ${event.payload?.selectedAgentId || '-'}`}</span>
          {Array.isArray(event.payload?.scores) && <small>{event.payload.scores.slice(0, 3).map((item: any) => `${item.id} ${item.score}`).join(' / ')}</small>}
        </div>
      ))}
      {guardEvents.slice(-4).map(event => (
        <div key={event.id} className={'wb-role-event guard ' + (event.payload?.level || 'low') + (event.payload?.requiresUserDecision ? ' pending' : '')}>
          <strong>{event.payload?.role || 'Guard'}</strong>
          <span>{guardStatusText(event.payload)}</span>
          {Array.isArray(event.payload?.reasons) && <small>{event.payload.reasons.join('; ')}</small>}
        </div>
      ))}
    </div>
  )
}

function guardStatusText(payload: any): string {
  if (payload?.requiresUserDecision) return tr('高风险 / 等待你确认', 'High risk / waiting for you')
  if (payload?.decision === 'approved') return tr('已确认继续', 'Approved')
  if (payload?.decision === 'denied') return tr('已停止', 'Stopped')
  if (payload?.decision === 'timeout') return tr('确认超时', 'Timed out')
  return `${payload?.level || 'low'} / ${payload?.status || 'pass'}`
}

function OrchestrateCompact({ events, turnStatus, workspaceRoot }: { events: RuntimeEvent[]; turnStatus: WorkbenchTurnStatus; workspaceRoot?: string | null }) {
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
        <MarkdownBlock content={normalizeOutput(final.payload.content)} workspaceRoot={workspaceRoot} />
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
  const running = !isTerminalTurnStatus(outputStatus(turn.status, events, turn.targetAgent || ''))
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

function relativeEventTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return tr('刚刚', 'now')
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}${tr('分钟前', 'm ago')}`
  return `${Math.round(diff / 3_600_000)}${tr('小时前', 'h ago')}`
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

function isChatVisibleRuntimeEvent(event: RuntimeEvent): boolean {
  if (event.kind === 'turn:created' || event.kind === 'turn:status' || event.kind === 'turn:summary' || event.kind === 'memory:candidate') return false
  if (event.agentId && INTERNAL_TIMELINE_AGENT_IDS.has(event.agentId)) return false
  if (event.payload?.visibility === 'run') return false
  if (event.kind === 'route:decision') return true
  if (event.kind === 'agent:delta' || event.kind === 'agent:done' || event.kind === 'agent:start' || event.kind === 'agent:error' || event.kind === 'agent:activity') return true
  if (event.kind === 'orchestrate' || event.payload?.kind?.startsWith?.('orchestrate:')) return true
  if (event.kind === 'guard:verdict') return true
  return false
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
  } as Partial<Record<DispatchPreset, string>>)[turn.mode] || turn.mode
}

function agentOutputName(agentId: string, providerPayload?: any): string {
  if (agentId.startsWith('provider:')) {
    return providerOutputName(providerPayload?.providerId || agentId.slice('provider:'.length), providerPayload?.modelId)
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
  if (status === 'awaiting-decision') return tr('等待决定', 'Waiting for decision')
  if (status === 'failed') return tr('失败', 'failed')
  if (status === 'cancelled') return tr('已取消', 'cancelled')
  if (status === 'interrupted') return tr('已中断', 'Interrupted')
  return status
}

function outputStatus(turnStatus: WorkbenchTurnStatus, eventsOrSummary: RuntimeEvent[] | AgentEventSummary, agentId: string): WorkbenchTurnStatus {
  if (Array.isArray(eventsOrSummary)) {
    if (eventsOrSummary.some(event => event.kind === 'agent:error' || event.payload?.kind === 'orchestrate:error')) return 'failed'
    if (eventsOrSummary.some(event => event.kind === 'agent:done' || event.payload?.kind === 'orchestrate:final')) return 'completed'
  } else {
    if (eventsOrSummary.latestAgentStatus === 'failed') return 'failed'
    if (eventsOrSummary.latestAgentStatus === 'running') return 'running'
    if (eventsOrSummary.latestAgentStatus === 'completed') return 'completed'
    if (eventsOrSummary.hasError || eventsOrSummary.hasOrchestrateError) return 'failed'
    if (eventsOrSummary.hasDone || eventsOrSummary.hasOrchestrateFinal) return 'completed'
    if (eventsOrSummary.routeEvents.length > 0 || eventsOrSummary.guardEvents.length > 0) {
      return turnStatus === 'queued' ? 'running' : turnStatus
    }
  }
  if (agentId === 'orchestrate' && isTerminalTurnStatus(turnStatus)) return turnStatus
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
      else cleaned.push(line)
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
  // Improve exit code error messages with actionable hints
  const exitCodeMatch = text.match(/(\S+?)\s*退出码\s*(-?\d+)/)
  if (exitCodeMatch) {
    const code = parseInt(exitCodeMatch[2], 10)
    let hint = ''
    if (code === 1) hint = tr(' 可能原因：工具调用失败、API 错误或权限问题。', ' Possible cause: tool call failure, API error, or permission issue.')
    else if (code === 137 || code === 143) hint = tr(' 进程被强制终止（可能超时或内存不足）。', ' Process was force-killed (possibly timeout or OOM).')
    else if (code === 126) hint = tr(' 权限不足，无法执行命令。', ' Permission denied, cannot execute command.')
    else if (code === 127) hint = tr(' 命令未找到，请检查 CLI 路径配置。', ' Command not found, please check CLI path configuration.')
    return text + hint
  }
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

function _extractReferencedFiles(events: RuntimeEvent[], extraText = ''): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const scan = (value: any) => {
    const text = String(value || '')
    const matches = text.match(/(?:[A-Za-z]:[\\/][^\s'"`<>]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+|[A-Za-z0-9_.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|go|rs|java|cs|cpp|c|h|hpp|vue|svelte))(?::\d+)?/g) || []
    for (const match of matches) {
      const parsed = filePathFromText(match)
      if (!parsed || seen.has(parsed.path) || !isLikelySourceFilePath(parsed.path)) continue
      seen.add(parsed.path)
      out.push(parsed.line ? `${parsed.path}:${parsed.line}` : parsed.path)
    }
  }
  scan(extraText)
  for (const event of events) {
    scan(event.payload?.path)
    scan(event.payload?.filePath)
    scan(event.payload?.content)
    scan(event.payload?.text)
    scan(event.payload?.step?.label)
    scan(event.payload?.step?.detail)
    scan(event.payload?.step?.output)
  }
  return out.slice(0, 12)
}

function extractModifiedFiles(events: RuntimeEvent[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (value: any) => {
    const text = String(value || '')
    const matches = text.match(/(?:[A-Za-z]:[\\/][^\s'"`<>]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+|[A-Za-z0-9_.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|go|rs|java|cs|cpp|c|h|hpp|vue|svelte))(?::\d+)?/g) || []
    for (const match of matches) {
      const parsed = filePathFromText(match)
      if (!parsed || seen.has(parsed.path) || !isLikelySourceFilePath(parsed.path)) continue
      seen.add(parsed.path)
      out.push(parsed.line ? `${parsed.path}:${parsed.line}` : parsed.path)
    }
  }
  for (const event of events) {
    const step = event.payload?.step
    if (!step || !isWriteLikeStep(step)) continue
    add(step.path)
    add(step.filePath)
    add(step.label)
    add(step.detail)
    add(step.output)
  }
  return out.slice(0, 12)
}

function isWriteLikeStep(step: any): boolean {
  const haystack = `${step.kind || ''} ${step.tool || ''} ${step.label || ''} ${step.detail || ''}`
  if (/\b(read|grep|glob|search|find|list|ls|cat|view|fetch|open)\b/i.test(haystack)) return false
  return /\b(write|edit|create|update|patch|apply|modify|delete|remove|rename|move|save|fs_write)\b/i.test(haystack)
}

function filePathFromText(value: string): { path: string; line?: number } | null {
  if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  const match = value.match(/(?:^|\s|["'`])((?:[A-Za-z]:[\\/][^\s'"`<>]+|(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+|[A-Za-z0-9_.-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|go|rs|java|cs|cpp|c|h|hpp|vue|svelte)))(?::(\d+))?/)
  if (!match) return null
  const path = match[1].replace(/[),.;\]}]+$/, '')
  if (!isLikelySourceFilePath(path)) return null
  return { path, line: match[2] ? Number(match[2]) : undefined }
}

function isLikelySourceFilePath(path: string): boolean {
  if (!path || /\b[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false
  if (!/\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|go|rs|java|cs|cpp|c|h|hpp|vue|svelte)$/i.test(path)) return false
  const normalized = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) return true
  if (normalized.startsWith('./') || normalized.startsWith('../')) return true
  if (normalized.includes('/')) return true
  return /^(README|CHANGELOG|LICENSE|package|vite\.config|tsconfig|config)\./i.test(normalized)
}

function _describePlan(subtasks: any[]): string {
  const rows = subtasks
    .slice(0, 5)
    .map((task, index) => `${index + 1}. ${task.title || task.detail || task.id || tr('未命名子任务', 'Untitled subtask')}`)
  return [tr('任务拆解：', 'Plan:'), ...rows].join('\n')
}
