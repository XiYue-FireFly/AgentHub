import { describe, expect, it } from "vitest"
import { RuntimeProducerTracker } from "../producer-tracker"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("RuntimeProducerTracker", () => {
  it("closes top-level admission while draining child work registered by an admitted producer", async () => {
    const tracker = new RuntimeProducerTracker()
    const parentGate = deferred<void>()
    const childGate = deferred<void>()
    let childRegistered = false

    const parent = tracker.run(async () => {
      await parentGate.promise
      tracker.track(childGate.promise)
      childRegistered = true
    })
    tracker.close()
    await expect(tracker.run(async () => undefined)).rejects.toThrow("shutting down")

    let drained = false
    const draining = tracker.drain().then(() => { drained = true })
    parentGate.resolve()
    await parent
    expect(childRegistered).toBe(true)
    await Promise.resolve()
    expect(drained).toBe(false)

    childGate.resolve()
    await draining
    expect(drained).toBe(true)
  })

  it("observes tracked rejection while drain still completes", async () => {
    const tracker = new RuntimeProducerTracker()
    const failure = deferred<void>()
    const tracked = tracker.track(failure.promise)
    tracker.close()
    const draining = tracker.drain()

    failure.reject(new Error("producer failed"))
    await expect(tracked).rejects.toThrow("producer failed")
    await expect(draining).resolves.toBeUndefined()
  })
})
