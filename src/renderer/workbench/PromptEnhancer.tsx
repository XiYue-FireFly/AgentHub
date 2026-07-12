/**
 * PromptEnhancer: compact "Optimize prompt" button for Composer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { tr } from '../glass/i18n'
import { draftDecisionItem, type DraftDecisionItem } from './decisions/decisionAdapters'

interface PromptEnhancerProps {
  text: string
  threadId: string
  draftRevision: number
  draftHash: string
  onDraftDecision: (decision: DraftDecisionItem) => void
  disabled?: boolean
}

export function PromptEnhancer({ text, threadId, draftRevision, draftHash, onDraftDecision, disabled }: PromptEnhancerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestDraftRef = useRef({ text, threadId, draftRevision, draftHash })
  const mountedRef = useRef(true)
  const requestGenerationRef = useRef(0)
  latestDraftRef.current = { text, threadId, draftRevision, draftHash }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    requestGenerationRef.current += 1
    setLoading(false)
    setError(null)
  }, [draftHash, draftRevision, text, threadId])

  const enhance = useCallback(async () => {
    if (!text.trim() || loading) return
    const requestGeneration = ++requestGenerationRef.current
    const draftAtRequest = { text, threadId, draftRevision, draftHash }
    const isCurrentRequest = () => {
      const latestDraft = latestDraftRef.current
      return (
        mountedRef.current
        && requestGenerationRef.current === requestGeneration
        && latestDraft.text === draftAtRequest.text
        && latestDraft.threadId === draftAtRequest.threadId
        && latestDraft.draftRevision === draftAtRequest.draftRevision
        && latestDraft.draftHash === draftAtRequest.draftHash
      )
    }
    setLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.ai.promptCandidates({
        origin: 'quick-complete:prompt-enhancer',
        prompt: text,
        draftHash
      })
      const candidates = Array.isArray(result?.candidates)
        ? result.candidates.map(candidate => typeof candidate === 'string' ? candidate.trim() : '')
        : []
      if (result?.draftHash !== draftAtRequest.draftHash) return
      if (result?.error || candidates.length < 2 || candidates.length > 3 || candidates.some(candidate => !candidate)) {
        if (isCurrentRequest()) {
          setError(result?.error || tr('AI 未能返回有效候选提示词，请重试', 'AI returned no valid prompt candidates, please retry'))
        }
        return
      }
      if (!isCurrentRequest()) return

      const id = `prompt-optimizer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      onDraftDecision(draftDecisionItem({
        id,
        threadId,
        createdAt: Date.now(),
        request: {
          schemaVersion: 1,
          id,
          source: 'prompt-optimizer',
          kind: 'single-select',
          title: tr('选择提示词版本？', 'Choose a prompt version?'),
          description: tr('选择保留当前内容、使用候选提示词，或输入自己的版本。', 'Keep the current draft, choose a candidate, or enter your own text.'),
          options: [
            { id: 'keep-original', label: tr('保留原文', 'Keep original') },
            ...candidates.map((candidate, index) => ({
              id: `candidate-${index + 1}`,
              label: tr(`候选 ${index + 1}`, `Candidate ${index + 1}`),
              preview: candidate
            })),
            { id: 'use-custom', label: tr('使用自定义文本', 'Use custom text') }
          ],
          minSelections: 1,
          maxSelections: 1,
          allowCustom: true,
          customInput: {
            placeholder: tr('输入自定义提示词', 'Enter custom prompt text'),
            maxChars: 512 * 1024
          },
          allowRemember: false,
          createdAt: Date.now()
        },
        draftRevision,
        draftHash,
        valuesByOptionId: {
          'keep-original': text,
          ...Object.fromEntries(candidates.map((candidate, index) => [`candidate-${index + 1}`, candidate]))
        }
      }))
    } catch (err: any) {
      if (isCurrentRequest()) {
        setError(err?.message || tr('优化失败', 'Enhancement failed'))
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }, [draftHash, draftRevision, loading, onDraftDecision, text, threadId])

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
