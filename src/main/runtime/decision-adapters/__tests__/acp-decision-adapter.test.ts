import { describe, expect, it, vi } from 'vitest'
import type { DecisionResolution } from '../../../../shared/decision-contract'
import { AcpDecisionAdapter } from '../acp-decision-adapter'

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
  title: 'Allow filesystem operation?',
  toolName: 'filesystem',
  options: [
    { optionId: 'deny.exact', name: 'Deny', kind: 'deny_once' },
    { optionId: 'allow.once/exact', name: 'Allow once', kind: 'allow_once' }
  ],
  idempotencyKey: 'acp-1'
}

function resolution(overrides: Partial<DecisionResolution> = {}): DecisionResolution {
  return {
    requestId: 'decision-1',
    status: 'selected',
    selectedOptionIds: ['allow.once/exact'],
    resolvedAt: 1,
    ...overrides
  }
}

describe('AcpDecisionAdapter', () => {
  it('returns the exact selected ACP protocol option ID from the trusted decision service', async () => {
    const request = vi.fn(async () => resolution())
    const adapter = new AcpDecisionAdapter({ decisionService: { request } })

    await expect(adapter.request(input)).resolves.toEqual({
      outcome: 'selected',
      optionId: 'allow.once/exact'
    })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      source: 'acp',
      options: [
        expect.objectContaining({ id: 'deny.exact' }),
        expect.objectContaining({ id: 'allow.once/exact' })
      ],
      allowCustom: false,
      allowRemember: false,
      metadata: expect.objectContaining({ agentId: 'codex' })
    }), expect.objectContaining({ onAdmitted: expect.any(Function) }))
  })

  it.each([
    resolution({ status: 'cancelled', selectedOptionIds: undefined }),
    resolution({ selectedOptionIds: ['unknown-option'] }),
    resolution({ selectedOptionIds: ['deny.exact', 'allow.once/exact'] })
  ])('fails closed unless exactly one original protocol option ID was selected', async (decision) => {
    const adapter = new AcpDecisionAdapter({ decisionService: { request: vi.fn(async () => decision) } })

    await expect(adapter.request(input)).resolves.toEqual({ outcome: 'cancelled' })
  })

  it('announces only the one durable request admitted for duplicate idempotent ACP calls', async () => {
    let first: Promise<DecisionResolution> | undefined
    const request = vi.fn((decision: any, options?: any) => {
      if (!first) {
        options?.onAdmitted?.(decision)
        first = Promise.resolve(resolution({ requestId: decision.id }))
      }
      return first
    })
    const adapter = new AcpDecisionAdapter({ decisionService: { request } })
    const announced: string[] = []

    await expect(Promise.all([
      adapter.request(input, { onRequested: decision => announced.push(decision.id) }),
      adapter.request(input, { onRequested: decision => announced.push(decision.id) })
    ])).resolves.toEqual([
      { outcome: 'selected', optionId: 'allow.once/exact' },
      { outcome: 'selected', optionId: 'allow.once/exact' }
    ])
    expect(announced).toHaveLength(1)
  })
})
