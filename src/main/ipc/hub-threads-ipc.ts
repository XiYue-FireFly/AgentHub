import { buildContextProjection } from '../runtime/context-ledger'
import { runGitQuery } from '../runtime/git'
import { optionalWorkbenchWorkspace } from '../runtime/workspace-helpers'
import { typedHandle } from './typed-ipc'

interface HubThreadsDeps {
  hub: any
  dispatcher: any
  registry: any
  runtimeStore: any
  memory: () => any
  proxy: any
  getWorkspaceManager: () => any
}

export function registerHubThreadsIpc(deps: HubThreadsDeps): void {
  const { hub, dispatcher, registry, runtimeStore, memory, proxy } = deps

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
  typedHandle("threads:delete", (_event, threadId) => runtimeStore.deleteThread(threadId))
  typedHandle("threads:select", (_event, threadId) => runtimeStore.selectThread(threadId))
  typedHandle("threads:fork", (_event, input) => {
    if (!input || typeof input.message !== 'string' || !input.message.trim()) {
      throw new Error('Invalid fork input: message is required')
    }
    const newThread = runtimeStore.createThread({ title: `Fork: ${input.message.slice(0, 50)}` })
    const { turn: forkTurn } = runtimeStore.createTurn({
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
      runtimeStore.appendStreamEvent(forkTurn.id, stream)
    }
    runtimeStore.setTurnStatus(forkTurn.id, finalStatusFromEvents(turnEvents))
    return newThread
  })

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

  typedHandle("git:query", async (_event, input) => {
    const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
    if (!workspaceId) throw new Error("Git query requires a workspace")
    const thread = input?.threadId ? runtimeStore.getThread(input.threadId) : undefined
    const { thread: targetThread, turn } = runtimeStore.createTurn({
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
      runtimeStore.appendStreamEvent(turn.id, {
        turnId: turn.id,
        type: "content",
        content: result,
        agentId: "git"
      })
      runtimeStore.setTurnStatus(turn.id, "completed")
      return { threadId: targetThread.id, turnId: turn.id, result }
    } catch (e: any) {
      runtimeStore.appendStreamEvent(turn.id, {
        turnId: turn.id,
        type: "content",
        content: `Git query failed: ${e?.message || String(e)}`,
        agentId: "git"
      })
      runtimeStore.setTurnStatus(turn.id, "failed")
      return { threadId: targetThread.id, turnId: turn.id, result: null, error: e?.message || String(e) }
    }
  })
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

function finalStatusFromEvents(events: any[]): "completed" | "failed" | "cancelled" {
  const statusEvent = [...events]
    .reverse()
    .find(event => event?.kind === "turn:status" && typeof event?.payload?.status === "string")
  const status = statusEvent?.payload?.status
  return status === "failed" || status === "cancelled" ? status : "completed"
}
