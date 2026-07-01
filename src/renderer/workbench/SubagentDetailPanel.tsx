/**
 * SubagentDetailPanel: Kun-inspired agent run detail view.
 *
 * Shows detailed information about a specific agent's run including
 * status, output, tool calls, thinking, and errors.
 */

import React, { useMemo } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { tr } from '../glass/i18n'

interface SubagentDetailPanelProps {
  agentId: string
  turnId: string
  events: RuntimeEvent[]
  onClose: () => void
}

interface AgentRunSummary {
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  startTime: number | null
  endTime: number | null
  durationMs: number | null
  outputContent: string
  thinkingContent: string
  toolCalls: Array<{ name: string; detail: string; timestamp: number }>
  errors: string[]
  streamDeltas: number
}

function summarizeAgentRun(agentId: string, turnId: string, events: RuntimeEvent[]): AgentRunSummary {
  const agentEvents = events.filter(e =>
    e.turnId === turnId && (e.agentId === agentId || e.payload?.agentId === agentId)
  )

  const summary: AgentRunSummary = {
    status: 'unknown',
    startTime: null,
    endTime: null,
    durationMs: null,
    outputContent: '',
    thinkingContent: '',
    toolCalls: [],
    errors: [],
    streamDeltas: 0
  }

  for (const event of agentEvents) {
    if (event.kind === 'run:created' || event.kind === 'run:status') {
      if (event.payload?.status === 'running') summary.status = 'running'
      else if (event.payload?.status === 'completed') summary.status = 'completed'
      else if (event.payload?.status === 'failed') summary.status = 'failed'
      else if (event.payload?.status === 'cancelled') summary.status = 'cancelled'
    }
    if (event.kind === 'agent:start') {
      summary.status = 'running'
      summary.startTime = event.ts || Date.now()
    }
    if (event.kind === 'agent:done') {
      summary.status = 'completed'
      summary.endTime = event.ts || Date.now()
      if (event.payload?.content) summary.outputContent = String(event.payload.content)
      if (event.payload?.durationMs) summary.durationMs = event.payload.durationMs
    }
    if (event.kind === 'agent:error') {
      summary.status = 'failed'
      summary.endTime = event.ts || Date.now()
      if (event.payload?.error) summary.errors.push(String(event.payload.error))
    }
    if (event.kind === 'agent:delta') {
      summary.streamDeltas++
      if (event.payload?.channel === 'thinking') {
        summary.thinkingContent += event.payload.text || ''
      } else {
        summary.outputContent += event.payload.text || ''
      }
    }
    if (event.kind === 'agent:activity' && event.payload?.step) {
      const step = event.payload.step
      summary.toolCalls.push({
        name: step.tool || step.kind || 'activity',
        detail: step.label || step.detail || '',
        timestamp: event.ts || Date.now()
      })
    }
  }

  if (summary.startTime && summary.endTime) {
    summary.durationMs = summary.endTime - summary.startTime
  }

  return summary
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function statusLabel(status: AgentRunSummary['status']): string {
  switch (status) {
    case 'running': return tr('运行中', 'Running')
    case 'completed': return tr('已完成', 'Completed')
    case 'failed': return tr('失败', 'Failed')
    case 'cancelled': return tr('已取消', 'Cancelled')
    default: return tr('未知', 'Unknown')
  }
}

function statusClass(status: AgentRunSummary['status']): string {
  switch (status) {
    case 'running': return 'running'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return ''
  }
}

export function SubagentDetailPanel({ agentId, turnId, events, onClose }: SubagentDetailPanelProps) {
  const summary = useMemo(() => summarizeAgentRun(agentId, turnId, events), [agentId, turnId, events])

  return (
    <div className="wb-subagent-detail">
      <div className="wb-timeline-head">
        <div>
          <strong>{tr('Agent 详情', 'Agent Details')}</strong>
          <span>{agentId}</span>
        </div>
        <div className="wb-timeline-head-actions">
          <button onClick={onClose} title={tr('关闭', 'Close')}>
            <Icon d={IC.x} size={14} />
          </button>
        </div>
      </div>

      {/* Status header */}
      <div className="wb-subagent-status">
        <AgentMark id={agentId} size={32} radius={8} />
        <div className="wb-subagent-status-info">
          <div className="wb-subagent-status-label">
            <span className={'ah-dot ' + statusClass(summary.status)} />
            <strong>{statusLabel(summary.status)}</strong>
          </div>
          <div className="wb-subagent-status-meta">
            {summary.durationMs !== null && (
              <span>{tr('耗时', 'Duration')}: {formatDuration(summary.durationMs)}</span>
            )}
            {summary.streamDeltas > 0 && (
              <span>{summary.streamDeltas} {tr('个流事件', 'stream events')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Errors */}
      {summary.errors.length > 0 && (
        <div className="wb-subagent-section">
          <div className="wb-subagent-section-title">{tr('错误', 'Errors')}</div>
          {summary.errors.map((err, i) => (
            <div key={i} className="wb-subagent-error">{err}</div>
          ))}
        </div>
      )}

      {/* Tool calls */}
      {summary.toolCalls.length > 0 && (
        <div className="wb-subagent-section">
          <div className="wb-subagent-section-title">
            {tr('工具调用', 'Tool Calls')} ({summary.toolCalls.length})
          </div>
          <div className="wb-subagent-tool-list">
            {summary.toolCalls.map((call, i) => (
              <div key={i} className="wb-subagent-tool-item">
                <Icon d={IC.bolt} size={12} />
                <span className="wb-subagent-tool-name">{call.name}</span>
                {call.detail && <span className="wb-subagent-tool-detail">{call.detail}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thinking */}
      {summary.thinkingContent && (
        <div className="wb-subagent-section">
          <div className="wb-subagent-section-title">
            <Icon d={IC.brain} size={13} />
            {tr('思考过程', 'Thinking')}
          </div>
          <div className="wb-subagent-content">
            {summary.thinkingContent.slice(0, 2000)}
            {summary.thinkingContent.length > 2000 && '...'}
          </div>
        </div>
      )}

      {/* Output */}
      {summary.outputContent && (
        <div className="wb-subagent-section">
          <div className="wb-subagent-section-title">{tr('输出内容', 'Output')}</div>
          <div className="wb-subagent-output">
            {summary.outputContent.slice(0, 5000)}
            {summary.outputContent.length > 5000 && '...'}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!summary.outputContent && !summary.thinkingContent && summary.toolCalls.length === 0 && summary.errors.length === 0 && (
        <div className="wb-muted-box" style={{ margin: 16 }}>
          {tr('暂无详细信息', 'No details available')}
        </div>
      )}
    </div>
  )
}
