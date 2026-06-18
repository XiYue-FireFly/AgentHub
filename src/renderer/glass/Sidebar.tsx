/* ============================================================
   AgentHub 玻璃拟态 UI — 侧边栏（218px，常驻）
   导航 + Agents 列表（点击跳会话并指定）+ proxy 地址
   ============================================================ */

import React, { ReactNode } from 'react'
import { Icon, IC, AgentMark, StatusDot } from './ui'
import { AGENT_META, AGENT_IDS, AgentUIStatus } from './meta'
import { tr } from './i18n'

export type PageId = 'home' | 'chat' | 'tasks' | 'settings'

const NAV: Array<{ id: PageId; zh: string; en: string; icon: ReactNode }> = [
  { id: 'home', zh: '总览', en: 'Overview', icon: IC.home },
  { id: 'chat', zh: '会话', en: 'Chat', icon: IC.chat },
  { id: 'tasks', zh: '任务', en: 'Tasks', icon: IC.tasks },
  { id: 'settings', zh: '设置', en: 'Settings', icon: IC.gear }
]

export function Sidebar({ page, setPage, agents, activeAgent, setActiveAgent, providerCount, proxyHost }: {
  page: PageId
  setPage: (p: PageId) => void
  agents: Record<string, { status: AgentUIStatus }>
  activeAgent: string | null
  setActiveAgent: (id: string | null) => void
  providerCount: number
  proxyHost: string
}) {
  return (
    <div className="glass" style={{
      width: 218, flex: 'none', display: 'flex', flexDirection: 'column',
      margin: '0 0 14px 14px', padding: 11, gap: 2, overflow: 'hidden auto', minHeight: 0
    }}>
      <div style={{ padding: '3px 10px 8px' }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{tr('工作台', 'Workbench')}</div>
        <div className="ah-hint">{tr(`${AGENT_IDS.length} 个 Agent · ${providerCount} 个提供商`, `${AGENT_IDS.length} agents · ${providerCount} providers`)}</div>
      </div>
      {NAV.map(n => (
        <button key={n.id} onClick={() => setPage(n.id)} style={{
          display: 'flex', alignItems: 'center', gap: 11, font: 'inherit', fontSize: 13.5,
          color: page === n.id ? 'var(--tx-1)' : 'var(--tx-2)',
          background: page === n.id ? 'rgba(255,255,255,0.1)' : 'transparent',
          border: 'none', borderRadius: 11, padding: '8px 12px', cursor: 'pointer',
          transition: 'background 0.15s, color 0.15s', textAlign: 'left',
          fontWeight: page === n.id ? 600 : 400, flex: 'none'
        }}>
          <Icon d={n.icon} size={16} style={{ opacity: page === n.id ? 1 : 0.7 }} />
          {tr(n.zh, n.en)}
        </button>
      ))}

      <div style={{ borderTop: '1px solid var(--glass-border)', margin: '9px 4px', flex: 'none' }}></div>
      <div className="ah-label" style={{ padding: '0 10px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Agents <Icon d={IC.chevDown} size={13} />
      </div>
      {AGENT_IDS.map(id => {
        const a = agents[id] || { status: 'off' as AgentUIStatus }
        const sel = activeAgent === id
        return (
          <button key={id} onClick={() => { setActiveAgent(sel ? null : id); setPage('chat') }} style={{
            display: 'flex', alignItems: 'center', gap: 10, font: 'inherit',
            background: sel ? 'rgba(255,255,255,0.1)' : 'transparent',
            border: 'none', borderRadius: 11, padding: '5px 10px', cursor: 'pointer',
            color: 'var(--tx-1)', textAlign: 'left', transition: 'background 0.15s', flex: 'none'
          }}>
            <AgentMark id={id} size={28} radius={8} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: sel ? 600 : 400 }}>{AGENT_META[id].name}</span>
            <StatusDot status={a.status} />
          </button>
        )
      })}
      <div style={{ flex: 1, minHeight: 6 }}></div>
      <div className="ah-hint" style={{ padding: '8px 10px 2px', fontFamily: 'var(--font-mono)', fontSize: 10.5, flex: 'none' }}>
        proxy · {proxyHost}
      </div>
    </div>
  )
}
