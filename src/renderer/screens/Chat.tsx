import React, { useState, useRef, useEffect, ReactNode } from 'react'
import { Icon, IC, AgentMark, Enter, Seg } from '../glass/ui'
import { AGENT_META, AGENT_IDS, DispatchMode, ChatMessage } from '../glass/meta'
import { ActivityTrail } from '../glass/activity-view'
import { tr, modeLabel } from '../glass/i18n'
import { ConnectionSummary, SetupTab, firstRunActionForError } from '../glass/connection-status'
import {
  curateAgentReply,
  orchestrationReplies,
  TranscriptReply,
  visibleSequentialReplies
} from '../glass/chat-transcript'

export function ChatScreen({ activeAgent, setActiveAgent, messages, streaming, onSend, onCancel, connectionSummary, openSetup }: {
  activeAgent: string | null
  setActiveAgent: (id: string | null) => void
  messages: ChatMessage[]
  streaming: boolean
  onSend: (text: string, mode: DispatchMode, targetAgent: string | null, workspaceId?: string | null) => void
  onCancel: () => void
  connectionSummary: ConnectionSummary
  openSetup: (tab?: SetupTab) => void
}) {
  const [mode, setMode] = useState<DispatchMode>('auto')
  const [input, setInput] = useState('')
  const [routeHint, setRouteHint] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; rootPath: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // 启动时拉一次工作区列表 + 活动工作区；用户后续改设置时通过 IPC 事件可再次刷新（这里仅首加载）
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = await (window.electronAPI as any)?.workspaces?.list?.()
        if (alive && Array.isArray(list)) setWorkspaces(list)
        const active = await (window.electronAPI as any)?.workspaces?.getActive?.()
        if (!alive) return
        if (typeof active === 'string' && active) {
          // 拿到的 active 若在列表里才设；否则视为空（被外部删了）
          setWorkspaceId(Array.isArray(list) && list.some((w: any) => w.id === active) ? active : null)
        }
      } catch { /* 容忍：业务未就绪时为空数组 */ }
    })()
    return () => { alive = false }
  }, [])

  // Chat 顶部选了 workspace 后回写为活动（持久化到主进程 store）
  const pickWorkspace = async (next: string | null) => {
    setWorkspaceId(next)
    try { await (window.electronAPI as any)?.workspaces?.setActive?.(next) } catch { /* noop */ }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (mode !== 'auto' || activeAgent || !input.trim()) { setRouteHint(null); return }
    const timer = setTimeout(async () => {
      try {
        const scores = await (window.electronAPI as any)?.hub?.routePreview?.(input)
        setRouteHint(Array.isArray(scores) && scores[0] ? scores[0].id : null)
      } catch { setRouteHint(null) }
    }, 300)
    return () => clearTimeout(timer)
  }, [input, mode, activeAgent])

  const targetItem = activeAgent
    ? connectionSummary.items.find(item => item.agentId === activeAgent)
    : routeHint
    ? connectionSummary.items.find(item => item.agentId === routeHint)
    : mode === 'chain'
    ? connectionSummary.items.find(item => ['codex', 'claude'].includes(item.agentId) && item.state !== 'usable')
    : mode === 'broadcast' && connectionSummary.counts.usable === 0
    ? connectionSummary.items.find(item => item.action)
    : null
  const blocked = !!targetItem && targetItem.state !== 'usable' && targetItem.state !== 'busy'

  // 自动屏蔽未安装/未配置的 Agent：对话中「指定」目标只展示已就绪(usable/busy)的 Agent，
  // 其余(缺 Key / 待安装 / 未启用 / 异常)从目标选择器隐藏，避免误派发到跑不起来的 Agent。
  const selectableAgentIds = AGENT_IDS.filter(id => {
    const item = connectionSummary.items.find(it => it.agentId === id)
    return !!item && (item.state === 'usable' || item.state === 'busy')
  })
  const selectableKey = selectableAgentIds.join(',')

  // 已选目标若变为不可用(被屏蔽)，自动取消指定，回到当前模式
  useEffect(() => {
    if (activeAgent && !selectableKey.split(',').includes(activeAgent)) setActiveAgent(null)
  }, [activeAgent, selectableKey, setActiveAgent])

  const send = () => {
    const text = input.trim()
    if (!text || streaming || blocked) return
    setInput('')
    onSend(text, activeAgent ? 'auto' : mode, activeAgent, workspaceId)
  }

  return (
    <div data-screen-label="会话" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <ChatToolbar
        activeAgent={activeAgent}
        setActiveAgent={setActiveAgent}
        mode={mode}
        setMode={setMode}
        routeHint={routeHint}
        targetItem={targetItem}
        selectableAgentIds={selectableAgentIds}
        openSetup={openSetup}
        workspaceId={workspaceId}
        workspaces={workspaces}
        pickWorkspace={pickWorkspace}
      />

      <div ref={scrollRef} className="ah-chat-list">
        {messages.length === 0 && <EmptyChatState />}
        {messages.map(m => (
          <Enter key={m.id} className="ah-chat-thread">
            <UserMessageRow text={m.text} meta={modeLabel(m.mode)} />
            {messageAgentReplies(m).map((reply, idx) => (
              <AgentMessageRow key={`${m.id}-${reply.agentId}-${idx}`} reply={reply} delay={idx * 70} openSetup={openSetup} />
            ))}
          </Enter>
        ))}
      </div>

      {blocked && targetItem && (
        <div className="glass" style={{ flex: 'none', padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 10, borderColor: 'rgba(232,179,77,0.28)' }}>
          <Icon d={IC.pulse} size={14} style={{ color: 'var(--st-busy)', flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--tx-1)' }}>{tr(targetItem.titleZh, targetItem.titleEn)}</div>
            <div className="ah-hint">{tr(targetItem.detailZh, targetItem.detailEn)}</div>
          </div>
          {targetItem.action && (
            <button className="ah-btn sm primary" onClick={() => openSetup(targetItem.action!.tab)}>
              {tr(targetItem.action.labelZh, targetItem.action.labelEn)}
            </button>
          )}
        </div>
      )}

      <div className="glass-strong" style={{ flex: 'none', display: 'flex', alignItems: 'flex-end', gap: 10, padding: 10, borderRadius: 18 }}>
        <textarea value={input} rows={1}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={streaming ? tr('正在生成...', 'Generating...') : tr('描述任务，Enter 发送，Shift+Enter 换行', 'Describe the task. Enter to send, Shift+Enter for newline')}
          style={{
            flex: 1, resize: 'none', background: 'none', border: 'none', outline: 'none',
            color: 'var(--tx-1)', font: 'inherit', fontSize: 14, padding: '8px 8px', maxHeight: 120
          }} />
        {streaming
          ? <button className="ah-btn danger" onClick={onCancel}><Icon d={IC.stop} size={14} /> {tr('停止', 'Stop')}</button>
          : <button className="ah-btn primary" onClick={send} disabled={!input.trim() || blocked}><Icon d={IC.send} size={14} /> {tr('发送', 'Send')}</button>}
      </div>
    </div>
  )
}

function ChatToolbar({ activeAgent, setActiveAgent, mode, setMode, routeHint, targetItem, selectableAgentIds, openSetup, workspaceId, workspaces, pickWorkspace }: {
  activeAgent: string | null
  setActiveAgent: (id: string | null) => void
  mode: DispatchMode
  setMode: (mode: DispatchMode) => void
  routeHint: string | null
  targetItem: ConnectionSummary['items'][number] | null | undefined
  selectableAgentIds: string[]
  openSetup: (tab?: SetupTab) => void
  workspaceId: string | null
  workspaces: Array<{ id: string; name: string; rootPath: string }>
  pickWorkspace: (id: string | null) => void
}) {
  return (
    <div className="glass" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', flexWrap: 'wrap' }}>
      <Seg value={activeAgent ? 'single' : mode} onChange={v => { setActiveAgent(null); setMode(v as DispatchMode) }}
        options={[
          { value: 'auto', label: tr('智能路由', 'Auto route') },
          { value: 'broadcast', label: tr('广播全部', 'Broadcast') },
          { value: 'chain', label: tr('链式接力', 'Chain relay') },
          { value: 'orchestrate', label: tr('编排', 'Orchestrate') }
        ]} />
      <div style={{ width: 1, height: 20, background: 'var(--glass-border)' }}></div>
      <span className="ah-label">{tr('指定：', 'Target:')}</span>
      {selectableAgentIds.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {selectableAgentIds.map(id => (
            <button key={id} onClick={() => setActiveAgent(activeAgent === id ? null : id)}
              className="ah-chip" style={{
                cursor: 'pointer', font: 'inherit', fontSize: 11.5, border: '1px solid',
                borderColor: activeAgent === id ? AGENT_META[id].colorRaw : 'rgba(255,255,255,0.08)',
                color: activeAgent === id ? AGENT_META[id].colorRaw : 'var(--tx-2)',
                background: activeAgent === id ? `color-mix(in srgb, ${AGENT_META[id].colorRaw} 14%, transparent)` : 'rgba(255,255,255,0.05)'
              }}>{AGENT_META[id].name}</button>
          ))}
        </div>
      ) : (
        <span className="ah-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {tr('暂无已配置的 Agent', 'No configured agents yet')}
          <button className="ah-btn sm" onClick={() => openSetup('routing')}>{tr('去设置', 'Set up')}</button>
        </span>
      )}
      <div style={{ width: 1, height: 20, background: 'var(--glass-border)' }}></div>
      {/* 工作区选择器：让 agent 知道当前对话对应的项目（cwd） */}
      <span className="ah-label">{tr('工作区：', 'Workspace:')}</span>
      <select className="ah-select" style={{ minWidth: 140, maxWidth: 220, padding: '4px 8px' }}
        value={workspaceId ?? '__auto__'}
        onChange={e => pickWorkspace(e.target.value === '__auto__' ? null : e.target.value)}
        title={tr('选择工作目录，agent 将在此目录下工作', 'Pick a workspace so the agent runs in your project directory')}>
        <option value="__auto__">{tr('自动（沿用上次）', 'Auto (use last)')}</option>
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      {workspaceId && (() => {
        const w = workspaces.find(x => x.id === workspaceId)
        return w ? <span className="ah-hint" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.rootPath}>{w.rootPath}</span> : null
      })()}
      {!workspaceId && workspaces.length > 0 && (
        <span className="ah-hint">{tr('agent 将在 home 目录运行（无项目上下文）', 'agent runs in your home dir (no project context)')}</span>
      )}
      {workspaces.length === 0 && (
        <button className="ah-btn sm" onClick={() => openSetup('workspaces')}>{tr('新建工作区', 'New workspace')}</button>
      )}
      <div style={{ flex: 1 }}></div>
      {activeAgent && <span className="ah-hint">{tr(`仅派发给 ${AGENT_META[activeAgent].name}`, `Dispatch to ${AGENT_META[activeAgent].name} only`)}</span>}
      {mode === 'chain' && !activeAgent && <span className="ah-hint">{tr('Codex 到 Claude，前者输出作为后者输入', 'Codex to Claude, output of the first feeds the second')}</span>}
      {mode === 'auto' && !activeAgent && routeHint && AGENT_META[routeHint] && (
        <span className="ah-hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon d={IC.bolt} size={12} style={{ color: AGENT_META[routeHint].colorRaw }} />
          {tr(`将路由到 ${AGENT_META[routeHint].name}`, `Routes to ${AGENT_META[routeHint].name}`)}
          {targetItem && targetItem.state !== 'usable' && targetItem.state !== 'busy' && (
            <span style={{ color: 'var(--st-busy)' }}>{tr('需要配置', 'setup needed')}</span>
          )}
        </span>
      )}
    </div>
  )
}

function EmptyChatState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--tx-3)' }}>
      <Icon d={IC.broadcast} size={36} sw={1.2} />
      <div style={{ fontSize: 14 }}>{tr('输入任务开始派发', 'Type a task to dispatch')}</div>
      <div className="ah-hint">{tr(`Agent 回复会按消息顺序显示，思考过程只保留状态动画`, 'Agent replies appear one by one, with thinking shown as status only')}</div>
    </div>
  )
}

function messageAgentReplies(message: ChatMessage): TranscriptReply[] {
  if (message.mode === 'orchestrate') {
    return orchestrationReplies(message.orchestration ?? { phase: 'planning', subtasks: [] })
  }
  return visibleSequentialReplies(message.replies).map(reply => ({
    ...reply,
    text: curateAgentReply(reply.text)
  }))
}

function UserMessageRow({ text, meta }: { text: string; meta: string }) {
  return (
    <div className="ah-chat-row user">
      <div className="ah-chat-user-stack">
        <div className="ah-chat-user-line">
          <div className="ah-chat-bubble user">{text}</div>
          <div className="ah-chat-avatar user">我</div>
        </div>
        <span className="ah-hint">{meta}</span>
      </div>
    </div>
  )
}

function AgentMessageRow({ reply, delay = 0, openSetup }: { reply: TranscriptReply; delay?: number; openSetup: (tab?: SetupTab) => void }) {
  const meta = AGENT_META[reply.agentId]
  const displayText = curateAgentReply(reply.text)
  const steps = reply.steps ?? []
  const hasSteps = steps.length > 0
  const isThinking = !reply.done && !reply.error && !reply.cancelled && !displayText && !hasSteps
  const errorAction = firstRunActionForError(reply.error)

  return (
    <Enter delay={delay} className="ah-chat-row agent">
      <AgentAvatar agentId={reply.agentId} />
      <div className="ah-chat-agent-stack">
        <div className="ah-chat-agent-name">{meta?.name ?? (reply.agentId === 'orchestrate' ? tr('分拣员', 'Curator') : reply.agentId)}</div>
        <div className="ah-chat-bubble agent" style={meta ? { borderColor: `color-mix(in srgb, ${meta.colorRaw} 34%, transparent)` } : undefined}>
          {reply.cancelled ? (
            <span className="ah-chat-muted">{tr('已停止', 'Stopped')}</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: hasSteps && (displayText || reply.error) ? 8 : 0 }}>
              {hasSteps && <ActivityTrail steps={steps} running={!reply.done && !reply.error} />}
              {reply.error ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ color: 'var(--st-error)', fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{reply.error}</span>
                  {errorAction && (
                    <button className="ah-btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={() => openSetup(errorAction.tab)}>
                      {tr(errorAction.labelZh, errorAction.labelEn)}
                    </button>
                  )}
                </div>
              ) : displayText ? (
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {renderRichText(displayText)}
                  {!reply.done && <span className="ah-chat-caret"></span>}
                </div>
              ) : isThinking ? (
                <ThinkingBubble />
              ) : !hasSteps ? (
                <span className="ah-chat-muted">{tr('已完成，没有需要展示的内容', 'Done. Nothing needs attention')}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Enter>
  )
}

function AgentAvatar({ agentId }: { agentId: string }) {
  return AGENT_META[agentId]
    ? <AgentMark id={agentId} size={34} radius={9} />
    : <div className="ah-chat-avatar agent"><Icon d={IC.bolt} size={15} /></div>
}

function ThinkingBubble() {
  return (
    <span className="ah-thinking" aria-label={tr('正在思考', 'Thinking')}>
      <span>{tr('正在思考', 'Thinking')}</span>
      <span className="ah-thinking-dots"><i></i><i></i><i></i></span>
    </span>
  )
}

function renderRichText(text: string): ReactNode {
  const parts = text.split(/```(?:\w+)?\n?/)
  return parts.map((seg, i) => i % 2 === 1
    ? <pre key={i} style={{ background: 'rgba(0,0,0,0.32)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: '9px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, overflowX: 'auto', margin: '6px 0' }}>{seg}</pre>
    : <span key={i}>{seg.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, j) => {
        if (s.startsWith('`')) return <code key={j} style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, background: 'rgba(255,255,255,0.09)', borderRadius: 4, padding: '1px 5px' }}>{s.slice(1, -1)}</code>
        if (s.startsWith('**')) return <strong key={j}>{s.slice(2, -2)}</strong>
        return s
      })}</span>)
}
