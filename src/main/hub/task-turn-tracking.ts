import { isTerminalTurnStatus, type WorkbenchTurnStatus } from "../../shared/turn-status"

interface TaskTurnEventSource {
  on(event: string, listener: (...args: any[]) => void): unknown
  off?(event: string, listener: (...args: any[]) => void): unknown
}

interface TaskTurnRuntimeStore {
  attachTask(turnId: string, taskId: string): Promise<unknown>
  appendStreamEvent(turnId: string, event: any): Promise<unknown>
}

export function installTaskTurnTracking(
  dispatcher: TaskTurnEventSource,
  runtimeStore: TaskTurnRuntimeStore
): () => Promise<void> {
  const taskToTurn = new Map<string, string>()
  const pendingWrites = new Set<Promise<void>>()
  let accepting = true
  let cleanupPromise: Promise<void> | null = null

  const trackWrite = (
    write: () => Promise<unknown>,
    onFailure: (error: unknown) => void
  ): void => {
    let result: Promise<unknown>
    try {
      result = write()
    } catch (error) {
      onFailure(error)
      return
    }

    const observed = Promise.resolve(result).then(
      () => undefined,
      error => { onFailure(error) }
    )
    pendingWrites.add(observed)
    void observed.then(() => { pendingWrites.delete(observed) })
  }

  const onCreated = (task: { id: string; __turnId?: string }) => {
    if (!accepting) return
    if (!task.__turnId) return
    taskToTurn.set(task.id, task.__turnId)
    trackWrite(
      () => runtimeStore.attachTask(task.__turnId!, task.id),
      error => {
        if (taskToTurn.get(task.id) === task.__turnId) taskToTurn.delete(task.id)
        console.error("[task-turn-tracking] Failed to attach task to turn", error)
      }
    )
  }
  const onStream = (event: { taskId: string; __runtimeTurnId?: string }) => {
    if (!accepting) return
    const turnId = taskToTurn.get(event.taskId)
    if (!turnId) return
    event.__runtimeTurnId = turnId
    trackWrite(
      () => runtimeStore.appendStreamEvent(turnId, event),
      error => {
        console.error("[task-turn-tracking] Failed to append stream event", error)
      }
    )
  }
  const onFinished = (task: { id: string; status: WorkbenchTurnStatus }) => {
    if (!accepting) return
    if (isTerminalTurnStatus(task.status)) {
      taskToTurn.delete(task.id)
    }
  }
  const onRemoved = (event: { taskId: string }) => {
    if (!accepting) return
    taskToTurn.delete(event.taskId)
  }

  dispatcher.on("task:created", onCreated)
  dispatcher.on("stream", onStream)
  dispatcher.on("task:finished", onFinished)
  dispatcher.on("task:removed", onRemoved)

  return () => {
    if (cleanupPromise) return cleanupPromise
    accepting = false
    dispatcher.off?.("task:created", onCreated)
    dispatcher.off?.("stream", onStream)
    dispatcher.off?.("task:finished", onFinished)
    dispatcher.off?.("task:removed", onRemoved)
    taskToTurn.clear()
    cleanupPromise = Promise.all(Array.from(pendingWrites)).then(() => undefined)
    return cleanupPromise
  }
}
