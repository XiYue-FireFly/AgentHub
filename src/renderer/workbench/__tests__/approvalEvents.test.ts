import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import type { ApprovalItem } from '../../glass/approval-dialog'
import { setLang } from '../../glass/i18n'
import * as approvalEvents from '../utils/approvalEvents'

const { approvalItemFromRuntimeEvent } = approvalEvents

type PendingApprovalItemsFromEvents = (events: RuntimeEvent[]) => ApprovalItem[]
type ReduceApprovalItemsFromRuntimeEvent = (items: ApprovalItem[], event: RuntimeEvent) => ApprovalItem[]
type ReconcileApprovalItemsWithHistory = (
  items: ApprovalItem[],
  events: RuntimeEvent[],
  activeIds?: ReadonlySet<string> | null
) => ApprovalItem[]
type ApprovalDecisionHandler = {
  decide: (item: ApprovalItem, approved: boolean, remember: boolean) => Promise<{
    outcome: 'resolved' | 'not-found' | 'failed' | 'busy'
    error?: unknown
    rememberError?: unknown
  }>
}
type CreateApprovalDecisionHandler = (api: {
  resolveApproval: (requestId: string, approved: boolean) => Promise<boolean>
  setApprovalOverride: (agentId: string, tool: 'write' | 'exec', policy: 'allow' | 'deny') => Promise<unknown>
}) => ApprovalDecisionHandler
type ApprovalDecisionPresentation = (result: Awaited<ReturnType<ApprovalDecisionHandler['decide']>>) => {
  remove: boolean
  error?: string
  notice?: string
}

const pendingApprovalItemsFromEvents = (approvalEvents as unknown as {
  pendingApprovalItemsFromEvents?: PendingApprovalItemsFromEvents
}).pendingApprovalItemsFromEvents
const reduceApprovalItemsFromRuntimeEvent = (approvalEvents as unknown as {
  reduceApprovalItemsFromRuntimeEvent?: ReduceApprovalItemsFromRuntimeEvent
}).reduceApprovalItemsFromRuntimeEvent
const reconcileApprovalItemsWithHistory = (approvalEvents as unknown as {
  reconcileApprovalItemsWithHistory?: ReconcileApprovalItemsWithHistory
}).reconcileApprovalItemsWithHistory
const createApprovalDecisionHandler = (approvalEvents as unknown as {
  createApprovalDecisionHandler?: CreateApprovalDecisionHandler
}).createApprovalDecisionHandler
const approvalDecisionPresentation = (approvalEvents as unknown as {
  approvalDecisionPresentation?: ApprovalDecisionPresentation
}).approvalDecisionPresentation

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
        stepId: 'step-1',
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

  it('does not map approval resolution events back into pending dialog items', () => {
    expect(approvalItemFromRuntimeEvent(runtimeApproval({
      seq: 2,
      payload: {
        taskId: 'task-1',
        status: 'approved',
        request: { id: 'appr-1', tool: 'exec', toolName: 'exec' }
      }
    }))).toBeNull()
  })
})

describe('reduceApprovalItemsFromRuntimeEvent', () => {
  it('removes an existing pending item when its realtime resolution arrives', () => {
    expect(reduceApprovalItemsFromRuntimeEvent).toBeTypeOf('function')
    if (!reduceApprovalItemsFromRuntimeEvent) return
    const pending = approvalItemFromRuntimeEvent(runtimeApproval())!
    const unrelated = { ...pending, id: 'appr-other' }
    const resolution = runtimeApproval({
      seq: 2,
      payload: {
        taskId: 'task-1',
        status: 'denied',
        request: { id: 'appr-1', tool: 'exec', toolName: 'exec' }
      }
    })

    expect(reduceApprovalItemsFromRuntimeEvent([pending, unrelated], resolution)).toEqual([unrelated])
  })
})

describe('pendingApprovalItemsFromEvents', () => {
  it('restores a pending approval from loaded runtime history', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return

    expect(pendingApprovalItemsFromEvents([runtimeApproval()])).toEqual([
      expect.objectContaining({ id: 'appr-1', taskId: 'task-1', agentId: 'codex' })
    ])
  })

  it('does not restore approvals followed by agent progress or an explicit resolution', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return

    const progressed: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-2',
      seq: 2,
      kind: 'agent:activity',
      payload: { taskId: 'task-1', step: { id: 'step-1', status: 'completed' } }
    }
    const explicitResolution: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-3',
      seq: 3,
      payload: { requestId: 'appr-2', status: 'approved' }
    }

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      progressed,
      runtimeApproval({
        id: 'event-4',
        seq: 4,
        payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
      }),
      { ...explicitResolution, seq: 5 }
    ])).toEqual([])
  })

  it('does not restore approvals whose agent run or turn is terminal', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return

    const terminalRun: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-terminal-run',
      seq: 2,
      kind: 'run:status',
      payload: { taskId: 'task-1', status: 'failed' }
    }
    const second = runtimeApproval({
      id: 'event-second-approval',
      turnId: 'turn-2',
      seq: 3,
      payload: { taskId: 'task-2', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
    })
    const terminalTurn: RuntimeEvent = {
      ...second,
      id: 'event-terminal-turn',
      seq: 4,
      kind: 'turn:status',
      agentId: undefined,
      payload: { status: 'cancelled' }
    }

    expect(pendingApprovalItemsFromEvents([runtimeApproval(), terminalRun, second, terminalTurn])).toEqual([])
  })

  it('sorts out-of-order history and deduplicates repeated approval requests', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return

    const first = runtimeApproval()
    const resolvedFirst: RuntimeEvent = {
      ...first,
      id: 'event-progress',
      seq: 2,
      kind: 'agent:delta',
      payload: { taskId: 'task-1', approvalId: 'appr-1', text: 'continued' }
    }
    const second = runtimeApproval({
      id: 'event-second',
      seq: 3,
      payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
    })
    const duplicateSecond = { ...second, id: 'event-second-duplicate', seq: 4 }

    expect(pendingApprovalItemsFromEvents([duplicateSecond, resolvedFirst, second, first])).toEqual([
      expect.objectContaining({ id: 'appr-2', tool: 'write' })
    ])
  })

  it('keeps distinct pending ids in the same run scope and deduplicates only the same id', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const second = runtimeApproval({
      id: 'event-second',
      seq: 2,
      payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
    })

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      second,
      { ...second, id: 'event-second-duplicate', seq: 3 }
    ]).map(item => item.id)).toEqual(['appr-1', 'appr-2'])
  })

  it('removes only the approval whose stepId matches realtime progress in a shared scope', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const second = runtimeApproval({
      id: 'event-second',
      seq: 2,
      payload: {
        taskId: 'task-1',
        request: { id: 'appr-2', stepId: 'step-2', tool: 'write', toolName: 'fs_write' }
      }
    })
    const progress: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-progress',
      seq: 3,
      kind: 'agent:activity',
      payload: { taskId: 'task-1', step: { id: 'step-1', status: 'completed' } }
    }

    expect(pendingApprovalItemsFromEvents([runtimeApproval(), second, progress]).map(item => item.id)).toEqual(['appr-2'])
  })

  it.each([
    ['an unrelated step', { taskId: 'task-1', step: { id: 'step-other', status: 'completed' } }],
    ['no explicit approval reference', { taskId: 'task-1', activity: 'still working' }]
  ])('keeps all shared-scope approvals for progress with %s', (_label, payload) => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const second = runtimeApproval({
      id: 'event-second',
      seq: 2,
      payload: {
        taskId: 'task-1',
        request: { id: 'appr-2', stepId: 'step-2', tool: 'write', toolName: 'fs_write' }
      }
    })
    const progress: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-progress',
      seq: 3,
      kind: 'agent:activity',
      payload
    }

    expect(pendingApprovalItemsFromEvents([runtimeApproval(), second, progress]).map(item => item.id)).toEqual(['appr-1', 'appr-2'])
  })

  it('closes the only legacy pending approval in scope when unreferenced progress arrives', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const legacy = runtimeApproval({
      payload: {
        taskId: 'task-1',
        request: { id: 'appr-legacy', tool: 'exec', toolName: 'exec' }
      }
    })
    const progress: RuntimeEvent = {
      ...legacy,
      id: 'event-progress',
      seq: 2,
      kind: 'agent:activity',
      payload: { taskId: 'task-1', activity: 'continued' }
    }

    expect(pendingApprovalItemsFromEvents([legacy, progress])).toEqual([])
  })

  it('keeps multiple legacy pending approvals when progress has no explicit reference', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const first = runtimeApproval({
      payload: {
        taskId: 'task-1',
        request: { id: 'appr-legacy-1', tool: 'exec', toolName: 'exec' }
      }
    })
    const second = runtimeApproval({
      id: 'event-second',
      seq: 2,
      payload: {
        taskId: 'task-1',
        request: { id: 'appr-legacy-2', tool: 'write', toolName: 'fs_write' }
      }
    })
    const progress: RuntimeEvent = {
      ...first,
      id: 'event-progress',
      seq: 3,
      kind: 'agent:activity',
      payload: { taskId: 'task-1', activity: 'continued' }
    }

    expect(pendingApprovalItemsFromEvents([first, second, progress]).map(item => item.id)).toEqual([
      'appr-legacy-1',
      'appr-legacy-2'
    ])
  })

  it('removes only the explicitly referenced request id from shared-scope progress', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const second = runtimeApproval({
      id: 'event-second',
      seq: 2,
      payload: {
        taskId: 'task-1',
        request: { id: 'appr-2', stepId: 'step-2', tool: 'write', toolName: 'fs_write' }
      }
    })
    const progress: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-progress',
      seq: 3,
      kind: 'agent:activity',
      payload: { taskId: 'task-1', requestId: 'appr-1' }
    }

    expect(pendingApprovalItemsFromEvents([runtimeApproval(), second, progress]).map(item => item.id)).toEqual(['appr-2'])
  })

  it.each([
    ['explicit resolution', runtimeApproval({
      id: 'event-resolution',
      seq: 2,
      payload: {
        taskId: 'task-1',
        status: 'approved',
        request: { id: 'appr-1', tool: 'exec', toolName: 'exec', label: 'Run command' }
      }
    })],
    ['agent progress', {
      ...runtimeApproval(),
      id: 'event-progress',
      seq: 2,
      kind: 'agent:activity',
      payload: { taskId: 'task-1', step: { id: 'step-1', status: 'completed' } }
    } as RuntimeEvent]
  ])('does not resurrect a tombstoned id after %s while allowing a new id', (_label, closingEvent) => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const newRequest = runtimeApproval({
      id: 'event-new-request',
      seq: 3,
      payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
    })
    const repeatedClosedRequest = runtimeApproval({ id: 'event-repeat-closed', seq: 4 })

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      closingEvent,
      newRequest,
      repeatedClosedRequest
    ]).map(item => item.id)).toEqual(['appr-2'])
  })

  it('does not resurrect approvals after their turn is terminal', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const terminalTurn: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-terminal-turn',
      seq: 2,
      kind: 'turn:status',
      agentId: undefined,
      payload: { status: 'completed' }
    }

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      terminalTurn,
      runtimeApproval({ id: 'event-repeat', seq: 3 }),
      runtimeApproval({
        id: 'event-new',
        seq: 4,
        payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
      })
    ])).toEqual([])
  })

  it('does not resurrect approvals after their run scope is terminal', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const terminalRun: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-terminal-run',
      seq: 2,
      kind: 'run:status',
      payload: { taskId: 'task-1', status: 'failed' }
    }

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      terminalRun,
      runtimeApproval({ id: 'event-repeat', seq: 3 }),
      runtimeApproval({
        id: 'event-new',
        seq: 4,
        payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
      })
    ])).toEqual([])
  })

  it('restores a new approval after agent:start opens a new run epoch without reviving old ids', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const done: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-done',
      seq: 2,
      kind: 'agent:done',
      payload: { taskId: 'task-1' }
    }
    const restarted: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-restart',
      seq: 3,
      kind: 'agent:start',
      payload: { taskId: 'task-1' }
    }
    const nextApproval = runtimeApproval({
      id: 'event-next-approval',
      seq: 4,
      payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
    })

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      done,
      restarted,
      nextApproval,
      runtimeApproval({ id: 'event-old-repeat', seq: 5 })
    ]).map(item => item.id)).toEqual(['appr-2'])
  })

  it('restores a new approval after run:created opens a new run epoch without reviving old ids', () => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const terminalRun: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-terminal-run',
      seq: 2,
      kind: 'run:status',
      payload: { taskId: 'task-1', status: 'failed' }
    }
    const nextRun: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-next-run',
      seq: 3,
      kind: 'run:created',
      payload: { id: 'run-2', turnId: 'turn-1', agentId: 'codex', status: 'running' }
    }
    const nextApproval = runtimeApproval({
      id: 'event-next-approval',
      seq: 4,
      payload: { taskId: 'task-1', request: { id: 'appr-2', tool: 'write', toolName: 'fs_write' } }
    })

    expect(pendingApprovalItemsFromEvents([
      runtimeApproval(),
      terminalRun,
      nextRun,
      nextApproval,
      runtimeApproval({ id: 'event-old-repeat', seq: 5 })
    ]).map(item => item.id)).toEqual(['appr-2'])
  })

  it.each([
    ['missing sequence', undefined],
    ['equal sequence', 1]
  ])('orders ISO createdAt values when sequence is %s', (_label, seq) => {
    expect(pendingApprovalItemsFromEvents).toBeTypeOf('function')
    if (!pendingApprovalItemsFromEvents) return
    const withOrder = (event: RuntimeEvent, createdAt: string): RuntimeEvent => ({
      ...event,
      seq: seq as unknown as number,
      createdAt: createdAt as unknown as number
    })
    const requestBeforeTerminal = withOrder(runtimeApproval({ id: 'event-early' }), '2026-07-10T01:00:00.000Z')
    const terminal = withOrder({
      ...runtimeApproval(),
      id: 'event-terminal',
      kind: 'turn:status',
      agentId: undefined,
      payload: { status: 'completed' }
    }, '2026-07-10T01:01:00.000Z')
    const requestAfterTerminal = withOrder(runtimeApproval({ id: 'event-late' }), '2026-07-10T01:02:00.000Z')

    expect(pendingApprovalItemsFromEvents([
      requestAfterTerminal,
      terminal,
      requestBeforeTerminal
    ])).toEqual([])
  })
})

describe('reconcileApprovalItemsWithHistory', () => {
  it('does not restore a historical pending approval that is no longer active after restart', () => {
    expect(reconcileApprovalItemsWithHistory).toBeTypeOf('function')
    if (!reconcileApprovalItemsWithHistory) return

    expect(reconcileApprovalItemsWithHistory([], [runtimeApproval()], new Set())).toEqual([])
  })

  it('restores a historical pending approval that is still active', () => {
    expect(reconcileApprovalItemsWithHistory).toBeTypeOf('function')
    if (!reconcileApprovalItemsWithHistory) return

    expect(reconcileApprovalItemsWithHistory([], [runtimeApproval()], new Set(['appr-1']))).toEqual([
      expect.objectContaining({ id: 'appr-1' })
    ])
  })

  it('does not remove an existing approval from another thread while reconciling history', () => {
    expect(reconcileApprovalItemsWithHistory).toBeTypeOf('function')
    if (!reconcileApprovalItemsWithHistory) return
    const otherThread = {
      ...approvalItemFromRuntimeEvent(runtimeApproval())!,
      id: 'appr-other',
      taskId: 'task-other'
    }

    expect(reconcileApprovalItemsWithHistory([otherThread], [runtimeApproval()], new Set())).toEqual([otherThread])
  })

  it('conservatively restores history when the active-id query fails', () => {
    expect(reconcileApprovalItemsWithHistory).toBeTypeOf('function')
    if (!reconcileApprovalItemsWithHistory) return

    expect(reconcileApprovalItemsWithHistory([], [runtimeApproval()], null)).toEqual([
      expect.objectContaining({ id: 'appr-1' })
    ])
  })

  it('does not restore an interrupted turn approval when the active-id query fails', () => {
    expect(reconcileApprovalItemsWithHistory).toBeTypeOf('function')
    if (!reconcileApprovalItemsWithHistory) return
    const interrupted: RuntimeEvent = {
      ...runtimeApproval(),
      id: 'event-interrupted',
      seq: 2,
      kind: 'turn:status',
      agentId: undefined,
      payload: { status: 'interrupted' }
    }

    expect(reconcileApprovalItemsWithHistory([], [runtimeApproval(), interrupted], null)).toEqual([])
  })
})

describe('createApprovalDecisionHandler', () => {
  const approval = approvalItemFromRuntimeEvent(runtimeApproval())!

  it('awaits a successful resolution before persisting a remembered decision', async () => {
    expect(createApprovalDecisionHandler).toBeTypeOf('function')
    if (!createApprovalDecisionHandler) return
    const calls: string[] = []
    const resolveApproval = vi.fn(async () => { calls.push('resolve'); return true })
    const setApprovalOverride = vi.fn(async () => { calls.push('remember') })
    const handler = createApprovalDecisionHandler({ resolveApproval, setApprovalOverride })

    await expect(handler.decide(approval, true, true)).resolves.toMatchObject({ outcome: 'resolved' })
    expect(calls).toEqual(['resolve', 'remember'])
    expect(setApprovalOverride).toHaveBeenCalledWith('codex', 'exec', 'allow')
  })

  it('keeps a not-found request retryable and never remembers it', async () => {
    expect(createApprovalDecisionHandler).toBeTypeOf('function')
    if (!createApprovalDecisionHandler) return
    const setApprovalOverride = vi.fn()
    const handler = createApprovalDecisionHandler({
      resolveApproval: vi.fn().mockResolvedValue(false),
      setApprovalOverride
    })

    await expect(handler.decide(approval, false, true)).resolves.toMatchObject({ outcome: 'not-found' })
    expect(setApprovalOverride).not.toHaveBeenCalled()
  })

  it('keeps a rejected submission retryable and never remembers it', async () => {
    expect(createApprovalDecisionHandler).toBeTypeOf('function')
    if (!createApprovalDecisionHandler) return
    const error = new Error('IPC unavailable')
    const setApprovalOverride = vi.fn()
    const handler = createApprovalDecisionHandler({
      resolveApproval: vi.fn().mockRejectedValue(error),
      setApprovalOverride
    })

    await expect(handler.decide(approval, true, true)).resolves.toEqual({ outcome: 'failed', error })
    expect(setApprovalOverride).not.toHaveBeenCalled()
  })

  it('coalesces duplicate decisions while the first submission is pending', async () => {
    expect(createApprovalDecisionHandler).toBeTypeOf('function')
    if (!createApprovalDecisionHandler) return
    let finish!: (value: boolean) => void
    const resolveApproval = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const handler = createApprovalDecisionHandler({ resolveApproval, setApprovalOverride: vi.fn() })

    const first = handler.decide(approval, true, false)
    await expect(handler.decide(approval, true, false)).resolves.toEqual({ outcome: 'busy' })
    expect(resolveApproval).toHaveBeenCalledTimes(1)
    finish(true)
    await expect(first).resolves.toMatchObject({ outcome: 'resolved' })
  })
})

describe('approvalDecisionPresentation', () => {
  it('returns a visible notice when remember persistence fails after resolution', () => {
    setLang('en')
    try {
      expect(approvalDecisionPresentation).toBeTypeOf('function')
      if (!approvalDecisionPresentation) return
      expect(approvalDecisionPresentation({ outcome: 'resolved', rememberError: new Error('store failed') })).toEqual({
        remove: true,
        notice: 'Approval submitted, but this choice could not be remembered.'
      })
    } finally {
      setLang('zh')
    }
  })
})
