import React, { useState } from 'react'
import { Icon, IC, AgentMark, Enter, Seg, Collapse } from '../glass/ui'
import { TaskItem, sumTokens, fmtTokens, usageTotal, sumCost, costOf, fmtCost } from '../glass/meta'
import { SetupTab, firstRunActionForError } from '../glass/connection-status'
import { ActivityTrail } from '../glass/activity-view'

const STATUS_LABEL: Record<TaskItem['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}

const STATUS_COLOR: Record<TaskItem['status'], string> = {
  running: 'var(--st-busy)',
  completed: 'var(--st-idle)',
  failed: 'var(--st-error)',
  cancelled: 'var(--tx-3)'
}

const MODE_LABEL: Record<string, string> = {
  auto: '自动路由',
  broadcast: '广播',
  chain: '链式交接',
  orchestrate: '编排',
  'lead-workers': '主控 + 工作者',
  'parallel-review': '并行评审',
  custom: '自定义调度'
}

function StatusBadge({ status }: { status: TaskItem['status'] }) {
  const color = STATUS_COLOR[status] || 'var(--tx-3)'
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      color,
      border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      background: `color-mix(in srgb, ${color} 11%, transparent)`,
      borderRadius: 999,
      padding: '2px 9px',
      whiteSpace: 'nowrap'
    }}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="ah-btn sm"
      title="复制内容"
      style={{ flex: 'none', padding: '4px 9px' }}
      onClick={(event) => {
        event.stopPropagation()
        try {
          navigator.clipboard?.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          // noop
        }
      }}
    >
      <Icon d={done ? IC.check : IC.copy} size={12} /> {done ? '已复制' : '复制'}
    </button>
  )
}

export function TasksScreen({ tasks, search, onCancelTask, onDeleteTask, onClearCompleted, openSetup }: {
  tasks: TaskItem[]
  search: string
  onCancelTask: (id: string) => void
  onDeleteTask: (id: string) => void
  onClearCompleted: () => void
  openSetup: (tab?: SetupTab) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const visible = tasks.filter(task =>
    (filter === 'all' || task.status === filter) &&
    (!search || task.text.toLowerCase().includes(search.toLowerCase()))
  )

  const completedCount = tasks.filter(task => task.status !== 'running').length

  return (
    <div data-screen-label="任务" style={{ padding: '6px 4px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>任务历史</h2>
          <div className="ah-hint" style={{ marginTop: 4 }}>查看、复制、取消或删除本地任务记录。</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Seg value={filter} onChange={setFilter} options={[
            { value: 'all', label: '全部' },
            { value: 'running', label: '运行中' },
            { value: 'completed', label: '已完成' },
            { value: 'failed', label: '失败' },
            { value: 'cancelled', label: '已取消' }
          ]} />
          <button className="ah-btn sm" disabled={completedCount === 0} onClick={onClearCompleted}>
            <Icon d={IC.trash} size={12} /> 清理已结束
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: 'center', color: 'var(--tx-3)' }}>没有匹配的任务</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map((task, index) => {
          const isOpen = open === task.id
          const tokenTotal = sumTokens(task.usage)
          const cost = sumCost(task.usage)
          return (
            <Enter key={task.id} delay={index * 35} className="glass" style={{ overflow: 'hidden' }}>
              <div
                onClick={() => setOpen(isOpen ? null : task.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', cursor: 'pointer', minWidth: 0 }}
              >
                <StatusBadge status={task.status} />
                <span style={{ flex: 1, minWidth: 120, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.text}</span>
                <span className="ah-chip">{MODE_LABEL[task.mode] || task.mode}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {task.agents.map(agentId => <AgentMark key={agentId} id={agentId} size={20} radius={6} />)}
                </div>
                {tokenTotal > 0 && (
                  <span className="ah-chip" title="Token 总量 / 估算费用" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {fmtTokens(tokenTotal)} tok{cost != null ? ` · ${fmtCost(cost)}` : ''}
                  </span>
                )}
                <span className="ah-hint" style={{ width: 52, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {task.status === 'running' ? '-' : formatDuration(task.durationMs)}
                </span>
                <span className="ah-hint" style={{ width: 46, textAlign: 'right' }}>{task.createdAt}</span>
                {task.status === 'running' ? (
                  <button className="ah-btn sm danger" onClick={event => { event.stopPropagation(); onCancelTask(task.id) }}>取消</button>
                ) : (
                  <button className="ah-btn sm danger" onClick={event => { event.stopPropagation(); onDeleteTask(task.id) }}>
                    <Icon d={IC.trash} size={12} /> 删除
                  </button>
                )}
                <Icon d={IC.chevDown} size={14} style={{ color: 'var(--tx-3)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </div>

              <Collapse open={isOpen}>
                <div style={{ borderTop: '1px solid var(--glass-border)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>
                    {task.id} · {MODE_LABEL[task.mode] || task.mode} · {task.agents.length} 个 Agent
                  </div>
                  {tokenTotal > 0 && (
                    <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ color: 'var(--mint)' }}>Token 合计 {fmtTokens(tokenTotal)}{cost != null ? ` · ${fmtCost(cost)}` : ''}</span>
                      {Object.entries(task.usage || {}).map(([agentId, usage]) => (
                        <span key={agentId} style={{ color: 'var(--tx-3)' }}>
                          {agentId}: {fmtTokens(usageTotal(usage))} (输入 {fmtTokens(usage.prompt_tokens || 0)} / 输出 {fmtTokens(usage.completion_tokens || 0)}){costOf(usage) != null ? ` · ${fmtCost(costOf(usage)! )}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {task.results && Object.entries(task.results).map(([agentId, content]) => (
                    <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <AgentMark id={agentId} size={24} radius={7} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {task.steps?.[agentId]?.length ? <ActivityTrail steps={task.steps[agentId]} running={task.status === 'running'} /> : null}
                        <div style={{ fontSize: 13, color: 'var(--tx-2)', background: 'rgba(0,0,0,0.18)', borderRadius: 10, padding: '9px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
                      </div>
                      {content && <CopyBtn text={content} />}
                    </div>
                  ))}
                  {task.errors && Object.entries(task.errors).map(([agentId, error]) => {
                    const action = firstRunActionForError(error)
                    return (
                      <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <AgentMark id={agentId} size={24} radius={7} />
                        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {task.steps?.[agentId]?.length ? <ActivityTrail steps={task.steps[agentId]} running={false} /> : null}
                          <div style={{ fontSize: 12.5, color: 'var(--st-error)', background: 'rgba(232,112,106,0.08)', border: '1px solid rgba(232,112,106,0.2)', borderRadius: 10, padding: '9px 13px', fontFamily: 'var(--font-mono)' }}>{error}</div>
                        </div>
                        {action && <button className="ah-btn sm primary" onClick={() => openSetup(action.tab)}>去设置</button>}
                        {error && <CopyBtn text={error} />}
                      </div>
                    )
                  })}
                  {task.steps && Object.entries(task.steps).map(([agentId, steps]) =>
                    (steps?.length && !task.results?.[agentId] && !task.errors?.[agentId]) ? (
                      <div key={`steps-${agentId}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <AgentMark id={agentId} size={24} radius={7} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <ActivityTrail steps={steps} running={task.status === 'running'} />
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              </Collapse>
            </Enter>
          )
        })}
      </div>
    </div>
  )
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
