/**
 * PromptEnhancer: "Optimize prompt" button for Composer.
 *
 * When clicked, takes the current user input and sends it to the AI model
 * for rewriting/improvement. Returns the enhanced prompt.
 *
 * Phase 3.4 of AGENTHUB_ITERATION_GOAL.
 */

import React, { useState, useCallback } from 'react'

interface PromptEnhancerProps {
  text: string
  onEnhanced: (enhanced: string) => void
  disabled?: boolean
}

function tr(zh: string, en: string): string {
  const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh' : 'en'
  return lang === 'zh' ? zh : en
}

export function PromptEnhancer({ text, onEnhanced, disabled }: PromptEnhancerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enhance = useCallback(async () => {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)

    try {
      // Build a meta-prompt that asks the AI to improve the user's input
      const metaPrompt = `You are a prompt engineering assistant. Your task is to improve the following user prompt to be clearer, more specific, and more likely to get a good response from an AI coding assistant.

Rules:
- Keep the original intent and meaning
- Add specificity where the prompt is vague
- Structure complex requests into numbered steps
- Add relevant context cues (file paths, language, framework) when obvious
- Keep it concise — don't add unnecessary preamble
- Output ONLY the improved prompt, nothing else

Original prompt:
${text.trim()}

Improved prompt:`

      // TODO: Send metaPrompt to the AI model via the provider system
      // For now, return the original text with a note
      const enhanced = `[Enhanced] ${text.trim()}`

      onEnhanced(enhanced)
    } catch (err: any) {
      setError(err?.message || tr('优化失败', 'Enhancement failed'))
    } finally {
      setLoading(false)
    }
  }, [text, loading, onEnhanced])

  if (!text.trim()) return null

  return (
    <button
      className="ah-btn sm"
      onClick={enhance}
      disabled={disabled || loading || !text.trim()}
      title={tr('用 AI 优化提示词', 'Optimize prompt with AI')}
      style={{ fontSize: 11, padding: '2px 8px' }}
    >
      {loading ? '⏳' : '✨'} {tr('优化', 'Enhance')}
      {error && <span style={{ color: 'var(--color-error)', marginLeft: 4, fontSize: 10 }}>{error}</span>}
    </button>
  )
}
