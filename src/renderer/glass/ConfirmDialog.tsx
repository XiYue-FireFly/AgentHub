/**
 * ConfirmDialog: styled confirmation dialog replacing window.confirm().
 *
 * Shows a glass-styled modal with title, message, confirm/cancel buttons.
 * Supports danger styling for destructive actions.
 *
 * Phase P0-3: Replace all native window.confirm() with unified UI.
 */

import React, { useState, useCallback, useEffect } from 'react'
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
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  return (
    <div className="wb-cp-overlay" onClick={onCancel}>
      <div className="wb-cp-container" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--glass-border-default)' }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--glass-border-default)' }}>
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

/**
 * Hook for using ConfirmDialog declaratively.
 * Returns [ConfirmDialogComponent, confirm(message, options)]
 */
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
      setState({
        message,
        title: opts?.title || tr('确认操作', 'Confirm Action'),
        confirmLabel: opts?.confirmLabel,
        danger: opts?.danger,
        resolve
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
