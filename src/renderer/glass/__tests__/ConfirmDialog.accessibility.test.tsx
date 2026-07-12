// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../ConfirmDialog'
import { setLang } from '../i18n'

function pressEnter(target: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  const shouldRunNativeAction = target.dispatchEvent(event)
  if (shouldRunNativeAction && target instanceof HTMLButtonElement && !target.disabled) {
    target.click()
  }
}

describe('ConfirmDialog keyboard behavior', () => {
  afterEach(() => {
    cleanup()
    setLang('zh')
  })

  it('keeps native button Enter behavior without treating every Enter as confirmation', () => {
    setLang('en')
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const view = render(
      <ConfirmDialog
        open
        danger
        title="Delete session"
        message="This cannot be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    const cancel = view.getByRole('button', { name: 'Cancel' })
    const confirm = view.getByRole('button', { name: 'Confirm' })
    const dialog = view.getByRole('dialog', { name: 'Delete session' })

    expect(document.activeElement).toBe(cancel)

    cancel.focus()
    pressEnter(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    confirm.focus()
    pressEnter(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(dialog, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
