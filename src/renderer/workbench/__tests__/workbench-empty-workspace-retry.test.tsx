// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchLayout } from '../WorkbenchLayout'
import { resetWorkbenchUiStoreForTests } from '../state/ui-store'
import { LAST_WORKSPACE_STORE_KEY, PERSONAL_WORKSPACE_SENTINEL } from '../workspaceSelection'

const observedSidebar = vi.hoisted(() => ({
  selectWorkspace: null as ((workspaceId: string | null) => Promise<void>) | null,
  workspaceId: null as string | null
}))

vi.mock('../../glass/approval-dialog', () => ({ ApprovalDialog: () => null }))
vi.mock('../CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('../CreateWorkspaceDialog', () => ({ CreateWorkspaceDialog: () => null }))
vi.mock('../NativeTitlebar', () => ({ NativeTitlebar: () => null }))
vi.mock('../SessionSidebar', () => ({
  SessionSidebar: (props: { selectWorkspace: (workspaceId: string | null) => Promise<void>; workspaceId: string | null }) => {
    observedSidebar.selectWorkspace = props.selectWorkspace
    observedSidebar.workspaceId = props.workspaceId
    return null
  }
}))
vi.mock('../WorkbenchAnnouncementModal', () => ({ WorkbenchAnnouncementModal: () => null }))
vi.mock('../WorkbenchMainContent', () => ({ WorkbenchMainContent: () => null }))
vi.mock('../WorkbenchPanelContainers', () => ({ WorkbenchPanelContainers: () => null }))

const RETRY_DELAY_MS = 500
const MAX_EMPTY_WORKSPACE_LOAD_CALLS = 4
const stableEmptyArray: never[] = []
const emptySnapshot = { threads: stableEmptyArray, turns: stableEmptyArray, runs: stableEmptyArray, activeThreadId: null }
const recoveredWorkspace = { id: 'workspace-recovered', name: 'Recovered', rootPath: 'E:\\Recovered', createdAt: 1, updatedAt: 1 }
const stableRecoveredWorkspaces = [recoveredWorkspace]
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
const stableBindings: never[] = []
const stableFallbackChain: string[] = []
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
  bindings: stableBindings,
  fallbackChain: stableFallbackChain,
  providerActions: stableProviderActions,
  motion: 'off' as const,
  setMotion: vi.fn()
}

function installElectronApi(listWorkspaces: () => Promise<typeof stableRecoveredWorkspaces | never[]>) {
  const api = {
    agentic: {
      getPendingApprovalIds: vi.fn(async () => stableEmptyArray),
      resolveApproval: vi.fn(async () => true),
      setApprovalOverride: vi.fn(async () => undefined)
    },
    app: { onMenuCommand: vi.fn(() => vi.fn()) },
    localAgents: { status: vi.fn(async () => stableEmptyArray) },
    runtime: {
      eventsSince: vi.fn(async () => stableEmptyArray),
      onEvent: vi.fn(() => vi.fn()),
      snapshot: vi.fn(async () => emptySnapshot)
    },
    schedules: { list: vi.fn(async () => stableEmptyArray) },
    store: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined)
    },
    terminal: { history: vi.fn(async () => stableEmptyArray) },
    workspaces: {
      getActive: vi.fn(async () => null),
      list: vi.fn(listWorkspaces),
      setActive: vi.fn(async (workspaceId: string | null) => workspaceId)
    },
    platform: 'win32'
  }
  ;(window as any).electronAPI = api
  return api
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

async function flushPendingEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advanceRetryTick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetWorkbenchUiStoreForTests()
  observedSidebar.selectWorkspace = null
  observedSidebar.workspaceId = null
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
  delete (window as any).electronAPI
})

describe('Workbench empty workspace retries', () => {
  it('stops polling after a bounded number of empty workspace loads', async () => {
    const api = installElectronApi(async () => stableEmptyArray)
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await flushPendingEffects()

    for (let tick = 0; tick < MAX_EMPTY_WORKSPACE_LOAD_CALLS + 4; tick += 1) {
      await advanceRetryTick()
    }

    expect(api.workspaces.list).toHaveBeenCalledTimes(MAX_EMPTY_WORKSPACE_LOAD_CALLS)
    expect(api.runtime.snapshot).toHaveBeenCalledTimes(MAX_EMPTY_WORKSPACE_LOAD_CALLS * 2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('loads a workspace that appears during polling and stops retrying', async () => {
    let listCalls = 0
    const api = installElectronApi(async () => {
      listCalls += 1
      return listCalls < 3 ? stableEmptyArray : stableRecoveredWorkspaces
    })
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await flushPendingEffects()

    await advanceRetryTick()
    await advanceRetryTick()

    expect(api.workspaces.list).toHaveBeenCalledTimes(3)
    expect(api.runtime.snapshot).toHaveBeenCalledWith(recoveredWorkspace.id)
    expect(vi.getTimerCount()).toBe(0)

    await advanceRetryTick()
    await advanceRetryTick()
    expect(api.workspaces.list).toHaveBeenCalledTimes(3)
  })

  it('preserves an explicit personal workspace preference when a workspace appears during polling', async () => {
    localStorage.setItem(LAST_WORKSPACE_STORE_KEY, PERSONAL_WORKSPACE_SENTINEL)
    let listCalls = 0
    const api = installElectronApi(async () => {
      listCalls += 1
      return listCalls === 1 ? stableEmptyArray : stableRecoveredWorkspaces
    })
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await flushPendingEffects()

    await advanceRetryTick()

    expect(api.workspaces.list).toHaveBeenCalledTimes(2)
    expect(api.runtime.snapshot).not.toHaveBeenCalledWith(recoveredWorkspace.id)
    expect(api.workspaces.setActive).not.toHaveBeenCalledWith(recoveredWorkspace.id)
    expect(localStorage.getItem(LAST_WORKSPACE_STORE_KEY)).toBe(PERSONAL_WORKSPACE_SENTINEL)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not issue snapshot or active-workspace IPC after pending metadata resolves post-unmount', async () => {
    const pendingWorkspaces = deferred<typeof stableRecoveredWorkspaces | never[]>()
    const api = installElectronApi(() => pendingWorkspaces.promise)
    const view = render(<WorkbenchLayout {...stableLayoutProps} />)
    await flushPendingEffects()
    expect(api.workspaces.list).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => {
      pendingWorkspaces.resolve(stableRecoveredWorkspaces)
      await pendingWorkspaces.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.runtime.snapshot).not.toHaveBeenCalled()
    expect(api.workspaces.setActive).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not issue stale snapshot or setActive IPC when an explicit workspace load supersedes pending metadata', async () => {
    const staleWorkspace = { id: 'workspace-stale', name: 'Stale', rootPath: 'E:\\Stale', createdAt: 2, updatedAt: 2 }
    const stableStaleWorkspaces = [staleWorkspace]
    const pendingAutoWorkspaces = deferred<typeof stableRecoveredWorkspaces | never[]>()
    let listCalls = 0
    const api = installElectronApi(() => {
      listCalls += 1
      return listCalls === 1 ? pendingAutoWorkspaces.promise : Promise.resolve(stableRecoveredWorkspaces)
    })
    render(<WorkbenchLayout {...stableLayoutProps} />)
    await flushPendingEffects()
    expect(api.workspaces.list).toHaveBeenCalledTimes(1)
    expect(observedSidebar.selectWorkspace).toBeTypeOf('function')

    await act(async () => {
      await observedSidebar.selectWorkspace?.(recoveredWorkspace.id)
    })
    expect(api.runtime.snapshot).toHaveBeenCalledWith(recoveredWorkspace.id)
    expect(observedSidebar.workspaceId).toBe(recoveredWorkspace.id)

    await act(async () => {
      pendingAutoWorkspaces.resolve(stableStaleWorkspaces)
      await pendingAutoWorkspaces.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.runtime.snapshot).not.toHaveBeenCalledWith(staleWorkspace.id)
    expect(api.workspaces.setActive).not.toHaveBeenCalledWith(staleWorkspace.id)
    expect(observedSidebar.workspaceId).toBe(recoveredWorkspace.id)
  })

  it('does not continue empty workspace polling after unmount', async () => {
    const api = installElectronApi(async () => stableEmptyArray)
    const view = render(<WorkbenchLayout {...stableLayoutProps} />)
    await flushPendingEffects()
    expect(api.workspaces.list).toHaveBeenCalledTimes(1)

    view.unmount()
    await advanceRetryTick()
    await advanceRetryTick()

    expect(api.workspaces.list).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
