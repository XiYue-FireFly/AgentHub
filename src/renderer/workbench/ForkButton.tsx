/**
 * ForkButton: fork conversation from a specific message.
 *
 * When clicked, creates a new conversation branch starting from
 * the selected message, allowing the user to explore alternative paths.
 *
 * Phase 3.1 of AGENTHUB_ITERATION_GOAL.
 */

import React, { useState, useCallback } from 'react'
import { tr } from '../glass/i18n'

interface ForkButtonProps {
  turnId: string
  threadId: string
  messageContent: string
  onFork?: (newThreadId: string) => void
}

export function ForkButton({ turnId, threadId, messageContent, onFork }: ForkButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFork = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Create a new thread forked from this turn
      const result = await window.electronAPI.threads?.fork?.({
        sourceThreadId: threadId,
        sourceTurnId: turnId,
        message: messageContent
      })

      if (result?.id && onFork) {
        onFork(result.id)
      }
    } catch (err: any) {
      setError(err?.message || tr('分叉失败', 'Fork failed'))
    } finally {
      setLoading(false)
    }
  }, [turnId, threadId, messageContent, onFork])

  return (
    <button
      className="ah-btn sm"
      onClick={handleFork}
      disabled={loading}
      title={tr('从这里分叉新对话', 'Fork new conversation from here')}
      style={{ fontSize: 11, padding: '2px 8px' }}
    >
      {loading ? '⏳' : '🔀'} {tr('分叉', 'Fork')}
      {error && <span style={{ color: 'var(--color-error)', marginLeft: 4, fontSize: 10 }}>{error}</span>}
    </button>
  )
}
