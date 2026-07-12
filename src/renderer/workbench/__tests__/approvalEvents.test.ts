import { describe, expect, it } from 'vitest'
import {
  approvalAuditFromRuntimeEvent,
  reconcileApprovalAuditEvents
} from '../utils/approvalEvents'

function approvalEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: 'event-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    kind: 'agent:approval',
    agentId: 'codex',
    payload: {
      auditOnly: true,
      taskId: 'task-1',
      request: { id: 'approval-1' },
      status: 'pending'
    },
    seq: 1,
    createdAt: 1,
    ...overrides
  } as RuntimeEvent
}

describe('approval audit events', () => {
  it('parses audit-only approval records without exposing a submission action', () => {
    expect(approvalAuditFromRuntimeEvent(approvalEvent())).toEqual({
      id: 'approval-1',
      turnId: 'turn-1',
      agentId: 'codex',
      taskId: 'task-1',
      status: 'pending'
    })
  })

  it('ignores interactive legacy approval events', () => {
    expect(approvalAuditFromRuntimeEvent(approvalEvent({
      payload: { request: { id: 'approval-1' }, status: 'pending' }
    }))).toBeNull()
  })

  it('keeps only the latest immutable audit record for an approval', () => {
    expect(reconcileApprovalAuditEvents([
      approvalEvent(),
      approvalEvent({
        id: 'event-2',
        seq: 2,
        payload: {
          auditOnly: true,
          request: { id: 'approval-1' },
          status: 'denied'
        }
      })
    ])).toEqual([
      expect.objectContaining({ id: 'approval-1', status: 'denied' })
    ])
  })
})
