/* ============================================================
   AgentHub — 写/执行审批弹窗（Item K）
   当某 agent 的 write/exec 策略为 'ask' 时，工具回环暂停并发 approval 事件，
   本覆盖层呈现请求详情，用户「允许 / 拒绝」经 agentic:resolveApproval 回传。
   可勾选「记住」把决定固化为该 agent 该工具的 allow/deny 覆盖。
   ============================================================ */

import React, { useEffect, useId, useRef, useState } from 'react'
import { Icon, IC, AgentMark } from './ui'
import { AGENT_META } from './meta'
import { tr } from './i18n'
import { useModalFocus } from '../hooks/useModalFocus'

export interface ApprovalItem {
  id: string
  taskId: string
  agentId: string
  tool: 'write' | 'exec'
  toolName: string
  label?: string
  detail?: string
}

const AMBER = 'var(--color-warning)'

export function ApprovalDialog({ items, onDecide, busy = false, error = null }: {
  items: ApprovalItem[]
  onDecide: (item: ApprovalItem, approved: boolean, remember: boolean) => void | Promise<void>
  busy?: boolean
  error?: string | null
}) {
  const [remember, setRemember] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const denyRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const it = items[0]
  const decide = (approved: boolean) => {
    if (!it || busy) return
    void onDecide(it, approved, remember)
  }

  useModalFocus({
    containerRef: dialogRef,
    initialFocusRef: denyRef,
    onEscape: () => { if (!busy) decide(false) },
    active: Boolean(it),
    activationKey: it?.id
  })

  // Reset remember when approval items change
  useEffect(() => {
    setRemember(false)
  }, [items[0]?.id])

  if (!it) return null
  const meta = AGENT_META[it.agentId]
  const toolZh = it.tool === 'write' ? '写文件' : '执行命令'
  const toolEn = it.tool === 'write' ? 'write a file' : 'run a command'
  const summary = approvalSummary(it)
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--overlay-bg)', backdropFilter: 'blur(2px)'
    }}>
      <div className="glass" ref={dialogRef} role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} style={{
        width: 'min(540px, 92vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14,
        borderColor: 'color-mix(in srgb, ' + AMBER + ' 45%, transparent)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon d={IC.bolt} size={18} style={{ color: AMBER }} />
          <div id={titleId} style={{ fontWeight: 700, fontSize: 15 }}>{tr('需要你批准一次操作', 'Approval required')}</div>
          {items.length > 1 && (
            <span className="ah-chip" style={{ fontSize: 10.5 }}>
              {tr(`队列还有 ${items.length - 1}`, `${items.length - 1} more`)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {meta ? <AgentMark id={it.agentId} size={30} radius={8} /> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{meta?.name || it.agentId}</span>
            <span className="ah-hint" style={{ fontSize: 11.5 }}>
              {tr('请求', 'wants to')}{' '}
              <b style={{ color: AMBER }}>{tr(toolZh, toolEn)}</b>
            </span>
          </div>
        </div>

        <div className="approval-request-card" id={descriptionId}>
          <div className="approval-request-row">
            <span>{tr('请求内容', 'Request')}</span>
            <strong>{it.label || summary.action}</strong>
          </div>
          <div className="approval-request-row">
            <span>{tr('工具', 'Tool')}</span>
            <strong>{it.toolName}</strong>
          </div>
          {summary.target && (
            <div className="approval-request-row">
              <span>{tr('目标', 'Target')}</span>
              <strong className="mono">{summary.target}</strong>
            </div>
          )}
          {summary.preview && (
            <pre className="mono approval-request-preview">{summary.preview}</pre>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: 'var(--tx-2)' }}>
          <input type="checkbox" checked={remember} disabled={busy} onChange={e => setRemember(e.target.checked)} />
          {tr(`记住：以后「${meta?.name || it.agentId}」的「${toolZh}」都按本次决定`,
              `Remember this decision for ${meta?.name || it.agentId}`)}
        </label>

        {error && <div role="alert" className="wb-error-text">{error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button ref={denyRef} className="ah-btn" disabled={busy} onClick={() => decide(false)}><Icon d={IC.x} size={14} /> {tr('拒绝', 'Deny')}</button>
          <button className="ah-btn primary" disabled={busy} onClick={() => decide(true)}><Icon d={IC.check} size={14} /> {tr('允许', 'Allow')}</button>
        </div>
      </div>
    </div>
  )
}

function approvalSummary(item: ApprovalItem): { action: string; target: string; preview: string } {
  const detail = String(item.detail || '').trim()
  const lines = detail.split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean)
  const action = findDetailValue(lines, 'Action') || (item.tool === 'write' ? 'write file' : 'run command')
  const target = findDetailValue(lines, 'Path') || findDetailValue(lines, 'Command') || ''
  const previewIndex = lines.findIndex(line => line.toLowerCase() === 'preview:')
  const preview = previewIndex >= 0
    ? lines.slice(previewIndex + 1).join('\n')
    : detail && detail !== target ? detail : ''
  return { action, target, preview }
}

function findDetailValue(lines: string[], key: string): string {
  const prefix = `${key}:`
  const row = lines.find(line => line.toLowerCase().startsWith(prefix.toLowerCase()))
  return row ? row.slice(prefix.length).trim() : ''
}
