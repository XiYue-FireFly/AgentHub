import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest } from '../../agentic/approval'
import { Dispatcher, type DispatchTask, type StreamEvent } from '../dispatcher'

const approval: ApprovalRequest = {
  stepId: 'step-1', agentId: 'codex', tool: 'exec', toolName: 'exec',
  label: 'Run tests', detail: 'npm test', action: 'run_command', target: 'npm test',
  risk: 'high', reason: 'Runs a command', preview: 'npm test'
}

function task(): DispatchTask {
  return {
    id: 'task-1', text: 'Run tests', mode: 'auto', targetAgent: 'codex', status: 'running',
    results: new Map(), thinking: new Map(), errors: new Map(), usage: new Map(),
    thinkingSummary: new Map(), createdAt: new Date(), __turnId: 'turn-1'
  }
}

describe('Dispatcher approval audit events', () => {
  it('records a durable-decision request and outcome without owning a waiter', async () => {
    const requestToolDecision = vi.fn(async ({ onRequested }: any) => {
      onRequested('decision-1')
      return false
    })
    const dispatcher = new (Dispatcher as any)(
      {}, { process: vi.fn() }, () => [], { requestToolDecision }
    ) as Dispatcher
    const events: StreamEvent[] = []
    dispatcher.on('stream', event => events.push(event))

    await expect((dispatcher as any).requestApprovalFor(task(), 'codex', approval)).resolves.toBe(false)

    expect(events.filter(event => event.kind === 'approval')).toEqual([
      expect.objectContaining({ status: 'pending', auditOnly: true, request: expect.objectContaining({ id: 'decision-1' }) }),
      expect.objectContaining({ status: 'denied', auditOnly: true, request: expect.objectContaining({ id: 'decision-1' }) })
    ])
  })

  it('does not invoke the adapter after scoped cancellation', async () => {
    const requestToolDecision = vi.fn(async () => true)
    const dispatcher = new (Dispatcher as any)(
      {}, { process: vi.fn() }, () => [], { requestToolDecision }
    ) as Dispatcher
    const active = task()
    ;(dispatcher as any).tasks.set(active.id, active)
    dispatcher.cancelAgent(active.id, 'codex')

    await expect((dispatcher as any).requestApprovalFor(active, 'codex', approval)).resolves.toBe(false)
    expect(requestToolDecision).not.toHaveBeenCalled()
  })
})
