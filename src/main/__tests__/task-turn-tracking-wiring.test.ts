import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("main task turn tracking wiring", () => {
  it("installs lifecycle tracking instead of retaining the old global task map", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("installTaskTurnTracking(dispatcher, runtimeStore)")
    expect(source).not.toContain("const taskToTurn = new Map")
    expect(source).not.toContain("taskToTurn.set(")
  })

  it("closes and awaits every runtime producer before the final runtime drain", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")
    const cleanupStart = source.indexOf("const cleanup = async (): Promise<void> => {")
    const cleanupEnd = source.indexOf("handleWillQuit = createWillQuitHandler", cleanupStart)
    const cleanup = source.slice(cleanupStart, cleanupEnd)
    const producerClose = cleanup.indexOf("runtimeProducers.close()")
    const hubStop = cleanup.indexOf("hub?.stop()")
    const proxyStop = cleanup.indexOf("proxy.stop()")
    const producerDrain = cleanup.indexOf("await drainRuntimeProducersForShutdown({")
    const runtimeDispose = cleanup.indexOf(
      '() => runtimeDispose.finalize("Application shutdown")'
    )
    const finalStoreFlush = cleanup.indexOf("() => store.flush()")

    expect(cleanupStart).toBeGreaterThanOrEqual(0)
    expect(producerClose).toBeGreaterThanOrEqual(0)
    expect(hubStop).toBeGreaterThan(producerClose)
    expect(proxyStop).toBeGreaterThan(producerClose)
    expect(producerDrain).toBeGreaterThan(hubStop)
    expect(producerDrain).toBeGreaterThan(proxyStop)
    expect(producerDrain).toBeLessThan(runtimeDispose)
    expect(runtimeDispose).toBeLessThan(finalStoreFlush)
    expect(cleanup).toContain("interruptRuntimeWork: reason => runtimeDispose.interrupt(reason)")
    expect(cleanup).not.toContain("setImmediate")
  })

  it("tracks create and retry handlers plus their detached settlements", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain('typedHandle("turns:create", (_event, payload) => runtimeProducers.run(async () => {')
    expect(source).toContain('typedHandle("turns:retry", (_event, turnId) => runtimeProducers.run(async () => {')
    expect(source).toContain("const createSettlement = runner")
    expect(source).toContain("runtimeProducers.track(createSettlement)")
    expect(source).toContain("const retrySettlement = retryRunner")
    expect(source).toContain("runtimeProducers.track(retrySettlement)")
    expect(source).toContain("stopTaskTurnTracking = installTaskTurnTracking(dispatcher, runtimeStore)")
  })

  it("routes will-quit through the tested single-flight cleanup and exit handler", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("handleWillQuit = createWillQuitHandler({")
    expect(source).toContain("exit: () => app.exit(0)")
    expect(source).toContain("void handleWillQuit(event)")
    expect(source).not.toContain("willQuitCleanupStarted")
  })

  it("delegates final store flush failure handling to the persistence finalizer", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")
    const cleanupStart = source.indexOf("const cleanup = async (): Promise<void> => {")
    const cleanupEnd = source.indexOf("handleWillQuit = createWillQuitHandler", cleanupStart)
    const cleanup = source.slice(cleanupStart, cleanupEnd)

    expect(source).toContain("createSharedRuntimeDisposeForShutdown,")
    expect(source).toContain("drainRuntimeProducersForShutdown,")
    expect(source).toContain("finalizeRuntimePersistenceForShutdown")
    expect(cleanup).toContain("await finalizeRuntimePersistenceForShutdown({")
    expect(cleanup).toContain("() => store.flush()")
    expect(cleanup).toContain("onFailure: logShutdownFailure")
  })

  it("bounds final runtime disposal and config flush while preserving an interruption reason", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")
    const cleanupStart = source.indexOf("const cleanup = async (): Promise<void> => {")
    const cleanupEnd = source.indexOf("handleWillQuit = createWillQuitHandler", cleanupStart)
    const cleanup = source.slice(cleanupStart, cleanupEnd)

    expect(source).toContain("createSharedRuntimeDisposeForShutdown,")
    expect(source).toContain("drainRuntimeProducersForShutdown,")
    expect(source).toContain("finalizeRuntimePersistenceForShutdown")
    expect(cleanup.match(/await finalizeRuntimePersistenceForShutdown\(/g)).toHaveLength(1)
    expect(cleanup).toContain(
      'dispose: () => runtimeDispose.finalize("Application shutdown")'
    )
    expect(source).toContain("reason => runtimeStore.dispose({ interruptReason: reason })")
    expect(cleanup).toContain("interruptRuntimeWork: reason => runtimeDispose.interrupt(reason)")
    expect(cleanup).toContain("flush: () => store.flush()")
    expect(cleanup).toContain("timeoutMs: STOP_TIMEOUT_MS")
    expect(cleanup).toContain("onFailure: logShutdownFailure")
    expect(cleanup).not.toContain("await runtimeStore.dispose()")
    expect(cleanup).not.toContain("await store.flush()")
  })

  it("does not start an unobserved config flush during before-quit", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")
    const beforeQuitStart = source.indexOf('app.on("before-quit"')
    const beforeQuitEnd = source.indexOf("\n})", beforeQuitStart)
    const beforeQuit = source.slice(beforeQuitStart, beforeQuitEnd)

    expect(beforeQuitStart).toBeGreaterThanOrEqual(0)
    expect(beforeQuit).not.toContain("store.flush()")
  })

  it("settles create and retry runners through actor-local status transitions", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain('runtimeStore.transitionTurnStatus(turn.id, ["running"]')
    expect(source).toContain('runtimeStore.transitionTurnStatus(created.turn.id, ["running"]')
    expect(source).not.toContain('if (runtimeStore.getTurn(turn.id)?.status === "cancelled") return')
    expect(source).not.toContain('if (runtimeStore.getTurn(created.turn.id)?.status === "cancelled") return')
  })

  it("cancels an agent and conditionally settles its Turn inside one runtime actor operation", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")
    const cancelTurnStart = source.indexOf('typedHandle("turns:cancel"')
    const cancelAgentStart = source.indexOf('typedHandle("turns:cancelAgent"')
    const cancelTurnHandler = source.slice(cancelTurnStart, cancelAgentStart)
    const cancelAgentEnd = source.indexOf('typedHandle("turns:resolveGuard"', cancelAgentStart)
    const cancelAgentHandler = source.slice(cancelAgentStart, cancelAgentEnd)

    expect(source).toContain("runtimeStore.cancelAgentRun(turnId, agentId")
    expect(cancelTurnHandler).toContain("runtimeStore.cancelTurn(turnId")
    expect(cancelTurnHandler.indexOf("runtimeStore.cancelTurn(turnId"))
      .toBeLessThan(cancelTurnHandler.indexOf("dispatcher?.cancelTurn(turnId)"))
    expect(cancelTurnHandler).toContain("dispatcher?.cancelTurn(turnId)")
    expect(cancelAgentHandler.indexOf("runtimeStore.cancelAgentRun(turnId, agentId"))
      .toBeLessThan(cancelAgentHandler.indexOf("dispatcher?.cancelAgentForTurn(turnId, agentId)"))
    expect(cancelAgentHandler).toContain("dispatcher?.cancelAgentForTurn(turnId, agentId)")
    expect(source).not.toContain("runtimeStore.setRunStatus(turnId, agentId, \"cancelled\"")
    expect(source).not.toContain("const freshSnapshot = runtimeStore.snapshot()")
    expect(source).not.toContain("const remainingRunning = freshSnapshot.runs.filter")
  })
})
