import { describe, expect, it, vi } from 'vitest'
import { GuardDecisionAdapter } from '../decision-adapters/guard-decision-adapter'
import { explicitGuardVerdictFromText } from '../guards'

const owner = {
  type: 'turn' as const,
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  webContentsId: 7
}

describe('guard decision adapter integration', () => {
  it('sends an explicit high-risk Guard verdict through the durable decision adapter', async () => {
    const verdict = explicitGuardVerdictFromText('BLOCK: destructive command')
    const request = vi.fn(async () => ({
      requestId: 'guard-1',
      status: 'denied' as const,
      resolvedAt: 1
    }))
    const adapter = new GuardDecisionAdapter({ decisionService: { request } })

    await expect(adapter.request({
      owner,
      agentId: 'reviewer',
      role: 'executor',
      risk: verdict!.level,
      reasons: verdict!.reasons,
      idempotencyKey: 'guard:turn-1:review'
    })).resolves.toEqual({ requestId: 'guard-1', decision: 'denied' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      source: 'guard',
      owner,
      idempotencyKey: 'guard:turn-1:review'
    }))
  })
})
