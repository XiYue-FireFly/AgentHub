// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchLayout } from '../WorkbenchLayout'
import { resetWorkbenchUiStoreForTests } from '../state/ui-store'

const observedMainContent = vi.hoisted(() => ({
  activeThreadId: null as string | null,
  workspaceId: null as string | null,
  threadTodos: [] as ThreadTodo[]
}))
const observedSidebar = vi.hoisted(() => ({
  selectThread: null as ((threadId: string | null) => Promise<void>) | null,
  threads: [] as WorkbenchThread[]
}))

vi.mock('../CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../CreateWorkspaceDialog', () => ({ CreateWorkspaceDialog: () => null }))
vi.mock('../NativeTitlebar', () => ({ NativeTitlebar: () => null }))
vi.mock('../SessionSidebar', () => ({
  SessionSidebar: (props: { selectThread: (threadId: string | null) => Promise<void>; threads: WorkbenchThread[] }) => {
    observedSidebar.selectThread = props.selectThread
    observedSidebar.threads = props.threads
    return null
  }
}))
vi.mock('../WorkbenchAnnouncementModal', () => ({ WorkbenchAnnouncementModal: () => null }))
vi.mock('../WorkbenchMainContent', () => ({
  WorkbenchMainContent: (props: { activeThreadId: string | null; workspaceId: string | null; threadTodos: ThreadTodo[] }) => {
    observedMainContent.activeThreadId = props.activeThreadId
    observedMainContent.workspaceId = props.workspaceId
    observedMainContent.threadTodos = props.threadTodos
    return null
  }
}))
vi.mock('../WorkbenchPanelContainers', () => ({ WorkbenchPanelContainers: () => null }))

const stableEmptyArray: never[] = []
const workspaceA = { id: 'workspace-a', name: 'A', rootPath: 'E:\\A', createdAt: 1, updatedAt: 1 }
const workspaceB = { id: 'workspace-b', name: 'B', rootPath: 'E:\\B', createdAt: 2, updatedAt: 2 }
const stableWorkspaces = [workspaceA, workspaceB]
const threadA = { id: 'thread-a', workspaceId: workspaceA.id, title: 'Thread A', createdAt: 1, updatedAt: 1 }
const threadB = { id: 'thread-b', workspaceId: workspaceB.id, title: 'Thread B', createdAt: 2, updatedAt: 2 }
const stableAllThreads = [threadA, threadB]
const todoA = { id: 'todo-a', threadId: threadA.id, content: 'Todo A', status: 'pending', updatedAt: 1 } as ThreadTodo
const todoB = { id: 'todo-b', threadId: threadB.id, content: 'Todo B', status: 'pending', updatedAt: 2 } as ThreadTodo
const stableTodosA = [todoA]
const stableTodosB = [todoB]
const snapshotA = { threads: [threadA], turns: stableEmptyArray, runs: stableEmptyArray, activeThreadId: threadA.id }
const snapshotB = { threads: [threadB], turns: stableEmptyArray, runs: stableEmptyArray, activeThreadId: threadB.id }
const allSnapshot = { threads: stableAllThreads, turns: stableEmptyArray, runs: stableEmptyArray, activeThreadId: threadA.id }
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installElectronApi(pendingTodosA: Promise<ThreadTodo[]>) {
  const api = {
    app: { onMenuCommand: vi.fn(() => vi.fn()) },
    goals: { get: vi.fn(async () => null) },
    localAgents: { status: vi.fn(async () => stableEmptyArray) },
    runtime: {
      eventsSince: vi.fn(async () => stableEmptyArray),
      onEvent: vi.fn(() => vi.fn()),
      snapshot: vi.fn(async (workspaceId?: string | null) => {
        if (workspaceId === undefined) return allSnapshot
        if (workspaceId === workspaceB.id) return snapshotB
        return snapshotA
      })
    },
    schedules: { list: vi.fn(async () => stableEmptyArray) },
    store: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined)
    },
    terminal: { history: vi.fn(async () => stableEmptyArray) },
    threads: { select: vi.fn(async (threadId: string | null) => threadId) },
    todos: {
      list: vi.fn((threadId: string) => threadId === threadA.id ? pendingTodosA : Promise.resolve(stableTodosB))
    },
    workspaces: {
      getActive: vi.fn(async () => workspaceA.id),
      list: vi.fn(async () => stableWorkspaces),
      setActive: vi.fn(async (workspaceId: string | null) => workspaceId)
    },
    platform: 'win32'
  }
  ;(window as any).electronAPI = api
  return api
}

beforeEach(() => {
  localStorage.clear()
  resetWorkbenchUiStoreForTests()
  observedMainContent.activeThreadId = null
  observedMainContent.workspaceId = null
  observedMainContent.threadTodos = []
  observedSidebar.selectThread = null
  observedSidebar.threads = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as any).electronAPI
})

describe('Workbench stale Todo loading', () => {
  it.each(['resolve', 'reject'] as const)('keeps B Todos when stale A Todo loading later %s', async outcome => {
    const pendingTodosA = deferred<ThreadTodo[]>()
    const api = installElectronApi(pendingTodosA.promise)
    render(<WorkbenchLayout {...stableLayoutProps} />)

    await waitFor(() => expect(api.todos.list).toHaveBeenCalledWith(threadA.id))
    await waitFor(() => expect(observedSidebar.threads.map(thread => thread.id)).toEqual([threadA.id, threadB.id]))
    expect(observedSidebar.selectThread).toBeTypeOf('function')

    await act(async () => {
      await observedSidebar.selectThread?.(threadB.id)
    })
    await waitFor(() => expect(observedMainContent.threadTodos).toEqual(stableTodosB))
    expect(observedMainContent.activeThreadId).toBe(threadB.id)
    expect(observedMainContent.workspaceId).toBe(workspaceB.id)

    await act(async () => {
      if (outcome === 'resolve') pendingTodosA.resolve(stableTodosA)
      else pendingTodosA.reject(new Error('A Todo load failed'))
      await pendingTodosA.promise.catch(() => stableEmptyArray)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(observedMainContent.activeThreadId).toBe(threadB.id)
    expect(observedMainContent.workspaceId).toBe(workspaceB.id)
    expect(observedMainContent.threadTodos).toEqual(stableTodosB)
  })
})
