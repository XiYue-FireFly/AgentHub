import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { installTaskTurnTracking } from "../../hub/task-turn-tracking"
import { RuntimeProducerTracker } from "../producer-tracker"
import {
  drainRuntimeProducersForShutdown,
  finalizeRuntimePersistenceForShutdown
} from "../shutdown-quiescence"
import * as shutdownQuiescence from "../shutdown-quiescence"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("runtime shutdown quiescence", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps task tracking attached through dispatcher drain, then awaits its pending runtime write", async () => {
    const dispatcher = new EventEmitter() as EventEmitter & { stopAndDrain: () => Promise<void> }
    const dispatcherStop = deferred<void>()
    dispatcher.stopAndDrain = vi.fn(() => dispatcherStop.promise)
    const append = deferred<void>()
    const runtimeStore = {
      attachTask: vi.fn(async () => undefined),
      appendStreamEvent: vi.fn(() => append.promise)
    }
    const stopTracking = installTaskTurnTracking(dispatcher, runtimeStore)
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const registry = {
      stopAll: vi.fn(async () => undefined),
      forceKillAll: vi.fn(async () => undefined)
    }

    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    await vi.waitFor(() => expect(runtimeStore.attachTask).toHaveBeenCalledOnce())
    let drained = false
    const draining = drainRuntimeProducersForShutdown({
      dispatcher,
      registry,
      runtimeProducers,
      stopTaskTurnTracking: stopTracking,
      timeoutMs: 1_000,
      finalTimeoutMs: 1_000,
      interruptRuntimeWork: vi.fn(async () => undefined),
      onFailure: vi.fn()
    }).then(() => { drained = true })

    expect(dispatcher.listenerCount("stream")).toBe(1)
    dispatcher.emit("stream", {
      taskId: "task-1",
      agentId: "agent-a",
      kind: "error",
      code: "AGENT_CANCELLED"
    })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce()
    dispatcherStop.resolve()

    await vi.waitFor(() => expect(dispatcher.listenerCount("stream")).toBe(0))
    expect(drained).toBe(false)
    dispatcher.emit("stream", { taskId: "task-1", kind: "delta", text: "too late" })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce()

    append.resolve()
    await draining
    expect(drained).toBe(true)
  })

  it("awaits the forced registry barrier after the graceful timeout", async () => {
    vi.useFakeTimers()
    const registryStop = deferred<void>()
    const forcedStop = deferred<void>()
    const registry = {
      stopAll: vi.fn(() => registryStop.promise),
      forceKillAll: vi.fn(() => forcedStop.promise)
    }
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    let drained = false
    const draining = drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(async () => undefined) },
      registry,
      runtimeProducers,
      stopTaskTurnTracking: null,
      timeoutMs: 50,
      finalTimeoutMs: 50,
      interruptRuntimeWork: vi.fn(async () => undefined),
      onFailure: vi.fn()
    }).then(() => { drained = true })

    await vi.advanceTimersByTimeAsync(50)
    expect(registry.forceKillAll).toHaveBeenCalledOnce()
    expect(drained).toBe(false)

    forcedStop.resolve()
    await draining
    expect(drained).toBe(true)
    registryStop.resolve()
  })

  it("bounds task tracking finalization after a graceful producer drain", async () => {
    vi.useFakeTimers()
    const trackingDrain = deferred<void>()
    const trackingFailure = new Error("late tracking failure")
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const registry = {
      stopAll: vi.fn(async () => undefined),
      forceKillAll: vi.fn(async () => undefined)
    }
    const stopTaskTurnTracking = vi.fn(() => trackingDrain.promise)
    const interruptRuntimeWork = vi.fn(async () => undefined)
    const onFailure = vi.fn()
    let drained = false

    const draining = drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(async () => undefined) },
      registry,
      runtimeProducers,
      stopTaskTurnTracking,
      timeoutMs: 10,
      finalTimeoutMs: 10,
      finalizationTimeoutMs: 15,
      interruptRuntimeWork,
      onFailure
    }).then(() => { drained = true })

    await vi.advanceTimersByTimeAsync(0)
    expect(stopTaskTurnTracking).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15)
    expect(drained).toBe(true)
    await draining
    expect(registry.forceKillAll).not.toHaveBeenCalled()
    expect(interruptRuntimeWork).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/finalization deadline/i),
      expect.any(Error)
    )

    trackingDrain.reject(trackingFailure)
    await Promise.resolve()
    await Promise.resolve()
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/task-turn tracking drain failed/i),
      trackingFailure
    )
  })

  it("bounds task tracking finalization after the forced registry barrier drains", async () => {
    vi.useFakeTimers()
    const registryStop = deferred<void>()
    const trackingDrain = deferred<void>()
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const registry = {
      stopAll: vi.fn(() => registryStop.promise),
      forceKillAll: vi.fn(async () => undefined)
    }
    const stopTaskTurnTracking = vi.fn(() => trackingDrain.promise)
    const onFailure = vi.fn()
    let drained = false

    const draining = drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(async () => undefined) },
      registry,
      runtimeProducers,
      stopTaskTurnTracking,
      timeoutMs: 10,
      finalTimeoutMs: 10,
      finalizationTimeoutMs: 15,
      interruptRuntimeWork: vi.fn(async () => undefined),
      onFailure
    }).then(() => { drained = true })

    await vi.advanceTimersByTimeAsync(10)
    expect(registry.forceKillAll).toHaveBeenCalledOnce()
    expect(stopTaskTurnTracking).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15)
    expect(drained).toBe(true)
    await draining
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/finalization deadline/i),
      expect.any(Error)
    )

    registryStop.resolve()
    trackingDrain.resolve()
  })

  it("does not treat a rejected dispatcher drain as a graceful shutdown", async () => {
    const dispatcherFailure = new Error("dispatcher drain failed")
    const registry = {
      stopAll: vi.fn(async () => undefined),
      forceKillAll: vi.fn(async () => undefined)
    }
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const interruptRuntimeWork = vi.fn(async () => undefined)
    const onFailure = vi.fn()

    await drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(async () => { throw dispatcherFailure }) },
      registry,
      runtimeProducers,
      stopTaskTurnTracking: null,
      timeoutMs: 50,
      finalTimeoutMs: 50,
      interruptRuntimeWork,
      onFailure
    })

    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/dispatcher shutdown drain failed/i),
      dispatcherFailure
    )
    expect(registry.forceKillAll).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).toHaveBeenCalledWith(expect.stringMatching(/drain failed/i))
    expect(interruptRuntimeWork).not.toHaveBeenCalledWith(expect.stringMatching(/deadline/i))
    expect(onFailure).toHaveBeenCalledWith(
      "[AgentHub] Shutdown drain failed",
      dispatcherFailure
    )
  })

  it("treats a successful forced registry stop as recovery from a graceful registry rejection", async () => {
    const registryFailure = new Error("registry stop failed")
    const registry = {
      stopAll: vi.fn(async () => { throw registryFailure }),
      forceKillAll: vi.fn(async () => undefined)
    }
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const interruptRuntimeWork = vi.fn(async () => undefined)
    const onFailure = vi.fn()

    await drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(async () => undefined) },
      registry,
      runtimeProducers,
      stopTaskTurnTracking: null,
      timeoutMs: 50,
      finalTimeoutMs: 50,
      interruptRuntimeWork,
      onFailure
    })

    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/registry shutdown drain failed/i),
      registryFailure
    )
    expect(registry.forceKillAll).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalledWith(
      expect.stringMatching(/shutdown deadline exceeded/i),
      expect.any(Error)
    )
  })

  it("does not treat a rejected producer drain as a graceful shutdown", async () => {
    const producerFailure = new Error("producer drain failed")
    const runtimeProducers = {
      drain: vi.fn(async () => { throw producerFailure })
    } as unknown as RuntimeProducerTracker
    const registry = {
      stopAll: vi.fn(async () => undefined),
      forceKillAll: vi.fn(async () => undefined)
    }
    const interruptRuntimeWork = vi.fn(async () => undefined)
    const onFailure = vi.fn()

    await drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(async () => undefined) },
      registry,
      runtimeProducers,
      stopTaskTurnTracking: null,
      timeoutMs: 50,
      finalTimeoutMs: 50,
      interruptRuntimeWork,
      onFailure
    })

    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/runtime producer drain failed/i),
      producerFailure
    )
    expect(registry.forceKillAll).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).toHaveBeenCalledWith(expect.stringMatching(/drain failed/i))
    expect(interruptRuntimeWork).not.toHaveBeenCalledWith(expect.stringMatching(/deadline/i))
    expect(onFailure).toHaveBeenCalledWith(
      "[AgentHub] Shutdown drain failed",
      producerFailure
    )
  })

  it("detaches task tracking before closing writer admission and awaits both final barriers", async () => {
    vi.useFakeTimers()
    const dispatcher = new EventEmitter() as EventEmitter & { stopAndDrain: () => Promise<void> }
    const dispatcherStop = deferred<void>()
    dispatcher.stopAndDrain = vi.fn(() => dispatcherStop.promise)
    const registryStop = deferred<void>()
    const forcedStop = deferred<void>()
    const registry = {
      stopAll: vi.fn(() => registryStop.promise),
      forceKillAll: vi.fn(() => forcedStop.promise)
    }
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const pendingStreamWrite = deferred<void>()
    const runtimeStore = {
      attachTask: vi.fn(async () => undefined),
      appendStreamEvent: vi.fn(() => pendingStreamWrite.promise)
    }
    const order: string[] = []
    const stopTracking = installTaskTurnTracking(dispatcher, runtimeStore)
    const stopTaskTurnTracking = vi.fn(() => {
      order.push("tracking")
      return stopTracking()
    })
    const interruptedPersist = deferred<void>()
    let streamListenersAtInterrupt = -1
    const interruptRuntimeWork = vi.fn(() => {
      order.push("interrupt")
      streamListenersAtInterrupt = dispatcher.listenerCount("stream")
      dispatcher.emit("stream", {
        taskId: "task-1",
        agentId: "agent-a",
        kind: "delta",
        text: "too late"
      })
      return interruptedPersist.promise
    })
    const onFailure = vi.fn()
    dispatcher.emit("task:created", { id: "task-1", __turnId: "turn-1" })
    dispatcher.emit("stream", {
      taskId: "task-1",
      agentId: "agent-a",
      kind: "delta",
      text: "already pending"
    })
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce()

    let drained = false
    const draining = drainRuntimeProducersForShutdown({
      dispatcher,
      registry,
      runtimeProducers,
      stopTaskTurnTracking,
      timeoutMs: 25,
      finalTimeoutMs: 25,
      interruptRuntimeWork,
      onFailure
    }).then(() => { drained = true })

    await vi.advanceTimersByTimeAsync(25)
    expect(registry.forceKillAll).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(25)
    await Promise.resolve()

    expect(stopTaskTurnTracking).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).toHaveBeenCalledWith(expect.stringMatching(/deadline/i))
    expect(order).toEqual(["tracking", "interrupt"])
    expect(streamListenersAtInterrupt).toBe(0)
    expect(runtimeStore.appendStreamEvent).toHaveBeenCalledOnce()
    expect(drained).toBe(false)
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/deadline/i),
      expect.any(Error)
    )

    interruptedPersist.resolve()
    await Promise.resolve()
    expect(drained).toBe(false)

    pendingStreamWrite.resolve()
    await draining
    expect(drained).toBe(true)

    dispatcherStop.resolve()
    registryStop.resolve()
    forcedStop.resolve()
  })

  it.each([
    { pendingStep: "task tracking" as const },
    { pendingStep: "runtime interruption" as const }
  ])("returns after the finalization deadline when $pendingStep never settles", async ({ pendingStep }) => {
    vi.useFakeTimers()
    const dispatcherStop = deferred<void>()
    const registryStop = deferred<void>()
    const forcedStop = deferred<void>()
    const neverSettles = deferred<void>()
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const stopTaskTurnTracking = vi.fn(() => pendingStep === "task tracking"
      ? neverSettles.promise
      : Promise.resolve())
    const interruptRuntimeWork = vi.fn(() => pendingStep === "runtime interruption"
      ? neverSettles.promise
      : Promise.resolve())
    const onFailure = vi.fn()
    let drained = false

    const draining = drainRuntimeProducersForShutdown({
      dispatcher: { stopAndDrain: vi.fn(() => dispatcherStop.promise) },
      registry: {
        stopAll: vi.fn(() => registryStop.promise),
        forceKillAll: vi.fn(() => forcedStop.promise)
      },
      runtimeProducers,
      stopTaskTurnTracking,
      timeoutMs: 10,
      finalTimeoutMs: 10,
      finalizationTimeoutMs: 15,
      interruptRuntimeWork,
      onFailure
    }).then(() => { drained = true })

    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    expect(stopTaskTurnTracking).toHaveBeenCalledOnce()
    expect(interruptRuntimeWork).toHaveBeenCalledOnce()
    expect(drained).toBe(false)

    await vi.advanceTimersByTimeAsync(15)
    expect(drained).toBe(true)
    await draining
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringMatching(/finalization deadline/i),
      expect.any(Error)
    )
  })

  it("gives task tracking and runtime interruption independent finalization deadlines and observes late rejections", async () => {
    vi.useFakeTimers()
    const dispatcherStop = deferred<void>()
    const registryStop = deferred<void>()
    const forcedStop = deferred<void>()
    const trackingDrain = deferred<void>()
    const interruptedPersist = deferred<void>()
    const trackingFailure = new Error("late tracking rejection")
    const interruptionFailure = new Error("late interruption rejection")
    const runtimeProducers = new RuntimeProducerTracker()
    runtimeProducers.close()
    const onFailure = vi.fn()
    const unhandledRejection = vi.fn()
    process.on("unhandledRejection", unhandledRejection)

    try {
      const draining = drainRuntimeProducersForShutdown({
        dispatcher: { stopAndDrain: vi.fn(() => dispatcherStop.promise) },
        registry: {
          stopAll: vi.fn(() => registryStop.promise),
          forceKillAll: vi.fn(() => forcedStop.promise)
        },
        runtimeProducers,
        stopTaskTurnTracking: vi.fn(() => trackingDrain.promise),
        timeoutMs: 10,
        finalTimeoutMs: 10,
        finalizationTimeoutMs: 15,
        interruptRuntimeWork: vi.fn(() => interruptedPersist.promise),
        onFailure
      })

      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(15)
      await draining

      expect(onFailure).toHaveBeenCalledWith(
        expect.stringMatching(/task-turn tracking finalization deadline/i),
        expect.any(Error)
      )
      expect(onFailure).toHaveBeenCalledWith(
        expect.stringMatching(/runtime interruption finalization deadline/i),
        expect.any(Error)
      )

      trackingDrain.reject(trackingFailure)
      interruptedPersist.reject(interruptionFailure)
      await Promise.allSettled([trackingDrain.promise, interruptedPersist.promise])
      await Promise.resolve()
      await Promise.resolve()
      expect(onFailure).toHaveBeenCalledWith(
        expect.stringMatching(/task-turn tracking drain failed/i),
        trackingFailure
      )
      expect(onFailure).toHaveBeenCalledWith(
        expect.stringMatching(/failed to persist interrupted runtime work/i),
        interruptionFailure
      )
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandledRejection)
      dispatcherStop.resolve()
      registryStop.resolve()
      forcedStop.resolve()
    }
  })

  it("finalizes runtime persistence in dispose-then-flush order and reports both failures", async () => {
    const disposeFailure = new Error("dispose failed")
    const flushFailure = new Error("flush failed")
    const calls: string[] = []
    const onFailure = vi.fn()

    await finalizeRuntimePersistenceForShutdown({
      dispose: () => {
        calls.push("dispose")
        throw disposeFailure
      },
      flush: async () => {
        calls.push("flush")
        throw flushFailure
      },
      timeoutMs: 50,
      onFailure
    })

    expect(calls).toEqual(["dispose", "flush"])
    expect(onFailure).toHaveBeenNthCalledWith(
      1,
      "[runtime-store] Shutdown persist failed",
      disposeFailure
    )
    expect(onFailure).toHaveBeenNthCalledWith(
      2,
      "[AgentHub] Final store flush failed",
      flushFailure
    )
  })

  it("observes and reports persistence rejections that arrive after both deadlines", async () => {
    vi.useFakeTimers()
    const disposeGate = deferred<void>()
    const flushGate = deferred<void>()
    const disposeFailure = new Error("late dispose failure")
    const flushFailure = new Error("late flush failure")
    const onFailure = vi.fn()
    const unhandledRejection = vi.fn()
    process.on("unhandledRejection", unhandledRejection)

    try {
      const finalizing = finalizeRuntimePersistenceForShutdown({
        dispose: () => disposeGate.promise,
        flush: () => flushGate.promise,
        timeoutMs: 10,
        onFailure
      })

      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(10)
      await finalizing

      disposeGate.reject(disposeFailure)
      flushGate.reject(flushFailure)
      await Promise.allSettled([disposeGate.promise, flushGate.promise])
      await Promise.resolve()
      await Promise.resolve()

      expect(onFailure).toHaveBeenCalledWith(
        "[runtime-store] Shutdown persist failed",
        disposeFailure
      )
      expect(onFailure).toHaveBeenCalledWith(
        "[AgentHub] Final store flush failed",
        flushFailure
      )
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandledRejection)
    }
  })

  it("runs a lazy shutdown step with a deadline and observes synchronous failure", async () => {
    const runWithDeadline = (
      shutdownQuiescence as unknown as {
        runShutdownStepWithDeadline?: (
          step: () => Promise<unknown> | unknown,
          timeoutMs: number
        ) => Promise<{ status: string; error?: unknown }>
      }
    ).runShutdownStepWithDeadline

    expect(runWithDeadline).toBeTypeOf("function")
    if (!runWithDeadline) return

    const failure = new Error("sync shutdown failure")
    const failed = await runWithDeadline(() => { throw failure }, 50)
    expect(failed).toEqual({ status: "rejected", error: failure })

    vi.useFakeTimers()
    const pending = deferred<void>()
    const timed = runWithDeadline(() => pending.promise, 20)
    await vi.advanceTimersByTimeAsync(20)
    await expect(timed).resolves.toMatchObject({
      status: "timed-out",
      error: expect.any(Error)
    })
    pending.reject(new Error("late shutdown rejection"))
    await Promise.resolve()
    await Promise.resolve()
  })
})
