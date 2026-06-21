/**
 * confirm.ts: styled confirmation dialog utility.
 *
 * Replaces window.confirm() with a DOM-based styled dialog.
 * Returns Promise<boolean> — true on confirm, false on cancel.
 *
 * P2-1: Full window.confirm() replacement.
 */

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

/**
 * Show a styled confirmation dialog.
 * Creates a temporary DOM overlay with glass-styled buttons.
 */
export function styledConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'wb-cp-overlay'
    overlay.style.zIndex = '10000'

    const container = document.createElement('div')
    container.className = 'wb-cp-container'
    container.style.maxWidth = '420px'

    // Title
    if (opts.title) {
      const titleEl = document.createElement('div')
      titleEl.style.cssText = 'padding:16px 20px;border-bottom:1px solid var(--glass-border-default)'
      titleEl.innerHTML = `<strong style="font-size:15px">${escapeHtml(opts.title)}</strong>`
      container.appendChild(titleEl)
    }

    // Message
    const msgEl = document.createElement('div')
    msgEl.style.cssText = 'padding:16px 20px;font-size:13px;color:var(--tx-2);line-height:1.5'
    msgEl.textContent = opts.message
    container.appendChild(msgEl)

    // Buttons
    const btnRow = document.createElement('div')
    btnRow.style.cssText = 'padding:12px 20px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--glass-border-default)'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'ah-btn sm'
    cancelBtn.textContent = opts.cancelLabel || '取消'
    cancelBtn.onclick = () => { cleanup(); resolve(false) }

    const confirmBtn = document.createElement('button')
    confirmBtn.className = `ah-btn sm ${opts.danger ? 'danger' : 'primary'}`
    confirmBtn.textContent = opts.confirmLabel || '确认'
    confirmBtn.onclick = () => { cleanup(); resolve(true) }

    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(confirmBtn)
    container.appendChild(btnRow)

    overlay.appendChild(container)
    document.body.appendChild(overlay)

    function cleanup() {
      overlay.remove()
    }

    // Esc to cancel, Enter to confirm
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cleanup(); resolve(false) }
      if (e.key === 'Enter') { cleanup(); resolve(true) }
    }
    document.addEventListener('keydown', onKeyDown, { once: true })
    overlay.onclick = (e) => { if (e.target === overlay) { cleanup(); resolve(false) } }
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
