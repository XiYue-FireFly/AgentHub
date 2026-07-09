import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IC, AgentMark } from '../glass/ui'
import { tr } from '../glass/i18n'
import type { AgentUIStatus } from '../glass/meta'
import { WorkspaceItem, AgentMap } from './types'
import { renderMarkdown } from './markdown-renderer'
import { sanitizeHtml } from '../lib/sanitize'
import { localAgentLabel, localAgentOptions } from './localAgentOptions'

type WriteViewMode = 'source' | 'preview' | 'split'
type WriteAction = 'polish' | 'outline' | 'summarize' | 'continue'

export function WriteWorkspace({
  workspace,
  hasWorkspace,
  targetAgent,
  setTargetAgent,
  agents,
  localAgents,
  sending,
  onSend,
  onCancel,
  onCreateProject,
  openChat,
  turns,
  events
}: {
  workspace: WorkspaceItem | null
  hasWorkspace: boolean
  targetAgent: string | null
  setTargetAgent: (agentId: string | null) => void
  agents: AgentMap
  localAgents: LocalAgentStatus[]
  sending: boolean
  onSend: (prompt: string) => void
  onCancel: () => void
  onCreateProject: () => void
  openChat: () => void
  thread: WorkbenchThread | null
  turns: WorkbenchTurn[]
  events: RuntimeEvent[]
}) {
  const storageKey = `agenthub.writeDraft.${workspace?.id || 'global'}`
  const [title, setTitle] = useState(() => tr('未命名文稿', 'Untitled draft'))
  const [content, setContent] = useState('')
  const [instruction, setInstruction] = useState('')
  const [viewMode, setViewMode] = useState<WriteViewMode>('split')
  const [notice, setNotice] = useState<string | null>(null)
  void hasWorkspace
  void onCreateProject

  // F-N7: avoid StrictMode remount wiping drafts with empty initial state
  const dirtyRef = useRef(false)
  const hydratedKeyRef = useRef<string | null>(null)
  const titleRef = useRef(title)
  const contentRef = useRef(content)
  titleRef.current = title
  contentRef.current = content

  useEffect(() => {
    dirtyRef.current = false
    hydratedKeyRef.current = null
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw)
        const nextTitle = saved.title || tr('未命名文稿', 'Untitled draft')
        const nextContent = saved.content || ''
        setTitle(nextTitle)
        setContent(nextContent)
        titleRef.current = nextTitle
        contentRef.current = nextContent
      } else {
        const nextTitle = tr('未命名文稿', 'Untitled draft')
        setTitle(nextTitle)
        setContent('')
        titleRef.current = nextTitle
        contentRef.current = ''
      }
    } catch {
      const nextTitle = tr('未命名文稿', 'Untitled draft')
      setTitle(nextTitle)
      setContent('')
      titleRef.current = nextTitle
      contentRef.current = ''
    } finally {
      hydratedKeyRef.current = storageKey
    }
  }, [storageKey])

  const updateTitle = (value: string) => {
    dirtyRef.current = true
    setTitle(value)
  }
  const updateContent = (value: string) => {
    dirtyRef.current = true
    setContent(value)
  }

  useEffect(() => {
    let innerTimer: number | undefined
    const keyAtStart = storageKey
    const timer = window.setTimeout(() => {
      if (hydratedKeyRef.current !== keyAtStart || !dirtyRef.current) return
      try {
        localStorage.setItem(keyAtStart, JSON.stringify({
          title: titleRef.current,
          content: contentRef.current,
          updatedAt: Date.now()
        }))
      } catch { /* noop */ }
      setNotice(tr('已自动保存本地草稿', 'Local draft saved'))
      // P2-9: Track inner timer so it's cleaned up if the effect re-runs.
      innerTimer = window.setTimeout(() => setNotice(null), 1400)
    }, 450)
    return () => {
      window.clearTimeout(timer)
      if (innerTimer !== undefined) window.clearTimeout(innerTimer)
      // Only flush user edits after hydrate — never wipe with empty mount state
      if (hydratedKeyRef.current !== keyAtStart || !dirtyRef.current) return
      try {
        localStorage.setItem(keyAtStart, JSON.stringify({
          title: titleRef.current,
          content: contentRef.current,
          updatedAt: Date.now()
        }))
      } catch { /* noop */ }
    }
  }, [content, storageKey, title])

  const stats = useMemo(() => documentStats(content), [content])
  const assistantEvents = useMemo(() => latestAssistantItems(events), [events])
  const usableAgentIds = useMemo(() => localAgentOptions(localAgents), [localAgents])
  const usableAgentSignature = usableAgentIds.join('|')
  const selectedTargetAgent = targetAgent && usableAgentIds.includes(targetAgent) ? targetAgent : null
  const visibleAgentIds = useMemo(() => {
    return selectedTargetAgent
      ? [selectedTargetAgent, ...usableAgentIds.filter(id => id !== selectedTargetAgent)].slice(0, 3)
      : usableAgentIds.slice(0, 3)
  }, [selectedTargetAgent, usableAgentSignature])
  const readyAgents = usableAgentIds.length

  useEffect(() => {
    if (targetAgent && !usableAgentIds.includes(targetAgent)) setTargetAgent(null)
  }, [targetAgent, setTargetAgent, usableAgentSignature])

  const sendWriteAction = (action: WriteAction) => {
    if (sending) return
    const prompt = buildWritePrompt(action, title, content, instruction)
    setInstruction('')
    onSend(prompt)
  }

  const sendCustomInstruction = () => {
    if (!instruction.trim()) return
    sendWriteAction('polish')
  }

  return (
    <section className="wb-write">
      <header className="wb-write-head">
        <div className="wb-write-title-block">
          <input
            value={title}
            onChange={event => updateTitle(event.target.value)}
            aria-label={tr('文稿标题', 'Draft title')}
          />
          <span title={workspace?.rootPath}>
            <Icon d={IC.folder} size={13} />
            {workspace?.name || tr('全局写作空间', 'Global writing')}
          </span>
        </div>
        <div className="wb-write-actions">
          <button className={viewMode === 'source' ? 'active' : ''} onClick={() => setViewMode('source')} title={tr('源码', 'Source')}>
            <Icon d={IC.terminal} size={14} />
          </button>
          <button className={viewMode === 'split' ? 'active' : ''} onClick={() => setViewMode('split')} title={tr('分屏', 'Split')}>
            <Icon d={IC.tasks} size={14} />
          </button>
          <button className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')} title={tr('预览', 'Preview')}>
            <Icon d={IC.search} size={14} />
          </button>
          <button onClick={openChat} title={tr('回到会话', 'Back to chat')}>
            <Icon d={IC.chat} size={14} />
          </button>
        </div>
      </header>

      {!content.trim() && (
        <div className="wb-write-start">
          <div>
            <strong>{tr('开始写作', 'Start writing')}</strong>
            <p>{tr('在左侧写草稿，右侧选择 Agent 做提纲、润色、总结或续写。', 'Write in the editor, then ask an agent to outline, polish, summarize, or continue.')}</p>
          </div>
          <button onClick={() => {
            updateTitle(tr('新文稿', 'New draft'))
            updateContent('# ' + tr('新文稿', 'New draft') + '\n\n')
          }}>
            <Icon d={IC.plus} size={14} />
            {tr('新建草稿', 'New draft')}
          </button>
        </div>
      )}

      <div className="wb-write-body">
        <main className={'wb-write-editor-grid ' + viewMode}>
          {viewMode !== 'preview' && (
            <textarea
              className="wb-write-editor"
              value={content}
              onChange={event => updateContent(event.target.value)}
              placeholder={tr('写下你想处理的内容', 'Write what you want to handle')}
              spellCheck
            />
          )}
          {viewMode !== 'source' && (
            <article className="wb-write-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(content)) }} />
          )}
        </main>

        <aside className="wb-write-assistant">
          <div className="wb-write-assistant-card">
            <div className="wb-write-card-head">
              <strong>{tr('写作助手', 'Writing assistant')}</strong>
              {readyAgents > 0 && <span>{readyAgents} {tr('个本地 Agent 可用', 'local agents ready')}</span>}
            </div>
            <select value={selectedTargetAgent ?? '__auto__'} onChange={event => setTargetAgent(event.target.value === '__auto__' ? null : event.target.value)}>
              <option value="__auto__">{tr('按模式调度', 'Use schedule')}</option>
              {usableAgentIds.map(agentId => (
                <option key={agentId} value={agentId}>{agentName(agentId)} · {statusText(agents[agentId]?.status)}</option>
              ))}
            </select>
            <div className="wb-write-agent-row">
              {visibleAgentIds.map(agentId => (
                <button
                  key={agentId}
                  className={selectedTargetAgent === agentId ? 'active' : ''}
                  onClick={() => setTargetAgent(selectedTargetAgent === agentId ? null : agentId)}
                  title={tr(`直连 ${agentName(agentId)}`, `Direct ${agentName(agentId)}`)}
                >
                  <AgentMark id={agentId} size={22} radius={6} />
                  <span>{agentName(agentId)}</span>
                </button>
              ))}
              {usableAgentIds.length > visibleAgentIds.length && (
                <select value="__more__" onChange={event => {
                  if (event.target.value !== '__more__') setTargetAgent(event.target.value)
                }}>
                  <option value="__more__">{tr('更多 Agent', 'More agents')}</option>
                  {usableAgentIds.filter(id => !visibleAgentIds.includes(id)).map(agentId => (
                    <option key={agentId} value={agentId}>{agentName(agentId)}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="wb-write-assistant-card">
            <div className="wb-write-card-head">
              <strong>{tr('快速动作', 'Quick actions')}</strong>
              <span>{stats.words} {tr('词', 'words')} / {stats.chars} {tr('字', 'chars')}</span>
            </div>
            <div className="wb-write-action-grid">
              <button onClick={() => sendWriteAction('polish')} disabled={sending || !content.trim()}>{tr('润色', 'Polish')}</button>
              <button onClick={() => sendWriteAction('outline')} disabled={sending || !content.trim()}>{tr('提纲', 'Outline')}</button>
              <button onClick={() => sendWriteAction('summarize')} disabled={sending || !content.trim()}>{tr('总结', 'Summarize')}</button>
              <button onClick={() => sendWriteAction('continue')} disabled={sending || !content.trim()}>{tr('续写', 'Continue')}</button>
            </div>
          </div>

          <div className="wb-write-assistant-card">
            <label>{tr('给 Agent 的具体要求', 'Instruction for agent')}</label>
            <textarea
              value={instruction}
              onChange={event => setInstruction(event.target.value)}
              placeholder={tr('告诉 Agent 你的写作目标、语气或改写要求', 'Tell the agent your goal, tone, or rewrite request')}
            />
            <div className="wb-write-send-row">
              {sending
                ? <button className="stop" onClick={onCancel}><Icon d={IC.stop} size={14} /> {tr('停止', 'Stop')}</button>
                : <button className="primary" onClick={sendCustomInstruction} disabled={!instruction.trim() || !content.trim()}>
                    <Icon d={IC.send} size={14} /> {tr('发送给 Agent', 'Send to agent')}
                  </button>}
            </div>
          </div>

          <div className="wb-write-assistant-card wb-write-history">
            <div className="wb-write-card-head">
              <strong>{tr('最近建议', 'Recent suggestions')}</strong>
              <span>{turns.length} {tr('轮', 'turns')}</span>
            </div>
            {assistantEvents.length === 0 && <div className="wb-muted-box">{tr('Agent 的写作建议会显示在这里。', 'Agent writing suggestions will appear here.')}</div>}
            {assistantEvents.map(item => (
              <div key={item.id} className={'wb-write-suggestion ' + item.tone}>
                <strong>{agentName(item.agentId)}</strong>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <footer className="wb-write-status">
        <span>{notice || tr('本地草稿会自动保存到当前浏览器存储。', 'Local draft autosaves to browser storage.')}</span>
        <span>{stats.lines} {tr('行', 'lines')}</span>
      </footer>
    </section>
  )
}

function buildWritePrompt(action: WriteAction, title: string, content: string, instruction: string): string {
  const actionLine = {
    polish: tr('请润色下面的文稿。', 'Please polish the draft below.'),
    outline: tr('请为下面的文稿整理结构化提纲，并指出缺口。', 'Please create a structured outline and identify gaps.'),
    summarize: tr('请总结下面文稿的核心观点和可改进点。', 'Please summarize the draft and suggest improvements.'),
    continue: tr('请延续下面文稿继续写作，保持语气和结构一致。', 'Please continue the draft with the same tone and structure.')
  }[action]
  return [
    '[AgentHub Write]',
    actionLine,
    instruction.trim() ? `${tr('额外要求', 'Extra instruction')}: ${instruction.trim()}` : '',
    `${tr('标题', 'Title')}: ${title.trim() || tr('未命名文稿', 'Untitled draft')}`,
    '',
    '---',
    content.trim()
  ].filter(Boolean).join('\n')
}

function latestAssistantItems(events: RuntimeEvent[]): Array<{ id: string; agentId: string; text: string; tone: 'ok' | 'error' }> {
  return [...events]
    .filter(event => event.kind === 'agent:done' || event.kind === 'agent:error' || event.payload?.kind === 'orchestrate:final' || event.payload?.kind === 'orchestrate:error')
    .slice(-5)
    .reverse()
    .map(event => ({
      id: event.id,
      agentId: event.agentId || 'orchestrate',
      text: short(event.payload?.content || event.payload?.error || ''),
      tone: event.kind === 'agent:error' || event.payload?.kind === 'orchestrate:error' ? 'error' : 'ok'
    }))
}

function documentStats(content: string): { chars: number; words: number; lines: number } {
  const trimmed = content.trim()
  const latinWords = trimmed.match(/[A-Za-z0-9_'-]+/g)?.length || 0
  const cjkChars = trimmed.match(/[\u3400-\u9fff]/g)?.length || 0
  return {
    chars: trimmed.length,
    words: latinWords + cjkChars,
    lines: content ? content.split(/\r?\n/).length : 0
  }
}

function agentName(agentId: string): string {
  if (agentId === 'orchestrate') return tr('编排器', 'Orchestrator')
  return localAgentLabel(agentId)
}

function statusText(status?: AgentUIStatus): string {
  if (status === 'busy') return tr('运行中', 'running')
  if (status === 'error') return tr('异常', 'error')
  if (status === 'off') return tr('未启用', 'off')
  return tr('可用', 'ready')
}

function short(value: string, max = 420): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
