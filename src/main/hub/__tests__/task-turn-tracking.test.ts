import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { installTaskTurnTracking } from "../task-turn-tracking"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setupTracking() {
  const dispatcher = new EventEmitter()
  const runtimeStore = {
    attachTask: vi.fn(async () => undefined),
    appendStreamEvent: vi.fn(async () => undefined)
  }
  const dispose = installTaskTurnTracking(dispatcher, runtimeStore)
  return { dispatcher, runtimeStore, dispose }
}

describe("task turn tracking", () => {
  it("detaches admission synchronously and waits for every write already in flight", async () => {
    const dispatcher = new EventEmitter()
    const attach = deferred<void>()
    const append = deferred<void>()
    const runtimeStore = {
      attachTask: vi.fn(() => attach.promise),
      appendStreamEvent: vi.fn(() => append.promise)
    }
    const cleanup = installTaskTurnTracking(dispatcher, runtimeStore)

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("stream", { taskId: "task-1", kind: "delta", text: "pending" })
    const cleanupResult: unknown = cleanup()

    try {
      expect(dispatcher.listenerCount("task:created")).toBe(0)
      expect(dispatcher.listenerCount("stream")).toBe(0)
      dispatcher.emit("task:created", { id: "task-2", __turnId: "turn-2" })
      dispatcher.emit("stream", { taskId: "task-1", kind: "delta", text: "too late" })
      expect(runtimeStore.attachTask).toHaveBeenCalledOnce()
      expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce()

      expect(cleanupResult).toBeInstanceOf(Promise)
      if (!(cleanupResult instanceof Promise)) return
      let cleaned = false
      void cleanupResult.then(() => { cleaned = true })

      attach.resolve()
      await Promise.resolve()
      expect(cleaned).toBe(false)
      append.resolve()
      await cleanupResult
      expect(cleaned).toBe(true)
    } finally {
      attach.resolve()
      append.resolve()
      if (cleanupResult instanceof Promise) await cleanupResult
    }
  })

  it("observes rejected pending writes and resolves cleanup after logging them", async () => {
    const dispatcher = new EventEmitter()
    const attach = deferred<void>()
    const append = deferred<void>()
    const runtimeStore = {
      attachTask: vi.fn(() => attach.promise),
      appendStreamEvent: vi.fn(() => append.promise)
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const cleanup = installTaskTurnTracking(dispatcher, runtimeStore)

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("stream", { taskId: "task-1", kind: "delta", text: "pending" })
    const cleanupResult: unknown = cleanup()

    try {
      expect(cleanupResult).toBeInstanceOf(Promise)
      if (!(cleanupResult instanceof Promise)) return
      let cleaned = false
      void cleanupResult.then(() => { cleaned = true })
      await Promise.resolve()
      expect(cleaned).toBe(false)

      attach.reject(new Error("attach failed during shutdown"))
      append.reject(new Error("append failed during shutdown"))
      await expect(cleanupResult).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledTimes(2)
    } finally {
      attach.resolve()
      append.resolve()
      if (cleanupResult instanceof Promise) await cleanupResult
      errorSpy.mockRestore()
    }
  })

  it("keeps the task attached while its Turn awaits a decision and releases only on a shared terminal status", () => {
    const dispatcher = new EventEmitter()
    const runtimeStore = {
      attachTask: vi.fn(async () => undefined),
      appendStreamEvent: vi.fn(async () => undefined)
    }
    installTaskTurnTracking(dispatcher, runtimeStore)
    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("task:finished", { id: "task-1", status: "awaiting-decision" })
    dispatcher.emit("stream", { taskId: "task-1", kind: "delta", text: "after pause" })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)
    dispatcher.emit("task:finished", { id: "task-1", status: "interrupted" })
    dispatcher.emit("stream", { taskId: "task-1", kind: "delta", text: "too late" })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["completed", { kind: "done", content: "answer", durationMs: 1 }],
    ["failed", { kind: "error", error: "provider failed" }],
    ["cancelled", { kind: "error", error: "cancelled", code: "AGENT_CANCELLED" }]
  ])("keeps the final %s event linked to its turn, then releases the mapping", (status, finalFields) => {
    const { dispatcher, runtimeStore } = setupTracking()
    const finalEvent = {
      taskId: "task-1",
      agentId: "codex",
      providerId: "openai",
      modelId: "gpt",
      ...finalFields
    }

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("stream", finalEvent)

    expect(runtimeStore.attachTask).toHaveBeenCalledWith("turn-1", "task-1")
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith("turn-1", finalEvent)
    expect((finalEvent as any).__runtimeTurnId).toBe("turn-1")

    dispatcher.emit("task:finished", { id: "task-1", status })
    dispatcher.emit("stream", { ...finalEvent, kind: "delta", text: "late" })

    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)
  })

  it("does not release a multi-agent task on an individual agent terminal event", () => {
    const { dispatcher, runtimeStore } = setupTracking()
    const firstDone = { kind: "done", taskId: "task-1", agentId: "codex", providerId: "openai", modelId: "gpt", content: "one", durationMs: 1 }
    const finalDone = { kind: "done", taskId: "task-1", agentId: "claude", providerId: "anthropic", modelId: "claude", content: "two", durationMs: 1 }

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("stream", firstDone)
    dispatcher.emit("stream", finalDone)

    expect(runtimeStore.appendStreamEvent).toHaveBeenNthCalledWith(1, "turn-1", firstDone)
    expect(runtimeStore.appendStreamEvent).toHaveBeenNthCalledWith(2, "turn-1", finalDone)

    dispatcher.emit("task:finished", { id: "task-1", status: "completed" })
    dispatcher.emit("stream", { ...finalDone, kind: "delta", text: "late" })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(2)
  })

  it.each(["delete", "prune"])("releases the mapping when a task is removed by %s", (reason) => {
    const { dispatcher, runtimeStore } = setupTracking()
    const finalEvent = { kind: "error", taskId: "task-1", agentId: "codex", error: "stopped" }

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("stream", finalEvent)
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledWith("turn-1", finalEvent)

    dispatcher.emit("task:removed", { taskId: "task-1", reason })
    dispatcher.emit("stream", { ...finalEvent, kind: "delta", text: "late" })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledTimes(1)
  })

  it("contains attachTask failures and drops the mapping after rejection", async () => {
    const dispatcher = new EventEmitter()
    const runtimeStore = {
      attachTask: vi.fn(async () => { throw new Error("attach failed") }),
      appendStreamEvent: vi.fn(async () => undefined)
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    installTaskTurnTracking(dispatcher, runtimeStore)

    expect(() => dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })).not.toThrow()
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce())
    expect(() => dispatcher.emit("stream", { kind: "done", taskId: "task-1", agentId: "codex" })).not.toThrow()
    dispatcher.emit("task:finished", { id: "task-1", status: "completed" })
    dispatcher.emit("stream", { kind: "delta", taskId: "task-1", agentId: "codex", text: "late" })

    expect(runtimeStore.appendStreamEvent).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it("contains appendStreamEvent failures and releases the mapping on finish", async () => {
    const dispatcher = new EventEmitter()
    const runtimeStore = {
      attachTask: vi.fn(async () => undefined),
      appendStreamEvent: vi.fn(async () => { throw new Error("append failed") })
    }
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    installTaskTurnTracking(dispatcher, runtimeStore)
    const finalEvent = { kind: "done", taskId: "task-1", agentId: "codex" }

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    expect(() => dispatcher.emit("stream", finalEvent)).not.toThrow()
    expect((finalEvent as any).__runtimeTurnId).toBe("turn-1")
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce())
    dispatcher.emit("task:finished", { id: "task-1", status: "completed" })
    expect(() => dispatcher.emit("stream", { ...finalEvent, kind: "delta", text: "late" })).not.toThrow()

    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })
})
