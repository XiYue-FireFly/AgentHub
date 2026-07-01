/**
 * SDD Assistant Panel - AI 助手面板
 *
 * 参照 kun 的 SddAssistantPanel 设计
 * 提供 AI 对话、PM 技能框架、消息输入功能
 */

import React, { useState, useRef, useEffect } from 'react'
import { Icon, IC } from '../../glass/ui'
import { tr } from '../../glass/i18n'
import {
  SDD_FRAMEWORK_GROUPS,
  frameworksForStage,
  type SddWorkflowStage,
  type SddPmFramework
} from '../pm-skill-frameworks'

// ============================================================
// Types
// ============================================================

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface SddAssistantPanelProps {
  draftId: string
  workspaceRoot: string
  onSendMessage?: (message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>
  onApplyFramework?: (framework: SddPmFramework) => void
  onClose?: () => void
  initialMessage?: string
}

// ============================================================
// Framework Icons
// ============================================================

type AssistantIconName =
  | 'question'
  | 'lightbulb'
  | 'search'
  | 'users'
  | 'tree'
  | 'inbox'
  | 'checks'
  | 'layout'
  | 'quote'
  | 'file'
  | 'spell'
  | 'shield'
  | 'sliders'
  | 'warning'
  | 'flask'
  | 'sparkles'
  | 'send'

const FRAMEWORK_ICONS: Record<string, AssistantIconName> = {
  clarify: 'lightbulb',
  research: 'search',
  'brainstorm-ideas': 'users',
  'opportunity-tree': 'tree',
  'triage-requests': 'inbox',
  structure: 'checks',
  wwa: 'layout',
  'job-stories': 'quote',
  prd: 'file',
  polish: 'spell',
  assumptions: 'shield',
  'prioritize-assumptions': 'sliders',
  'pre-mortem': 'warning',
  experiments: 'flask'
}

const STAGE_COLORS: Record<SddWorkflowStage, string> = {
  discover: 'sdd-stage-discover',
  structure: 'sdd-stage-structure',
  risk: 'sdd-stage-risk'
}

const ICON_PATHS: Record<AssistantIconName, string[]> = {
  question: ['M9 9a3 3 0 1 1 5.1 2.1c-.9.8-2.1 1.2-2.1 2.9', 'M12 17h.01', 'M6 3h9l3 3v15H6z'],
  lightbulb: ['M9 18h6', 'M10 22h4', 'M8.5 14.5a5 5 0 1 1 7 0c-.8.8-1.5 1.9-1.5 3.5h-4c0-1.6-.7-2.7-1.5-3.5z'],
  search: ['M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z', 'M21 21l-4.3-4.3'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  tree: ['M12 3v5', 'M6 13h12', 'M6 13v5', 'M18 13v5', 'M12 8v5', 'M4 18h4v3H4z', 'M10 18h4v3h-4z', 'M16 18h4v3h-4z'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z'],
  checks: ['M4 7l2 2 4-4', 'M4 17l2 2 4-4', 'M13 6h7', 'M13 16h7'],
  layout: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  quote: ['M8 11H5a4 4 0 0 1 4-4v2a2 2 0 0 0-2 2h2v6H5v-6', 'M18 11h-3a4 4 0 0 1 4-4v2a2 2 0 0 0-2 2h2v6h-4v-6'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6'],
  spell: ['M5 20l6-16 6 16', 'M8 14h6', 'M18 5l2 2 3-4'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M12 8v5', 'M12 16h.01'],
  sliders: ['M4 6h10', 'M18 6h2', 'M14 4v4', 'M4 12h2', 'M10 12h10', 'M8 10v4', 'M4 18h12', 'M20 18h0', 'M16 16v4'],
  warning: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  flask: ['M9 2h6', 'M10 2v6l-5.5 9.5A3 3 0 0 0 7.1 22h9.8a3 3 0 0 0 2.6-4.5L14 8V2', 'M8 16h8'],
  sparkles: ['M12 3l1.6 4.8L18 10l-4.4 2.2L12 17l-1.6-4.8L6 10l4.4-2.2z', 'M20 3v4', 'M22 5h-4', 'M4 17v3', 'M5.5 18.5h-3'],
  send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z']
}

function AssistantIcon({ name, size = 18 }: { name: AssistantIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}

// ============================================================
// Component
// ============================================================

export function SddAssistantPanel({
  draftId: _draftId,
  workspaceRoot,
  onSendMessage,
  onApplyFramework,
  onClose,
  initialMessage
}: SddAssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const msgIdCounter = useRef(0)
  const initialMessageSent = useRef(false)

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-send initial message (e.g. for plan generation mode)
  useEffect(() => {
    if (!initialMessage || initialMessageSent.current || !onSendMessage) return
    initialMessageSent.current = true
    setInput(initialMessage)
    // 使用 setTimeout 确保 state 已更新后再触发发送
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-${++msgIdCounter.current}`,
        role: 'user',
        content: initialMessage,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, userMessage])
      setInput('')
      setBusy(true)
      onSendMessage(initialMessage, [])
        .then(response => {
          if (cancelled) return
          const assistantMessage: ChatMessage = {
            id: `msg-${Date.now()}-${++msgIdCounter.current}`,
            role: 'assistant',
            content: response,
            timestamp: new Date().toISOString()
          }
          setMessages(prev => [...prev, assistantMessage])
        })
        .catch(error => {
          if (cancelled) return
          const errorMessage: ChatMessage = {
            id: `msg-${Date.now()}-${++msgIdCounter.current}`,
            role: 'assistant',
            content: `Error: ${error?.message || String(error)}`,
            timestamp: new Date().toISOString()
          }
          setMessages(prev => [...prev, errorMessage])
        })
        .finally(() => { if (!cancelled) setBusy(false) })
    }, 0)
    // 清理 timer 和标记，防止组件卸载后更新状态
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [initialMessage, onSendMessage])

  // Send message
  const handleSend = async () => {
    if (!input.trim() || busy || !onSendMessage) return

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${++msgIdCounter.current}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setBusy(true)

    try {
      // 传递对话历史给 AI，支持多轮对话上下文
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const response = await onSendMessage(userMessage.content, history)
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-${++msgIdCounter.current}`,
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error: any) {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-${++msgIdCounter.current}`,
        role: 'assistant',
        content: `Error: ${error?.message || String(error)}`,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setBusy(false)
    }
  }

  // Apply framework
  const handleApplyFramework = (framework: SddPmFramework) => {
    if (onApplyFramework) {
      onApplyFramework(framework)
    } else {
      // 默认行为：将框架 prompt 作为用户消息发送
      setInput(framework.prompt)
    }
  }

  // Format timestamp
  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const hasMessages = messages.length > 0

  return (
    <aside className="sdd-assistant-panel">
      <div className="sdd-assistant-header">
        <div className="sdd-assistant-header-content">
          {onClose && (
            <button className="sdd-assistant-close" onClick={onClose} title={tr('关闭', 'Close')}>
              <Icon d={IC.x} size={16} />
            </button>
          )}
          <div className="sdd-assistant-title">
            <span className="sdd-assistant-sparkle"><AssistantIcon name="sparkles" size={17} /></span>
            <span>{tr('需求 AI', 'Requirements AI')}</span>
          </div>
        </div>
        <div className="sdd-assistant-path">
          {workspaceRoot}
        </div>
      </div>

      <div className="sdd-assistant-body">
        {hasMessages ? (
          <div className="sdd-assistant-timeline">
            {messages.map((msg) => (
              <div key={msg.id} className={`sdd-message sdd-message-${msg.role}`}>
                <div className="sdd-message-header">
                  <span className="sdd-message-role">
                    {msg.role === 'user' ? '👤' : '✨'}
                    {msg.role === 'user' ? tr('用户', 'User') : tr('AI 助手', 'AI Assistant')}
                  </span>
                  <span className="sdd-message-time">{formatTime(msg.timestamp)}</span>
                </div>
                <div className="sdd-message-content">
                  {msg.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="sdd-message sdd-message-assistant">
                <div className="sdd-message-header">
                  <span className="sdd-message-role">✨ {tr('AI 助手', 'AI Assistant')}</span>
                </div>
                <div className="sdd-message-content sdd-message-loading">
                  {tr('思考中...', 'Thinking...')}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="sdd-assistant-empty">
            <div className="sdd-assistant-empty-card">
              <div className="sdd-assistant-empty-icon">
                <AssistantIcon name="question" size={22} />
              </div>
              <h3>{tr('一起把需求问清楚', 'Let’s clarify the requirement')}</h3>
              <p>{tr('可以让 AI 帮你调研、补问题、整理边界，然后再进入计划。', 'AI can research, ask missing questions, organize boundaries, then move into planning.')}</p>
            </div>

            <div className="sdd-assistant-frameworks">
              {SDD_FRAMEWORK_GROUPS.map((group) => {
                const frameworks = frameworksForStage(group.stage)
                if (frameworks.length === 0) return null
                return (
                  <div key={group.stage} className="sdd-framework-group">
                    <span className="sdd-framework-group-title">
                      {group.title}
                    </span>
                    <span className="sdd-framework-group-desc">
                      {group.description}
                    </span>
                    <div className="sdd-framework-items">
                      {frameworks.map((framework) => (
                        <button
                          key={framework.id}
                          className={`sdd-framework-item ${STAGE_COLORS[framework.stage]}`}
                          onClick={() => handleApplyFramework(framework)}
                        >
                          <span className="sdd-framework-icon">
                            <AssistantIcon name={FRAMEWORK_ICONS[framework.id] || 'sparkles'} size={18} />
                          </span>
                          <span className="sdd-framework-copy">
                            <span className="sdd-framework-name">
                              {framework.name}
                            </span>
                            <span className="sdd-framework-subtitle">
                              {framework.subtitle}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="sdd-assistant-composer">
        <div className="sdd-composer-input-wrapper">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr('向智能体提问...', 'Ask the assistant...')}
            rows={3}
            disabled={busy}
            className="sdd-composer-textarea"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
        </div>
        <div className="sdd-composer-footer">
          <div className="sdd-composer-hints">
            <span className="sdd-composer-hint">{tr('Enter 发送', 'Enter to send')}</span>
            <span className="sdd-composer-hint">{tr('Shift+Enter 换行', 'Shift+Enter for newline')}</span>
          </div>
          <button
            className="sdd-composer-send"
            onClick={handleSend}
            disabled={busy || !input.trim()}
          >
            {busy ? (
              <span className="sdd-composer-send-loading">{tr('发送中...', 'Sending...')}</span>
            ) : (
              <>
                <AssistantIcon name="send" size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  )
}
