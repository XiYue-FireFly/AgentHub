/**
 * confirm.ts: styled confirmation dialog utility.
 *
 * Replaces window.confirm() with a Promise-based styled dialog.
 * Components use this instead of native confirm for consistent UX.
 *
 * P2-6: Git destructive actions → unified confirm.
 */

import React from 'react'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

let confirmResolver: ((value: boolean) => void) | null = null

/**
 * Show a styled confirmation dialog.
 * Returns a Promise<boolean> that resolves to true (confirm) or false (cancel).
 *
 * Usage:
 *   const ok = await styledConfirm({ message: 'Delete this?', danger: true })
 *   if (!ok) return
 */
export function styledConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve
    // Dispatch custom event that a React ConfirmDialog component listens to
    const event = new CustomEvent('agenthub:confirm', { detail: opts })
    window.dispatchEvent(event)
  })
}

/**
 * Called by the ConfirmDialog component when user responds.
 */
export function resolveConfirm(value: boolean): void {
  confirmResolver?.(value)
  confirmResolver = null
}

/**
 * Check if a styled confirm is currently pending.
 */
export function isConfirmPending(): boolean {
  return confirmResolver !== null
}
