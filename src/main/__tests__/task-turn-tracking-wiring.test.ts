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

  it("routes create and retry through the central durable turns registrar", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")
    const turnsIpc = readFileSync(resolve(process.cwd(), "src/main/ipc/turns-ipc.ts"), "utf8")
    const ipcIndex = readFileSync(resolve(process.cwd(), "src/main/ipc/index.ts"), "utf8")

    expect(source).toContain("new WorkbenchTurnRunner")
    expect(source).toContain("cancel: async turnId => { await dispatcher?.cancelTurn(turnId) }")
    expect(source).toContain("new ThreadExecutionCoordinator(")
    expect(source).not.toMatch(/typedHandle\(\s*["']turns:/)
    expect(turnsIpc).toContain("coordinator.enqueueCreate")
    expect(turnsIpc).toContain("coordinator.enqueueRetry")
    expect(ipcIndex).toContain("registerTurnsIpc(")
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

  it("settles runner work through actor-local status transitions", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/index.ts"), "utf8")

    expect(source).toContain("runtimeStore.transitionTurnStatus(turn.id, ['running']")
    expect(source).toContain('await runtimeProducers.track(settlement)')
    expect(source).not.toContain('void runtimeProducers.track(settlement)')
    expect(source).toContain("if (!input.isStillActive()) return")
    expect(source).not.toContain("Legacy turns handlers")
  })

  it('uses the immutable prepared root exactly once for plugin analysis and routing', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')
    const runnerStart = source.indexOf('const workbenchTurnRunner = new WorkbenchTurnRunner')
    const preflightStart = source.indexOf('async function approvePluginPreDispatch')
    const executionStart = source.indexOf('async function executeQueuedWorkbenchTurn')
    const preflight = source.slice(preflightStart, executionStart)
    const execution = source.slice(executionStart)

    expect(runnerStart).toBeGreaterThanOrEqual(0)
    expect(source.slice(runnerStart, executionStart)).toContain('preDispatch: approvePluginPreDispatch')
    expect(preflight).toContain('const promptEnvelope = input.turn.promptEnvelope')
    expect(preflight).toContain('prompt: promptEnvelope.effectivePrompt')
    expect(preflight).not.toContain('optimizePromptForDispatch(')
    expect(source).toContain('const approved = await pluginDecisionAdapter.request({')
    expect(source).toContain('if (!input.isStillActive()) return')
    expect(execution).toContain('outcome: preDispatchOutcome')
    expect(execution).toContain('makeRouteDecision(thread.id, turn.id, promptEnvelope.effectivePrompt')
    expect(execution).not.toContain('optimizePromptForDispatch(')
    expect(execution).not.toContain('runPreDispatchHooks(')
    expect(execution).not.toContain('resolvePluginPreDispatchHooks(')
  })

  it('derives dispatcher tool-decision ownership from the durable Turn at bootstrap', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')

    expect(source).toContain('requestToolDecision: async ({ task, agentId, request, idempotencyKey, onRequested }) =>')
    expect(source).toContain('trustedDecisionOwnerForTurn(task.__turnId)')
    expect(source).toContain('onRequested: decision => onRequested(decision.id)')
    expect(source).toContain('requestAcpPermissionDecision: async ({ task, agentId, request, idempotencyKey, onRequested }) =>')
    expect(source).toContain('return acpDecisionAdapter.request({')
  })

  it("centralizes durable turn and agent cancellation in turns IPC", () => {
    const source = readFileSync(resolve(process.cwd(), "src/main/ipc/turns-ipc.ts"), "utf8")

    expect(source).toContain("decisionService.cancelTurn(turnId)")
    expect(source).toContain("dispatcher?.preCancelTurn(turnId)")
    expect(source).toContain("dispatcher?.cancelTurn(turnId, { decisionAlreadyCancelled: true })")
    expect(source).toContain("coordinator.cancelTurn(turnId, { runnerAlreadyCancelled: true })")
    expect(source).toContain("runtimeStore.cancelAgentRun(turnId, agentId")
    expect(source).toContain("dispatcher?.preCancelAgentForTurn(turnId, agentId)")
    expect(source).toContain("{ decisionAlreadyCancelled: true }")
  })
})
