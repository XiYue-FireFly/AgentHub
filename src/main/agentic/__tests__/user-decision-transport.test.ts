import { describe, expect, it, vi } from 'vitest'
import {
  continueAgentDecisionEvent,
  parseAgentDecisionRequestEvent
} from '../user-decision-transport'

const request = {
  idempotencyKey: 'scope-step',
  title: 'Choose scope',
  options: [
    { id: 'focused', label: 'Focused repair' },
    { id: 'full', label: 'Full audit' }
  ],
  selectionMode: 'single' as const,
  minSelections: 1,
  maxSelections: 1,
  allowCustom: false
}

describe('structured Agent decision transport', () => {
  it('accepts only an object decision_request event and never parses prose', async () => {
    expect(parseAgentDecisionRequestEvent('Please choose A or B')).toBeNull()
    expect(parseAgentDecisionRequestEvent(JSON.stringify({
      type: 'decision_request',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      continuation: { mode: 'live' },
      request
    }))).toBeNull()

    const event = parseAgentDecisionRequestEvent({
      type: 'decision_request',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      continuation: { mode: 'live' },
      request
    })
    expect(event).toMatchObject({ type: 'decision_request', requestId: 'request-1' })

    const requestUserDecision = vi.fn()
    const outcome = await continueAgentDecisionEvent({
      protocol: 'stdio-plain',
      event: 'Please choose A or B',
      requestUserDecision
    })
    expect(requestUserDecision).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      status: 'unavailable',
      delivery: 'best-effort',
      reason: 'structured-decision-unsupported'
    })
  })

  it('resumes a live-capable structured session with a decision_result event', async () => {
    const resumeLive = vi.fn(async () => undefined)
    const redispatchCheckpoint = vi.fn(async () => undefined)
    const outcome = await continueAgentDecisionEvent({
      protocol: 'stdio-ndjson',
      event: {
        type: 'decision_request',
        version: 1,
        requestId: 'request-1',
        sessionId: 'session-1',
        continuation: { mode: 'live' },
        request
      },
      requestUserDecision: vi.fn(async () => ({
        status: 'selected' as const,
        selectedOptionIds: ['focused'],
        resolvedAt: 20
      })),
      resumeLive,
      redispatchCheckpoint
    })

    expect(resumeLive).toHaveBeenCalledWith({
      type: 'decision_result',
      version: 1,
      requestId: 'request-1',
      sessionId: 'session-1',
      resolution: {
        status: 'selected',
        selectedOptionIds: ['focused'],
        resolvedAt: 20
      }
    })
    expect(redispatchCheckpoint).not.toHaveBeenCalled()
    expect(outcome.status).toBe('resumed-live')
  })
})
