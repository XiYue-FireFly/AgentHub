import type { RuntimeProducerTracker } from "./producer-tracker"

interface ShutdownDispatcher {
  stopAndDrain(): Promise<void>
}

interface ShutdownRegistry {
  stopAll(): Promise<void>
  forceKillAll(): Promise<void>
}

interface RuntimeShutdownInputs {
  dispatcher: ShutdownDispatcher | null
  registry: ShutdownRegistry
  runtimeProducers: RuntimeProducerTracker
  stopTaskTurnTracking: (() => Promise<void>) | null
  timeoutMs: number
  finalTimeoutMs?: number
  finalizationTimeoutMs?: number
  interruptRuntimeWork(reason: string): Promise<unknown>
  onFailure: (message: string, error: unknown) => void
}

const SHUTDOWN_DEADLINE_REASON = "Application shutdown deadline exceeded"
const SHUTDOWN_DRAIN_FAILURE_REASON = "Application shutdown drain failed"

export type ShutdownStepOutcome<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown }
  | { status: "timed-out"; error: Error }

export async function runShutdownStepWithDeadline<T>(
  step: () => PromiseLike<T> | T,
  timeoutMs: number
): Promise<ShutdownStepOutcome<T>> {
  let deadline: ReturnType<typeof setTimeout> | null = null
  const operation = Promise.resolve()
    .then(step)
    .then<ShutdownStepOutcome<T>, ShutdownStepOutcome<T>>(
      value => ({ status: "fulfilled", value }),
      error => ({ status: "rejected", error })
    )
  const timeout = new Promise<ShutdownStepOutcome<T>>(resolve => {
    deadline = setTimeout(() => {
      resolve({
        status: "timed-out",
        error: new Error(`Shutdown step deadline exceeded after ${timeoutMs}ms`)
      })
    }, timeoutMs)
  })

  return Promise.race([operation, timeout]).finally(() => {
    if (deadline) clearTimeout(deadline)
  })
}

interface RuntimePersistenceShutdownInputs {
  dispose(): PromiseLike<unknown> | unknown
  flush(): PromiseLike<unknown> | unknown
  timeoutMs: number
  onFailure: (message: string, error: unknown) => void
}

interface SharedRuntimeDisposeForShutdown {
  interrupt(reason: string): Promise<unknown>
  finalize(reason: string): Promise<unknown>
}

export function createSharedRuntimeDisposeForShutdown(
  dispose: (reason: string) => PromiseLike<unknown> | unknown
): SharedRuntimeDisposeForShutdown {
  let interruptedDispose: Promise<unknown> | null = null
  const startDispose = (reason: string): Promise<unknown> => Promise.resolve()
    .then(() => dispose(reason))

  return {
    interrupt(reason) {
      if (!interruptedDispose) interruptedDispose = startDispose(reason)
      return interruptedDispose
    },
    finalize(reason) {
      if (!interruptedDispose) return startDispose(reason)
      return interruptedDispose.catch(() => undefined)
    }
  }
}

export async function finalizeRuntimePersistenceForShutdown({
  dispose,
  flush,
  timeoutMs,
  onFailure
}: RuntimePersistenceShutdownInputs): Promise<void> {
  const report = (message: string, error: unknown): void => {
    try { onFailure(message, error) } catch { /* shutdown reporting must not block persistence */ }
  }
  const runPersistenceStep = async (
    step: () => PromiseLike<unknown> | unknown,
    rejectedMessage: string,
    timedOutMessage: string
  ): Promise<void> => {
    const reportedStep = (): Promise<unknown> => Promise.resolve()
      .then(step)
      .catch(error => {
        report(rejectedMessage, error)
        throw error
      })
    const outcome = await runShutdownStepWithDeadline(reportedStep, timeoutMs)
    if (outcome.status === "timed-out") report(timedOutMessage, outcome.error)
  }

  await runPersistenceStep(
    dispose,
    "[runtime-store] Shutdown persist failed",
    "[runtime-store] Shutdown persist deadline exceeded"
  )
  await runPersistenceStep(
    flush,
    "[AgentHub] Final store flush failed",
    "[AgentHub] Final store flush deadline exceeded"
  )
}

export async function drainRuntimeProducersForShutdown({
  dispatcher,
  registry,
  runtimeProducers,
  stopTaskTurnTracking,
  timeoutMs,
  finalTimeoutMs = timeoutMs,
  finalizationTimeoutMs = finalTimeoutMs,
  interruptRuntimeWork,
  onFailure
}: RuntimeShutdownInputs): Promise<void> {
  const report = (message: string, error: unknown): void => {
    try { onFailure(message, error) } catch { /* shutdown reporting must not break the barrier */ }
  }

  const startReportedStep = (
    step: () => PromiseLike<unknown> | unknown,
    failureMessage: string,
    onRejected?: (error: unknown) => void
  ): Promise<void> => Promise.resolve()
    .then(step)
    .then(() => undefined)
    .catch(error => {
      onRejected?.(error)
      report(failureMessage, error)
      throw error
    })
  const settlesWithin = async (
    operations: Promise<unknown>[],
    deadlineMs: number
  ): Promise<boolean> => {
    const outcome = await runShutdownStepWithDeadline(
      () => Promise.allSettled(operations),
      deadlineMs
    )
    return outcome.status === "fulfilled"
      && outcome.value.every(result => result.status === "fulfilled")
  }

  let unrecoverableDrainRejected = false
  let unrecoverableDrainError: unknown
  const noteUnrecoverableDrainRejection = (error: unknown): void => {
    if (!unrecoverableDrainRejected) unrecoverableDrainError = error
    unrecoverableDrainRejected = true
  }
  const dispatcherDrain = startReportedStep(
    () => dispatcher?.stopAndDrain(),
    "[AgentHub] Dispatcher shutdown drain failed",
    noteUnrecoverableDrainRejection
  )
  const registryDrain = startReportedStep(
    () => registry.stopAll(),
    "[AgentHub] Registry shutdown drain failed"
  )
  const producerDrain = startReportedStep(
    () => runtimeProducers.drain(),
    "[AgentHub] Runtime producer drain failed",
    noteUnrecoverableDrainRejection
  )
  const stopTracking = async (): Promise<void> => {
    if (!stopTaskTurnTracking) return
    try {
      await stopTaskTurnTracking()
    } catch (error) {
      report("[AgentHub] Task-turn tracking drain failed", error)
    }
  }
  const awaitFinalization = async (
    operation: Promise<unknown>,
    deadlineMessage: string
  ): Promise<void> => {
    const finalization = await runShutdownStepWithDeadline(
      () => operation,
      finalizationTimeoutMs
    )
    if (finalization.status === "timed-out") {
      report(deadlineMessage, finalization.error)
    }
  }

  const stoppedGracefully = await settlesWithin(
    [dispatcherDrain, registryDrain, producerDrain],
    timeoutMs
  )

  if (stoppedGracefully) {
    await awaitFinalization(
      stopTracking(),
      "[AgentHub] Task-turn tracking finalization deadline exceeded"
    )
    return
  }

  const forcedRegistryDrain = startReportedStep(
    () => registry.forceKillAll(),
    "[AgentHub] Forced adapter shutdown failed"
  )

  const stoppedAfterForce = await settlesWithin(
    [dispatcherDrain, producerDrain, forcedRegistryDrain],
    finalTimeoutMs
  )
  if (stoppedAfterForce && !unrecoverableDrainRejected) {
    await awaitFinalization(
      stopTracking(),
      "[AgentHub] Task-turn tracking finalization deadline exceeded"
    )
    return
  }

  const interruptionReason = unrecoverableDrainRejected
    ? SHUTDOWN_DRAIN_FAILURE_REASON
    : SHUTDOWN_DEADLINE_REASON
  const shutdownError = unrecoverableDrainRejected
    ? unrecoverableDrainError
    : new Error(interruptionReason)
  report(
    unrecoverableDrainRejected
      ? "[AgentHub] Shutdown drain failed"
      : "[AgentHub] Shutdown deadline exceeded",
    shutdownError
  )
  const trackingDrain = stopTracking()
  const interruptedPersist = startReportedStep(
    () => interruptRuntimeWork(interruptionReason),
    "[AgentHub] Failed to persist interrupted runtime work"
  )
  await Promise.all([
    awaitFinalization(
      trackingDrain,
      "[AgentHub] Task-turn tracking finalization deadline exceeded"
    ),
    awaitFinalization(
      interruptedPersist,
      "[AgentHub] Runtime interruption finalization deadline exceeded"
    )
  ])
}
