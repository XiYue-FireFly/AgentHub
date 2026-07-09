/**
 * SideConversationPanel: true side-thread conversation (F-W1).
 * Creates a dedicated child thread instead of writing into the parent thread.
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
  /** Optional: parent can navigate to the side thread after creation */
  onOpenSideThread?: (threadId: string) => void
}

interface SideMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export function SideConversationPanel({
  parentThreadId,
  parentTurnId,
  workspaceId,
  onClose,
  onSendMessage,
  onOpenSideThread
}: SideConversationPanelProps) {
  const [messages, setMessages] = useState<SideMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sideThreadId, setSideThreadId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Reset side thread when parent context changes
  useEffect(() => {
    setSideThreadId(null)
    setMessages([])
  }, [parentThreadId, workspaceId])

  const ensureSideThread = useCallback(async (): Promise<string | null> => {
    if (sideThreadId) return sideThreadId
    const title = parentThreadId
      ? tr(`旁支 · ${parentThreadId.slice(0, 8)}`, `Side · ${parentThreadId.slice(0, 8)}`)
      : tr('旁支对话', 'Side chat')
    const thread = await window.electronAPI.threads.create({
      workspaceId: workspaceId ?? null,
      title
    })
    const id = thread?.id || null
    if (id && aliveRef.current) {
      setSideThreadId(id)
      onOpenSideThread?.(id)
    }
    return id
  }, [sideThreadId, workspaceId, parentThreadId, onOpenSideThread])

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
      if (onSendMessage) {
        onSendMessage(text)
        if (!aliveRef.current) return
        setMessages(prev => [...prev, {
          id: `side-assistant-${Date.now()}`,
          role: 'assistant',
          content: tr('已通过自定义通道发送', 'Sent via custom channel'),
          timestamp: Date.now()
        }])
        return
      }

      // F-W1: always use a dedicated side thread — never parentThreadId
      const threadId = await ensureSideThread()
      if (!threadId) throw new Error(tr('无法创建旁支会话', 'Failed to create side thread'))

      const contextPrefix = parentTurnId
        ? `[Side of turn ${parentTurnId} | parent ${parentThreadId || '-'}]\n`
        : parentThreadId
          ? `[Side of thread ${parentThreadId}]\n`
          : ''

      await window.electronAPI.turns.create({
        threadId,
        workspaceId: workspaceId ?? null,
        prompt: contextPrefix + text,
        mode: 'auto'
      })

      if (!aliveRef.current) return
      setMessages(prev => [...prev, {
        id: `side-assistant-${Date.now()}`,
        role: 'assistant',
        content: tr(
          `已发送到旁支会话（${threadId.slice(0, 8)}…），不会写入主对话。`,
          `Sent to side thread (${threadId.slice(0, 8)}…); main chat untouched.`
        ),
        timestamp: Date.now()
      }])
    } catch (err: any) {
      if (!aliveRef.current) return
      setMessages(prev => [...prev, {
        id: `side-error-${Date.now()}`,
        role: 'system',
        content: err?.message || tr('发送失败', 'Failed to send'),
        timestamp: Date.now()
      }])
    } finally {
      if (aliveRef.current) setSending(false)
    }
  }, [input, sending, parentThreadId, parentTurnId, workspaceId, onSendMessage, ensureSideThread])

  return (
    <div className="wb-side-conversation">
      <div className="wb-timeline-head">
        <div>
          <strong>{tr('旁支对话', 'Side Chat')}</strong>
          <span>
            {sideThreadId
              ? tr(`独立会话 ${sideThreadId.slice(0, 8)}…`, `Thread ${sideThreadId.slice(0, 8)}…`)
              : tr('快速提问，独立线程，不影响主对话', 'Quick questions on a dedicated thread')}
          </span>
        </div>
        <div className="wb-timeline-head-actions">
          <button onClick={onClose} title={tr('关闭', 'Close')}>
            <Icon d={IC.x} size={14} />
          </button>
        </div>
      </div>

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
            <div className="wb-side-message-content">{tr('思考中…', 'Thinking…')}</div>
          </div>
        )}
      </div>

      <div className="wb-side-input">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          placeholder={tr('输入旁支问题…', 'Side question…')}
          rows={2}
          disabled={sending}
        />
        <button
          className="wb-send"
          disabled={sending || !input.trim()}
          onClick={() => void handleSend()}
          title={tr('发送', 'Send')}
        >
          <Icon d={IC.send} size={14} />
        </button>
      </div>
    </div>
  )
}
