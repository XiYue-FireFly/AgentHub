import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePendingApproval, savePendingApproval, type ApprovalRequest } from '../../agentic/approval'
import { Dispatcher, type DispatchTask, type StreamEvent } from '../dispatcher'
import { installTaskTurnTracking } from '../task-turn-tracking'

vi.mock('../../agentic/approval', () => ({
  getApprovalConfig: () => ({ policyFor: () => 'ask', policyForRisk: () => 'ask' }),
  savePendingApproval: vi.fn(),
  resolvePendingApproval: vi.fn(),
  expireStalePendingApprovals: vi.fn(() => 0),
  assessApprovalRisk: vi.fn(() => 'high'),
  approvalReason: vi.fn(() => 'Approval required')
}))

const request: ApprovalRequest = {
  stepId: 'step-1',
  agentId: 'codex',
  tool: 'exec',
  toolName: 'exec',
  label: 'Run tests',
  detail: 'npm test',
  action: 'run_command',
  target: 'npm test',
  risk: 'high',
  reason: 'Runs a command',
  preview: 'npm test'
}

function makeTask(id = 'task-1'): DispatchTask {
  return {
    id,
    text: 'Run tests',
    mode: 'auto',
    targetAgent: 'codex',
    status: 'running',
    results: new Map(),
    thinking: new Map(),
    errors: new Map(),
    usage: new Map(),
    thinkingSummary: new Map(),
    createdAt: new Date('2026-07-10T00:00:00.000Z')
  }
}

function setup() {
  const dispatcher = new Dispatcher({} as any, { process: vi.fn() } as any)
  const events: StreamEvent[] = []
  const timeline: string[] = []
  const runtimeStore = { attachTask: vi.fn(async (_turnId: string, _taskId: string) => undefined), appendStreamEvent: vi.fn(async (_turnId: string, _event: any) => undefined) }
  installTaskTurnTracking(dispatcher, runtimeStore)
  dispatcher.on('stream', event => {
    events.push(event)
    if (event.kind === 'approval') timeline.push(event.status || 'missing-status')
  })
  const task = makeTask()
  dispatcher.emit('task:created', { ...task, __turnId: 'turn-1' } as any)
  return { dispatcher, events, runtimeStore, task, timeline }
}

function requestApproval(
  dispatcher: Dispatcher,
  task: DispatchTask,
  agentId = 'codex'
): Promise<boolean> {
  return (dispatcher as any).requestApprovalFor(task, agentId, { ...request, agentId })
}

function approvalEvents(events: StreamEvent[]) {
  return events.filter((event): event is Extract<StreamEvent, { kind: 'approval' }> => event.kind === 'approval')
}

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(savePendingApproval).mockReset()
  vi.mocked(resolvePendingApproval).mockReset()
  vi.restoreAllMocks()
})

describe('Dispatcher approval resolution events', () => {
  it('fails closed without leaking a timer, map entry, or stream when pending persistence fails', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(savePendingApproval).mockImplementationOnce(() => { throw new Error('store unavailable') })
    const { dispatcher, events, task } = setup()

    const pending = requestApproval(dispatcher, task)

    await expect(pending).resolves.toBe(false)
    expect((dispatcher as any).pendingApprovals.size).toBe(0)
    expect(approvalEvents(events)).toEqual([])
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(approvalEvents(events)).toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it.each([
    [true, 'approved'],
    [false, 'denied']
  ] as const)('settles a user %s decision even when resolution persistence throws', async (approved, status) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolvePendingApproval).mockImplementationOnce(() => { throw new Error('store unavailable') })
    const { dispatcher, events, task } = setup()
    const pending = requestApproval(dispatcher, task)
    const requestId = approvalEvents(events)[0].request.id

    expect(() => dispatcher.resolveApproval(requestId, approved)).not.toThrow()
    await expect(pending).resolves.toBe(approved)
    expect((dispatcher as any).pendingApprovals.size).toBe(0)
    expect(approvalEvents(events).at(-1)).toMatchObject({ status, request: { id: requestId } })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('continues cancelAgent settlement for every matching approval when persistence throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolvePendingApproval).mockImplementation(() => { throw new Error('store unavailable') })
    const { dispatcher, events, task } = setup()
    ;(dispatcher as any).tasks.set(task.id, task)
    const first = requestApproval(dispatcher, task, 'codex')
    const second = requestApproval(dispatcher, task, 'codex')
    const ids = approvalEvents(events).filter(event => event.status === 'pending').map(event => event.request.id)

    expect(() => dispatcher.cancelAgent(task.id, 'codex')).not.toThrow()
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
    expect(approvalEvents(events).filter(event => event.status === 'denied').map(event => event.request.id)).toEqual(ids)
    expect((dispatcher as any).pendingApprovals.size).toBe(0)
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })

  it('settles task cancellation when resolution persistence throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolvePendingApproval).mockImplementationOnce(() => { throw new Error('store unavailable') })
    const { dispatcher, events, task } = setup()
    ;(dispatcher as any).tasks.set(task.id, task)
    const pending = requestApproval(dispatcher, task)

    expect(() => dispatcher.cancel(task.id)).not.toThrow()
    await expect(pending).resolves.toBe(false)
    expect(approvalEvents(events).at(-1)).toMatchObject({ status: 'denied' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('settles approval timeout when resolution persistence throws', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolvePendingApproval).mockImplementationOnce(() => { throw new Error('store unavailable') })
    const { dispatcher, events, task } = setup()
    const pending = requestApproval(dispatcher, task)

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await expect(pending).resolves.toBe(false)
    expect(approvalEvents(events).at(-1)).toMatchObject({ status: 'denied' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('settles every task approval before any finishTask terminal event and clears their timers', async () => {
    vi.useFakeTimers()
    const { dispatcher, events, task, timeline } = setup()
    dispatcher.on('task:finished', () => timeline.push('task:finished'))
    const first = requestApproval(dispatcher, task, 'codex')
    const second = requestApproval(dispatcher, task, 'claude')
    const requestIds = approvalEvents(events).map(event => event.request.id)

    ;(dispatcher as any).finishTask(task)

    expect((dispatcher as any).pendingApprovals.size).toBe(0)
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
    expect(timeline).toEqual(['pending', 'pending', 'denied', 'denied', 'task:finished'])
    expect(requestIds.map(id => dispatcher.resolveApproval(id, true))).toEqual([false, false])
    expect(vi.mocked(resolvePendingApproval).mock.calls).toEqual(requestIds.map(id => [id, 'denied']))

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(approvalEvents(events).filter(event => event.status === 'denied')).toHaveLength(2)
  })

  it('fails closed when a late approval arrives after the task has finished', async () => {
    vi.useFakeTimers()
    const { dispatcher, events, task } = setup()
    task.status = 'completed'
    ;(dispatcher as any).finishTask(task)
    vi.mocked(savePendingApproval).mockClear()
    const eventsBeforeLateRequest = approvalEvents(events)

    const lateApproval = requestApproval(dispatcher, task)

    expect((dispatcher as any).pendingApprovals.size).toBe(0)
    await expect(lateApproval).resolves.toBe(false)
    expect(approvalEvents(events)).toEqual(eventsBeforeLateRequest)
    expect(savePendingApproval).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses globally unique request ids across fresh Dispatcher instances', async () => {
    const first = setup()
    const second = setup()
    const firstPending = requestApproval(first.dispatcher, first.task)
    const secondPending = requestApproval(second.dispatcher, second.task)
    const firstId = approvalEvents(first.events)[0].request.id
    const secondId = approvalEvents(second.events)[0].request.id

    expect(firstId).toMatch(/^appr-task-1-/)
    expect(secondId).toMatch(/^appr-task-1-/)
    expect(firstId).not.toBe(secondId)

    first.dispatcher.resolveApproval(firstId, false)
    second.dispatcher.resolveApproval(secondId, false)
    await Promise.all([firstPending, secondPending])
  })

  it('returns an exact read-only snapshot of live pending approval ids', async () => {
    const { dispatcher, events, task } = setup()
    const first = requestApproval(dispatcher, task, 'codex')
    const second = requestApproval(dispatcher, task, 'claude')
    const requestIds = approvalEvents(events).map(event => event.request.id)

    const snapshot = dispatcher.getPendingApprovalIds()
    expect(snapshot).toEqual(requestIds)
    snapshot.pop()
    expect(dispatcher.getPendingApprovalIds()).toEqual(requestIds)

    dispatcher.resolveApproval(requestIds[0], false)
    expect(dispatcher.getPendingApprovalIds()).toEqual([requestIds[1]])
    dispatcher.resolveApproval(requestIds[1], false)
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
  })

  it('cancels approvals by pending task metadata instead of the request id prefix', async () => {
    const { dispatcher, events, task } = setup()
    ;(dispatcher as any).tasks.set(task.id, task)
    const result = requestApproval(dispatcher, task)
    const pendingApprovals = (dispatcher as any).pendingApprovals as Map<string, any>
    const [generatedId, pending] = [...pendingApprovals.entries()][0]
    const opaqueId = 'opaque-request-id'
    pendingApprovals.delete(generatedId)
    pending.request = { ...pending.request, id: opaqueId }
    pendingApprovals.set(opaqueId, pending)

    expect(dispatcher.cancel(task.id)).toBe(true)
    expect(approvalEvents(events).at(-1)).toMatchObject({ status: 'denied', request: { id: opaqueId } })
    await expect(result).resolves.toBe(false)
  })

  it.each([
    [true, 'approved'],
    [false, 'denied']
  ] as const)('emits and persists a %s decision before resolving the pending request', async (approved, status) => {
    const { dispatcher, events, runtimeStore, task, timeline } = setup()
    const pending = requestApproval(dispatcher, task).then(value => {
      timeline.push(`resolved:${value}`)
      return value
    })
    const requestId = approvalEvents(events)[0].request.id

    expect(dispatcher.resolveApproval(requestId, approved)).toBe(true)
    await expect(pending).resolves.toBe(approved)

    const emitted = approvalEvents(events)
    expect(emitted).toHaveLength(2)
    expect(emitted[0]).toMatchObject({
      kind: 'approval', taskId: 'task-1', agentId: 'codex', status: 'pending', request: { stepId: 'step-1' }
    })
    expect(emitted[1]).toMatchObject({
      kind: 'approval',
      taskId: 'task-1',
      agentId: 'codex',
      status,
      request: { id: requestId, tool: 'exec', toolName: 'exec' }
    })
    expect(emitted[1].request).toEqual(emitted[0].request)
    expect(timeline).toEqual(['pending', status, `resolved:${approved}`])
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('turn-1', expect.objectContaining({
      kind: 'approval', status, request: expect.objectContaining({ id: requestId })
    }))
  })

  it('emits and persists denial before an approval timeout resolves', async () => {
    vi.useFakeTimers()
    const { dispatcher, events, runtimeStore, task, timeline } = setup()
    const pending = requestApproval(dispatcher, task).then(value => {
      timeline.push(`resolved:${value}`)
      return value
    })
    const requestId = approvalEvents(events)[0].request.id

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await expect(pending).resolves.toBe(false)

    expect(approvalEvents(events).at(-1)).toMatchObject({
      taskId: 'task-1', agentId: 'codex', status: 'denied', request: { id: requestId }
    })
    expect(timeline).toEqual(['pending', 'denied', 'resolved:false'])
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('turn-1', expect.objectContaining({ status: 'denied' }))
  })

  it('emits and persists denial before task cancellation resolves pending approvals', async () => {
    const { dispatcher, events, runtimeStore, task, timeline } = setup()
    ;(dispatcher as any).tasks.set(task.id, task)
    const pending = requestApproval(dispatcher, task).then(value => {
      timeline.push(`resolved:${value}`)
      return value
    })
    const requestId = approvalEvents(events)[0].request.id

    expect(dispatcher.cancel(task.id)).toBe(true)
    await expect(pending).resolves.toBe(false)

    expect(approvalEvents(events).at(-1)).toMatchObject({
      taskId: 'task-1', agentId: 'codex', status: 'denied', request: { id: requestId }
    })
    expect(timeline).toEqual(['pending', 'denied', 'resolved:false'])
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith('turn-1', expect.objectContaining({ status: 'denied' }))
  })

  it('cancelAgent denies only matching pending approvals and clears their timeout', async () => {
    vi.useFakeTimers()
    const { dispatcher, events, task } = setup()
    const otherTask = makeTask('task-2')
    ;(dispatcher as any).tasks.set(task.id, task)
    ;(dispatcher as any).tasks.set(otherTask.id, otherTask)

    const matching = requestApproval(dispatcher, task, 'codex')
    const sameTaskOtherAgent = requestApproval(dispatcher, task, 'claude')
    const otherTaskSameAgent = requestApproval(dispatcher, otherTask, 'codex')
    const pendingEvents = approvalEvents(events).filter(event => event.status === 'pending')
    const matchingId = pendingEvents[0].request.id
    const otherAgentId = pendingEvents[1].request.id
    const otherTaskId = pendingEvents[2].request.id

    expect(dispatcher.cancelAgent(task.id, 'codex')).toBe(true)
    expect(approvalEvents(events).filter(event => event.status === 'denied').map(event => event.request.id)).toEqual([matchingId])
    await expect(matching).resolves.toBe(false)
    expect(resolvePendingApproval).toHaveBeenCalledWith(matchingId, 'denied')

    expect(dispatcher.resolveApproval(otherAgentId, true)).toBe(true)
    expect(dispatcher.resolveApproval(otherTaskId, true)).toBe(true)
    await expect(sameTaskOtherAgent).resolves.toBe(true)
    await expect(otherTaskSameAgent).resolves.toBe(true)

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(approvalEvents(events).filter(event => event.status === 'denied').map(event => event.request.id)).toEqual([matchingId])
  })

  it('does not create a new approval after scoped agent cancellation is tombstoned', async () => {
    vi.useFakeTimers()
    const { dispatcher, events, task } = setup()
    ;(dispatcher as any).tasks.set(task.id, task)

    expect(dispatcher.cancelAgent(task.id, 'codex')).toBe(true)
    const approval = requestApproval(dispatcher, task, 'codex')

    expect(approvalEvents(events)).toEqual([])
    expect((dispatcher as any).pendingApprovals.size).toBe(0)
    expect(savePendingApproval).not.toHaveBeenCalled()
    await expect(approval).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(approvalEvents(events)).toEqual([])
  })
})
