// @vitest-environment happy-dom
import React from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkbenchLayout } from "../WorkbenchLayout"
import { resetWorkbenchUiStoreForTests } from "../state/ui-store"
import { isTaskHistoryEvent, mergeRuntimeEventLists, runtimeAgentStatusFromEvent, shouldFlushFirstStreamDelta } from "../utils/eventUtils"
import type { PendingDecision } from "../../../shared/decision-contract"

const observedMainContent = vi.hoisted(() => ({
  workspaceId: null as string | null,
  activeThreadId: null as string | null,
  activeThreadTitle: null as string | null,
  sendError: null as string | null,
  renderCount: 0,
  selectWorkspace: null as ((workspaceId: string | null) => Promise<void>) | null
}))

const observedSidebar = vi.hoisted(() => ({
  threads: [] as WorkbenchThread[],
  decisionCount: {} as Record<string, number>,
  renderCount: 0
}))

vi.mock("../CommandPalette", () => ({ CommandPalette: () => null }))
vi.mock("../CreateWorkspaceDialog", () => ({ CreateWorkspaceDialog: () => null }))
vi.mock("../NativeTitlebar", () => ({ NativeTitlebar: () => null }))
vi.mock("../SessionSidebar", () => ({
  SessionSidebar: (props: { threads: WorkbenchThread[]; decisionCount: Record<string, number> }) => {
    observedSidebar.threads = props.threads
    observedSidebar.decisionCount = props.decisionCount
    observedSidebar.renderCount += 1
    return null
  }
}))
vi.mock("../WorkbenchAnnouncementModal", () => ({ WorkbenchAnnouncementModal: () => null }))
vi.mock("../WorkbenchMainContent", () => ({
  WorkbenchMainContent: (props: {
    workspaceId: string | null
    activeThreadId: string | null
    activeThread: WorkbenchThread | null
    sendError: string | null
    selectWorkspace: (workspaceId: string | null) => Promise<void>
  }) => {
    observedMainContent.workspaceId = props.workspaceId
    observedMainContent.activeThreadId = props.activeThreadId
    observedMainContent.activeThreadTitle = props.activeThread?.title ?? null
    observedMainContent.sendError = props.sendError
    observedMainContent.renderCount += 1
    observedMainContent.selectWorkspace = props.selectWorkspace
    return null
  }
}))
vi.mock("../WorkbenchPanelContainers", () => ({ WorkbenchPanelContainers: () => null }))

const stableEmptyArray: never[] = []
const stableAgents = {}
const stableProviders: never[] = []
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
  proxyHost: "127.0.0.1",
  agents: stableAgents,
  providers: stableProviders,
  bindings: stableBindings,
  fallbackChain: stableFallbackChain,
  providerActions: stableProviderActions,
  motion: "off" as const,
  setMotion: vi.fn()
}

const workspaceA = { id: "workspace-a", name: "A", rootPath: "E:\\Repo-A", createdAt: 1, updatedAt: 1 }
const workspaceB = { id: "workspace-b", name: "B", rootPath: "E:\\Repo-B", createdAt: 2, updatedAt: 2 }
const stableWorkspaces = [workspaceA, workspaceB]
const threadA = { id: "thread-a", workspaceId: workspaceA.id, title: "A", createdAt: 1, updatedAt: 1 }
const threadB = { id: "thread-b", workspaceId: workspaceB.id, title: "B", createdAt: 2, updatedAt: 2 }
const stableKnownThreads = [threadA, threadB]
const stableVisibleOnlyThreads = [threadA]

function makePlanTodo(threadId: string, workspaceRoot: string): ThreadTodo {
  return {
    id: `todo-${threadId}`,
    threadId,
    content: "T-1: capture evidence",
    status: "in_progress",
    source: {
      kind: "plan",
      threadId,
      turnId: `turn-${threadId}`,
      gitHeadAtDispatch: "base-b",
      gitRootAtDispatch: workspaceRoot,
      workspaceRoot,
      draftId: `draft-${threadId}`,
      planItemId: "T-1"
    },
    updatedAt: 1
  }
}

function completedEvent(threadId: string): RuntimeEvent {
  return {
    id: `event-${threadId}`,
    threadId,
    turnId: `turn-${threadId}`,
    seq: 1,
    kind: "turn:status",
    payload: { status: "completed" },
    createdAt: 2
  } as RuntimeEvent
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

function runtimeSnapshot(threads: WorkbenchThread[], activeThreadId: string | null): WorkbenchSnapshot {
  return {
    threads,
    turns: stableEmptyArray,
    runs: stableEmptyArray,
    activeThreadId
  }
}

function refreshEvent(id: string, seq: number): RuntimeEvent {
  return {
    id,
    threadId: threadA.id,
    turnId: `turn-${id}`,
    seq,
    kind: "turn:created",
    payload: {},
    createdAt: seq
  } as RuntimeEvent
}

function pendingDecision(id: string, threadId: string, createdAt: number, state: PendingDecision['state'] = 'active'): PendingDecision {
  return {
    request: {
      schemaVersion: 1,
      id,
      owner: {
        type: 'turn',
        threadId,
        turnId: `turn-${id}`,
        workspaceId: 'workspace-a',
        webContentsId: 7
      },
      source: 'agent',
      kind: 'single-select',
      title: id,
      options: [],
      minSelections: 0,
      maxSelections: 1,
      allowCustom: false,
      allowRemember: false,
      createdAt
    },
    state
  }
}

async function renderRuntimeEventHarness(input: {
  allThreads: WorkbenchThread[]
  todo: ThreadTodo
  platform?: string
  workspaces?: Array<typeof workspaceA>
  pendingDecisions?: PendingDecision[]
  listPendingDecisions?: () => Promise<PendingDecision[]>
}) {
  let runtimeListener: ((event: RuntimeEvent) => void) | null = null
  const eventTodos = [input.todo]
  const workspaces = input.workspaces ?? stableWorkspaces
  const listPendingDecisions = input.listPendingDecisions ?? vi.fn(async () => input.pendingDecisions ?? [])
  const visibleSnapshot = {
    threads: stableVisibleOnlyThreads,
    turns: stableEmptyArray,
    runs: stableEmptyArray,
    activeThreadId: threadA.id
  }
  const allSnapshot = {
    threads: input.allThreads,
    turns: stableEmptyArray,
    runs: stableEmptyArray,
    activeThreadId: threadA.id
  }
  const trace = {
    draftId: input.todo.source?.draftId || "draft",
    requirementBlocks: stableEmptyArray,
    planItems: [{
      id: "T-1",
      text: input.todo.content,
      covers: stableEmptyArray,
      status: "in_progress",
      lineNumber: 1,
      turnId: input.todo.source?.turnId
    }],
    coverage: {},
    derivedStatuses: {},
    uncoveredRequirementIds: stableEmptyArray,
    timestamp: "2026-07-10T00:00:00.000Z"
  }
  const api = {
    app: { onMenuCommand: vi.fn(() => vi.fn()) },
    git: {
      status: vi.fn(async (workspaceId: string) => ({
        isRepo: true,
        rootPath: workspaces.find(workspace => workspace.id === workspaceId)?.rootPath ?? ""
      })),
      log: vi.fn(async () => ({ entries: [{ sha: "head-b" }, { sha: "base-b" }] })),
      commitDetails: vi.fn(async () => ({ sha: "head-b", shortSha: "head-b", summary: "done", files: stableEmptyArray }))
    },
    goals: { get: vi.fn(async () => null) },
    localAgents: { status: vi.fn(async () => stableEmptyArray) },
    runtime: {
      eventsSince: vi.fn(async () => stableEmptyArray),
      onEvent: vi.fn((listener: (event: RuntimeEvent) => void) => {
        runtimeListener = listener
        return vi.fn()
      }),
      snapshot: vi.fn(async (workspaceId?: string | null): Promise<WorkbenchSnapshot> => workspaceId === undefined ? allSnapshot : visibleSnapshot)
    },
    schedules: { list: vi.fn(async () => stableEmptyArray) },
    sdd: {
      getTrace: vi.fn(async () => trace),
      saveTrace: vi.fn(async (_workspaceRoot: string, _draftId: string, _trace: unknown) => undefined)
    },
    store: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined)
    },
    terminal: { history: vi.fn(async () => stableEmptyArray) },
    turns: { listPendingDecisions },
    todos: {
      list: vi.fn(async (threadId: string) => threadId === input.todo.threadId ? eventTodos : stableEmptyArray),
      upsert: vi.fn(async (next: Partial<ThreadTodo>) => ({ ...input.todo, ...next, updatedAt: 2 }))
    },
    workspaces: {
      getActive: vi.fn(async () => workspaceA.id),
      list: vi.fn(async () => workspaces),
      setActive: vi.fn(async () => workspaceA.id)
    },
    platform: input.platform ?? "win32"
  }
  ;(window as any).electronAPI = api

  const rendered = render(React.createElement(WorkbenchLayout, stableLayoutProps))
  await waitFor(() => expect(api.runtime.onEvent.mock.calls.length).toBeGreaterThan(1))

  return {
    api,
    unmount: rendered.unmount,
    emit: async (event: RuntimeEvent) => {
      expect(runtimeListener).toBeTypeOf("function")
      await act(async () => {
        runtimeListener?.(event)
        await Promise.resolve()
      })
    }
  }
}

beforeEach(() => {
  localStorage.clear()
  resetWorkbenchUiStoreForTests()
  observedMainContent.workspaceId = null
  observedMainContent.activeThreadId = null
  observedMainContent.activeThreadTitle = null
  observedMainContent.sendError = null
  observedMainContent.renderCount = 0
  observedMainContent.selectWorkspace = null
  observedSidebar.threads = []
  observedSidebar.decisionCount = {}
  observedSidebar.renderCount = 0
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Workbench runtime event loading", () => {
  it('refreshes the globally scoped decision list on decision runtime events and passes per-thread counts to the sidebar', async () => {
    const pendingDecisions = [
      pendingDecision('decision-a', threadA.id, 1),
      pendingDecision('decision-b', threadB.id, 2, 'queued')
    ]
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo: makePlanTodo(threadB.id, workspaceB.rootPath), pendingDecisions })

    await waitFor(() => expect(harness.api.turns.listPendingDecisions).toHaveBeenCalledTimes(1))
    expect(harness.api.turns.listPendingDecisions).toHaveBeenLastCalledWith()
    expect(observedSidebar.decisionCount).toEqual({ [threadA.id]: 1, [threadB.id]: 1 })

    pendingDecisions.push(pendingDecision('decision-a-2', threadA.id, 3))
    await harness.emit({
      id: 'decision-requested',
      threadId: threadA.id,
      turnId: 'turn-decision-a-2',
      seq: 1,
      kind: 'decision:requested',
      payload: { requestId: 'decision-a-2' },
      createdAt: 3
    } as RuntimeEvent)

    await waitFor(() => expect(harness.api.turns.listPendingDecisions).toHaveBeenCalledTimes(2))
    expect(observedSidebar.decisionCount).toEqual({ [threadA.id]: 2, [threadB.id]: 1 })
  })

  it('preserves current decision counts when an older bridge lacks the pending-decision method', async () => {
    const harness = await renderRuntimeEventHarness({
      allThreads: stableKnownThreads,
      todo: makePlanTodo(threadB.id, workspaceB.rootPath),
      pendingDecisions: [pendingDecision('decision-a', threadA.id, 1)]
    })
    await waitFor(() => expect(harness.api.turns.listPendingDecisions).toHaveBeenCalledTimes(1))
    ;(harness.api.turns as { listPendingDecisions?: unknown }).listPendingDecisions = undefined

    await harness.emit({
      id: 'decision-requested-without-bridge',
      threadId: threadA.id,
      turnId: 'turn-decision-a',
      seq: 2,
      kind: 'decision:requested',
      payload: { requestId: 'decision-a' },
      createdAt: 2
    } as RuntimeEvent)
    await Promise.resolve()

    expect(observedSidebar.decisionCount).toEqual({ [threadA.id]: 1 })
  })

  it('keeps the newest authoritative decision refresh when an older request resolves late', async () => {
    const first = deferred<PendingDecision[]>()
    const second = deferred<PendingDecision[]>()
    const listPendingDecisions = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const harness = await renderRuntimeEventHarness({
      allThreads: stableKnownThreads,
      todo: makePlanTodo(threadB.id, workspaceB.rootPath),
      listPendingDecisions
    })

    await waitFor(() => expect(listPendingDecisions).toHaveBeenCalledTimes(1))
    await harness.emit({
      id: 'decision-resolved',
      threadId: threadA.id,
      turnId: 'turn-decision',
      seq: 2,
      kind: 'decision:resolved',
      payload: { requestId: 'decision-a', status: 'selected' },
      createdAt: 4
    } as RuntimeEvent)
    await waitFor(() => expect(listPendingDecisions).toHaveBeenCalledTimes(2))

    await act(async () => { second.resolve([pendingDecision('new-decision', threadB.id, 2)]) })
    await waitFor(() => expect(observedSidebar.decisionCount).toEqual({ [threadB.id]: 1 }))
    await act(async () => { first.resolve([pendingDecision('old-decision', threadA.id, 1)]) })
    await Promise.resolve()

    expect(observedSidebar.decisionCount).toEqual({ [threadB.id]: 1 })
  })

  it("mounts runtime event wiring when there are no pending approvals", async () => {
    const todo = makePlanTodo(threadB.id, workspaceB.rootPath)
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })

    expect(harness.api.runtime.onEvent).toHaveBeenCalled()
  })

  it("does not let a late runtime-event snapshot from workspace A overwrite workspace B", async () => {
    const todo = makePlanTodo(threadB.id, workspaceB.rootPath)
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })
    const snapshotA = {
      threads: [threadA],
      turns: stableEmptyArray,
      runs: stableEmptyArray,
      activeThreadId: threadA.id
    }
    const snapshotB = {
      threads: [threadB],
      turns: stableEmptyArray,
      runs: stableEmptyArray,
      activeThreadId: threadB.id
    }
    const allSnapshot = {
      threads: stableKnownThreads,
      turns: stableEmptyArray,
      runs: stableEmptyArray,
      activeThreadId: threadB.id
    }
    const lateWorkspaceA = deferred<typeof snapshotA>()
    let workspaceARefreshes = 0
    harness.api.runtime.snapshot.mockImplementation((workspaceId?: string | null) => {
      if (workspaceId === undefined) return Promise.resolve(allSnapshot)
      if (workspaceId === workspaceB.id) return Promise.resolve(snapshotB)
      workspaceARefreshes += 1
      return lateWorkspaceA.promise
    })

    await harness.emit({
      id: "event-refresh-a",
      threadId: threadA.id,
      turnId: "turn-a",
      seq: 2,
      kind: "turn:created",
      payload: {},
      createdAt: 2
    } as RuntimeEvent)
    await waitFor(() => expect(workspaceARefreshes).toBe(1))

    let switching!: Promise<void>
    act(() => {
      switching = observedMainContent.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })
    await act(async () => { await switching })
    await waitFor(() => {
      expect(observedMainContent.workspaceId).toBe(workspaceB.id)
      expect(observedMainContent.activeThreadId).toBe(threadB.id)
    })

    await act(async () => {
      lateWorkspaceA.resolve(snapshotA)
      await lateWorkspaceA.promise
      await Promise.resolve()
    })

    expect(observedMainContent.workspaceId).toBe(workspaceB.id)
    expect(observedMainContent.activeThreadId).toBe(threadB.id)
  })

  it.each(["scoped", "all", "both"] as const)(
    "keeps workspace B when the %s workspace-A refresh branch resolves late",
    async lateBranch => {
      const todo = makePlanTodo(threadB.id, workspaceB.rootPath)
      const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })
      const snapshotA = runtimeSnapshot([threadA], threadA.id)
      const snapshotB = runtimeSnapshot([threadB], threadB.id)
      const lateScoped = deferred<WorkbenchSnapshot>()
      const lateAll = deferred<WorkbenchSnapshot>()
      let scopedRefreshes = 0
      let allRefreshes = 0

      harness.api.runtime.snapshot.mockImplementation((owner?: string | null) => {
        if (owner === undefined) {
          allRefreshes += 1
          if (allRefreshes === 1) {
            return lateBranch === "all" || lateBranch === "both"
              ? lateAll.promise
              : Promise.resolve(snapshotA)
          }
          return Promise.resolve(snapshotB)
        }
        if (owner === workspaceA.id) {
          scopedRefreshes += 1
          return lateBranch === "scoped" || lateBranch === "both"
            ? lateScoped.promise
            : Promise.resolve(snapshotA)
        }
        return Promise.resolve(snapshotB)
      })

      await harness.emit(refreshEvent(`event-late-${lateBranch}`, 20))
      await waitFor(() => {
        expect(scopedRefreshes).toBe(1)
        expect(allRefreshes).toBe(1)
      })

      let switching!: Promise<void>
      act(() => {
        switching = observedMainContent.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
      })
      await act(async () => { await switching })
      await waitFor(() => {
        expect(observedMainContent.workspaceId).toBe(workspaceB.id)
        expect(observedMainContent.activeThreadId).toBe(threadB.id)
        expect(observedSidebar.threads.map(thread => thread.id)).toEqual([threadB.id])
      })

      const latePromises: Promise<WorkbenchSnapshot>[] = []
      await act(async () => {
        if (lateBranch === "scoped" || lateBranch === "both") {
          lateScoped.resolve(snapshotA)
          latePromises.push(lateScoped.promise)
        }
        if (lateBranch === "all" || lateBranch === "both") {
          lateAll.resolve(snapshotA)
          latePromises.push(lateAll.promise)
        }
        await Promise.all(latePromises)
        await Promise.resolve()
      })

      expect(observedMainContent.workspaceId).toBe(workspaceB.id)
      expect(observedMainContent.activeThreadId).toBe(threadB.id)
      expect(observedSidebar.threads.map(thread => thread.id)).toEqual([threadB.id])
    }
  )

  it("ignores late workspace-A refresh rejections after workspace B owns the view", async () => {
    const todo = makePlanTodo(threadB.id, workspaceB.rootPath)
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })
    const snapshotB = runtimeSnapshot([threadB], threadB.id)
    const lateScoped = deferred<WorkbenchSnapshot>()
    const lateAll = deferred<WorkbenchSnapshot>()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    let allRefreshes = 0

    harness.api.runtime.snapshot.mockImplementation((owner?: string | null) => {
      if (owner === undefined) {
        allRefreshes += 1
        return allRefreshes === 1 ? lateAll.promise : Promise.resolve(snapshotB)
      }
      return owner === workspaceA.id ? lateScoped.promise : Promise.resolve(snapshotB)
    })

    await harness.emit(refreshEvent("event-reject-a", 30))
    await waitFor(() => expect(allRefreshes).toBe(1))

    let switching!: Promise<void>
    act(() => {
      switching = observedMainContent.selectWorkspace?.(workspaceB.id) ?? Promise.resolve()
    })
    await act(async () => { await switching })
    await waitFor(() => {
      expect(observedMainContent.activeThreadId).toBe(threadB.id)
      expect(observedSidebar.threads.map(thread => thread.id)).toEqual([threadB.id])
    })

    await act(async () => {
      lateScoped.reject(new Error("stale scoped failure"))
      lateAll.reject(new Error("stale all-workspaces failure"))
      await Promise.allSettled([lateScoped.promise, lateAll.promise])
      await Promise.resolve()
    })

    expect(observedMainContent.workspaceId).toBe(workspaceB.id)
    expect(observedMainContent.activeThreadId).toBe(threadB.id)
    expect(observedMainContent.sendError).toBeNull()
    expect(observedSidebar.threads.map(thread => thread.id)).toEqual([threadB.id])
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("does not update rendered state when a pending runtime refresh resolves after unmount", async () => {
    const todo = makePlanTodo(threadB.id, workspaceB.rootPath)
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })
    const lateScoped = deferred<WorkbenchSnapshot>()
    const lateAll = deferred<WorkbenchSnapshot>()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    let refreshCalls = 0

    harness.api.runtime.snapshot.mockImplementation((owner?: string | null) => {
      refreshCalls += 1
      return owner === undefined ? lateAll.promise : lateScoped.promise
    })

    await harness.emit(refreshEvent("event-unmount", 40))
    await waitFor(() => expect(refreshCalls).toBe(2))
    harness.unmount()
    const mainRenderCountAfterUnmount = observedMainContent.renderCount
    const sidebarRenderCountAfterUnmount = observedSidebar.renderCount

    await act(async () => {
      lateScoped.resolve(runtimeSnapshot([threadA], threadA.id))
      lateAll.resolve(runtimeSnapshot([threadA], threadA.id))
      await Promise.all([lateScoped.promise, lateAll.promise])
      await Promise.resolve()
    })

    expect(observedMainContent.renderCount).toBe(mainRenderCountAfterUnmount)
    expect(observedSidebar.renderCount).toBe(sidebarRenderCountAfterUnmount)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("lets only the newest of two runtime refreshes for the same workspace update the view", async () => {
    const todo = makePlanTodo(threadB.id, workspaceB.rootPath)
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })
    const staleVisibleThread = { ...threadA, title: "stale visible" }
    const latestVisibleThread = { ...threadA, title: "latest visible" }
    const staleAllThread = { ...threadA, id: "thread-stale-all", title: "stale all" }
    const latestAllThread = { ...threadA, id: "thread-latest-all", title: "latest all" }
    const firstScoped = deferred<WorkbenchSnapshot>()
    const firstAll = deferred<WorkbenchSnapshot>()
    const secondScoped = deferred<WorkbenchSnapshot>()
    const secondAll = deferred<WorkbenchSnapshot>()
    let scopedRefreshes = 0
    let allRefreshes = 0

    harness.api.runtime.snapshot.mockImplementation((owner?: string | null) => {
      if (owner === undefined) {
        allRefreshes += 1
        return allRefreshes === 1 ? firstAll.promise : secondAll.promise
      }
      scopedRefreshes += 1
      return scopedRefreshes === 1 ? firstScoped.promise : secondScoped.promise
    })

    await harness.emit(refreshEvent("event-refresh-first", 50))
    await waitFor(() => {
      expect(scopedRefreshes).toBe(1)
      expect(allRefreshes).toBe(1)
    })
    await harness.emit(refreshEvent("event-refresh-second", 51))
    await waitFor(() => {
      expect(scopedRefreshes).toBe(2)
      expect(allRefreshes).toBe(2)
    })

    await act(async () => {
      secondScoped.resolve(runtimeSnapshot([latestVisibleThread], latestVisibleThread.id))
      secondAll.resolve(runtimeSnapshot([latestAllThread], latestAllThread.id))
      await Promise.all([secondScoped.promise, secondAll.promise])
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(observedMainContent.activeThreadTitle).toBe(latestVisibleThread.title)
      expect(observedSidebar.threads.map(thread => thread.id)).toEqual([latestAllThread.id])
    })

    await act(async () => {
      firstScoped.resolve(runtimeSnapshot([staleVisibleThread], staleVisibleThread.id))
      firstAll.resolve(runtimeSnapshot([staleAllThread], staleAllThread.id))
      await Promise.all([firstScoped.promise, firstAll.promise])
      await Promise.resolve()
    })

    expect(observedMainContent.activeThreadTitle).toBe(latestVisibleThread.title)
    expect(observedSidebar.threads.map(thread => thread.id)).toEqual([latestAllThread.id])
  })

  it("merges live runtime events that arrive while a snapshot is loading", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    const utils = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/eventUtils.ts"), "utf8")

    expect(utils).toContain("function mergeRuntimeEventLists")
    expect(source).toContain("setEvents(prev => mergeRuntimeEventLists(prev, nextEvents))")
    expect(source).toContain("const loadedEvents = await window.electronAPI.runtime.eventsSince")
    expect(source).toContain("const pendingForVisible = pendingRuntimeEvents.current.filter(event => event.threadId === nextVisibleThreadId)")
    expect(source).toContain("...prev.filter(event => event.threadId === nextVisibleThreadId)")
    expect(source).toContain("...pendingForVisible")
    expect(source).toContain("const pendingForSelected = selected ? pendingRuntimeEvents.current.filter(event => event.threadId === selected)")
    expect(source).toContain("...prev.filter(event => event.threadId === selected)")
    expect(source).toContain("...pendingForSelected")
    expect(source).toContain("const mergedLoadedEvents = mergeRuntimeEventLists(loadedEvents, pendingForSelected)")
    expect(source).toContain("[selected]: mergedLoadedEvents")
    expect(source).not.toContain("setEvents(await window.electronAPI.runtime.eventsSince")
  })

  it("flushes the first visible stream delta immediately before batching later deltas", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(source).toContain("seenImmediateStreamKeys")
    expect(source).toContain("shouldFlushFirstStreamDelta(event, seenImmediateStreamKeys.current)")
    expect(source).toContain("appendRuntimeEvents([event])")
    const utils = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/eventUtils.ts"), "utf8")

    expect(utils).toContain("event.kind !== 'agent:delta' || event.payload?.channel === 'thinking'")
    expect(utils).toContain("seenKeys.add(key)")
    expect(source).toContain("seenImmediateStreamKeys.current.clear()")
  })

  it("captures live events for the thread currently being loaded or selected", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(source).toContain("loadingThreadIdRef")
    expect(source).toContain("loadingThreadIdRef.current = threadId")
    expect(source).toContain("const isPendingThreadEvent = pendingActiveThreadIdRef.current !== null && event.threadId === loadingThreadIdRef.current")
    expect(source).toContain("const isVisibleThreadEvent = event.threadId === selectedThreadIdRef.current")
    expect(source).toContain("if (pendingActiveThreadIdRef.current) {")
    expect(source).toContain("if (selectThreadGenRef.current === gen) {")
  })

  it("deduplicates and sorts runtime events in the extracted utility", () => {
    const base = [
      { id: "a", threadId: "t1", turnId: "turn", seq: 2, kind: "agent:done", payload: {}, createdAt: 2 },
      { id: "b", threadId: "t1", turnId: "turn", seq: 4, kind: "agent:done", payload: {}, createdAt: 4 }
    ] as RuntimeEvent[]
    const incoming = [
      { id: "a", threadId: "t1", turnId: "turn", seq: 2, kind: "agent:done", payload: {}, createdAt: 2 },
      { id: "c", threadId: "t1", turnId: "turn", seq: 3, kind: "agent:done", payload: {}, createdAt: 3 }
    ] as RuntimeEvent[]

    expect(mergeRuntimeEventLists(base, incoming).map(event => event.id)).toEqual(["a", "c", "b"])
  })

  it("appends monotonic runtime events without changing order", () => {
    const base = [
      { id: "", threadId: "t1", turnId: "turn", seq: 1, kind: "agent:start", payload: {}, createdAt: 1 }
    ] as RuntimeEvent[]
    const incoming = [
      { id: "", threadId: "t1", turnId: "turn", seq: 2, kind: "agent:delta", payload: {}, createdAt: 2 },
      { id: "", threadId: "t1", turnId: "turn", seq: 3, kind: "agent:done", payload: {}, createdAt: 3 }
    ] as RuntimeEvent[]

    expect(mergeRuntimeEventLists(base, incoming).map(event => event.seq)).toEqual([1, 2, 3])
  })

  it("deduplicates repeated incoming runtime events before appending", () => {
    const base = [
      { id: "a", threadId: "t1", turnId: "turn", seq: 1, kind: "agent:start", payload: {}, createdAt: 1 }
    ] as RuntimeEvent[]
    const incoming = [
      { id: "b", threadId: "t1", turnId: "turn", seq: 2, kind: "agent:delta", payload: {}, createdAt: 2 },
      { id: "b", threadId: "t1", turnId: "turn", seq: 2, kind: "agent:delta", payload: {}, createdAt: 2 }
    ] as RuntimeEvent[]

    expect(mergeRuntimeEventLists(base, incoming).map(event => event.id)).toEqual(["a", "b"])
  })

  it("keeps id-based dedupe against base events even when incoming seq is newer", () => {
    const base = [
      { id: "a", threadId: "t1", turnId: "turn", seq: 1, kind: "agent:start", payload: {}, createdAt: 1 }
    ] as RuntimeEvent[]
    const incoming = [
      { id: "a", threadId: "t1", turnId: "turn", seq: 2, kind: "agent:delta", payload: {}, createdAt: 2 },
      { id: "b", threadId: "t1", turnId: "turn", seq: 3, kind: "agent:done", payload: {}, createdAt: 3 }
    ] as RuntimeEvent[]

    expect(mergeRuntimeEventLists(base, incoming).map(event => event.id)).toEqual(["a", "b"])
  })

  it("caps merged runtime events at the newest 5000 entries", () => {
    const base = Array.from({ length: 4999 }, (_, index) => ({
      id: `base-${index + 1}`,
      threadId: "t1",
      turnId: "turn",
      seq: index + 1,
      kind: "agent:delta",
      payload: {},
      createdAt: index + 1
    })) as RuntimeEvent[]
    const incoming = [
      { id: "new-5000", threadId: "t1", turnId: "turn", seq: 5000, kind: "agent:delta", payload: {}, createdAt: 5000 },
      { id: "new-5001", threadId: "t1", turnId: "turn", seq: 5001, kind: "agent:done", payload: {}, createdAt: 5001 }
    ] as RuntimeEvent[]

    const merged = mergeRuntimeEventLists(base, incoming)

    expect(merged).toHaveLength(5000)
    expect(merged[0].id).toBe("base-2")
    expect(merged[4999].id).toBe("new-5001")
  })

  it("flushes only the first content delta key in the extracted utility", () => {
    const seen = new Set<string>()
    const event = {
      id: "delta-1",
      threadId: "t1",
      turnId: "turn",
      seq: 1,
      kind: "agent:delta",
      agentId: "codex",
      payload: { channel: "content" },
      createdAt: 1
    } as RuntimeEvent

    expect(shouldFlushFirstStreamDelta(event, seen)).toBe(true)
    expect(shouldFlushFirstStreamDelta(event, seen)).toBe(false)
    expect(shouldFlushFirstStreamDelta({ ...event, id: "delta-2", payload: { channel: "thinking" } }, new Set())).toBe(false)
  })

  it("keeps task history events for non-visible threads", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const taskHistoryCacheIndex = source.indexOf("if (!isVisibleThreadEvent && isTaskHistoryEvent(event))")
    const pendingReturnIndex = source.indexOf("if (pendingActiveThreadIdRef.current) {")

    expect(isTaskHistoryEvent({ kind: "agent:activity", threadId: "t2", turnId: "turn", seq: 1 })).toBe(true)
    expect(isTaskHistoryEvent({ kind: "orchestrate", threadId: "t2", turnId: "turn", seq: 1 })).toBe(true)
    expect(isTaskHistoryEvent({ kind: "agent:delta", threadId: "t2", turnId: "turn", seq: 1 })).toBe(false)
    expect(taskHistoryCacheIndex).toBeGreaterThan(-1)
    expect(pendingReturnIndex).toBeGreaterThan(-1)
    expect(taskHistoryCacheIndex).toBeLessThan(pendingReturnIndex)
  })

  it("syncs SDD plan todo status without depending on the visible thread only", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(layout).toContain("const syncSddPlanTodoForRuntimeEvent = useCallback")
    expect(layout).toContain("await window.electronAPI.todos.list(event.threadId)")
    expect(layout).toContain("const todosForEventThread = [...persistedTodos, ...seedOnlyTodos]")
    expect(layout).toContain("void syncSddPlanTodoForRuntimeEvent(event).catch(() => {})")
    expect(layout).toContain("await syncSddPlanTodoForRuntimeEvent({")
    expect(layout).toContain("isTerminalTurnStatus(latestTurn.status)")
    expect(layout).toContain("targetAgent, workspaceId]")
  })

  it("attributes background SDD completion Git evidence to the event thread workspace", async () => {
    const todo = makePlanTodo(threadB.id, "e:\\repo-b\\")
    const harness = await renderRuntimeEventHarness({ allThreads: stableKnownThreads, todo })

    await harness.emit(completedEvent(threadB.id))

    await waitFor(() => expect(harness.api.git.status).toHaveBeenCalled())
    expect(harness.api.git.status).toHaveBeenCalledWith(workspaceB.id)
    expect(harness.api.git.status).not.toHaveBeenCalledWith(workspaceA.id)
    expect(harness.api.git.log).toHaveBeenCalledWith(workspaceB.id, 80)
    expect(harness.api.git.commitDetails).toHaveBeenCalledWith(workspaceB.id, "head-b")
    expect(harness.api.sdd.saveTrace.mock.calls.every(([root]) => root === todo.source?.workspaceRoot)).toBe(true)
  })

  it("falls back to a normalized todo source root only while the event thread is absent", async () => {
    const backgroundThreadId = "thread-b-not-yet-snapshotted"
    const todo = makePlanTodo(backgroundThreadId, "e:/repo-b/")
    const harness = await renderRuntimeEventHarness({ allThreads: stableVisibleOnlyThreads, todo })

    await harness.emit(completedEvent(backgroundThreadId))

    await waitFor(() => expect(harness.api.git.status).toHaveBeenCalled())
    expect(harness.api.git.status).toHaveBeenCalledWith(workspaceB.id)
    expect(harness.api.git.status).not.toHaveBeenCalledWith(workspaceA.id)
    expect(harness.api.git.commitDetails).toHaveBeenCalledWith(workspaceB.id, "head-b")
  })

  it("keeps Linux workspace root fallback case-sensitive when both case variants exist", async () => {
    const backgroundThreadId = "thread-linux-lower"
    const linuxUpperWorkspace = { id: "workspace-linux-upper", name: "Linux upper", rootPath: "/srv/Repo", createdAt: 3, updatedAt: 3 }
    const linuxLowerWorkspace = { id: "workspace-linux-lower", name: "Linux lower", rootPath: "/srv/repo", createdAt: 4, updatedAt: 4 }
    const stableLinuxWorkspaces = [workspaceA, linuxUpperWorkspace, linuxLowerWorkspace]
    const todo = makePlanTodo(backgroundThreadId, "/srv/repo")
    const harness = await renderRuntimeEventHarness({
      allThreads: stableVisibleOnlyThreads,
      todo,
      platform: "linux",
      workspaces: stableLinuxWorkspaces
    })

    await harness.emit(completedEvent(backgroundThreadId))

    await waitFor(() => expect(harness.api.git.status).toHaveBeenCalled())
    expect(harness.api.git.status).toHaveBeenCalledWith(linuxLowerWorkspace.id)
    expect(harness.api.git.status).not.toHaveBeenCalledWith(linuxUpperWorkspace.id)
  })

  it("fails Linux Git evidence closed for a case-only root mismatch while completing the todo", async () => {
    const backgroundThreadId = "thread-linux-unknown-case"
    const linuxUpperWorkspace = { id: "workspace-linux-upper", name: "Linux upper", rootPath: "/srv/Repo", createdAt: 3, updatedAt: 3 }
    const stableLinuxWorkspaces = [workspaceA, linuxUpperWorkspace]
    const todo = makePlanTodo(backgroundThreadId, "/srv/repo")
    const harness = await renderRuntimeEventHarness({
      allThreads: stableVisibleOnlyThreads,
      todo,
      platform: "linux",
      workspaces: stableLinuxWorkspaces
    })

    await harness.emit(completedEvent(backgroundThreadId))

    await waitFor(() => {
      expect(harness.api.todos.list.mock.calls.filter(([threadId]) => threadId === backgroundThreadId)).toHaveLength(2)
    })
    expect(harness.api.todos.upsert).toHaveBeenCalledWith(expect.objectContaining({
      threadId: backgroundThreadId,
      status: "completed"
    }))
    expect(harness.api.sdd.saveTrace).toHaveBeenCalledWith(
      todo.source?.workspaceRoot,
      todo.source?.draftId,
      expect.any(Object)
    )
    expect(harness.api.git.status).not.toHaveBeenCalled()
    expect(harness.api.git.log).not.toHaveBeenCalled()
    expect(harness.api.git.commitDetails).not.toHaveBeenCalled()
  })

  it("fails Git evidence closed for an unknown event workspace without skipping todo completion", async () => {
    const unknownThreadId = "thread-unknown"
    const todo = makePlanTodo(unknownThreadId, "E:\\Unknown-Repo")
    const harness = await renderRuntimeEventHarness({ allThreads: stableVisibleOnlyThreads, todo })

    await harness.emit(completedEvent(unknownThreadId))

    await waitFor(() => {
      expect(harness.api.todos.list.mock.calls.filter(([threadId]) => threadId === unknownThreadId)).toHaveLength(2)
    })
    expect(harness.api.todos.upsert).toHaveBeenCalledWith(expect.objectContaining({
      threadId: unknownThreadId,
      status: "completed"
    }))
    expect(harness.api.sdd.saveTrace).toHaveBeenCalledWith(
      todo.source?.workspaceRoot,
      todo.source?.draftId,
      expect.any(Object)
    )
    expect(harness.api.git.status).not.toHaveBeenCalled()
    expect(harness.api.git.log).not.toHaveBeenCalled()
    expect(harness.api.git.commitDetails).not.toHaveBeenCalled()
  })

  it("routes primary decisions through the durable DecisionService queue", () => {
    const app = readFileSync(join(process.cwd(), "src/renderer/App.tsx"), "utf8")
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(layout).toContain("refreshPendingDecisions")
    expect(layout).toContain("event.kind === 'decision:requested' || event.kind === 'decision:resolved'")
    expect(layout).not.toContain("ApprovalDialog")
    expect(layout).not.toContain("createApprovalDecisionHandler")
    expect(layout).not.toContain("getPendingApprovalIds")
    expect(app).not.toContain("e.kind === 'approval'")
    expect(app).not.toContain("setApprovals")
  })

  it("treats a created turn as sent even when the follow-up view refresh fails", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const mainContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchMainContent.tsx"), "utf8")

    expect(layout).toContain("createTurnAndRefresh(")
    expect(layout).toContain("if (outcome.refreshError)")
    expect(layout).toContain("return { ok: true as const, value: outcome.value }")
    expect(layout).toContain("const sendComposerPrompt = async")
    expect(layout).toContain("return outcome.ok ? { ok: true } : outcome")
    expect(mainContent).toContain("onSend: sendComposerPrompt")
    expect(mainContent).not.toContain("const sendFromComposer = async")
  })

  it("drives agent busy display from runtime events instead of legacy dispatch stream", () => {
    const app = readFileSync(join(process.cwd(), "src/renderer/App.tsx"), "utf8")
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(runtimeAgentStatusFromEvent({
      id: "start-1",
      threadId: "t1",
      turnId: "turn-1",
      seq: 1,
      kind: "agent:start",
      agentId: "codex",
      payload: { taskId: "task-1" },
      createdAt: 1
    } as RuntimeEvent)).toEqual({ agentId: "codex", status: "busy", runKey: "turn-1:codex:task-1" })

    expect(runtimeAgentStatusFromEvent({
      id: "done-1",
      threadId: "t1",
      turnId: "turn-1",
      seq: 2,
      kind: "agent:done",
      agentId: "codex",
      payload: { taskId: "task-1" },
      createdAt: 2
    } as RuntimeEvent)).toEqual({ agentId: "codex", status: "idle", runKey: "turn-1:codex:task-1" })

    expect(layout).toContain("runtimeAgentStatusFromEvent(event)")
    expect(layout).toContain("props.onRuntimeAgentStatus?.(runtimeAgentStatus.agentId, runtimeAgentStatus.status, runtimeAgentStatus.runKey)")
    expect(app).toContain("runtimeBusyRuns")
    expect(app).toContain("setRuntimeBusyRuns")
    expect(app).toContain("if (runtimeBusyRuns[id] && st !== 'off') st = 'busy'")
  })

  it("does not keep the legacy renderer dispatch stream or memory-backed chat state", () => {
    const app = readFileSync(join(process.cwd(), "src/renderer/App.tsx"), "utf8")

    expect(app).not.toContain("hub.onStream")
    expect(app).not.toContain("setMessages")
    expect(app).not.toContain("memoryApi.saveState")
    expect(app).not.toContain("memoryApi.loadState")
    expect(app).not.toContain("runtimeRefreshNonce")
  })
})
