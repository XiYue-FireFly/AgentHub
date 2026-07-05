import { describe, expect, it } from 'vitest'
import { approvalItemFromRuntimeEvent } from '../utils/approvalEvents'

function runtimeApproval(input: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: 'event-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    seq: 1,
    kind: 'agent:approval',
    agentId: 'codex',
    payload: {
      taskId: 'task-1',
      request: {
        id: 'appr-1',
        tool: 'exec',
        toolName: 'exec',
        label: 'Run command',
        detail: 'Command: npm test'
      }
    },
    createdAt: 1,
    ...input
  } as RuntimeEvent
}

describe('approvalItemFromRuntimeEvent', () => {
  it('maps runtime agent:approval events into approval dialog items', () => {
    expect(approvalItemFromRuntimeEvent(runtimeApproval())).toEqual({
      id: 'appr-1',
      taskId: 'task-1',
      agentId: 'codex',
      tool: 'exec',
      toolName: 'exec',
      label: 'Run command',
      detail: 'Command: npm test'
    })
  })

  it('falls back to turn id for task id and ignores malformed events', () => {
    expect(approvalItemFromRuntimeEvent(runtimeApproval({ payload: {
      request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' }
    } }))).toMatchObject({ id: 'appr-2', taskId: 'turn-1', tool: 'write' })

    expect(approvalItemFromRuntimeEvent(runtimeApproval({ kind: 'agent:activity' }))).toBeNull()
    expect(approvalItemFromRuntimeEvent(runtimeApproval({ payload: { request: { id: 'x', tool: 'read', toolName: 'fs_read' } } }))).toBeNull()
  })
})
