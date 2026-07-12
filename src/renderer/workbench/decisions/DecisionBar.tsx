import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { DecisionSubmission } from '../../../shared/decision-contract'
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
  if (item.request.kind === 'confirm') return 'Confirm'
  if (item.request.kind === 'text') return 'Submit'
  return 'Continue'
}

export function DecisionBar({ item, position, count, onSubmit }: DecisionBarProps) {
  const runtimeTurnId = item.origin === 'runtime' && item.request.owner.type === 'turn'
    ? item.request.owner.turnId
    : undefined
  const { request } = item
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
    const timer = window.setTimeout(() => setAnnouncement(`${request.title}. Decision ${position} of ${count}`), 180)
    return () => window.clearTimeout(timer)
  }, [count, item.id, position, request.title])

  const selectionValid = useMemo(() => {
    const selectedCount = selectedOptionIds.length
    if (request.kind === 'text') return customText.trim().length > 0
    if (customText.trim().length > 0 && selectedCount === 0) return true
    if (selectedCount < request.minSelections || selectedCount > request.maxSelections) return false
    return true
  }, [customText, request.kind, request.maxSelections, request.minSelections, selectedOptionIds.length])

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
      if (!accepted(result)) setError('The decision was not accepted. Please retry.')
      else if (typeof result === 'object' && result?.warning === 'remember_failed') {
        setWarning('Choice accepted, but it could not be remembered.')
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Unable to submit this decision. Please retry.')
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
      aria-label={request.title}
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
        <strong>{request.title}</strong>
        <span className="wb-decision-position">{position} of {count}</span>
      </div>
      {request.description && (
        <div className="wb-decision-description">
          <button
            type="button"
            className="wb-decision-detail-toggle"
            aria-expanded={detailsOpen}
            aria-controls={`decision-details-${request.id}`}
            onClick={() => setDetailsOpen(open => !open)}
          >
            {detailsOpen ? 'Hide details' : 'Show details'}
          </button>
          {detailsOpen && <p id={`decision-details-${request.id}`}>{request.description}</p>}
        </div>
      )}
      <div className="wb-decision-options">
        {request.options.map((option, index) => {
          const optionId = `decision-option-${request.id}-${option.id}`
          const descriptionIds = [
            option.description ? `${optionId}-description` : null,
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
              <span id={`${optionId}-label`}>{option.label}</span>
              {option.description && <small id={`${optionId}-description`}>{option.description}</small>}
              {option.preview && <code id={`${optionId}-preview`}>{option.preview}</code>}
            </span>
          </label>
          )
        })}
      </div>
      {hasCustomField && (
        <label className="wb-decision-custom">
          <span>{request.kind === 'text' ? 'Response' : 'Custom response'}</span>
          <textarea
            data-decision-primary={request.options.length === 0 ? true : undefined}
            value={customText}
            maxLength={customMaxChars}
            placeholder={request.customInput?.placeholder || 'Type a custom response'}
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
          <span>Remember this choice</span>
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
          {busy ? 'Submitting…' : primaryLabel(item)}
        </button>
      </div>
    </section>
  )
}
