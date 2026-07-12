import { describe, expect, it, vi } from "vitest"
import type { AgentAdapter } from "../adapters/base"
import { AgentRegistry } from "../registry"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function makeAdapter(id: string, stop: AgentAdapter["stop"]): AgentAdapter {
  return {
    id,
    name: id,
    binary: id,
    protocol: "stdio-plain",
    mode: "oneshot",
    status: "idle",
    start: vi.fn(async () => undefined),
    stop,
    send: vi.fn(),
    onOutput: null,
    onError: null
  }
}

describe("AgentRegistry shutdown", () => {
  it("starts every adapter stop concurrently when one adapter is still pending", async () => {
    const firstStop = deferred<void>()
    const first = makeAdapter("first", vi.fn(() => firstStop.promise))
    const second = makeAdapter("second", vi.fn(async () => undefined))
    const registry = new AgentRegistry()
    registry.register(first)
    registry.register(second)

    const stopping = registry.stopAll()
    try {
      await Promise.resolve()
      expect(first.stop).toHaveBeenCalledOnce()
      expect(second.stop).toHaveBeenCalledOnce()
    } finally {
      firstStop.resolve()
      await stopping
    }
  })

  it("returns an awaitable force-kill barrier that settles only after adapter stops", async () => {
    const pendingStop = deferred<void>()
    const adapter = makeAdapter("pending", vi.fn(() => pendingStop.promise))
    const registry = new AgentRegistry()
    registry.register(adapter)

    const forceKillResult: unknown = registry.forceKillAll()
    try {
      expect(forceKillResult).toBeInstanceOf(Promise)
      if (!(forceKillResult instanceof Promise)) return

      let settled = false
      void forceKillResult.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)

      pendingStop.resolve()
      await forceKillResult
      expect(settled).toBe(true)
      expect(registry.get("pending")?.status).toBe("offline")
    } finally {
      pendingStop.resolve()
      if (forceKillResult instanceof Promise) await forceKillResult
    }
  })

  it("joins an adapter stop already in flight instead of reporting a false forced shutdown", async () => {
    const pendingStop = deferred<void>()
    const stop = vi.fn()
      .mockImplementationOnce(() => pendingStop.promise)
      .mockResolvedValue(undefined)
    const registry = new AgentRegistry()
    registry.register(makeAdapter("in-flight", stop))

    const graceful = registry.stopAll()
    await Promise.resolve()
    let forcedSettled = false
    const forced = registry.forceKillAll().then(() => { forcedSettled = true })
    await Promise.resolve()

    expect(stop).toHaveBeenCalledOnce()
    expect(forcedSettled).toBe(false)
    pendingStop.resolve()
    await Promise.all([graceful, forced])
    expect(forcedSettled).toBe(true)
  })

  it("surfaces a rejected stop without falsely marking the adapter offline", async () => {
    const stopFailure = new Error("adapter stop failed")
    const adapter = makeAdapter("rejecting", vi.fn(async () => { throw stopFailure }))
    const registry = new AgentRegistry()
    registry.register(adapter)

    await expect(registry.stopAll()).rejects.toBe(stopFailure)

    expect(adapter.stop).toHaveBeenCalledOnce()
    expect(registry.get("rejecting")?.status).toBe("error")
  })

  it("retries a previously rejected stop during force shutdown", async () => {
    const stopFailure = new Error("first stop failed")
    const stop = vi.fn()
      .mockRejectedValueOnce(stopFailure)
      .mockResolvedValueOnce(undefined)
    const registry = new AgentRegistry()
    registry.register(makeAdapter("retry-after-rejection", stop))

    await expect(registry.stopAll()).rejects.toBe(stopFailure)
    await expect(registry.forceKillAll()).resolves.toBeUndefined()

    expect(stop).toHaveBeenCalledTimes(2)
    expect(registry.get("retry-after-rejection")?.status).toBe("offline")
  })
})
