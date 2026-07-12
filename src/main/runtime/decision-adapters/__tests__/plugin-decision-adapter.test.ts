import { describe, expect, it, vi } from 'vitest'
import { PluginDecisionAdapter } from '../plugin-decision-adapter'

const owner = {
  type: 'turn' as const,
  threadId: 'thread-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1',
  webContentsId: 7
}

const input = {
  owner,
  pluginId: 'policy-plugin',
  hookId: 'requires-review',
  message: 'Plugin review is required.',
  idempotencyKey: 'plugin:turn-1:requires-review'
}

describe('PluginDecisionAdapter', () => {
  it('uses the trusted Guard factory and allows only allow-once', async () => {
    const request = vi.fn(async () => ({
      requestId: 'decision-1',
      status: 'selected' as const,
      selectedOptionIds: ['allow-once'],
      resolvedAt: 1
    }))
    const adapter = new PluginDecisionAdapter({ decisionService: { request } })

    await expect(adapter.request(input)).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      source: 'guard',
      deadlineMs: 300_000,
      idempotencyKey: 'plugin:turn-1:requires-review',
      metadata: expect.objectContaining({ action: 'guard:plugin:policy-plugin:requires-review' })
    }), undefined)
  })

  it('fails closed when an owner or decision channel is absent', async () => {
    const request = vi.fn()
    const withChannel = new PluginDecisionAdapter({
      decisionService: { request }
    })
    const withoutChannel = new PluginDecisionAdapter({})

    await expect(withChannel.request({ ...input, owner: null })).resolves.toBe(false)
    await expect(withoutChannel.request(input)).resolves.toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('fails closed for denied guard decisions', async () => {
    const adapter = new PluginDecisionAdapter({
      decisionService: { request: vi.fn(async () => ({
        requestId: 'decision-1', status: 'denied' as const, resolvedAt: 1
      })) }
    })

    await expect(adapter.request(input)).resolves.toBe(false)
  })

  it('fails closed when the decision channel rejects the request', async () => {
    const adapter = new PluginDecisionAdapter({
      decisionService: { request: vi.fn(async () => { throw new Error('channel unavailable') }) }
    })

    await expect(adapter.request(input)).resolves.toBe(false)
  })
})
