// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingDecisionNotice } from '../PendingDecisionNotice'

afterEach(() => cleanup())

describe('PendingDecisionNotice', () => {
  it('is a status-only reminder outside Chat that opens the owning thread', () => {
    const open = vi.fn()
    render(<PendingDecisionNotice view="tasks" count={2} threadId="thread-7" onOpenThread={open} />)

    expect(screen.getByRole('status').textContent).toContain('2 pending decisions')
    fireEvent.click(screen.getByRole('button', { name: 'Open decision in chat' }))
    expect(open).toHaveBeenCalledWith('thread-7')
  })

  it('does not render while Chat is active or when no decision is pending', () => {
    const { rerender } = render(<PendingDecisionNotice view="chat" count={1} threadId="thread-7" onOpenThread={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<PendingDecisionNotice view="tasks" count={0} threadId={null} onOpenThread={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
