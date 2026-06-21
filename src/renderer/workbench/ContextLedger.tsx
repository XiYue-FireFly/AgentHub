/**
 * ContextLedger: show context sources and weights for a turn.
 *
 * Displays which context blocks contributed to the AI's response,
 * with token estimates and participation status.
 *
 * Phase 3.3 of AGENTHUB_ITERATION_GOAL.
 */

import React, { useState, useEffect } from 'react'

interface ContextBlock {
  id: string
  kind: string
  title?: string
  detail?: string
  estimateTokens?: number
  participation?: string
  pinned?: boolean
}

interface ContextLedgerProps {
  threadId: string | null
  turnId?: string
  compact?: boolean
}

function tr(zh: string, en: string): string {
  const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh' : 'en'
  return lang === 'zh' ? zh : en
}

const KIND_ICONS: Record<string, string> = {
  system: '⚙️',
  messages: '💬',
  attachments: '📎',
  skills: '⚡',
  workspace: '📁',
  memory: '🧠',
  browser: '🌐',
  write_draft: '✏️'
}

const PARTICIPATION_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  selected: { zh: '已选', en: 'Selected', color: 'var(--color-success)' },
  pinned_next_send: { zh: '已固定', en: 'Pinned', color: 'var(--color-info)' },
  carried_over: { zh: '已携带', en: 'Carried', color: 'var(--color-warning)' },
  excluded: { zh: '已排除', en: 'Excluded', color: 'var(--tx-3)' }
}

export function ContextLedger({ threadId, turnId, compact }: ContextLedgerProps) {
  const [blocks, setBlocks] = useState<ContextBlock[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(!compact)

  useEffect(() => {
    if (!threadId) return
    let alive = true
    setLoading(true)
    window.electronAPI.context.projection({ threadId })
      .then((result: any) => {
        if (!alive) return
        setBlocks(result?.blocks || [])
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [threadId, turnId])

  if (!threadId || blocks.length === 0) return null

  const totalTokens = blocks.reduce((sum, b) => sum + (b.estimateTokens || 0), 0)

  return (
    <div style={{
      margin: '8px 0',
      border: '1px solid var(--glass-border-default, rgba(255,255,255,0.06))',
      borderRadius: 8,
      overflow: 'hidden'
    }}>
      <button
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 12px', background: 'var(--bg-input)', border: 'none',
          color: 'var(--tx-1)', font: 'inherit', fontSize: 12, cursor: 'pointer',
          textAlign: 'left'
        }}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontWeight: 600 }}>{tr('上下文构成', 'Context composition')}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--tx-3)' }}>
          {blocks.length} {tr('来源', 'sources')} · {totalTokens.toLocaleString()} {tr('tokens', 'tokens')}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '8px 12px' }}>
          {blocks.map(block => {
            const participation = PARTICIPATION_LABELS[block.participation || 'selected']
            return (
              <div key={block.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 0', borderBottom: '1px solid var(--glass-border-default, rgba(255,255,255,0.04))'
              }}>
                <span style={{ fontSize: 14 }}>{KIND_ICONS[block.kind] || '📄'}</span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--tx-1)' }}>
                  {block.title || block.kind}
                  {block.pinned && <span style={{ marginLeft: 4 }}>📌</span>}
                </span>
                {block.estimateTokens && (
                  <span style={{ fontSize: 11, color: 'var(--tx-3)', fontFamily: 'var(--font-mono)' }}>
                    {block.estimateTokens.toLocaleString()} tok
                  </span>
                )}
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3,
                  color: participation.color,
                  background: `${participation.color}15`
                }}>
                  {tr(participation.zh, participation.en)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
