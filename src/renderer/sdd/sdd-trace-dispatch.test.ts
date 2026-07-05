// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findSddPlanTodosForRuntimeEvent,
  getSddPlanDispatchGitBaseline,
  isSddPlanTodo,
  persistSddPlanCompletedTurnGitEvidence,
  persistSddPlanCommitEvidence,
  persistSddPlanDispatch,
  persistSddPlanTodoStatus,
  sddPlanTodoStatusFromRuntimeEvent
} from './sdd-trace-dispatch'
import { useSddDraftStore, type SddDraft, type SddTrace } from './sdd-draft-store'

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Checkout',
  content: '# Checkout',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

const trace: SddTrace = {
  draftId: 'draft-1',
  requirementBlocks: [{
    id: 'R-1',
    title: 'Checkout',
    status: 'draft',
    description: 'Users can buy items.',
    acceptanceCriteria: [{ text: 'submit payment', checked: false }],
    lineNumber: 1
  }],
  planItems: [
    {
      id: 'T-1',
      text: 'T-1: Implement checkout (covers: R-1)',
      covers: ['R-1'],
      status: 'pending',
      lineNumber: 1
    },
    {
      id: 'T-2',
      text: 'T-2: Add checkout tests (covers: R-1)',
      covers: ['R-1'],
      status: 'pending',
      lineNumber: 2
    }
  ],
  coverage: { 'R-1': ['T-1', 'T-2'] },
  derivedStatuses: { 'R-1': 'planned' },
  uncoveredRequirementIds: [],
  timestamp: '2026-07-04T00:01:00.000Z'
}

describe('sdd trace dispatch persistence', () => {
  beforeEach(() => {
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
    useSddDraftStore.getState().setActiveDraft(draft)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    useSddDraftStore.getState().clearDraft()
  })

  it('detects SDD plan todos by source metadata', () => {
    expect(isSddPlanTodo({
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'pending',
      updatedAt: 1,
      source: { kind: 'plan', workspaceRoot: 'E:\\workspace', draftId: 'draft-1' }
    })).toBe(true)
  })

  it('maps terminal turn runtime events to SDD Todo statuses', () => {
    expect(sddPlanTodoStatusFromRuntimeEvent({
      kind: 'turn:status',
      turnId: 'turn-1',
      payload: { status: 'completed' }
    })).toBe('completed')
    expect(sddPlanTodoStatusFromRuntimeEvent({
      kind: 'turn:status',
      turnId: 'turn-1',
      payload: { status: 'failed' }
    })).toBe('pending')
    expect(sddPlanTodoStatusFromRuntimeEvent({
      kind: 'turn:status',
      turnId: 'turn-1',
      payload: { status: 'cancelled' }
    })).toBe('pending')
    expect(sddPlanTodoStatusFromRuntimeEvent({
      kind: 'run:status',
      turnId: 'turn-1',
      payload: { status: 'completed' }
    })).toBeNull()
  })

  it('matches only scoped SDD plan Todos for a completed runtime turn', () => {
    const todos: ThreadTodo[] = [
      {
        id: 'todo-1',
        threadId: 'thread-1',
        content: 'T-1: Implement checkout (covers: R-1)',
        status: 'in_progress',
        updatedAt: 1,
        source: {
          kind: 'plan',
          workspaceRoot: 'E:\\workspace',
          draftId: 'draft-1',
          planItemId: 'T-1',
          turnId: 'turn-1'
        }
      },
      {
        id: 'todo-2',
        threadId: 'thread-1',
        content: 'T-2: Other draft',
        status: 'in_progress',
        updatedAt: 1,
        source: {
          kind: 'plan',
          workspaceRoot: 'E:\\workspace',
          draftId: 'draft-2',
          planItemId: 'T-2',
          turnId: 'turn-other'
        }
      },
      {
        id: 'todo-3',
        threadId: 'thread-1',
        content: 'Manual follow-up',
        status: 'in_progress',
        updatedAt: 1,
        source: { kind: 'manual' }
      }
    ]

    expect(findSddPlanTodosForRuntimeEvent(todos, {
      kind: 'turn:status',
      turnId: 'turn-1',
      payload: { status: 'completed' }
    })).toEqual([{ todo: todos[0], status: 'completed' }])
  })

  it('writes the dispatched turn id back to the matching trace plan item', async () => {
    const api = {
      sdd: {
        getTrace: vi.fn(async () => trace),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api

    const nextTrace = await persistSddPlanDispatch({
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'in_progress',
      updatedAt: 1,
      source: {
        kind: 'plan',
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        relativePath: '.agenthub/requirements/draft-1/requirement.md',
        planItemId: 'T-1',
        turnId: 'turn-1'
      }
    }, 'turn-1')

    expect(api.sdd.getTrace).toHaveBeenCalledWith('E:\\workspace', 'draft-1')
    expect(api.sdd.saveTrace).toHaveBeenCalledTimes(1)
    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems[0]).toMatchObject({
      id: 'T-1',
      status: 'in_progress',
      turnId: 'turn-1'
    })
    expect(nextTrace?.planItems[0].turnId).toBe('turn-1')
    expect(useSddDraftStore.getState().trace?.planItems[0].turnId).toBe('turn-1')
  })

  it('writes todo completion status back to trace and derives building while related work remains open', async () => {
    const api = {
      sdd: {
        getTrace: vi.fn(async () => trace),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api

    const nextTrace = await persistSddPlanTodoStatus({
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'pending',
      updatedAt: 1,
      source: {
        kind: 'plan',
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        planItemId: 'T-1',
        turnId: 'turn-1'
      }
    }, 'completed')

    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems.find(item => item.id === 'T-1')).toMatchObject({
      status: 'completed',
      turnId: 'turn-1'
    })
    expect(savedTrace.derivedStatuses['R-1']).toBe('building')
    expect(nextTrace?.derivedStatuses['R-1']).toBe('building')
    expect(useSddDraftStore.getState().trace?.derivedStatuses['R-1']).toBe('building')
  })

  it('derives requirement done when all linked plan items are completed', async () => {
    const almostDoneTrace: SddTrace = {
      ...trace,
      planItems: trace.planItems.map(item =>
        item.id === 'T-2'
          ? { ...item, status: 'completed' }
          : item
      )
    }
    const api = {
      sdd: {
        getTrace: vi.fn(async () => almostDoneTrace),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api

    await persistSddPlanTodoStatus({
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'in_progress',
      updatedAt: 1,
      source: {
        kind: 'plan',
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        planItemId: 'T-1'
      }
    }, 'completed')

    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems.every(item => item.status === 'completed')).toBe(true)
    expect(savedTrace.derivedStatuses['R-1']).toBe('done')
  })

  it('persists explicit commit evidence to the matching trace plan item', async () => {
    const api = {
      sdd: {
        getTrace: vi.fn(async () => ({
          ...trace,
          planItems: trace.planItems.map(item =>
            item.id === 'T-1' ? { ...item, turnId: 'turn-1' } : item
          )
        })),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api

    const nextTrace = await persistSddPlanCommitEvidence({
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      planItemId: 'T-1',
      turnId: 'turn-1',
      commit: {
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        shortSha: 'abcdef1',
        summary: 'Implement checkout flow',
        message: 'Implement checkout flow',
        author: 'Dev',
        authorEmail: 'dev@example.com',
        committer: 'Dev',
        committerEmail: 'dev@example.com',
        authorTime: 1,
        commitTime: 1,
        parents: [],
        totalAdditions: 7,
        totalDeletions: 1,
        files: [{
          path: 'src/checkout.ts',
          status: 'M',
          additions: 7,
          deletions: 1,
          diff: 'diff --git a/src/checkout.ts b/src/checkout.ts',
          lineCount: 10,
          truncated: false
        }]
      }
    })

    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems.find(item => item.id === 'T-1')?.commits).toEqual([{
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      shortSha: 'abcdef1',
      summary: 'Implement checkout flow',
      linkedAt: expect.any(String),
      turnId: 'turn-1',
      files: [{
        path: 'src/checkout.ts',
        oldPath: undefined,
        status: 'M',
        additions: 7,
        deletions: 1
      }]
    }])
    expect(savedTrace.planItems.find(item => item.id === 'T-2')?.commits).toBeUndefined()
    expect(nextTrace?.planItems[0].commits?.[0].shortSha).toBe('abcdef1')
    expect(useSddDraftStore.getState().trace?.planItems[0].commits?.[0].sha).toBe('abcdef1234567890abcdef1234567890abcdef12')
  })

  it('can add thread scope to an existing unscoped commit evidence entry', async () => {
    const commit: GitCommitDetails = {
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      shortSha: 'abcdef1',
      summary: 'Implement checkout flow',
      message: 'Implement checkout flow',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      committer: 'Dev',
      committerEmail: 'dev@example.com',
      authorTime: 1,
      commitTime: 1,
      parents: [],
      totalAdditions: 7,
      totalDeletions: 1,
      files: [{
        path: 'src/checkout.ts',
        status: 'M',
        additions: 7,
        deletions: 1,
        diff: 'diff --git a/src/checkout.ts b/src/checkout.ts',
        lineCount: 10,
        truncated: false
      }]
    }
    const api = {
      sdd: {
        getTrace: vi.fn(async () => ({
          ...trace,
          planItems: trace.planItems.map(item =>
            item.id === 'T-1'
              ? {
                  ...item,
                  turnId: 'turn-1',
                  commits: [{
                    sha: commit.sha,
                    shortSha: commit.shortSha,
                    summary: commit.summary,
                    linkedAt: '2026-07-04T00:00:00.000Z',
                    turnId: 'turn-1',
                    files: [{ path: 'src/checkout.ts', status: 'M', additions: 7, deletions: 1 }]
                  }]
                }
              : item
          )
        })),
        saveTrace: vi.fn(async () => undefined)
      }
    }
    ;(window as any).electronAPI = api

    await persistSddPlanCommitEvidence({
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      planItemId: 'T-1',
      turnId: 'turn-1',
      threadId: 'thread-1',
      commit
    })

    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems[0].commits).toHaveLength(1)
    expect(savedTrace.planItems[0].commits?.[0]).toMatchObject({
      sha: commit.sha,
      threadId: 'thread-1',
      turnId: 'turn-1'
    })
  })

  it('captures dispatch git baseline for matching SDD workspace root', async () => {
    ;(window as any).electronAPI = {
      git: {
        status: vi.fn(async () => ({ isRepo: true, rootPath: 'E:\\workspace' })),
        log: vi.fn(async () => ({
          entries: [{ sha: 'base-sha' }]
        }))
      }
    }

    await expect(getSddPlanDispatchGitBaseline('ws-1', {
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'pending',
      updatedAt: 1,
      source: { kind: 'plan', workspaceRoot: 'E:\\workspace', draftId: 'draft-1', planItemId: 'T-1' }
    })).resolves.toEqual({
      gitRootAtDispatch: 'E:\\workspace',
      gitHeadAtDispatch: 'base-sha'
    })
  })

  it('persists completed turn commit evidence from commits after dispatch baseline', async () => {
    const commit = {
      sha: 'newcommit1234567890abcdef1234567890abcdef',
      shortSha: 'newcomm',
      summary: 'Implement checkout flow',
      message: 'Implement checkout flow',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      committer: 'Dev',
      committerEmail: 'dev@example.com',
      authorTime: 2,
      commitTime: 2,
      parents: ['base-sha'],
      totalAdditions: 5,
      totalDeletions: 1,
      files: [{
        path: 'src/checkout.ts',
        status: 'M',
        additions: 5,
        deletions: 1,
        diff: 'diff --git a/src/checkout.ts b/src/checkout.ts',
        lineCount: 8,
        truncated: false
      }]
    } satisfies GitCommitDetails
    const api = {
      sdd: {
        getTrace: vi.fn(async () => ({
          ...trace,
          planItems: trace.planItems.map(item =>
            item.id === 'T-1' ? { ...item, turnId: 'turn-1' } : item
          )
        })),
        saveTrace: vi.fn(async () => undefined)
      },
      git: {
        status: vi.fn(async () => ({ isRepo: true, rootPath: 'E:\\workspace' })),
        log: vi.fn(async () => ({
          entries: [
            { sha: commit.sha },
            { sha: 'base-sha' }
          ]
        })),
        commitDetails: vi.fn(async () => commit)
      }
    }
    ;(window as any).electronAPI = api

    await persistSddPlanCompletedTurnGitEvidence({
      workspaceId: 'ws-1',
      event: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        kind: 'turn:status',
        payload: { status: 'completed' }
      },
      todo: {
        id: 'todo-1',
        threadId: 'thread-1',
        content: 'T-1: Implement checkout (covers: R-1)',
        status: 'completed',
        updatedAt: 1,
        source: {
          kind: 'plan',
          threadId: 'thread-1',
          workspaceRoot: 'E:\\workspace',
          draftId: 'draft-1',
          planItemId: 'T-1',
          turnId: 'turn-1',
          gitRootAtDispatch: 'E:\\workspace',
          gitHeadAtDispatch: 'base-sha'
        }
      }
    })

    const savedTrace = (api.sdd.saveTrace.mock.calls[0] as any[])[2] as SddTrace
    expect(savedTrace.planItems[0].commits?.[0]).toMatchObject({
      sha: commit.sha,
      threadId: 'thread-1',
      turnId: 'turn-1',
      files: [{ path: 'src/checkout.ts', status: 'M', additions: 5, deletions: 1 }]
    })
  })

  it('does not persist completed turn commit evidence when git root changed after dispatch', async () => {
    const api = {
      sdd: {
        getTrace: vi.fn(async () => trace),
        saveTrace: vi.fn(async () => undefined)
      },
      git: {
        status: vi.fn(async () => ({ isRepo: true, rootPath: 'E:\\other' })),
        log: vi.fn(async () => ({ entries: [] })),
        commitDetails: vi.fn()
      }
    }
    ;(window as any).electronAPI = api

    await persistSddPlanCompletedTurnGitEvidence({
      workspaceId: 'ws-1',
      event: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        kind: 'turn:status',
        payload: { status: 'completed' }
      },
      todo: {
        id: 'todo-1',
        threadId: 'thread-1',
        content: 'T-1: Implement checkout (covers: R-1)',
        status: 'completed',
        updatedAt: 1,
        source: {
          kind: 'plan',
          threadId: 'thread-1',
          workspaceRoot: 'E:\\workspace',
          draftId: 'draft-1',
          planItemId: 'T-1',
          turnId: 'turn-1',
          gitRootAtDispatch: 'E:\\workspace',
          gitHeadAtDispatch: 'base-sha'
        }
      }
    })

    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(api.git.commitDetails).not.toHaveBeenCalled()
  })

  it('does not auto-link multiple commits after the dispatch baseline', async () => {
    const api = {
      sdd: {
        getTrace: vi.fn(async () => trace),
        saveTrace: vi.fn(async () => undefined)
      },
      git: {
        status: vi.fn(async () => ({ isRepo: true, rootPath: 'E:\\workspace' })),
        log: vi.fn(async () => ({
          entries: [
            { sha: 'new-2' },
            { sha: 'new-1' },
            { sha: 'base-sha' }
          ]
        })),
        commitDetails: vi.fn()
      }
    }
    ;(window as any).electronAPI = api

    await persistSddPlanCompletedTurnGitEvidence({
      workspaceId: 'ws-1',
      event: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        kind: 'turn:status',
        payload: { status: 'completed' }
      },
      todo: {
        id: 'todo-1',
        threadId: 'thread-1',
        content: 'T-1: Implement checkout (covers: R-1)',
        status: 'completed',
        updatedAt: 1,
        source: {
          kind: 'plan',
          threadId: 'thread-1',
          workspaceRoot: 'E:\\workspace',
          draftId: 'draft-1',
          planItemId: 'T-1',
          turnId: 'turn-1',
          gitRootAtDispatch: 'E:\\workspace',
          gitHeadAtDispatch: 'base-sha'
        }
      }
    })

    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(api.git.commitDetails).not.toHaveBeenCalled()
  })
})
