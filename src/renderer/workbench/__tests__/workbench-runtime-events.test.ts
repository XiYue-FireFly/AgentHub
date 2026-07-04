import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isTaskHistoryEvent, mergeRuntimeEventLists, runtimeAgentStatusFromEvent, shouldFlushFirstStreamDelta } from "../utils/eventUtils"

describe("Workbench runtime event loading", () => {
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
    expect(source).toContain("[selected]: mergeRuntimeEventLists(loadedEvents, pendingForSelected)")
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
    expect(source).toContain("const isPendingThreadEvent = pendingActiveThreadId !== null && event.threadId === loadingThreadIdRef.current")
    expect(source).toContain("const isVisibleThreadEvent = event.threadId === selectedThreadIdRef.current")
    expect(source).toContain("if (pendingActiveThreadId) {")
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
    const pendingReturnIndex = source.indexOf("if (pendingActiveThreadId) {")

    expect(isTaskHistoryEvent({ kind: "agent:activity", threadId: "t2", turnId: "turn", seq: 1 })).toBe(true)
    expect(isTaskHistoryEvent({ kind: "orchestrate", threadId: "t2", turnId: "turn", seq: 1 })).toBe(true)
    expect(isTaskHistoryEvent({ kind: "agent:delta", threadId: "t2", turnId: "turn", seq: 1 })).toBe(false)
    expect(taskHistoryCacheIndex).toBeGreaterThan(-1)
    expect(pendingReturnIndex).toBeGreaterThan(-1)
    expect(taskHistoryCacheIndex).toBeLessThan(pendingReturnIndex)
  })

  it("drives approval requests from runtime events instead of legacy dispatch stream", () => {
    const app = readFileSync(join(process.cwd(), "src/renderer/App.tsx"), "utf8")
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(layout).toContain("appendApprovalFromRuntimeEvent(event)")
    expect(layout).toContain("approvalItemFromRuntimeEvent(event)")
    expect(layout).toContain("<ApprovalDialog items={approvals} onDecide={onApprovalDecide} />")
    expect(app).not.toContain("e.kind === 'approval'")
    expect(app).not.toContain("setApprovals")
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
