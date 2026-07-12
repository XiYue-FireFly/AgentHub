import { describe, expect, it, vi } from 'vitest'
import type { DecisionOwner } from '../../../shared/decision-contract'
import { createUserDecisionAdapter } from '../user-decision-adapter'

describe('createUserDecisionAdapter', () => {
  it('maps an Agent multi-select request to the trusted factory and DecisionService', async () => {
    const signal = new AbortController().signal
    const request = vi.fn(async (_request: unknown, _options: unknown) => ({
      requestId: 'decision-1',
      status: 'selected' as const,
      selectedOptionIds: ['focused', 'tests'],
      resolvedAt: 25
    }))
    const owner: DecisionOwner = {
      type: 'turn',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceId: 'workspace-1',
      webContentsId: 42
    }
    const adapter = createUserDecisionAdapter({
      decisionService: { request } as any,
      owner
    })

    const resolution = await adapter.forAgent('codex', signal)({
      idempotencyKey: 'scope-step',
      title: 'Choose scope',
      description: 'Select every required workstream.',
      options: [
        { id: 'focused', label: 'Focused repair' },
        { id: 'tests', label: 'Regression tests' }
      ],
      selectionMode: 'multi',
      minSelections: 1,
      maxSelections: 2,
      allowCustom: false
    })

    expect(request).toHaveBeenCalledTimes(1)
    const [createdRequest, options] = request.mock.calls[0] as [any, any]
    expect(createdRequest).toMatchObject({
      owner,
      source: 'agent',
      kind: 'multi-select',
      minSelections: 1,
      maxSelections: 2,
      allowRemember: false,
      idempotencyKey: 'codex:scope-step'
    })
    expect(createdRequest.owner.type).toBe('turn')
    expect(createdRequest.owner).not.toHaveProperty('kind')
    expect(options).toEqual({ signal })
    expect(resolution).toEqual({
      status: 'selected',
      selectedOptionIds: ['focused', 'tests'],
      text: undefined,
      resolvedAt: 25
    })
  })

  it('maps custom input and terminal denial without exposing privileged fields', async () => {
    const request = vi.fn(async (_request: unknown, _options: unknown) => ({
      requestId: 'decision-2',
      status: 'denied' as const,
      resolvedAt: 30
    }))
    const owner: DecisionOwner = {
      type: 'hub',
      sessionId: 'hub-session-1'
    }
    const adapter = createUserDecisionAdapter({
      decisionService: { request } as any,
      owner
    })

    const resolution = await adapter.forAgent('claude')({
      idempotencyKey: 'format-step',
      title: 'Choose output format',
      options: [{ id: 'markdown', label: 'Markdown' }],
      selectionMode: 'single',
      minSelections: 1,
      maxSelections: 1,
      allowCustom: true
    })

    const [createdRequest] = request.mock.calls[0] as [any, any]
    expect(createdRequest).toMatchObject({
      owner: { type: 'hub', sessionId: 'hub-session-1' },
      kind: 'single-select',
      allowCustom: true,
      customInput: {
        placeholder: 'Enter another answer',
        maxChars: 16 * 1024
      },
      allowRemember: false,
      idempotencyKey: 'claude:format-step'
    })
    expect(createdRequest).not.toHaveProperty('deadlineMs')
    expect(createdRequest.metadata).toBeUndefined()
    expect(resolution).toEqual({
      status: 'denied',
      selectedOptionIds: undefined,
      text: undefined,
      resolvedAt: 30
    })
  })
})
