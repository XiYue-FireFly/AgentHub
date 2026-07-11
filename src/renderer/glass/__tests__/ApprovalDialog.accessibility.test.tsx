// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalDialog, type ApprovalItem } from '../approval-dialog'
import { setLang } from '../i18n'

const approval: ApprovalItem = {
  id: 'approval-1',
  taskId: 'task-1',
  agentId: 'codex',
  tool: 'exec',
  toolName: 'shell',
  label: 'Run tests',
  detail: 'Command: npm test'
}

const nextApproval: ApprovalItem = {
  ...approval,
  id: 'approval-2',
  label: 'Write release notes',
  tool: 'write',
  toolName: 'write-file'
}

describe('ApprovalDialog accessibility', () => {
  afterEach(() => {
    cleanup()
    setLang('zh')
  })

  it('names the dialog, defaults to Deny, traps focus, denies on Escape, and restores focus', async () => {
    setLang('en')
    const onDecide = vi.fn()

    function Harness() {
      const [items, setItems] = useState<ApprovalItem[]>([])
      return (
        <>
          <button onClick={() => setItems([approval])}>Request approval</button>
          <ApprovalDialog
            items={items}
            onDecide={(item, approved, remember) => {
              onDecide(item, approved, remember)
              setItems([])
            }}
          />
        </>
      )
    }

    const view = render(<Harness />)
    const trigger = view.getByRole('button', { name: 'Request approval' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = view.getByRole('dialog', { name: 'Approval required' })
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    const deny = view.getByRole('button', { name: /Deny/ })
    const allow = view.getByRole('button', { name: /Allow/ })
    const remember = view.getByRole('checkbox')
    expect(document.activeElement).toBe(deny)

    allow.focus()
    fireEvent.keyDown(allow, { key: 'Tab' })
    expect(document.activeElement).toBe(remember)

    remember.focus()
    fireEvent.keyDown(remember, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(allow)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onDecide).toHaveBeenCalledWith(approval, false, false)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('returns focus to Deny when the active approval item changes', () => {
    setLang('en')
    const onDecide = vi.fn()
    const view = render(<ApprovalDialog items={[approval]} onDecide={onDecide} />)
    const allow = view.getByRole('button', { name: /Allow/ })
    allow.focus()
    expect(document.activeElement).toBe(allow)

    view.rerender(<ApprovalDialog items={[nextApproval]} onDecide={onDecide} />)

    expect(document.activeElement).toBe(view.getByRole('button', { name: /Deny/ }))
  })

  it('shows submission errors, disables duplicate decisions while busy, and keeps remember selected for retry', () => {
    setLang('en')
    const onDecide = vi.fn()
    const view = render(
      <ApprovalDialog
        items={[approval]}
        onDecide={onDecide}
        busy
        error="Failed to submit approval. Please try again."
      />
    )

    expect(view.getByRole('alert').textContent).toContain('Failed to submit approval')
    expect((view.getByRole('button', { name: /Deny/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: /Allow/ }) as HTMLButtonElement).disabled).toBe(true)

    view.rerender(
      <ApprovalDialog
        items={[approval]}
        onDecide={onDecide}
        busy={false}
        error="Failed to submit approval. Please try again."
      />
    )
    const remember = view.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(remember)
    fireEvent.click(view.getByRole('button', { name: /Allow/ }))

    expect(onDecide).toHaveBeenCalledWith(approval, true, true)
    expect(remember.checked).toBe(true)
  })
})
