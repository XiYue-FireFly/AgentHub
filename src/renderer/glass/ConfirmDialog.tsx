/**
 * ConfirmDialog: React confirmation dialog.
 */

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { tr } from './i18n'

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
  const onConfirmRef = useRef(onConfirm)
  const onCancelRef = useRef(onCancel)

  // Update refs on every render to always have latest callbacks
  useEffect(() => {
    onConfirmRef.current = onConfirm
    onCancelRef.current = onCancel
  })

  useEffect(() => {
    if (!open || !containerRef.current) return
    const el = containerRef.current
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancelRef.current()
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onConfirmRef.current()
      }
    }
    el.addEventListener('keydown', onKeyDown)
    el.focus()
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <div className="wb-confirm-overlay" onClick={onCancel}>
      <div
        className="wb-confirm-container"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        ref={containerRef}
        tabIndex={-1}
      >
        <div className="wb-confirm-title">
          <strong>{title}</strong>
        </div>
        <div className="wb-confirm-message">{message}</div>
        <div className="wb-confirm-actions">
          <button className="ah-btn sm" onClick={onCancel}>
            {cancelLabel || tr('取消', 'Cancel')}
          </button>
          <button className={`ah-btn sm ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
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
