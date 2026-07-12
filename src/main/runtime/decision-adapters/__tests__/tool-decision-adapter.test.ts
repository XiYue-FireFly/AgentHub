import { describe, expect, it, vi } from 'vitest'
import type { DecisionResolution } from '../../../../shared/decision-contract'
import { ToolDecisionAdapter } from '../tool-decision-adapter'

const owner = {
  type: 'turn' as const,
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  webContentsId: 7
}

const input = {
  owner,
  agentId: 'codex',
  tool: 'exec' as const,
  toolName: 'exec',
  action: 'run_command',
  target: 'npm test',
  preview: 'npm test',
  risk: 'high' as const,
  idempotencyKey: 'tool-1'
}

function resolution(overrides: Partial<DecisionResolution> = {}): DecisionResolution {
  return {
    requestId: 'decision-1',
    status: 'selected',
    selectedOptionIds: ['allow-once'],
    resolvedAt: 1,
    ...overrides
  }
}

describe('ToolDecisionAdapter', () => {
  it('allows only a selected allow-once decision and sets trusted defaults', async () => {
    const request = vi.fn(async (_request: unknown, _options?: unknown) => resolution())
    const adapter = new ToolDecisionAdapter({
      decisionService: { request },
      approvalConfig: { setOverrideAndFlush: vi.fn(async () => undefined) }
    })

    await expect(adapter.request(input)).resolves.toBe(true)
    expect(request).toHaveBeenCalledOnce()
    const decision = request.mock.calls[0]?.[0]
    expect(decision).toMatchObject({
      source: 'tool',
      deadlineMs: 300_000,
      allowRemember: true,
      metadata: expect.objectContaining({ toolName: 'exec', target: 'npm test' })
    })
  })

  it('does not offer remember while ask-all would ignore the saved override', async () => {
    const request = vi.fn(async (_request: unknown) => resolution())
    const adapter = new ToolDecisionAdapter({
      decisionService: { request },
      approvalConfig: {
        getConfig: () => ({ preset: 'ask-all' }),
        setOverrideAndFlush: vi.fn(async () => undefined)
      }
    })

    await expect(adapter.request(input)).resolves.toBe(true)
    expect(request.mock.calls[0]?.[0]).toMatchObject({ allowRemember: false })
  })

  it.each([
    resolution({ status: 'denied', selectedOptionIds: undefined }),
    resolution({ selectedOptionIds: ['deny'] }),
    resolution({ status: 'cancelled', selectedOptionIds: undefined })
  ])('fails closed for non-allow decisions', async (decision) => {
    const adapter = new ToolDecisionAdapter({
      decisionService: { request: vi.fn(async () => decision) },
      approvalConfig: { setOverrideAndFlush: vi.fn(async () => undefined) }
    })

    await expect(adapter.request(input)).resolves.toBe(false)
  })

  it('does not request or execute a tool twice when remembering fails', async () => {
    let onRemember: ((resolution: DecisionResolution) => Promise<void>) | undefined
    const request = vi.fn(async (_decision: unknown, options?: {
      onRemember?: (resolution: DecisionResolution) => Promise<void>
    }) => {
      onRemember = options?.onRemember
      await onRemember?.(resolution()).catch(() => undefined)
      return resolution()
    })
    const setOverrideAndFlush = vi.fn(async () => { throw new Error('disk unavailable') })
    const adapter = new ToolDecisionAdapter({
      decisionService: { request },
      approvalConfig: { setOverrideAndFlush }
    })

    await expect(adapter.request(input)).resolves.toBe(true)
    expect(request).toHaveBeenCalledOnce()
    expect(setOverrideAndFlush).toHaveBeenCalledOnce()
    expect(setOverrideAndFlush).toHaveBeenCalledWith('codex', 'exec', 'allow')
  })
})
