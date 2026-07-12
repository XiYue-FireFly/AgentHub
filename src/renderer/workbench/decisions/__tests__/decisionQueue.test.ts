import { describe, expect, it } from 'vitest'
import type { PendingDecision } from '../../../../shared/decision-contract'
import type { RuntimeEvent } from '../../../../main/runtime/types'
import {
  draftDecisionItem,
  runtimeDecisionItem,
  staleDecisionRecoveryFromEvent
} from '../decisionAdapters'
import {
  pendingCountsByThread,
  reconcileDecisionQueue,
  selectActiveDecision
} from '../decisionQueue'

function pendingDecision(input: {
  id: string
  threadId: string
  turnId?: string
  createdAt: number
  state?: PendingDecision['state']
  owner?: 'turn' | 'hub'
}): PendingDecision {
  const owner = input.owner === 'hub'
    ? { type: 'hub' as const, sessionId: 'hub-session' }
    : {
        type: 'turn' as const,
        threadId: input.threadId,
        turnId: input.turnId ?? `turn-${input.id}`,
        workspaceId: 'workspace-1',
        webContentsId: 7
      }
  return {
    request: {
      schemaVersion: 1,
      id: input.id,
      owner,
      source: 'agent',
      kind: 'single-select',
      title: `Decision ${input.id}`,
      options: [],
      minSelections: 0,
      maxSelections: 1,
      allowCustom: false,
      allowRemember: false,
      createdAt: input.createdAt
    },
    state: input.state ?? 'active'
  }
}

describe('decision queue reconciliation', () => {
  it('replaces stale runtime items with the authoritative list while retaining local drafts', () => {
    const staleRuntime = runtimeDecisionItem(pendingDecision({ id: 'runtime-stale', threadId: 'thread-1', createdAt: 1 }))!
    const draft = draftDecisionItem({
      id: 'draft-local',
      threadId: 'thread-1',
      createdAt: 2,
      request: {
        schemaVersion: 1,
        id: 'draft-local',
        source: 'agent',
        kind: 'text',
        title: 'Draft decision',
        options: [],
        minSelections: 0,
        maxSelections: 1,
        allowCustom: true,
        allowRemember: false,
        createdAt: 2
      },
      draftRevision: 4,
      draftHash: 'draft-hash',
      valuesByOptionId: {}
    })
    const authoritative = [pendingDecision({ id: 'runtime-current', threadId: 'thread-1', createdAt: 3 })]

    expect(reconcileDecisionQueue([staleRuntime, draft], authoritative).map(item => item.id)).toEqual([
      'draft-local',
      'runtime-current'
    ])
  })

  it('keeps a stable ID tie-break when selecting the first active decision', () => {
    const laterId = runtimeDecisionItem(pendingDecision({ id: 'z-active', threadId: 'thread-1', createdAt: 10 }))!
    const earlierId = runtimeDecisionItem(pendingDecision({ id: 'a-active', threadId: 'thread-1', createdAt: 10 }))!

    const queue = reconcileDecisionQueue([], [laterId, earlierId].map(item => ({
      request: item.request,
      state: item.state,
      activatedAt: item.activatedAt,
      expiresAt: item.expiresAt
    })))

    expect(selectActiveDecision(queue, 'thread-1')?.id).toBe('a-active')
    expect(pendingCountsByThread([...queue, {
      ...runtimeDecisionItem(pendingDecision({ id: 'terminal', threadId: 'thread-1', createdAt: 11, state: 'terminal' }))!
    }])).toEqual({ 'thread-1': 2 })
  })

  it('excludes hub-owned decisions from desktop cards', () => {
    expect(runtimeDecisionItem(pendingDecision({ id: 'hub-decision', threadId: 'thread-1', createdAt: 1, owner: 'hub' }))).toBeNull()
  })

  it('prioritizes active runtime decisions over older local drafts while retaining runtime FIFO order', () => {
    const draft = draftDecisionItem({
      id: 'old-draft',
      threadId: 'thread-1',
      createdAt: 1,
      request: {
        schemaVersion: 1,
        id: 'old-draft',
        source: 'prompt-optimizer',
        kind: 'single-select',
        title: 'Draft',
        options: [],
        minSelections: 0,
        maxSelections: 1,
        allowCustom: false,
        allowRemember: false,
        createdAt: 1
      },
      draftRevision: 1,
      draftHash: 'hash',
      valuesByOptionId: {}
    })
    const firstRuntime = runtimeDecisionItem(pendingDecision({ id: 'runtime-first', threadId: 'thread-1', createdAt: 2 }))!
    const laterRuntime = runtimeDecisionItem(pendingDecision({ id: 'runtime-later', threadId: 'thread-1', createdAt: 3 }))!

    expect(selectActiveDecision([draft, laterRuntime, firstRuntime], 'thread-1')?.id).toBe('runtime-first')
  })
})

describe('stale decision recovery', () => {
  it('accepts only fixed rerun recovery fields and drops untrusted payload data', () => {
    const recovery = staleDecisionRecoveryFromEvent({
      id: 'event-1',
      threadId: 'thread-1',
      turnId: 'old-turn',
      seq: 1,
      kind: 'decision:resolved',
      payload: {
        requestId: 'decision-1',
        status: 'stale',
        source: 'tool',
        recovery: {
          kind: 'rerun-turn',
          originalTurnId: 'trusted-original-turn',
          preview: 'OLD_COMMAND_MUST_NOT_RENDER'
        },
        preview: 'OLD_COMMAND_MUST_NOT_RENDER',
        command: 'OLD_COMMAND_MUST_NOT_RENDER'
      },
      createdAt: 1
    } as RuntimeEvent)

    expect(recovery).toEqual({
      requestId: 'decision-1',
      source: 'tool',
      originalTurnId: 'trusted-original-turn',
      action: 'rerun-turn'
    })
    expect(JSON.stringify(recovery)).not.toContain('OLD_COMMAND_MUST_NOT_RENDER')
  })

  it('rejects unresolved events without the exact stale rerun shape', () => {
    expect(staleDecisionRecoveryFromEvent({
      id: 'event-2',
      threadId: 'thread-1',
      turnId: 'old-turn',
      seq: 2,
      kind: 'decision:resolved',
      payload: { requestId: 'decision-1', status: 'selected', source: 'tool', recovery: { kind: 'rerun-turn', originalTurnId: 'turn-1' } },
      createdAt: 2
    } as RuntimeEvent)).toBeNull()
  })
})
