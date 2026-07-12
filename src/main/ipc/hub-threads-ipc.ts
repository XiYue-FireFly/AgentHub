import { buildContextProjection } from '../runtime/context-ledger'
import { runGitQuery } from '../runtime/git'
import type { RuntimeProducerTracker } from '../runtime/producer-tracker'
import { optionalWorkbenchWorkspace } from '../runtime/workspace-helpers'
import { isTerminalTurnStatus, type WorkbenchTurnStatus } from '../../shared/turn-status'
import { typedHandle } from './typed-ipc'

interface HubThreadsDeps {
  hub: any
  dispatcher: any
  decisionService: any
  registry: any
  runtimeStore: any
  memory: () => any
  proxy: any
  getWorkspaceManager: () => any
  runtimeProducers: Pick<RuntimeProducerTracker, 'run'>
  isDeletionOwnerLive: (ownerWebContentsId: number) => boolean
}

export function registerHubThreadsIpc(deps: HubThreadsDeps): void {
  const {
    hub,
    dispatcher,
    decisionService,
    registry,
    runtimeStore,
    memory,
    proxy,
    runtimeProducers,
    isDeletionOwnerLive
  } = deps

  typedHandle("hub:status", () => ({
    running: hub !== null,
    url: hub?.getUrl() || "",
    proxyUrl: proxy.getUrl(),
    clientCount: hub?.getClientCount() || 0,
    agents: registry.getAll().map((a: any) => ({
      id: a.id, name: a.name, status: a.status, capabilities: a.capabilities,
      providerId: a.providerId, modelId: a.modelId, errorCount: a.errorCount
    })),
    tasks: dispatcher?.getRecentTasks(10).map((t: any) => ({
      id: t.id, text: t.text.slice(0, 50), mode: t.mode, status: t.status, createdAt: t.createdAt
    })) || []
  }))

  typedHandle("threads:list", (_event, workspaceId) => runtimeStore.listThreads(workspaceId))
  typedHandle("threads:create", (_event, input) => {
    const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
    return runtimeStore.createThread({ ...input, workspaceId })
  })
  typedHandle("threads:rename", (_event, threadId, title) => runtimeStore.renameThread(threadId, title))
  typedHandle("threads:delete", async (event, threadId) => {
    const senderId = senderWebContentsId(event)
    if (senderId === null) return false
    const reservation = await runtimeStore.beginThreadDeletion(threadId, senderId, isDeletionOwnerLive)
    if (reservation.status === 'not-found' || reservation.status === 'forbidden') {
      return false
    }

    await cancelThreadDeletionWork(reservation.work, { dispatcher, decisionService, runtimeStore })
    let finalization = await runtimeStore.finalizeThreadDeletion(threadId, senderId)
    if (finalization.status === 'deleted' || finalization.status === 'not-found') return true

    // The durable gate prevents new admission. A final revalidation may still
    // discover work captured by an earlier in-flight writer, so cancel that
    // exact current set before the single final attempt.
    await cancelThreadDeletionWork(finalization.work, { dispatcher, decisionService, runtimeStore })
    finalization = await runtimeStore.finalizeThreadDeletion(threadId, senderId)
    if (finalization.status === 'deleted' || finalization.status === 'not-found') return true

    throw new Error('Thread deletion is in progress; retry cleanup.')
  })
  typedHandle("threads:select", (_event, threadId) => runtimeStore.selectThread(threadId))
  typedHandle("threads:fork", (_event, input) => runtimeProducers.run(async () => {
    if (!input || typeof input.message !== 'string' || !input.message.trim()) {
      throw new Error('Invalid fork input: message is required')
    }
    const newThread = await runtimeStore.createThread({ title: `Fork: ${input.message.slice(0, 50)}` })
    const { turn: forkTurn } = await runtimeStore.createTurn({
      threadId: newThread.id,
      workspaceId: newThread.workspaceId ?? null,
      prompt: input.message,
      mode: "auto",
      targetAgent: null,
      attachments: [],
      modelSelection: undefined,
      thinking: { mode: "off", level: "minimal" }
    })
    const sourceEvents = runtimeStore.eventsSince(input.sourceThreadId, 0)
    const turnEvents = sourceEvents.filter((e: any) => e.turnId === input.sourceTurnId)
    for (const event of turnEvents) {
      if (!isForkableStreamEvent(event)) continue
      const stream = runtimeStreamFromEvent(event, forkTurn.id)
      await runtimeStore.appendStreamEvent(forkTurn.id, stream)
    }
    const finalStatus = finalStatusFromEvents(turnEvents)
    if (finalStatus === "cancelled") await runtimeStore.cancelTurn(forkTurn.id)
    else if (finalStatus === "interrupted") await runtimeStore.interruptTurn(forkTurn.id)
    else await runtimeStore.transitionTurnStatus(forkTurn.id, ["running"], finalStatus)
    return newThread
  }))

  typedHandle("runtime:snapshot", (_event, workspaceId) => runtimeStore.snapshot(workspaceId))
  typedHandle("runtime:eventsSince", (_event, threadId, seq = 0) => runtimeStore.eventsSince(threadId, seq))
  typedHandle("context:projection", (_event, input) => {
    const thread = input?.threadId ? runtimeStore.getThread(input.threadId) : undefined
    const workspaceId = thread ? thread.workspaceId : optionalWorkbenchWorkspace(input?.workspaceId)
    const snapshot = runtimeStore.snapshot(undefined)
    const events = thread ? runtimeStore.eventsSince(thread.id, 0) : []
    return buildContextProjection({
      thread,
      workspaceId,
      prompt: input?.prompt || "",
      attachments: Array.isArray(input?.attachments) ? input.attachments : [],
      snapshot,
      events,
      memories: memory().selectContextEntries(input?.prompt || "", { limit: 8, tokenBudget: 3_000 }),
      pinnedBlocks: Array.isArray(input?.pinnedBlocks) ? input.pinnedBlocks : [],
      writeDraft: input?.writeDraft ?? null
    })
  })

  typedHandle("git:query", (_event, input) => runtimeProducers.run(async () => {
    const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
    if (!workspaceId) throw new Error("Git query requires a workspace")
    const thread = input?.threadId ? runtimeStore.getThread(input.threadId) : undefined
    const { thread: targetThread, turn } = await runtimeStore.createTurn({
      threadId: thread?.id ?? null,
      workspaceId,
      prompt: input?.query || "git status",
      mode: "auto",
      targetAgent: null,
      attachments: [],
      modelSelection: undefined,
      thinking: { mode: "off", level: "minimal" }
    })
    try {
      const result = await runGitQuery(workspaceId, input?.query || "status")
      await runtimeStore.appendStreamEvent(turn.id, {
        turnId: turn.id,
        type: "content",
        content: result,
        agentId: "git"
      })
      await runtimeStore.transitionTurnStatus(turn.id, ["running"], "completed")
      return { threadId: targetThread.id, turnId: turn.id, result }
    } catch (e: any) {
      await runtimeStore.appendStreamEvent(turn.id, {
        turnId: turn.id,
        type: "content",
        content: `Git query failed: ${e?.message || String(e)}`,
        agentId: "git"
      })
      await runtimeStore.transitionTurnStatus(turn.id, ["running"], "failed")
      return { threadId: targetThread.id, turnId: turn.id, result: null, error: e?.message || String(e) }
    }
  }))
}

function senderWebContentsId(event: { sender?: { id?: unknown } }): number | null {
  const id = event.sender?.id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

type ThreadDeletionWork = {
  turns: Array<{ id: string }>
  decisionTurnIds: string[]
}

async function cancelThreadDeletionWork(
  work: ThreadDeletionWork,
  deps: { dispatcher: any; decisionService: any; runtimeStore: any }
): Promise<void> {
  const errors: unknown[] = []
  const turnIds = [...new Set([
    ...work.turns.map(turn => turn.id),
    ...work.decisionTurnIds
  ])]

  // Tombstone every captured dispatcher continuation before any awaited
  // cancellation can resolve a durable decision waiter.
  for (const turn of work.turns) {
    try {
      deps.dispatcher?.preCancelTurn?.(turn.id)
    } catch (error) {
      errors.push(error)
    }
  }

  if (!deps.decisionService?.cancelTurn && turnIds.length > 0) {
    errors.push(new Error('Decision cancellation service is unavailable'))
  } else {
    for (const turnId of turnIds) {
      try {
        await deps.decisionService?.cancelTurn(turnId)
      } catch (error) {
        errors.push(error)
      }
    }
  }

  for (const turn of work.turns) {
    try {
      await deps.dispatcher?.cancelTurn?.(turn.id, { decisionAlreadyCancelled: true })
    } catch (error) {
      errors.push(error)
    }
  }
  for (const turn of work.turns) {
    try {
      await deps.runtimeStore.cancelTurn(turn.id, { reason: 'Thread deleted by user.' })
    } catch (error) {
      errors.push(error)
    }
  }

  if (errors.length > 0) {
    throw new Error('Thread deletion is in progress; retry cleanup.')
  }
}

// isProviderDirectSelection is now imported from shared/utils (LOW-08)

function runtimeStreamFromEvent(event: any, turnId: string): any {
  const payload = event && typeof event.payload === "object" && event.payload !== null
    ? { ...event.payload }
    : { ...event }
  const runtimeKind = typeof event?.kind === "string" ? event.kind : undefined
  payload.kind = payload.kind ?? streamKindFromRuntimeKind(runtimeKind)
  payload.agentId = payload.agentId ?? event?.agentId
  payload.turnId = turnId
  return payload
}

function streamKindFromRuntimeKind(kind?: string): string {
  switch (kind) {
    case "agent:start":
      return "start"
    case "agent:delta":
      return "delta"
    case "agent:approval":
      return "approval"
    case "agent:done":
      return "done"
    case "agent:error":
      return "error"
    case "orchestrate":
      return "orchestrate:fork"
    default:
      return "activity"
  }
}

function isForkableStreamEvent(event: any): boolean {
  return [
    "agent:start",
    "agent:delta",
    "agent:activity",
    "agent:approval",
    "agent:done",
    "agent:error",
    "orchestrate"
  ].includes(event?.kind)
}

function finalStatusFromEvents(events: any[]): WorkbenchTurnStatus {
  const statusEvent = [...events]
    .reverse()
    .find(event => event?.kind === "turn:status" && typeof event?.payload?.status === "string")
  const status = statusEvent?.payload?.status as WorkbenchTurnStatus | undefined
  return status && isTerminalTurnStatus(status) ? status : "completed"
}
