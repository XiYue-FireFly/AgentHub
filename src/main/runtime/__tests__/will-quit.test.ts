import { afterEach, describe, expect, it, vi } from "vitest"
import { RuntimeProducerTracker } from "../producer-tracker"
import {
  drainRuntimeProducersForShutdown,
  finalizeRuntimePersistenceForShutdown
} from "../shutdown-quiescence"
import * as shutdownQuiescence from "../shutdown-quiescence"
import { createWillQuitHandler } from "../will-quit"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("will-quit lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("prevents every quit event while running cleanup and exit exactly once after cleanup", async () => {
    const cleanupGate = deferred<void>()
    const cleanup = vi.fn(() => cleanupGate.promise)
    const exit = vi.fn()
    const onFailure = vi.fn()
    const handleWillQuit = createWillQuitHandler({ cleanup, exit, onFailure })
    const firstEvent = { preventDefault: vi.fn() }
    const secondEvent = { preventDefault: vi.fn() }

    const firstCompletion = handleWillQuit(firstEvent)
    const secondCompletion = handleWillQuit(secondEvent)
    await Promise.resolve()

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce()
    expect(secondCompletion).toBe(firstCompletion)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    cleanupGate.resolve()
    await firstCompletion

    expect(exit).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("reuses completed cleanup and retries exit after the first exit attempt throws", async () => {
    const exitError = new Error("exit failed")
    const cleanup = vi.fn(async () => undefined)
    const exit = vi.fn()
      .mockImplementationOnce(() => { throw exitError })
      .mockImplementationOnce(() => undefined)
    const onFailure = vi.fn()
    const handleWillQuit = createWillQuitHandler({ cleanup, exit, onFailure })
    const firstEvent = { preventDefault: vi.fn() }
    const duplicateEvent = { preventDefault: vi.fn() }
    const retryEvent = { preventDefault: vi.fn() }

    const firstCompletion = handleWillQuit(firstEvent)
    const duplicateCompletion = handleWillQuit(duplicateEvent)
    await firstCompletion

    expect(duplicateCompletion).toBe(firstCompletion)
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(duplicateEvent.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/exit failed/i),
      exitError
    )

    const retryCompletion = handleWillQuit(retryEvent)
    expect(retryCompletion).not.toBe(firstCompletion)
    await retryCompletion

    expect(retryEvent.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledTimes(2)
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it("waits for the dispose deadline before flushing and exits after the independent flush deadline", async () => {
    vi.useFakeTimers()
    const disposeGate = deferred<void>()
    const flushGate = deferred<void>()
    const order: string[] = []
    const dispose = vi.fn(() => {
      order.push("dispose")
      return disposeGate.promise
    })
    const flush = vi.fn(() => {
      order.push("flush")
      return flushGate.promise
    })
    const exit = vi.fn(() => { order.push("exit") })
    const onFailure = vi.fn()
    const cleanup = () => finalizeRuntimePersistenceForShutdown({
      dispose,
      flush,
      timeoutMs: 10,
      onFailure
    })
    const handleWillQuit = createWillQuitHandler({ cleanup, exit, onFailure })

    const completion = handleWillQuit({ preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(["dispose"])

    await vi.advanceTimersByTimeAsync(9)
    expect(flush).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(order).toEqual(["dispose", "flush"])
    expect(exit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    await completion
    expect(order).toEqual(["dispose", "flush", "exit"])
    expect(exit).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/runtime.*deadline/i),
      expect.any(Error)
    )
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/store flush.*deadline/i),
      expect.any(Error)
    )

    disposeGate.resolve()
    flushGate.resolve()
  })

  it("shares the interrupted runtime dispose with final persistence and reports its late rejection once", async () => {
    vi.useFakeTimers()
    const createSharedRuntimeDispose = (
      shutdownQuiescence as unknown as {
        createSharedRuntimeDisposeForShutdown?: (
          dispose: (reason: string) => PromiseLike<unknown> | unknown
        ) => {
          interrupt(reason: string): Promise<unknown>
          finalize(reason: string): Promise<unknown>
        }
      }
    ).createSharedRuntimeDisposeForShutdown

    expect(createSharedRuntimeDispose).toBeTypeOf("function")
    if (!createSharedRuntimeDispose) return

    const dispatcherStop = deferred<void>()
    const registryStop = deferred<void>()
    const forcedStop = deferred<void>()
    const disposeGate = deferred<void>()
    const flushGate = deferred<void>()
    const disposeFailure = new Error("late shared dispose failure")
    const rawDispose = vi.fn((_reason: string) => disposeGate.promise)
    const sharedDispose = createSharedRuntimeDispose(rawDispose)
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const flush = vi.fn(() => flushGate.promise)
    const exit = vi.fn()
    const onFailure = vi.fn()
    const unhandledRejection = vi.fn()
    process.on("unhandledRejection", unhandledRejection)

    try {
      const cleanup = async (): Promise<void> => {
        await drainRuntimeProducersForShutdown({
          dispatcher: { stopAndDrain: vi.fn(() => dispatcherStop.promise) },
          registry: {
            stopAll: vi.fn(() => registryStop.promise),
            forceKillAll: vi.fn(() => forcedStop.promise)
          },
          runtimeProducers,
          stopTaskTurnTracking: null,
          timeoutMs: 10,
          finalTimeoutMs: 10,
          finalizationTimeoutMs: 10,
          interruptRuntimeWork: reason => sharedDispose.interrupt(reason),
          onFailure
        })
        await finalizeRuntimePersistenceForShutdown({
          dispose: () => sharedDispose.finalize("Application shutdown"),
          flush,
          timeoutMs: 10,
          onFailure
        })
      }
      const handleWillQuit = createWillQuitHandler({ cleanup, exit, onFailure })
      const completion = handleWillQuit({ preventDefault: vi.fn() })

      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(10)
      expect(rawDispose).toHaveBeenCalledOnce()
      expect(rawDispose).toHaveBeenCalledWith(expect.stringMatching(/deadline/i))

      await vi.advanceTimersByTimeAsync(10)
      expect(flush).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(9)
      expect(flush).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(flush).toHaveBeenCalledOnce()
      expect(rawDispose).toHaveBeenCalledOnce()

      disposeGate.reject(disposeFailure)
      await Promise.allSettled([disposeGate.promise])
      await Promise.resolve()
      await Promise.resolve()

      const disposeFailureReports = onFailure.mock.calls.filter(([, error]) => error === disposeFailure)
      expect(disposeFailureReports).toEqual([
        ["[AgentHub] Failed to persist interrupted runtime work", disposeFailure]
      ])
      expect(onFailure).not.toHaveBeenCalledWith(
        "[runtime-store] Shutdown persist failed",
        disposeFailure
      )

      await vi.advanceTimersByTimeAsync(10)
      await completion
      expect(exit).toHaveBeenCalledOnce()
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandledRejection)
      dispatcherStop.resolve()
      registryStop.resolve()
      forcedStop.resolve()
      flushGate.resolve()
    }
  })
})
