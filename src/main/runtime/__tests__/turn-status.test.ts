import { describe, expect, it } from 'vitest'
import { isTerminalTurnStatus, TERMINAL_TURN_STATUSES } from '../../../shared/turn-status'

describe('Turn terminal status invariant', () => {
  it('treats only completed, failed, cancelled, and interrupted as terminal', () => {
    expect(TERMINAL_TURN_STATUSES).toEqual(['completed', 'failed', 'cancelled', 'interrupted'])
    expect(isTerminalTurnStatus('queued')).toBe(false)
    expect(isTerminalTurnStatus('running')).toBe(false)
    expect(isTerminalTurnStatus('awaiting-decision')).toBe(false)
    expect(isTerminalTurnStatus('completed')).toBe(true)
    expect(isTerminalTurnStatus('failed')).toBe(true)
    expect(isTerminalTurnStatus('cancelled')).toBe(true)
    expect(isTerminalTurnStatus('interrupted')).toBe(true)
  })
})
