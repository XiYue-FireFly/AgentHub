/**
 * ConfirmDialog: React confirmation dialog.
 */

import React, { useCallback, useId, useRef, useState } from 'react'
import { tr } from './i18n'
import { useModalFocus } from '../hooks/useModalFocus'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useModalFocus({
    containerRef,
    initialFocusRef: danger ? cancelRef : confirmRef,
    onEscape: onCancel,
    active: open
  })

  if (!open) return null

  return (
    <div className="wb-confirm-overlay" onClick={onCancel}>
      <div
        className="wb-confirm-container"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        ref={containerRef}
        tabIndex={-1}
      >
        <div className="wb-confirm-title">
          <strong id={titleId}>{title}</strong>
        </div>
        <div className="wb-confirm-message" id={messageId}>{message}</div>
        <div className="wb-confirm-actions">
          <button ref={cancelRef} className="ah-btn sm" onClick={onCancel}>
            {cancelLabel || tr('取消', 'Cancel')}
          </button>
          <button ref={confirmRef} className={`ah-btn sm ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel || tr('确认', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useConfirmDialog(): [
  React.ReactElement | null,
  (message: string, opts?: { title?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>
] {
  const [state, setState] = useState<{
    message: string
    title: string
    confirmLabel?: string
    danger?: boolean
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback((message: string, opts?: { title?: string; confirmLabel?: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      setState(prev => {
        // MED-29: Resolve the previous Promise before overwriting to prevent leaked unresolved promises
        if (prev) prev.resolve(false)
        return {
          message,
          title: opts?.title || tr('确认操作', 'Confirm Action'),
          confirmLabel: opts?.confirmLabel,
          danger: opts?.danger,
          resolve
        }
      })
    })
  }, [])

  const onConfirm = useCallback(() => {
    state?.resolve(true)
    setState(null)
  }, [state])

  const onCancel = useCallback(() => {
    state?.resolve(false)
    setState(null)
  }, [state])

  const dialog = (
    <ConfirmDialog
      open={!!state}
      title={state?.title || ''}
      message={state?.message || ''}
      confirmLabel={state?.confirmLabel}
      danger={state?.danger}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )

  return [dialog, confirm]
}
