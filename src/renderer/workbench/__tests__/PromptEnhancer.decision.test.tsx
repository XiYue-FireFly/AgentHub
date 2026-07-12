// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { PromptEnhancer } from '../PromptEnhancer'

const candidateResult = (draftHash = 'sha256-original') => ({
  candidates: [
    'Clarify the expected behavior and implement the smallest safe change.',
    'Identify the target module, reproduce the issue, then make and verify a focused fix.'
  ],
  draftHash
})

beforeEach(() => {
  setLang('en')
  ;(window as any).electronAPI = {
    ai: {
      quickComplete: vi.fn(),
      promptCandidates: vi.fn().mockResolvedValue(candidateResult())
    }
  }
})

afterEach(() => {
  cleanup()
  delete (window as any).electronAPI
})

describe('PromptEnhancer draft decision', () => {
  it('turns validated candidates into a local prompt-optimizer decision without overwriting the draft', async () => {
    const onDraftDecision = vi.fn()
    render(
      <PromptEnhancer
        text="Original prompt"
        threadId="thread-1"
        draftRevision={3}
        draftHash="sha256-original"
        onDraftDecision={onDraftDecision}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /enhance/i }))

    await waitFor(() => expect(onDraftDecision).toHaveBeenCalledTimes(1))
    expect((window as any).electronAPI.ai.promptCandidates).toHaveBeenCalledWith({
      origin: 'quick-complete:prompt-enhancer',
      prompt: 'Original prompt',
      draftHash: 'sha256-original'
    })
    expect((window as any).electronAPI.ai.quickComplete).not.toHaveBeenCalled()

    const draft = onDraftDecision.mock.calls[0][0]
    expect(draft).toMatchObject({
      origin: 'draft',
      threadId: 'thread-1',
      draftRevision: 3,
      draftHash: 'sha256-original',
      request: {
        source: 'prompt-optimizer',
        kind: 'single-select',
        allowCustom: true
      },
      valuesByOptionId: {
        'keep-original': 'Original prompt',
        'candidate-1': candidateResult().candidates[0],
        'candidate-2': candidateResult().candidates[1]
      }
    })
    expect(draft.request.options.map((option: { id: string }) => option.id)).toEqual([
      'keep-original',
      'candidate-1',
      'candidate-2',
      'use-custom'
    ])
  })

  it('preserves a validated third candidate in the local decision', async () => {
    ;(window as any).electronAPI.ai.promptCandidates.mockResolvedValueOnce({
      ...candidateResult(),
      candidates: [...candidateResult().candidates, 'Produce a concise implementation plan, then make the scoped change and run focused tests.']
    })
    const onDraftDecision = vi.fn()
    render(
      <PromptEnhancer text="Original prompt" threadId="thread-1" draftRevision={3} draftHash="sha256-original" onDraftDecision={onDraftDecision} />
    )

    fireEvent.click(screen.getByRole('button', { name: /enhance/i }))
    await waitFor(() => expect(onDraftDecision).toHaveBeenCalledTimes(1))
    expect(onDraftDecision.mock.calls[0][0].valuesByOptionId['candidate-3'])
      .toBe('Produce a concise implementation plan, then make the scoped change and run focused tests.')
  })

  it('suppresses a candidate result when the composer revision or hash changes while generation is pending', async () => {
    let resolve!: (result: ReturnType<typeof candidateResult>) => void
    ;(window as any).electronAPI.ai.promptCandidates.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const onDraftDecision = vi.fn()
    const view = render(
      <PromptEnhancer text="Original prompt" threadId="thread-1" draftRevision={1} draftHash="hash-original" onDraftDecision={onDraftDecision} />
    )
    fireEvent.click(screen.getByRole('button', { name: /enhance/i }))
    view.rerender(
      <PromptEnhancer text="Edited prompt" threadId="thread-1" draftRevision={2} draftHash="hash-edited" onDraftDecision={onDraftDecision} />
    )

    resolve(candidateResult('hash-original'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onDraftDecision).not.toHaveBeenCalled()
  })

  it('suppresses candidates whose echoed draft hash does not match the request', async () => {
    ;(window as any).electronAPI.ai.promptCandidates.mockResolvedValueOnce(candidateResult('other-draft'))
    const onDraftDecision = vi.fn()
    render(
      <PromptEnhancer text="Original prompt" threadId="thread-1" draftRevision={1} draftHash="hash-original" onDraftDecision={onDraftDecision} />
    )

    fireEvent.click(screen.getByRole('button', { name: /enhance/i }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(onDraftDecision).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /enhance/i }).hasAttribute('disabled')).toBe(false)
  })

  it('shows a candidate-generation failure only for the current composer draft', async () => {
    ;(window as any).electronAPI.ai.promptCandidates.mockResolvedValueOnce({
      candidates: [],
      draftHash: 'sha256-original',
      error: 'candidate service unavailable'
    })
    const onDraftDecision = vi.fn()
    render(
      <PromptEnhancer text="Original prompt" threadId="thread-1" draftRevision={1} draftHash="sha256-original" onDraftDecision={onDraftDecision} />
    )

    fireEvent.click(screen.getByRole('button', { name: /enhance/i }))
    await waitFor(() => expect(screen.getByText('candidate service unavailable')).toBeTruthy())
    expect(onDraftDecision).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /enhance/i }).hasAttribute('disabled')).toBe(false)
  })
})
