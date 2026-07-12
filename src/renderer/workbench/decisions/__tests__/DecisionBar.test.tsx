// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionItem } from '../decisionAdapters'
import { DecisionBar } from '../DecisionBar'

function runtimeDecision(overrides: Partial<DecisionItem['request']> = {}): DecisionItem {
  return {
    origin: 'runtime',
    id: 'runtime-1',
    threadId: 'thread-1',
    createdAt: 1,
    state: 'active',
    request: {
      schemaVersion: 1,
      id: 'runtime-1',
      owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: 'workspace-1', webContentsId: 1 },
      source: 'agent',
      kind: 'single-select',
      title: 'Choose a path',
      description: 'This is expanded only on request.',
      options: [
        { id: 'first', label: 'First option', description: 'first detail' },
        { id: 'second', label: 'Second option' }
      ],
      minSelections: 1,
      maxSelections: 1,
      allowCustom: false,
      allowRemember: false,
      createdAt: 1,
      ...overrides
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('DecisionBar', () => {
  it('is an inline labelled group rather than a dialog and reports its queue position', () => {
    render(<DecisionBar item={runtimeDecision()} position={1} count={2} onSubmit={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Choose a path' })).toBeTruthy()
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  })

  it('keeps the card and focusable primary action after a failed submission, allowing retry', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network offline'))
    render(<DecisionBar item={runtimeDecision()} position={1} count={1} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByLabelText('First option'))
    const submit = screen.getByTestId('decision-primary')
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    submit.focus()
    fireEvent.click(submit)

    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('Network offline')
    expect(screen.getByRole('group', { name: 'Choose a path' })).toBeTruthy()
    expect(document.activeElement).toBe(submit)

    fireEvent.click(submit)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
  })

  it('blocks duplicate selection submissions while busy', async () => {
    let resolve!: (value: { accepted: boolean }) => void
    const onSubmit = vi.fn(() => new Promise<{ accepted: boolean }>(done => { resolve = done }))
    render(<DecisionBar item={runtimeDecision()} position={1} count={1} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByLabelText('First option'))
    const submit = screen.getByTestId('decision-primary')
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveProperty('disabled', true)
    resolve({ accepted: true })
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
  })

  it('announces high-impact runtime decisions assertively only after 180ms', async () => {
    vi.useFakeTimers()
    render(<DecisionBar item={runtimeDecision({ source: 'tool' })} position={1} count={1} onSubmit={vi.fn()} />)

    expect(document.querySelector('[aria-live="assertive"]')).toBeNull()
    await vi.advanceTimersByTimeAsync(179)
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(document.querySelector('[aria-live="assertive"]')?.textContent).toContain('Choose a path. Decision 1 of 1')
  })

  it('announces neutral agent decisions politely only after 180ms and Escape only collapses details', async () => {
    vi.useFakeTimers()
    render(<DecisionBar item={runtimeDecision()} position={1} count={1} onSubmit={vi.fn()} />)
    expect(document.querySelector('[aria-live="polite"]')).toBeNull()
    await vi.advanceTimersByTimeAsync(180)
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Choose a path. Decision 1 of 1')

    const details = screen.getByRole('button', { name: 'Show details' })
    expect(details.getAttribute('aria-expanded')).toBe('false')
    expect(details.getAttribute('aria-controls')).toBeTruthy()
    fireEvent.click(details)
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(details.getAttribute('aria-controls')!)).toBeTruthy()
    expect(screen.getByText('This is expanded only on request.')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('group', { name: 'Choose a path' }), { key: 'Escape' })
    expect(screen.queryByText('This is expanded only on request.')).toBeNull()
    expect(screen.getByRole('group', { name: 'Choose a path' })).toBeTruthy()
  })

  it('associates a failed decision alert with its group and consumes option tones', async () => {
    const item = runtimeDecision({ options: [{ id: 'danger', label: 'Dangerous choice', tone: 'danger' }] })
    render(<DecisionBar item={item} position={1} count={1} onSubmit={vi.fn().mockRejectedValue(new Error('Nope'))} />)
    const group = screen.getByRole('group', { name: 'Choose a path' })
    const dangerousOption = screen.getByLabelText('Dangerous choice')
    expect(dangerousOption.closest('.wb-decision-option')?.classList.contains('tone-danger')).toBe(true)
    fireEvent.click(dangerousOption)
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))
    const alert = await screen.findByRole('alert')
    expect(group.getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('links option descriptions and previews without overriding the option label', () => {
    const item = runtimeDecision({ options: [{ id: 'described', label: 'Described option', description: 'Accessible detail', preview: 'Accessible preview' }] })
    render(<DecisionBar item={item} position={1} count={1} onSubmit={vi.fn()} />)
    const option = screen.getByLabelText('Described option')
    const descriptionIds = option.getAttribute('aria-describedby')?.split(' ') || []

    expect(option.getAttribute('aria-label')).toBeNull()
    expect(descriptionIds).toHaveLength(2)
    expect(descriptionIds.map(id => document.getElementById(id)?.textContent)).toEqual(['Accessible detail', 'Accessible preview'])
  })

  it('shows a nonblocking notice when an accepted decision cannot remember its preference', async () => {
    render(<DecisionBar item={runtimeDecision()} position={1} count={1} onSubmit={vi.fn().mockResolvedValue({ accepted: true, warning: 'remember_failed' })} />)
    fireEvent.click(screen.getByLabelText('First option'))
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    expect(await screen.findByText('Choice accepted, but it could not be remembered.')).toBeTruthy()
  })

  it('submits a valid custom-only single selection without a mixed option payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ accepted: true })
    const item = runtimeDecision({
      allowCustom: true,
      customInput: { maxChars: 30 },
      options: [{ id: 'option', label: 'Option' }]
    })
    render(<DecisionBar item={item} position={1} count={1} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom response' }), { target: { value: 'Custom route' } })
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      requestId: 'runtime-1',
      outcome: 'submitted',
      customText: 'Custom route'
    }))
  })

  it('keeps in-progress selection and custom text when queue metadata changes for the same card', async () => {
    const item = runtimeDecision({
      allowCustom: true,
      customInput: { maxChars: 30 },
      options: [{ id: 'option', label: 'Option' }]
    })
    const view = render(<DecisionBar item={item} position={1} count={1} onSubmit={vi.fn()} />)
    const option = screen.getByLabelText('Option') as HTMLInputElement
    fireEvent.click(option)
    await waitFor(() => expect(option.checked).toBe(true))

    view.rerender(<DecisionBar item={item} position={2} count={3} onSubmit={vi.fn()} />)
    await waitFor(() => expect((screen.getByLabelText('Option') as HTMLInputElement).checked).toBe(true))

    const custom = screen.getByRole('textbox', { name: 'Custom response' }) as HTMLTextAreaElement
    fireEvent.change(custom, { target: { value: 'Keep this custom text' } })
    view.rerender(<DecisionBar item={item} position={3} count={4} onSubmit={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Custom response' }) as HTMLTextAreaElement).value).toBe('Keep this custom text'))
  })

  it('submits an option selection without custom text when no custom response is entered', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ accepted: true })
    const item = runtimeDecision({
      allowCustom: true,
      customInput: { maxChars: 30 },
      options: [{ id: 'option', label: 'Option' }]
    })
    render(<DecisionBar item={item} position={1} count={1} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByLabelText('Option'))
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      requestId: 'runtime-1',
      outcome: 'selected',
      selectedOptionIds: ['option']
    }))
  })

  it('switches an allowCustom single selection from an option to valid custom-only submission', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ accepted: true })
    const item = runtimeDecision({
      allowCustom: true,
      customInput: { maxChars: 30 },
      options: [{ id: 'option', label: 'Option' }]
    })
    render(<DecisionBar item={item} position={1} count={1} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByLabelText('Option'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom response' }), { target: { value: 'Custom replacement' } })
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({
      requestId: 'runtime-1',
      outcome: 'submitted',
      customText: 'Custom replacement'
    }))
  })
})
