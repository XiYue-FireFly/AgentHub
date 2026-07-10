/**
 * PromptEnhancer: compact "Optimize prompt" button for Composer.
 */

import React, { useCallback, useState } from 'react'
import { tr } from '../glass/i18n'

interface PromptEnhancerProps {
  text: string
  onEnhanced: (enhanced: string) => void
  disabled?: boolean
}

export function PromptEnhancer({ text, onEnhanced, disabled }: PromptEnhancerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enhance = useCallback(async () => {
    if (!text.trim() || loading) return
    setLoading(true)
    setError(null)

    try {
      const metaPrompt = `You are a prompt engineering assistant. Your task is to improve the following user prompt to be clearer, more specific, and more likely to get a good response from an AI coding assistant.

Rules:
- Keep the original intent and meaning
- Add specificity where the prompt is vague
- Structure complex requests into numbered steps
- Add relevant context cues (file paths, language, framework) when obvious
- Keep it concise; do not add unnecessary preamble
- Output ONLY the improved prompt, nothing else

Original prompt:
${text.trim()}

Improved prompt:`

      const result = await window.electronAPI.ai.quickComplete({
        prompt: metaPrompt,
        systemPrompt: 'You are a prompt engineering assistant. Output ONLY the improved prompt.',
        timeoutMs: 30_000
      })

      if (!result?.content) {
        setError(tr('AI 未能返回结果，请重试', 'AI returned no result, please retry'))
        return
      }

      let enhanced = result.content.trim()
      if (enhanced.startsWith('```') && enhanced.endsWith('```')) {
        enhanced = enhanced.split('\n').slice(1, -1).join('\n').trim()
      }

      onEnhanced(enhanced)
    } catch (err: any) {
      setError(err?.message || tr('优化失败', 'Enhancement failed'))
    } finally {
      setLoading(false)
    }
  }, [text, loading, onEnhanced])

  if (!text.trim()) return null

  return (
    <span className="wb-prompt-enhancer">
      <button
        className="wb-prompt-enhancer-button"
        onClick={enhance}
        disabled={disabled || loading || !text.trim()}
        title={tr('用 AI 优化提示词', 'Optimize prompt with AI')}
      >
        <span aria-hidden="true">{loading ? '...' : '*'}</span>
        {tr('优化', 'Enhance')}
      </button>
      {error && <span className="wb-prompt-enhancer-error">{error}</span>}
    </span>
  )
}
