import { describe, expect, it, vi } from 'vitest'
import { AcpAgentAdapter } from '../acp-adapter'

describe('AcpAgentAdapter cancellation lifecycle', () => {
  it('stops and clears a busy client after cancel grace expires', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new AcpAgentAdapter('acp', 'ACP', 'fake-acp', [])
      const client = { running: true, cancel: vi.fn(), stop: vi.fn(), onCrash: null }
      ;(adapter as any).client = client
      ;(adapter as any).currentSession = 'session-1'
      ;(adapter as any).status = 'busy'
      ;(adapter as any).sessions.set('thread-1', { id: 'session-1', cwd: process.cwd(), mcpSignature: '[]' })
      ;(adapter as any).sessionLocks.set('session-1', Promise.resolve())

      const stopping = (adapter as any).cancelAndStopAfterGrace(25)
      expect(client.cancel).toHaveBeenCalledWith('session-1')

      await vi.advanceTimersByTimeAsync(25)
      await stopping

      expect(client.stop).toHaveBeenCalled()
      expect((adapter as any).client).toBeNull()
      expect((adapter as any).currentSession).toBeNull()
      expect((adapter as any).status).toBe('idle')
      expect((adapter as any).sessions.size).toBe(0)
      expect((adapter as any).sessionLocks.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
