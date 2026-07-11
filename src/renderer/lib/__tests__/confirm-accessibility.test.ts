// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { styledConfirm } from '../confirm'

function pressEnter(target: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  const shouldRunNativeAction = target.dispatchEvent(event)
  if (shouldRunNativeAction && target instanceof HTMLButtonElement && !target.disabled) {
    target.click()
  }
}

describe('styledConfirm keyboard behavior', () => {
  afterEach(() => {
    for (let index = 0; index < 5 && document.querySelector('[role="dialog"]'); index++) {
      fireKey('Escape')
    }
    document.body.replaceChildren()
  })

  it('returns false when Enter activates the focused cancel button', async () => {
    const result = styledConfirm({
      title: 'Delete session',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true
    })

    const cancel = document.querySelector('.wb-confirm-actions button:first-child') as HTMLButtonElement
    expect(document.activeElement).toBe(cancel)

    pressEnter(cancel)
    await expect(result).resolves.toBe(false)
  })

  it('returns true when Enter activates the focused confirm button', async () => {
    const result = styledConfirm({ message: 'Continue?', confirmLabel: 'Continue', cancelLabel: 'Cancel' })
    const confirm = document.querySelector('.wb-confirm-actions button:last-child') as HTMLButtonElement

    confirm.focus()
    pressEnter(confirm)

    await expect(result).resolves.toBe(true)
  })

  it('does not confirm Enter from non-interactive dialog content and cancels on Escape', async () => {
    let settled = false
    const result = styledConfirm({ message: 'Continue?', confirmLabel: 'Continue', cancelLabel: 'Cancel' })
      .then(value => {
        settled = true
        return value
      })
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement

    pressEnter(dialog)
    await Promise.resolve()
    expect(settled).toBe(false)

    fireKey('Escape')
    await expect(result).resolves.toBe(false)
  })

  it('only closes the topmost concurrent confirm for each Escape press', async () => {
    let firstValue: boolean | undefined
    let secondValue: boolean | undefined
    const first = styledConfirm({ message: 'First?', cancelLabel: 'Cancel first' })
      .then(value => { firstValue = value })
    const second = styledConfirm({ message: 'Second?', cancelLabel: 'Cancel second' })
      .then(value => { secondValue = value })

    fireKey('Escape')
    await Promise.resolve()
    expect(secondValue).toBe(false)
    expect(firstValue).toBeUndefined()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)

    fireKey('Escape')
    await Promise.all([first, second])
    expect(firstValue).toBe(false)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  })

  it('wraps Tab focus between actions and restores the trigger after closing', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Open confirm'
    document.body.appendChild(trigger)
    trigger.focus()

    const result = styledConfirm({ message: 'Continue?', confirmLabel: 'Continue', cancelLabel: 'Cancel' })
    const cancel = document.querySelector('.wb-confirm-actions button:first-child') as HTMLButtonElement
    const confirm = document.querySelector('.wb-confirm-actions button:last-child') as HTMLButtonElement

    expect(document.activeElement).toBe(cancel)
    fireKey('Tab', true)
    expect(document.activeElement).toBe(confirm)
    fireKey('Tab')
    expect(document.activeElement).toBe(cancel)

    fireKey('Escape')
    await expect(result).resolves.toBe(false)
    expect(document.activeElement).toBe(trigger)
  })
})

function fireKey(key: string, shiftKey = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
}
