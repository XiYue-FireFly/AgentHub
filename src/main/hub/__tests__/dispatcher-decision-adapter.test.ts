import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest } from '../../agentic/approval'
import { Dispatcher, type DispatchTask, type StreamEvent } from '../dispatcher'
import { WorkbenchTurnRunner } from '../../runtime/workbench-turn-runner'

const request: ApprovalRequest = {
  stepId: 'step-1', agentId: 'codex', tool: 'exec', toolName: 'exec',
  label: 'Run tests', detail: 'npm test', action: 'run_command', target: 'npm test',
  risk: 'high', reason: 'Runs a command', preview: 'npm test'
}

const task: DispatchTask = {
  id: 'task-1', text: 'Run tests', mode: 'auto', targetAgent: 'codex', status: 'running',
  results: new Map(), thinking: new Map(), errors: new Map(), usage: new Map(),
  thinkingSummary: new Map(), createdAt: new Date(), __turnId: 'turn-1'
}

describe('Dispatcher durable tool decisions', () => {
  it('uses the injected trusted decision adapter and emits audit events in order', async () => {
    const requestToolDecision = vi.fn(async ({ onRequested }: any) => {
      onRequested('decision-1')
      return true
    })
    const dispatcher = new (Dispatcher as any)(
      {}, { process: vi.fn() }, () => [], { requestToolDecision }
    ) as Dispatcher
    const events: StreamEvent[] = []
    dispatcher.on('stream', event => events.push(event))

    await expect((dispatcher as any).requestApprovalFor(task, 'codex', request)).resolves.toBe(true)

    expect(requestToolDecision).toHaveBeenCalledWith(expect.objectContaining({
      task,
      agentId: 'codex',
      request,
      idempotencyKey: 'tool:task-1:codex:step-1'
    }))
    expect(events.filter(event => event.kind === 'approval')).toMatchObject([
      { status: 'pending', auditOnly: true, request: { id: 'decision-1' } },
      { status: 'approved', auditOnly: true, request: { id: 'decision-1' } }
    ])
  })

  it('fails closed without an injected trusted decision adapter', async () => {
    const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)

    await expect((dispatcher as any).requestApprovalFor(task, 'codex', request)).resolves.toBe(false)
  })

  it('cancels a durable decision before directly stopping a running task provider', async () => {
    let releaseDecision!: () => void
    const decision = new Promise<void>(resolve => { releaseDecision = resolve })
    const calls: string[] = []
    const dispatcher = new (Dispatcher as any)(
      {}, { process: vi.fn() }, () => [], {
        cancelDecisionTurn: async () => {
          calls.push('decision')
          await decision
        }
      }
    ) as Dispatcher
    const running = { ...task }
    ;(dispatcher as any).tasks.set(running.id, running)
    ;(dispatcher as any).activeAgentStops.set(`${running.id}:codex`, new Set([
      () => { calls.push('transport') }
    ]))

    const cancelling = dispatcher.cancelTurn('turn-1')
    await Promise.resolve()
    expect(calls).toEqual(['decision'])
    releaseDecision()
    await expect(cancelling).resolves.toBe(true)
    expect(calls).toEqual(['decision', 'transport'])
  })

  it('makes runner cancellation await durable decision cancellation before provider stop', async () => {
    let releaseDecision!: () => void
    const decision = new Promise<void>(resolve => { releaseDecision = resolve })
    const calls: string[] = []
    const dispatcher = new (Dispatcher as any)(
      {}, { process: vi.fn() }, () => [], {
        cancelDecisionTurn: async () => {
          calls.push('decision')
          await decision
        }
      }
    ) as Dispatcher
    const running = { ...task }
    ;(dispatcher as any).tasks.set(running.id, running)
    ;(dispatcher as any).activeAgentStops.set(`${running.id}:codex`, new Set([
      () => { calls.push('transport') }
    ]))
    const runner = new WorkbenchTurnRunner({
      runtimeStore: {} as any,
      execute: vi.fn(async () => undefined),
      cancel: async turnId => { await dispatcher.cancelTurn(turnId) }
    })

    const cancelling = runner.cancel('turn-1')
    await Promise.resolve()
    expect(calls).toEqual(['decision'])
    releaseDecision()
    await expect(cancelling).resolves.toBeUndefined()
    expect(calls).toEqual(['decision', 'transport'])
  })
})
