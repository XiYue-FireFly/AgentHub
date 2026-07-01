/**
 * SideConversationPanel: Kun-inspired side/branch conversation.
 *
 * Allows creating a side conversation from the current thread,
 * useful for asking follow-up questions without polluting the main thread.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Icon, IC } from '../glass/ui'
import { tr } from '../glass/i18n'

interface SideConversationPanelProps {
  parentThreadId: string | null
  parentTurnId?: string | null
  workspaceId: string | null
  onClose: () => void
  onSendMessage?: (message: string) => void
}

interface SideMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export function SideConversationPanel({
  parentThreadId,
  parentTurnId,
  workspaceId,
  onClose,
  onSendMessage
}: SideConversationPanelProps) {
  const [messages, setMessages] = useState<SideMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const userMessage: SideMessage = {
      id: `side-user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setSending(true)

    try {
      // Use the parent context for the side conversation
      if (onSendMessage) {
        onSendMessage(text)
      } else {
        // Fallback: send as a regular prompt with context
        const contextPrefix = parentTurnId
          ? `[Side conversation from turn ${parentTurnId}]\n`
          : ''
        await window.electronAPI.turns.create({
          threadId: parentThreadId,
          workspaceId: workspaceId ?? null,
          prompt: contextPrefix + text,
          mode: 'auto'
        })
      }

      const assistantMessage: SideMessage = {
        id: `side-assistant-${Date.now()}`,
        role: 'assistant',
        content: tr('已发送到主对话', 'Sent to main conversation'),
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (err: any) {
      const errorMessage: SideMessage = {
        id: `side-error-${Date.now()}`,
        role: 'assistant',
        content: err?.message || tr('发送失败', 'Failed to send'),
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setSending(false)
    }
  }, [input, sending, parentThreadId, parentTurnId, workspaceId, onSendMessage])

  return (
    <div className="wb-side-conversation">
      <div className="wb-timeline-head">
        <div>
          <strong>{tr('旁支对话', 'Side Chat')}</strong>
          <span>{tr('快速提问，不影响主对话', 'Quick questions without polluting main thread')}</span>
        </div>
        <div className="wb-timeline-head-actions">
          <button onClick={onClose} title={tr('关闭', 'Close')}>
            <Icon d={IC.x} size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="wb-side-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="wb-side-empty">
            <Icon d={IC.chat} size={24} />
            <span>{tr('输入问题开始旁支对话', 'Type a question to start a side chat')}</span>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={'wb-side-message wb-side-message-' + msg.role}>
            <div className="wb-side-message-content">{msg.content}</div>
          </div>
        ))}
        {sending && (
          <div className="wb-side-message wb-side-message-assistant">
            <div className="wb-side-message-content wb-side-typing">
              {tr('思考中...', 'Thinking...')}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="wb-side-input">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={tr('输入问题...', 'Type a question...')}
          rows={2}
          disabled={sending}
        />
        <button
          className="ah-btn sm primary"
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? '...' : tr('发送', 'Send')}
        </button>
      </div>
    </div>
  )
}
