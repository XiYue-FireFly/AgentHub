import { describe, expect, it, vi } from 'vitest'
import { GuardDecisionAdapter } from '../guard-decision-adapter'

const owner = {
  type: 'turn' as const,
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspaceId: null,
  webContentsId: 7
}

describe('GuardDecisionAdapter', () => {
  it.each([
    ['selected', ['allow-once'], 'approved'],
    ['denied', undefined, 'denied'],
    ['timeout', undefined, 'timeout'],
    ['cancelled', undefined, 'cancelled']
  ] as const)('maps %s to %s without changing Turn identity', async (status, selectedOptionIds, decision) => {
    const service = {
      request: vi.fn(async () => ({
        requestId: 'guard-1',
        status,
        selectedOptionIds,
        resolvedAt: 1
      }))
    }
    const adapter = new GuardDecisionAdapter({ decisionService: service as never })

    await expect(adapter.request({
      owner,
      agentId: 'reviewer',
      role: 'executor',
      risk: 'high',
      reasons: ['unsafe output']
    })).resolves.toEqual({ requestId: 'guard-1', decision })

    expect(service.request).toHaveBeenCalledWith(expect.objectContaining({
      owner,
      source: 'guard',
      deadlineMs: 300_000
    }))
  })

  it('fails closed when the durable decision service is unavailable', async () => {
    const adapter = new GuardDecisionAdapter({})

    await expect(adapter.request({
      owner,
      agentId: 'reviewer',
      role: 'executor',
      risk: 'high',
      reasons: ['unsafe output']
    })).resolves.toEqual({ requestId: '', decision: 'cancelled' })
  })
})
