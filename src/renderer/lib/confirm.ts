/**
 * styledConfirm: DOM-based confirmation dialog.
 * Returns true on confirm, false on cancel.
 */

import { registerModalFocus } from './modalFocusStack'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

let nextConfirmId = 0

export function styledConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = ++nextConfirmId
    let settled = false
    let disposeFocus = () => {}
    const overlay = document.createElement('div')
    overlay.className = 'wb-confirm-overlay'

    const container = document.createElement('div')
    container.className = 'wb-confirm-container'
    container.setAttribute('role', 'dialog')
    container.setAttribute('aria-modal', 'true')
    container.tabIndex = -1

    if (opts.title) {
      const titleEl = document.createElement('div')
      titleEl.className = 'wb-confirm-title'
      const titleStrong = document.createElement('strong')
      titleStrong.id = `wb-styled-confirm-title-${id}`
      titleStrong.textContent = opts.title
      titleEl.appendChild(titleStrong)
      container.appendChild(titleEl)
      container.setAttribute('aria-labelledby', titleStrong.id)
    }

    const msgEl = document.createElement('div')
    msgEl.className = 'wb-confirm-message'
    msgEl.id = `wb-styled-confirm-message-${id}`
    msgEl.textContent = opts.message
    container.appendChild(msgEl)
    container.setAttribute('aria-describedby', msgEl.id)
    if (!opts.title) container.setAttribute('aria-label', opts.message)

    const btnRow = document.createElement('div')
    btnRow.className = 'wb-confirm-actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'ah-btn sm'
    cancelBtn.textContent = opts.cancelLabel || '取消'
    cancelBtn.onclick = () => finish(false)

    const confirmBtn = document.createElement('button')
    confirmBtn.className = `ah-btn sm ${opts.danger ? 'danger' : 'primary'}`
    confirmBtn.textContent = opts.confirmLabel || '确认'
    confirmBtn.onclick = () => finish(true)

    btnRow.appendChild(cancelBtn)
    btnRow.appendChild(confirmBtn)
    container.appendChild(btnRow)
    overlay.appendChild(container)
    document.body.appendChild(overlay)

    function cleanup() {
      disposeFocus()
      overlay.remove()
    }

    function finish(value: boolean) {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    overlay.onclick = (e) => { if (e.target === overlay) finish(false) }
    disposeFocus = registerModalFocus({
      container,
      initialFocus: cancelBtn,
      onEscape: () => finish(false)
    })
  })
}
