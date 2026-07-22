import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { DecisionSubmission } from '../../../shared/decision-contract'
import { tr } from '../../glass/i18n'
import type { DecisionItem } from './decisionAdapters'

export type DecisionBarSubmitResult = boolean | { accepted: boolean; warning?: 'remember_failed' } | void

export interface DecisionBarProps {
  item: DecisionItem
  position: number
  count: number
  onSubmit: (submission: DecisionSubmission) => Promise<DecisionBarSubmitResult> | DecisionBarSubmitResult
}

function accepted(result: DecisionBarSubmitResult): boolean {
  return result === true || (typeof result === 'object' && result !== null && result.accepted === true)
}

function needsDelayedAnnouncement(item: DecisionItem): boolean {
  return item.origin === 'runtime' && ['tool', 'guard', 'acp'].includes(item.request.source)
}

function primaryLabel(item: DecisionItem): string {
  if (item.request.kind === 'confirm') return tr('确认', 'Confirm')
  if (item.request.kind === 'text') return tr('提交', 'Submit')
  return tr('继续', 'Continue')
}

function isPromptOptimizationDecision(item: DecisionItem): boolean {
  return item.request.source === 'prompt-optimizer'
}

function displayTitle(item: DecisionItem): string {
  return isPromptOptimizationDecision(item)
    ? tr('选择优化后的提示词', 'Choose the prepared Prompt')
    : item.request.title
}

function displayDescription(item: DecisionItem): string | undefined {
  const { request } = item
  if (!request.description) return undefined
  if (!isPromptOptimizationDecision(item)) return request.description
  if (request.options.some(option => option.id === 'retry-optimization')) {
    return tr('候选生成未通过校验，请重试优化或保留原文。', 'The generated prompt candidates could not be validated. Retry optimization or keep the original.')
  }
  // Structural check: candidate options present means the "broad or ambiguous"
  // guidance applies, without coupling to the exact main-side wording.
  if (request.options.some(option => /^candidate-\d+$/.test(option.id))) {
    return tr('原始请求范围过大或存在歧义。', 'The original request is broad or ambiguous.')
  }
  return request.description
}

function displayOptionLabel(item: DecisionItem, option: DecisionItem['request']['options'][number]): string {
  if (!isPromptOptimizationDecision(item)) return option.label
  if (option.id === 'retry-optimization') return tr('重新优化', 'Retry optimization')
  if (option.id === 'original' || option.id === 'keep-original') return tr('保留原文', 'Keep original')
  if (option.id === 'use-custom') return tr('使用自定义文本', 'Use custom text')
  const candidate = /^candidate-(\d+)$/.exec(option.id)
  return candidate ? tr(`候选 ${Number(candidate[1]) + 1}`, `Candidate ${Number(candidate[1]) + 1}`) : option.label
}

function displayOptionDescription(item: DecisionItem, option: DecisionItem['request']['options'][number]): string | undefined {
  if (isPromptOptimizationDecision(item) && option.id === 'retry-optimization') {
    return tr('候选生成未通过校验，请重试优化或保留原文。', 'Candidate validation failed. Retry optimization or keep the original.')
  }
  return option.description
}

function displayCustomLabel(item: DecisionItem): string {
  return item.request.kind === 'text'
    ? tr('回复', 'Response')
    : tr('自定义回复', 'Custom response')
}

function displayCustomPlaceholder(item: DecisionItem): string {
  if (isPromptOptimizationDecision(item)) {
    return tr('输入另一版提示词', 'Write another version')
  }
  return item.request.customInput?.placeholder || tr('输入自定义回复', 'Type a custom response')
}

export function DecisionBar({ item, position, count, onSubmit }: DecisionBarProps) {
  const runtimeTurnId = item.origin === 'runtime' && item.request.owner.type === 'turn'
    ? item.request.owner.turnId
    : undefined
  const { request } = item
  const title = displayTitle(item)
  const description = displayDescription(item)
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([])
  const [customText, setCustomText] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const submitInFlightRef = useRef(false)

  useEffect(() => {
    setSelectedOptionIds([])
    setCustomText('')
    setRemember(false)
    setBusy(false)
    setError(null)
    setWarning(null)
    setDetailsOpen(false)
    submitInFlightRef.current = false
  }, [item.id])

  useEffect(() => {
    setAnnouncement('')
    const timer = window.setTimeout(() => setAnnouncement(`${title}. ${tr(`第 ${position} / ${count} 个决策`, `Decision ${position} of ${count}`)}`), 180)
    return () => window.clearTimeout(timer)
  }, [count, item.id, position, title])

  const selectionValid = useMemo(() => {
    const selectedCount = selectedOptionIds.length
    if (request.kind === 'text') return customText.trim().length > 0
    if (customText.trim().length > 0 && selectedCount === 0) return true
    if (selectedCount < request.minSelections || selectedCount > request.maxSelections) return false
    // A draft "Use custom text" choice is only meaningful with actual text; an
    // empty one would be silently discarded by the draft applier.
    if (item.origin === 'draft' && selectedOptionIds.includes('use-custom')) {
      return customText.trim().length > 0
    }
    return true
  }, [customText, item.origin, request.kind, request.maxSelections, request.minSelections, selectedOptionIds])

  const toggleOption = (optionId: string) => {
    setError(null)
    if (request.kind === 'multi-select') {
      setSelectedOptionIds(current => (
        current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : current.length >= request.maxSelections ? current : [...current, optionId]
      ))
      return
    }
    setSelectedOptionIds([optionId])
  }

  const submit = async () => {
    if (busy || submitInFlightRef.current || !selectionValid) return
    submitInFlightRef.current = true
    setBusy(true)
    setError(null)
    const hasSelection = selectedOptionIds.length > 0
    const normalizedCustomText = customText.trim()
    const isCustomSubmission = !hasSelection && normalizedCustomText.length > 0
    const isDraftCustomSelection = item.origin === 'draft'
      && selectedOptionIds.includes('use-custom')
      && normalizedCustomText.length > 0
    const submission: DecisionSubmission = {
      requestId: request.id,
      outcome: request.kind === 'text' || isCustomSubmission ? 'submitted' : 'selected',
      ...(hasSelection ? { selectedOptionIds } : {}),
      ...(isCustomSubmission || isDraftCustomSelection ? { customText: normalizedCustomText } : {}),
      ...(request.allowRemember ? { remember } : {})
    }
    try {
      const result = await onSubmit(submission)
      if (!accepted(result)) setError(tr('未能接受此决策，请重试。', 'The decision was not accepted. Please retry.'))
      else if (typeof result === 'object' && result?.warning === 'remember_failed') {
        setWarning(tr('选择已接受，但无法记住此偏好。', 'Choice accepted, but it could not be remembered.'))
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : tr('无法提交此决策，请重试。', 'Unable to submit this decision. Please retry.'))
    } finally {
      submitInFlightRef.current = false
      setBusy(false)
    }
  }

  const errorId = `decision-error-${request.id}`
  const isMulti = request.kind === 'multi-select'
  const hasCustomField = request.allowCustom || request.kind === 'text'
  const customMaxChars = request.customInput?.maxChars ?? 8_000
  const delayed = needsDelayedAnnouncement(item)

  return (
    <section
      className="wb-decision-bar"
      role="group"
      aria-label={title}
      aria-describedby={error ? errorId : undefined}
      data-turn-id={runtimeTurnId}
      data-decision-id={item.origin === 'runtime' ? request.id : undefined}
      onKeyDown={event => {
        if (event.key === 'Escape' && detailsOpen) {
          event.preventDefault()
          setDetailsOpen(false)
        }
      }}
    >
      {announcement && (
        <span className="wb-decision-announcement" aria-live={delayed ? 'assertive' : 'polite'} aria-atomic="true">
          {announcement}
        </span>
      )}
      <div className="wb-decision-bar-heading">
        <strong>{title}</strong>
        <span className="wb-decision-position">{tr(`${position} / ${count}`, `${position} of ${count}`)}</span>
      </div>
      {description && (
        <div className="wb-decision-description">
          <button
            type="button"
            className="wb-decision-detail-toggle"
            aria-expanded={detailsOpen}
            aria-controls={`decision-details-${request.id}`}
            onClick={() => setDetailsOpen(open => !open)}
          >
            {detailsOpen ? tr('隐藏详情', 'Hide details') : tr('显示详情', 'Show details')}
          </button>
          {detailsOpen && <p id={`decision-details-${request.id}`}>{description}</p>}
        </div>
      )}
      <div className="wb-decision-options">
        {request.options.map((option, index) => {
          const optionId = `decision-option-${request.id}-${option.id}`
          const optionLabel = displayOptionLabel(item, option)
          const optionDescription = displayOptionDescription(item, option)
          const descriptionIds = [
            optionDescription ? `${optionId}-description` : null,
            option.preview ? `${optionId}-preview` : null
          ].filter((id): id is string => !!id)
          return (
          <label key={option.id} htmlFor={optionId} className={`wb-decision-option tone-${option.tone || 'default'}`}>
            <input
              id={optionId}
              type={isMulti ? 'checkbox' : 'radio'}
              name={`decision-${request.id}`}
              aria-labelledby={`${optionId}-label`}
              aria-describedby={descriptionIds.length ? descriptionIds.join(' ') : undefined}
              data-decision-primary={index === 0 ? true : undefined}
              checked={selectedOptionIds.includes(option.id)}
              disabled={busy}
              onChange={() => toggleOption(option.id)}
            />
            <span>
              <span id={`${optionId}-label`}>{optionLabel}</span>
              {optionDescription && <small id={`${optionId}-description`}>{optionDescription}</small>}
              {option.preview && <code id={`${optionId}-preview`}>{option.preview}</code>}
            </span>
          </label>
          )
        })}
      </div>
      {hasCustomField && (
        <label className="wb-decision-custom">
          <span>{displayCustomLabel(item)}</span>
          <textarea
            data-decision-primary={request.options.length === 0 ? true : undefined}
            value={customText}
            maxLength={customMaxChars}
            placeholder={displayCustomPlaceholder(item)}
            disabled={busy}
            onChange={event => {
              const nextCustomText = event.target.value
              setCustomText(nextCustomText)
              if (nextCustomText.trim()) setSelectedOptionIds([])
              setError(null)
            }}
          />
        </label>
      )}
      {request.allowRemember && (
        <label className="wb-decision-remember">
          <input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />
          <span>{tr('记住此选择', 'Remember this choice')}</span>
        </label>
      )}
      {error && <p id={errorId} className="wb-decision-error" role="alert">{error}</p>}
      {warning && <p className="wb-decision-warning" role="status">{warning}</p>}
      <div className="wb-decision-actions">
        <button
          type="button"
          className="wb-decision-primary"
          data-decision-primary
          data-testid="decision-primary"
          disabled={busy || !selectionValid}
          aria-describedby={error ? errorId : undefined}
          onClick={() => { void submit() }}
        >
          {busy ? tr('正在提交…', 'Submitting…') : primaryLabel(item)}
        </button>
      </div>
    </section>
  )
}
