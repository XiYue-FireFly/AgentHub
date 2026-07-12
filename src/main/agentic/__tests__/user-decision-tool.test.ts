import { describe, expect, it } from 'vitest'
import {
  parseAgentDecisionInput,
  type AgentDecisionResolution
} from '../user-decision-tool'

// @ts-expect-error Agent decision resolutions must always retain their resolution timestamp.
const missingResolvedAt: AgentDecisionResolution = { status: 'selected' }
void missingResolvedAt

describe('parseAgentDecisionInput', () => {
  it('rejects duplicate option ids', () => {
    expect(() => parseAgentDecisionInput({
      idempotencyKey: 'step-1',
      title: 'Choose scope',
      options: [
        { id: 'same', label: 'A' },
        { id: 'same', label: 'B' }
      ]
    })).toThrow(/unique/)
  })

  it('rejects unsupported fields', () => {
    expect(() => parseAgentDecisionInput({
      idempotencyKey: 'step-2',
      title: 'Approve command',
      options: [{ id: 'yes', label: 'Yes' }],
      risk: 'critical'
    })).toThrow('unsupported field: risk')
  })
})
