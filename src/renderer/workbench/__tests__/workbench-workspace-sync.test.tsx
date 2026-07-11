// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchLayout } from '../WorkbenchLayout'
import { resetWorkbenchUiStoreForTests } from '../state/ui-store'
import { notifyWorkspaceChange, WORKSPACE_CHANGE_EVENT } from '../../workspace-change'

const observed = vi.hoisted(() => ({
  activeWorkspace: null as WorkbenchWorkspace | null,
  workspaceId: null as string | null,
  activeThreadId: null as string | null,
  activeGoal: null as WorkbenchGoal | null,
  threadTodos: [] as ThreadTodo[],
  sendError: null as string | null,
  workspaces: [] as WorkbenchWorkspace[],
  pendingThreadId: null as string | null,
  selectWorkspace: null as ((workspaceId: string | null) => Promise<void>) | null,
  selectThread: null as ((threadId: string | null) => Promise<void>) | null,
  renameThread: null as ((threadId: string, title: string) => Promise<void>) | null
}))

vi.mock('../../glass/approval-dialog', () => ({ ApprovalDialog: () => null }))
vi.mock('../CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../CreateWorkspaceDialog', () => ({ CreateWorkspaceDialog: () => null }))
vi.mock('../NativeTitlebar', () => ({ NativeTitlebar: () => null }))
vi.mock('../SessionSidebar', () => ({
  SessionSidebar: (props: {
    workspaces: WorkbenchWorkspace[]
    workspaceId: string | null
    pendingThreadId: string | null
    selectWorkspace: (workspaceId: string | null) => Promise<void>
    selectThread: (threadId: string | null) => Promise<void>
    renameThread: (threadId: string, title: string) => Promise<void>
  }) => {
    observed.workspaces = props.workspaces
    observed.workspaceId = props.workspaceId
    observed.pendingThreadId = props.pendingThreadId
    observed.selectWorkspace = props.selectWorkspace
    observed.selectThread = props.selectThread
    observed.renameThread = props.renameThread
    return null
  }
}))
vi.mock('../WorkbenchAnnouncementModal', () => ({ WorkbenchAnnouncementModal: () => null }))
vi.mock('../WorkbenchMainContent', () => ({
  WorkbenchMainContent: (props: {
    activeWorkspace: WorkbenchWorkspace | null
    workspaceId: string | null
    activeThreadId: string | null
    activeGoal: WorkbenchGoal | null
    threadTodos: ThreadTodo[]
    sendError: string | null
  }) => {
    observed.activeWorkspace = props.activeWorkspace
    observed.workspaceId = props.workspaceId
    observed.activeThreadId = props.activeThreadId
    observed.activeGoal = props.activeGoal
    observed.threadTodos = props.threadTodos
    observed.sendError = props.sendError
    return null
  }
}))
vi.mock('../WorkbenchPanelContainers', () => ({ WorkbenchPanelContainers: () => null }))

const stableEmptyArray: never[] = []
const workspaceA = { id: 'workspace-a', name: 'A', rootPath: 'E:\\A', createdAt: 1, updatedAt: 1 }
const workspaceB = { id: 'workspace-b', name: 'B', rootPath: 'E:\\B', createdAt: 2, updatedAt: 2 }
const workspaceC = { id: 'workspace-c', name: 'C', rootPath: 'E:\\C', createdAt: 3, updatedAt: 3 }
const threadA = { id: 'thread-a', workspaceId: workspaceA.id, title: 'Thread A', createdAt: 1, updatedAt: 1 }
const threadB = { id: 'thread-b', workspaceId: workspaceB.id, title: 'Thread B', createdAt: 2, updatedAt: 2 }
const threadC = { id: 'thread-c', workspaceId: workspaceC.id, title: 'Thread C', createdAt: 3, updatedAt: 3 }
const todoA = { id: 'todo-a', threadId: threadA.id, content: 'Todo A', status: 'pending', updatedAt: 1 } as ThreadTodo
const todoB = { id: 'todo-b', threadId: threadB.id, content: 'Todo B', status: 'pending', updatedAt: 2 } as ThreadTodo
const todoC = { id: 'todo-c', threadId: threadC.id, content: 'Todo C', status: 'pending', updatedAt: 3 } as ThreadTodo
const goalA: WorkbenchGoal = { threadId: threadA.id, goal: 'Goal A', createdAt: 1, updatedAt: 1, loopLimit: 3, status: 'active' }
const goalB: WorkbenchGoal = { threadId: threadB.id, goal: 'Goal B', createdAt: 2, updatedAt: 2, loopLimit: 5, status: 'active' }
const goalC: WorkbenchGoal = { threadId: threadC.id, goal: 'Goal C', createdAt: 3, updatedAt: 3, loopLimit: 7, status: 'active' }
const stableProviders = [{
  id: 'test-provider',
  name: 'Test provider',
  kind: 'openai-compatible',
  baseUrl: 'https://example.invalid',
  apiKey: 'test-key',
  enabled: true,
  builtIn: false,
  models: stableEmptyArray
}]
const stableProviderActions = {
  onSetEnabled: vi.fn(),
  onSetKey: vi.fn(),
  onSetBinding: vi.fn(),
  onSetFallback: vi.fn(),
  onReload: vi.fn(),
  onUpsertProvider: vi.fn(),
  onDeleteProvider: vi.fn(),
  onReorderProvidersForClaude: vi.fn()
}
const stableLayoutProps = {
  hubRunning: true,
  proxyHost: '127.0.0.1',
  agents: {},
  providers: stableProviders,
  bindings: stableEmptyArray,
  fallbackChain: stableEmptyArray,
  providerActions: stableProviderActions,
  motion: 'off' as const,
  setMotion: vi.fn()
}

function snapshotFor(workspaceId: string | null | undefined) {
  if (workspaceId === undefined) {
    return { threads: [threadA, threadB, threadC], turns: stableEmptyArray, runs: stableEmptyArray, activeThreadId: threadA.id }
  }
  const thread = workspaceId === workspaceA.id
    ? threadA
    : workspaceId === workspaceB.id
      ? threadB
      : workspaceId === workspaceC.id
        ? threadC
        : null
  return { threads: thread ? [thread] : [], turns: stableEmptyArray, runs: stableEmptyArray, activeThreadId: thread?.id ?? null }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function goalFor(threadId: string | null | undefined): WorkbenchGoal | null {
  if (threadId === threadA.id) return goalA
  if (threadId === threadB.id) return goalB
  if (threadId === threadC.id) return goalC
  return null
}

function installElectronApi() {
  let workspaces: WorkbenchWorkspace[] = [workspaceA, workspaceB, workspaceC]
  let activeWorkspaceId: string | null = workspaceA.id
  const api = {
    agentic: {
      getPendingApprovalIds: vi.fn(async () => stableEmptyArray),
      resolveApproval: vi.fn(async () => true),
      setApprovalOverride: vi.fn(async () => undefined)
    },
    app: { onMenuCommand: vi.fn(() => vi.fn()) },
    goals: { get: vi.fn(async (threadId?: string | null): Promise<WorkbenchGoal | null> => goalFor(threadId)) },
    localAgents: { status: vi.fn(async () => stableEmptyArray) },
    runtime: {
      eventsSince: vi.fn(async () => stableEmptyArray),
      onEvent: vi.fn(() => vi.fn()),
      snapshot: vi.fn(async (workspaceId?: string | null) => snapshotFor(workspaceId))
    },
    schedules: { list: vi.fn(async () => stableEmptyArray) },
    store: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined)
    },
    terminal: { history: vi.fn(async () => stableEmptyArray) },
    threads: {
      select: vi.fn(async (threadId: string | null) => threadId),
      rename: vi.fn(async (threadId: string, title: string) => ({
        ...(threadId === threadA.id ? threadA : threadId === threadB.id ? threadB : threadC),
        title
      }))
    },
    todos: {
      list: vi.fn(async (threadId: string): Promise<ThreadTodo[]> => {
        if (threadId === threadA.id) return [todoA]
        if (threadId === threadB.id) return [todoB]
        if (threadId === threadC.id) return [todoC]
        return stableEmptyArray
      })
    },
    workspaces: {
      getActive: vi.fn(async () => activeWorkspaceId),
      list: vi.fn(async () => workspaces),
      setActive: vi.fn(async (workspaceId: string | null) => {
        activeWorkspaceId = workspaceId
        return activeWorkspaceId
      })
    },
    platform: 'win32'
  }
  ;(window as any).electronAPI = api
  return {
    api,
    setManagerState(nextWorkspaces: WorkbenchWorkspace[], nextActiveWorkspaceId: string | null) {
      workspaces = nextWorkspaces
      activeWorkspaceId = nextActiveWorkspaceId
    }
  }
}

function delayThreadASelectionReads(api: ReturnType<typeof installElectronApi>['api']) {
  const snapshot = deferred<ReturnType<typeof snapshotFor>>()
  const todos = deferred<ThreadTodo[]>()
  const goal = deferred<WorkbenchGoal | null>()

  api.runtime.snapshot.mockClear()
  api.todos.list.mockClear()
  api.goals.get.mockClear()
  api.threads.select.mockClear()
  api.runtime.snapshot.mockImplementation((workspaceId?: string | null) => (
    workspaceId === workspaceA.id ? snapshot.promise : Promise.resolve(snapshotFor(workspaceId))
  ))
  api.todos.list.mockImplementation((threadId: string) => (
    threadId === threadA.id ? todos.promise : Promise.resolve(threadId === threadB.id ? [todoB] : threadId === threadC.id ? [todoC] : [])
  ))
  api.goals.get.mockImplementation((threadId?: string | null) => (
    threadId === threadA.id ? goal.promise : Promise.resolve(goalFor(threadId))
  ))

  return { snapshot, todos, goal }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkbenchUiStoreForTests()
  observed.activeWorkspace = null
  observed.workspaceId = null
  observed.activeThreadId = null
  observed.activeGoal = null
  observed.threadTodos = []
  observed.sendError = null
  observed.workspaces = []
  observed.pendingThreadId = null
  observed.selectWorkspace = null
  observed.selectThread = null
  observed.renameThread = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).electronAPI
})

describe('Workbench workspace mutation sync', () => {
  it('switches its runtime snapshot from A to the authoritative active workspace B', async () => {
    const { api, setManagerState } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))

    setManagerState([workspaceA, workspaceB, workspaceC], workspaceB.id)
    act(() => notifyWorkspaceChange({ kind: 'known', activeWorkspaceId: workspaceB.id }))

    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))
    expect(api.runtime.snapshot).toHaveBeenCalledWith(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
  })

  it('refreshes the active workspace name and root when an edit keeps the same id', async () => {
    const { setManagerState } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.activeWorkspace?.name).toBe('A'))

    const updatedA = { ...workspaceA, name: 'A edited', rootPath: 'E:\\A-edited', updatedAt: 10 }
    setManagerState([updatedA, workspaceB, workspaceC], updatedA.id)
    act(() => notifyWorkspaceChange({ kind: 'known', activeWorkspaceId: updatedA.id }))

    await waitFor(() => expect(observed.activeWorkspace).toEqual(updatedA))
    expect(observed.workspaces.find(workspace => workspace.id === updatedA.id)).toEqual(updatedA)
  })

  it.each([
    { label: 'successor', remaining: [workspaceB, workspaceC], activeId: workspaceB.id, expectedThreadId: threadB.id, expectedTodos: [todoB] },
    { label: 'null', remaining: [], activeId: null, expectedThreadId: null, expectedTodos: [] }
  ])('uses the manager-selected $label after deleting active A without retaining A state', async ({ remaining, activeId, expectedThreadId, expectedTodos }) => {
    const { setManagerState } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.threadTodos).toEqual([todoA]))

    setManagerState(remaining, activeId)
    act(() => notifyWorkspaceChange({ kind: 'known', activeWorkspaceId: activeId }))

    await waitFor(() => expect(observed.workspaceId).toBe(activeId))
    await waitFor(() => expect(observed.threadTodos).toEqual(expectedTodos))
    expect(observed.activeThreadId).toBe(expectedThreadId)
    expect(observed.workspaces.some(workspace => workspace.id === workspaceA.id)).toBe(false)
  })

  it('keeps the latest workspace when two change reloads resolve in reverse order', async () => {
    const { api, setManagerState } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))

    const pendingB = deferred<ReturnType<typeof snapshotFor>>()
    api.runtime.snapshot.mockImplementation((workspaceId?: string | null) => {
      if (workspaceId === workspaceB.id) return pendingB.promise
      return Promise.resolve(snapshotFor(workspaceId))
    })

    setManagerState([workspaceA, workspaceB, workspaceC], workspaceB.id)
    act(() => notifyWorkspaceChange({ kind: 'known', activeWorkspaceId: workspaceB.id }))
    await waitFor(() => expect(api.runtime.snapshot).toHaveBeenCalledWith(workspaceB.id))

    setManagerState([workspaceA, workspaceB, workspaceC], workspaceC.id)
    act(() => notifyWorkspaceChange({ kind: 'known', activeWorkspaceId: workspaceC.id }))
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceC.id))
    expect(observed.threadTodos).toEqual([todoC])

    await act(async () => {
      pendingB.resolve(snapshotFor(workspaceB.id))
      await pendingB.promise
      await Promise.resolve()
    })

    expect(observed.workspaceId).toBe(workspaceC.id)
    expect(observed.activeThreadId).toBe(threadC.id)
    expect(observed.threadTodos).toEqual([todoC])
  })

  it('invalidates an older thread selection when a workspace change reload completes first', async () => {
    const { api, setManagerState } = installElectronApi()
    const pendingThreadA = deferred<string | null>()
    api.threads.select.mockImplementationOnce(() => pendingThreadA.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    expect(observed.selectThread).toBeTypeOf('function')

    let selectingA!: Promise<void>
    act(() => {
      selectingA = observed.selectThread?.(threadA.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(api.threads.select).toHaveBeenCalledWith(threadA.id))
    await waitFor(() => expect(observed.pendingThreadId).toBe(threadA.id))

    setManagerState([workspaceA, workspaceB, workspaceC], workspaceB.id)
    act(() => notifyWorkspaceChange({ kind: 'known', activeWorkspaceId: workspaceB.id }))
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))
    await waitFor(() => expect(observed.threadTodos).toEqual([todoB]))

    await act(async () => {
      pendingThreadA.resolve(threadA.id)
      await selectingA
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.pendingThreadId).toBeNull()
  })

  it('keeps a directly selected workspace when an older thread selection resolves last', async () => {
    const { api } = installElectronApi()
    const pendingThreadA = deferred<string | null>()
    api.threads.select.mockImplementationOnce(() => pendingThreadA.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    expect(observed.selectThread).toBeTypeOf('function')
    expect(observed.selectWorkspace).toBeTypeOf('function')

    let selectingA!: Promise<void>
    act(() => {
      selectingA = observed.selectThread?.(threadA.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(api.threads.select).toHaveBeenCalledWith(threadA.id))
    await waitFor(() => expect(observed.pendingThreadId).toBe(threadA.id))

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })
    await act(async () => { await selectingB })
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))
    expect(observed.activeThreadId).toBe(threadB.id)
    await waitFor(() => expect(observed.activeGoal).toEqual(goalB))
    expect(observed.threadTodos).toEqual([todoB])

    await act(async () => {
      pendingThreadA.resolve(threadA.id)
      await selectingA
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.activeGoal).toEqual(goalB)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.pendingThreadId).toBeNull()
  })

  it('ignores an older thread selection error after a direct workspace switch', async () => {
    const { api } = installElectronApi()
    const pendingThreadA = deferred<string | null>()
    api.threads.select.mockImplementationOnce(() => pendingThreadA.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))

    let selectingA!: Promise<void>
    act(() => {
      selectingA = observed.selectThread?.(threadA.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(observed.pendingThreadId).toBe(threadA.id))

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })
    await act(async () => { await selectingB })
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))

    await act(async () => {
      pendingThreadA.reject(new Error('stale A selection failed'))
      await selectingA
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.sendError).toBeNull()
    expect(observed.pendingThreadId).toBeNull()
  })

  it('ignores stale selection reads that resolve after threads.select and a direct workspace switch', async () => {
    const { api } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    await waitFor(() => expect(observed.activeGoal).toEqual(goalA))
    const pending = delayThreadASelectionReads(api)

    let selectingA!: Promise<void>
    act(() => {
      selectingA = observed.selectThread?.(threadA.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(api.threads.select).toHaveBeenCalledWith(threadA.id))
    await waitFor(() => {
      expect(api.runtime.snapshot).toHaveBeenCalledWith(workspaceA.id)
      expect(api.todos.list).toHaveBeenCalledWith(threadA.id)
      expect(api.goals.get).toHaveBeenCalledWith(threadA.id)
    })
    expect(observed.pendingThreadId).toBe(threadA.id)

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })
    await act(async () => { await selectingB })
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))
    await waitFor(() => expect(observed.activeGoal).toEqual(goalB))

    await act(async () => {
      pending.snapshot.resolve(snapshotFor(workspaceA.id))
      pending.todos.resolve([todoA])
      pending.goal.resolve(goalA)
      await selectingA
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.activeGoal).toEqual(goalB)
    expect(observed.sendError).toBeNull()
    expect(observed.pendingThreadId).toBeNull()
  })

  it.each(['snapshot', 'todos', 'goal'] as const)('ignores a stale %s failure after threads.select and a direct workspace switch', async rejectedRead => {
    const { api } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    await waitFor(() => expect(observed.activeGoal).toEqual(goalA))
    const pending = delayThreadASelectionReads(api)

    let selectingA!: Promise<void>
    act(() => {
      selectingA = observed.selectThread?.(threadA.id) ?? Promise.resolve()
    })
    await waitFor(() => {
      expect(api.runtime.snapshot).toHaveBeenCalledWith(workspaceA.id)
      expect(api.todos.list).toHaveBeenCalledWith(threadA.id)
      expect(api.goals.get).toHaveBeenCalledWith(threadA.id)
    })

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })
    await act(async () => { await selectingB })
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))
    await waitFor(() => expect(observed.activeGoal).toEqual(goalB))

    await act(async () => {
      if (rejectedRead === 'snapshot') pending.snapshot.reject(new Error('stale A snapshot failed'))
      else pending.snapshot.resolve(snapshotFor(workspaceA.id))
      if (rejectedRead === 'todos') pending.todos.reject(new Error('stale A todos failed'))
      else pending.todos.resolve([todoA])
      if (rejectedRead === 'goal') pending.goal.reject(new Error('stale A goal failed'))
      else pending.goal.resolve(goalA)
      await selectingA
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.activeGoal).toEqual(goalB)
    expect(observed.sendError).toBeNull()
    expect(observed.pendingThreadId).toBeNull()
  })

  it('clears pending thread selection before awaiting workspace activation', async () => {
    const { api } = installElectronApi()
    const pendingThreadA = deferred<string | null>()
    const pendingSetActiveB = deferred<string | null>()
    api.threads.select.mockImplementationOnce(() => pendingThreadA.promise)
    api.workspaces.setActive.mockImplementationOnce(() => pendingSetActiveB.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))

    let selectingA!: Promise<void>
    act(() => {
      selectingA = observed.selectThread?.(threadA.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(observed.pendingThreadId).toBe(threadA.id))

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })

    expect(api.workspaces.setActive).toHaveBeenCalledWith(workspaceB.id)
    expect(observed.pendingThreadId).toBeNull()

    await act(async () => {
      pendingSetActiveB.resolve(workspaceB.id)
      await selectingB
      pendingThreadA.resolve(threadA.id)
      await selectingA
    })
    expect(observed.workspaceId).toBe(workspaceB.id)
  })

  it('does not invalidate a pending thread selection during an ordinary rename refresh', async () => {
    const { api } = installElectronApi()
    const pendingThreadB = deferred<string | null>()
    api.threads.select.mockImplementationOnce(() => pendingThreadB.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    expect(observed.renameThread).toBeTypeOf('function')

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectThread?.(threadB.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(observed.pendingThreadId).toBe(threadB.id))

    await act(async () => {
      await observed.renameThread?.(threadA.id, 'Thread A renamed')
    })
    expect(api.threads.rename).toHaveBeenCalledWith(threadA.id, 'Thread A renamed')
    expect(observed.pendingThreadId).toBe(threadB.id)

    await act(async () => {
      pendingThreadB.resolve(threadB.id)
      await selectingB
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.activeGoal).toEqual(goalB)
    expect(observed.pendingThreadId).toBeNull()
  })

  it('does not let an earlier rename refresh overwrite a thread selection that commits first', async () => {
    const { api } = installElectronApi()
    const pendingThreadB = deferred<string | null>()
    const pendingRefreshA = deferred<ReturnType<typeof snapshotFor>>()
    api.threads.select.mockImplementationOnce(() => pendingThreadB.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    await waitFor(() => expect(observed.activeGoal).toEqual(goalA))

    let selectingB!: Promise<void>
    act(() => {
      selectingB = observed.selectThread?.(threadB.id) ?? Promise.resolve()
    })
    await waitFor(() => expect(observed.pendingThreadId).toBe(threadB.id))

    api.runtime.snapshot.mockClear()
    api.runtime.snapshot.mockImplementation((workspaceId?: string | null) => (
      workspaceId === workspaceA.id ? pendingRefreshA.promise : Promise.resolve(snapshotFor(workspaceId))
    ))
    let refreshingA!: Promise<void>
    act(() => {
      refreshingA = observed.renameThread?.(threadA.id, 'Thread A renamed during selection') ?? Promise.resolve()
    })
    await waitFor(() => expect(api.runtime.snapshot).toHaveBeenCalledWith(workspaceA.id))

    await act(async () => {
      pendingThreadB.resolve(threadB.id)
      await selectingB
    })
    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.activeGoal).toEqual(goalB)

    await act(async () => {
      pendingRefreshA.resolve(snapshotFor(workspaceA.id))
      await refreshingA
    })

    expect(observed.workspaceId).toBe(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
    expect(observed.activeGoal).toEqual(goalB)
    expect(observed.pendingThreadId).toBeNull()
  })

  it('ignores missing and invalid workspace-change details without reloading', async () => {
    const { api } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))
    const listCalls = api.workspaces.list.mock.calls.length

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGE_EVENT))
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGE_EVENT, {
        detail: { kind: 'known', activeWorkspaceId: 42 }
      }))
    })

    expect(api.workspaces.list).toHaveBeenCalledTimes(listCalls)
    expect(observed.workspaceId).toBe(workspaceA.id)
  })

  it('uses the manager active workspace for an invalidate even when current A still exists', async () => {
    const { api, setManagerState } = installElectronApi()
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await waitFor(() => expect(observed.workspaceId).toBe(workspaceA.id))

    setManagerState([workspaceA, workspaceB, workspaceC], workspaceB.id)
    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGE_EVENT, { detail: { kind: 'invalidate' } }))
    })

    await waitFor(() => expect(observed.workspaceId).toBe(workspaceB.id))
    expect(api.runtime.snapshot).toHaveBeenCalledWith(workspaceB.id)
    expect(observed.activeThreadId).toBe(threadB.id)
    expect(observed.threadTodos).toEqual([todoB])
  })
})
