/**
 * ToolCallStream: 实时工具调用流式展示组件
 * 参照 Codex 输出形式：实时展示 → 状态追踪 → 可展开/收起
 * Phase 2.4: 全面使用 CSS 变量，参照 ccgui tool-block card 视觉
 */

import React, { useEffect, useMemo, useState } from 'react'

interface ToolCall {
  id: string
  tool: string
  status: 'started' | 'succeeded' | 'failed' | 'declined'
  startTime: number
  endTime?: number
  input?: string
  output?: string
  error?: string
}

interface ToolCallStreamProps {
  calls: ToolCall[]
  className?: string
  defaultOpen?: boolean
  collapseWhenComplete?: boolean
}

/** 状态 → CSS 变量映射（参照 codex GuardianRiskLevel + ccgui token 纪律） */
const STATUS_STYLES: Record<ToolCall['status'], { border: string; bg: string; text: string; badge: string; icon: string }> = {
  started:   { border: 'var(--color-info)',    bg: 'rgba(59,130,246,0.06)',  text: 'var(--color-info)',    badge: 'rgba(59,130,246,0.15)',  icon: '▶' },
  succeeded: { border: 'var(--color-success)', bg: 'rgba(16,185,129,0.06)',  text: 'var(--color-success)', badge: 'rgba(16,185,129,0.15)', icon: '✓' },
  failed:    { border: 'var(--color-error)',   bg: 'rgba(239,68,68,0.06)',   text: 'var(--color-error)',   badge: 'rgba(239,68,68,0.15)',  icon: '✗' },
  declined:  { border: 'var(--tx-3)',          bg: 'rgba(107,114,128,0.06)', text: 'var(--tx-3)',          badge: 'rgba(107,114,128,0.15)', icon: '⊘' }
}

function formatDuration(ms: number): string {
  const value = Math.max(0, Math.round(ms))
  if (value < 1000) return `${value}ms`
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.floor(value / 60000)}m ${((value % 60000) / 1000).toFixed(0)}s`
}

export function ToolCallStream({ calls, className = '', defaultOpen = true, collapseWhenComplete = false }: ToolCallStreamProps) {
  const [streamOpen, setStreamOpen] = useState(defaultOpen)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const summary = useMemo(() => summarizeCalls(calls), [calls])

  useEffect(() => {
    const shouldCollapse = collapseWhenComplete && summary.running === 0
    setStreamOpen(shouldCollapse ? false : defaultOpen)
    if (shouldCollapse) setExpandedIds(new Set())
  }, [collapseWhenComplete, defaultOpen, summary.running])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  if (calls.length === 0) return null

  return (
    <div className={`tool-call-stream ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
      <button
        type="button"
        className="tool-call-stream-summary"
        onClick={() => setStreamOpen(value => !value)}
        aria-expanded={streamOpen}
      >
        <span className="tool-call-stream-chevron">{streamOpen ? '▼' : '▶'}</span>
        <strong>{summary.total} tool{summary.total === 1 ? '' : 's'}</strong>
        {summary.running > 0 && <em>{summary.running} running</em>}
        {summary.succeeded > 0 && <em className="succeeded">{summary.succeeded} succeeded</em>}
        {summary.failed > 0 && <em className="failed">{summary.failed} failed</em>}
        {summary.declined > 0 && <em>{summary.declined} declined</em>}
        {summary.duration != null && <small>⏱ {formatDuration(summary.duration)}</small>}
      </button>
      {streamOpen && calls.map(call => {
        const isExpanded = expandedIds.has(call.id)
        const duration = call.endTime ? Math.max(0, call.endTime - call.startTime) : null
        const s = STATUS_STYLES[call.status]

        return (
          <div
            key={call.id}
            style={{
              borderRadius: 8,
              border: `1px solid var(--glass-border-default, rgba(255,255,255,0.08))`,
              borderLeft: `3px solid ${s.border}`,
              background: s.bg,
              overflow: 'hidden',
              transition: 'all 0.15s'
            }}
          >
            {/* Header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => toggleExpand(call.id)}
            >
              <span style={{ fontSize: 11, color: 'var(--tx-3)', width: 16, textAlign: 'center' }}>{isExpanded ? '▼' : '▶'}</span>
              <span style={{ color: s.text, fontSize: 14, width: 18, textAlign: 'center' }}>{s.icon}</span>
              <span style={{ flex: 1, fontWeight: 600, color: 'var(--tx-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{call.tool}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: s.badge, color: s.text, fontWeight: 600, textTransform: 'uppercase' }}>{call.status}</span>
              {duration != null && (
                <span style={{ fontSize: 11, color: 'var(--tx-3)', display: 'flex', alignItems: 'center', gap: 4 }}>⏱ {formatDuration(duration)}</span>
              )}
            </div>

            {/* Details (expandable) */}
            {isExpanded && (
              <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--glass-border-default, rgba(255,255,255,0.04))' }}>
                {call.input && (
                  <div style={{ marginTop: 10 }}>
                    <strong style={{ color: 'var(--color-success)', fontSize: 11, textTransform: 'uppercase' }}>Input:</strong>
                    <pre style={{ marginTop: 6, background: 'var(--bg-code-block, rgba(0,0,0,0.22))', padding: 10, borderRadius: 6, overflow: 'auto', maxHeight: 280, fontSize: 12, lineHeight: 1.5 }}>
                      <code>{call.input}</code>
                    </pre>
                  </div>
                )}
                {call.output && (
                  <div style={{ marginTop: 10 }}>
                    <strong style={{ color: 'var(--color-success)', fontSize: 11, textTransform: 'uppercase' }}>Output:</strong>
                    <pre style={{ marginTop: 6, background: 'var(--bg-code-block, rgba(0,0,0,0.22))', padding: 10, borderRadius: 6, overflow: 'auto', maxHeight: 280, fontSize: 12, lineHeight: 1.5 }}>
                      <code>{call.output}</code>
                    </pre>
                  </div>
                )}
                {call.error && (
                  <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-error-subtle, rgba(239,68,68,0.08))', borderRadius: 6 }}>
                    <strong style={{ color: 'var(--color-error)', fontSize: 11, textTransform: 'uppercase' }}>Error:</strong>
                    <pre style={{ marginTop: 6, fontSize: 12, color: 'var(--color-error)', lineHeight: 1.5 }}>
                      <code>{call.error}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function summarizeCalls(calls: ToolCall[]) {
  const started = calls.map(call => call.startTime).filter(Number.isFinite)
  const ended = calls
    .map(call => call.endTime && call.endTime >= call.startTime ? call.endTime : 0)
    .filter(value => value > 0)
  const total = calls.length
  const running = calls.filter(call => call.status === 'started').length
  const succeeded = calls.filter(call => call.status === 'succeeded').length
  const failed = calls.filter(call => call.status === 'failed').length
  const declined = calls.filter(call => call.status === 'declined').length
  const duration = started.length && ended.length
    ? Math.max(0, Math.max(...ended) - Math.min(...started))
    : null
  return { total, running, succeeded, failed, declined, duration }
}

export type { ToolCall, ToolCallStreamProps }
