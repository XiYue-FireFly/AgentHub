/* ============================================================
   AgentHub 玻璃拟态 UI — 总览页
   Agent 卡片网格（三条对齐线：头部 48px / 模型栏 37px / 按钮贴底）
   + 最近任务（前 4 条）
   ============================================================ */

import React, { useState } from 'react'
import { Icon, IC, AgentMark, StatusDot, Enter, SectionTitle, TaskStatusBadge } from '../glass/ui'
import { AGENT_META, AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef, TaskItem, sumTokens, fmtTokens, sumCost, fmtCost } from '../glass/meta'
import { tr, statusLabel, modeLabel, agentDesc } from '../glass/i18n'
import { useBudget, setBudget, useBudgetMode, setBudgetMode, budgetLevel } from '../glass/budget'
import { ConnectionState, ConnectionSummary, SetupTab } from '../glass/connection-status'

/** 本次会话预算条：口径切换(Token/$) + 进度 + 分级告警(ok/warn≥80%/over≥100%) + 可编辑上限 */
function BudgetBar({ tokens, cost }: { tokens: number; cost: number }) {
  const mode = useBudgetMode()
  const limit = useBudget()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const isCost = mode === 'cost'
  const used = isCost ? cost : tokens
  const level = budgetLevel(used, limit)
  const color = level === 'over' ? 'var(--st-error)' : level === 'warn' ? 'var(--st-busy)' : 'var(--mint)'
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const fmtU = (n: number) => isCost ? fmtCost(n) : fmtTokens(n)
  const commit = () => {
    const n = Number(val.replace(/[$,_\s]/g, ''))
    setBudget(Number.isFinite(n) ? n : 0)
    setEditing(false); setVal('')
  }
  return (
    <div className="glass" style={{ padding: '11px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon d={IC.bolt} size={15} style={{ color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: limit > 0 ? 5 : 0 }}>
          <span style={{ color: 'var(--tx-2)' }}>
            {tr('本次预算', 'Session budget')}
            {level === 'over' && <span style={{ color: 'var(--st-error)', marginLeft: 8 }}>· {tr('已超预算', 'Over budget')}</span>}
            {level === 'warn' && <span style={{ color: 'var(--st-busy)', marginLeft: 8 }}>· {tr('接近预算', 'Near limit')}</span>}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx-3)' }}>
            {fmtU(used)}{limit > 0 ? ` / ${fmtU(limit)}` : tr(' · 未设', ' · not set')}
          </span>
        </div>
        {limit > 0 && (
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: color, transition: 'width 0.3s' }} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className={'ah-btn sm' + (!isCost ? ' primary' : '')} onClick={() => setBudgetMode('tokens')} title={tr('按 Token 计', 'By tokens')}>Token</button>
        <button className={'ah-btn sm' + (isCost ? ' primary' : '')} onClick={() => setBudgetMode('cost')} title={tr('按估算费用计', 'By est. cost')}>$</button>
      </div>
      {editing ? (
        <input className="ah-input mono" autoFocus style={{ width: 140, fontSize: 12, padding: '4px 8px' }}
          value={val} placeholder={isCost ? tr('输入美元预算，留空关闭', 'Enter USD budget, blank disables') : tr('输入 Token 预算，留空关闭', 'Enter token budget, blank disables')}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      ) : (
        <button className="ah-btn sm" onClick={() => { setVal(limit ? String(limit) : ''); setEditing(true) }}>
          {limit > 0 ? tr('改', 'Edit') : tr('设预算', 'Set')}
        </button>
      )}
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return tr('夜深了', 'Burning the midnight oil')
  if (h < 12) return tr('上午好', 'Good morning')
  if (h < 18) return tr('下午好', 'Good afternoon')
  return tr('晚上好', 'Good evening')
}

export function HomeScreen({ agents, bindings, providers, tasks, goChat, connectionSummary, openSetup }: {
  agents: Record<string, { status: AgentUIStatus }>
  bindings: BindingDef[]
  providers: ProviderDef[]
  tasks: TaskItem[]
  goChat: (agentId: string | null) => void
  connectionSummary: ConnectionSummary
  openSetup: (tab?: SetupTab) => void
}) {
  const runningCount = tasks.filter(t => t.status === 'running').length
  const doneToday = tasks.filter(t => t.status === 'completed').length
  const sessionTokens = tasks.reduce((s, t) => s + sumTokens(t.usage), 0)
  const sessionCost = tasks.reduce((s, t) => s + (sumCost(t.usage) || 0), 0)
  const costZh = sessionCost > 0 ? ` ≈${fmtCost(sessionCost)}` : ''
  const tokZh = sessionTokens > 0 ? ` · 本次 Token ${fmtTokens(sessionTokens)}${costZh}` : ''
  const tokEn = sessionTokens > 0 ? ` · ${fmtTokens(sessionTokens)} tokens${costZh}` : ''

  return (
    <div data-screen-label="总览" style={{ padding: '6px 4px 30px', width: '100%', maxWidth: 1540, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>{greeting()}</h1>
          <div style={{ color: 'var(--tx-2)', marginTop: 3 }}>
            {tr(`${connectionSummary.headlineZh} · ${runningCount} 个任务运行中 · 今日完成 ${doneToday} 个${tokZh}`,
                `${connectionSummary.headlineEn} · ${runningCount} running · ${doneToday} done today${tokEn}`)}
          </div>
        </div>
        <button className="ah-btn primary" onClick={() => goChat(null)}>
          <Icon d={IC.bolt} size={15} /> {tr('新建派发', 'New dispatch')}
        </button>
      </div>

      <BudgetBar tokens={sessionTokens} cost={sessionCost} />

      <FirstRunPanel summary={connectionSummary} openSetup={openSetup} goChat={goChat} />

      {/* Agent 卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, alignItems: 'stretch' }}>
        {AGENT_IDS.map((id, idx) => {
          const meta = AGENT_META[id]
          const a = agents[id] || { status: 'off' as AgentUIStatus }
          const b = bindings.find(x => x.agentId === id)
          const prov = providers.find(p => p.id === b?.providerId)
          const model = prov?.models.find(m => m.id === b?.modelId)
          const isStdio = b?.protocol === 'stdio-plain'
          const connection = connectionSummary.items.find(item => item.agentId === id)
          return (
            <Enter key={id} delay={idx * 70} style={{ display: 'flex' }}>
              <div data-agent-card className="glass hover-glow" style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 13, transition: 'border-color 0.2s, transform 0.2s', cursor: 'default', minWidth: 0 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--glass-border-strong)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.transform = 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, height: 48 }}>
                  <AgentMark id={id} size={48} radius={13} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.name}</div>
                    <div className="ah-hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agentDesc(id, meta.desc)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tx-2)', flex: 'none' }}>
                    <StatusDot status={a.status} />{connection ? connectionStateLabel(connection.state) : statusLabel(a.status)}
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, height: 37, flex: 'none',
                  background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '0 12px',
                  fontFamily: 'var(--font-mono)', color: 'var(--tx-2)'
                }}>
                  <Icon d={isStdio ? IC.terminal : IC.link} size={13} style={{ color: meta.colorRaw, flex: 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isStdio ? tr('本地 CLI · stdio', 'Local CLI · stdio') : `${prov?.name ?? tr('未绑定', 'Unbound')} · ${model?.label || b?.modelId || '–'}`}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', flex: 1, minHeight: 24 }}>
                  {meta.caps.map(c => <span key={c} className="ah-chip">{c}</span>)}
                </div>
                {connection && connection.state !== 'usable' && connection.state !== 'busy' && (
                  <div className="ah-hint" style={{ lineHeight: 1.5 }}>
                    {tr(connection.detailZh, connection.detailEn)}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                  <button className="ah-btn sm" style={{ flex: '1 1 128px' }} onClick={() => goChat(id)}>
                    <Icon d={IC.send} size={13} /> {tr('派发任务', 'Dispatch')}
                  </button>
                  {connection?.action && (
                    <button className="ah-btn sm primary" style={{ flex: '1 1 128px' }} onClick={() => openSetup(connection.action!.tab)}>
                      {tr(connection.action.labelZh, connection.action.labelEn)}
                    </button>
                  )}
                </div>
              </div>
            </Enter>
          )
        })}
      </div>

      {/* 最近任务 */}
      <Enter delay={320} style={{ marginTop: 28 }}>
        <SectionTitle right={<span className="ah-hint">{tr(`${tasks.length} 条记录`, `${tasks.length} records`)}</span>}>{tr('最近任务', 'Recent tasks')}</SectionTitle>
        <div className="glass" style={{ padding: '6px 0' }}>
          {tasks.length === 0 && (
            <div style={{ padding: '18px 18px', color: 'var(--tx-3)', fontSize: 13 }}>{tr('还没有任务 — 去会话页派发第一个任务吧', 'No tasks yet — dispatch your first one from Chat')}</div>
          )}
          {tasks.slice(0, 4).map((t, i) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: '11px 18px',
              borderTop: i === 0 ? 'none' : '1px solid var(--glass-border)'
            }}>
              <TaskStatusBadge status={t.status} />
              <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
              <span className="ah-chip">{modeLabel(t.mode)}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {t.agents.map(a => <AgentMark key={a} id={a} size={20} radius={6} />)}
              </div>
              <span className="ah-hint" style={{ width: 42, textAlign: 'right' }}>{t.createdAt}</span>
            </div>
          ))}
        </div>
      </Enter>
    </div>
  )
}

function connectionStateLabel(state: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    usable: tr('可用', 'Ready'),
    busy: tr('运行中', 'Running'),
    error: tr('异常', 'Error'),
    'needs-provider': tr('缺 Key', 'Needs key'),
    'needs-install': tr('待安装', 'Needs install'),
    off: tr('未启用', 'Off')
  }
  return labels[state]
}

function FirstRunPanel({ summary, openSetup, goChat }: {
  summary: ConnectionSummary
  openSetup: (tab?: SetupTab) => void
  goChat: (agentId: string | null) => void
}) {
  const ready = summary.counts.usable + summary.counts.busy
  const firstUsable = summary.items.find(item => item.state === 'usable')?.agentId ?? null
  const firstAction = summary.firstAction
  return (
    <div className="glass" style={{ padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ready ? 'var(--mint-soft)' : 'rgba(232,179,77,0.12)', color: ready ? 'var(--mint)' : 'var(--st-busy)', flex: 'none' }}>
        <Icon d={ready ? IC.check : IC.bolt} size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>
          {ready ? tr('已具备可派发 Agent', 'At least one agent is ready') : tr('完成首次连接', 'Finish first connection')}
        </div>
        <div className="ah-hint" style={{ lineHeight: 1.55 }}>
          {ready
            ? tr('可以先发送一条试跑任务；其他 Agent 可随后继续补 Key 或 CLI 路径。', 'Send a test task now; add keys or CLI paths for the remaining agents later.')
            : tr('先配置一个 Provider Key 或选择一个本地 CLI 路径，再回到会话页发送第一条任务。', 'Configure one provider key or choose one local CLI path, then return to Chat and send the first task.')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {firstAction && (
          <button className="ah-btn sm primary" onClick={() => openSetup(firstAction.tab)}>
            {tr(firstAction.labelZh, firstAction.labelEn)}
          </button>
        )}
        <button className="ah-btn sm" disabled={!ready} onClick={() => goChat(firstUsable)}>
          <Icon d={IC.send} size={13} /> {tr('发送试跑任务', 'Send test task')}
        </button>
      </div>
    </div>
  )
}
