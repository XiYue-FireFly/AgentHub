import { ipcMain } from 'electron'
import { routePreview } from '../hub/route-preview'
import { buildContextProjection } from '../runtime/context-ledger'
import { runGitQuery } from '../runtime/git'
import { optionalWorkbenchWorkspace } from '../runtime/workspace-helpers'
import { isProviderDirectSelection } from '../../shared/utils'

interface HubThreadsDeps {
  hub: any
  dispatcher: any
  registry: any
  router: any
  runtimeStore: any
  memory: () => any
  proxy: any
  getWorkspaceManager: () => any
}

export function registerHubThreadsIpc(deps: HubThreadsDeps): void {
  const { hub, dispatcher, registry, router, runtimeStore, memory, proxy } = deps

  ipcMain.handle("hub:status", () => ({
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

  ipcMain.handle("hub:dispatch", async (_event, payload: any) => {
    if (!dispatcher) return null
    const directTarget = payload.targetAgent?.trim()
    const providerDirect = !directTarget && isProviderDirectSelection(payload.modelSelection)
    if (providerDirect) {
      return dispatcher.dispatchProviderDirect(payload.text, payload.modelSelection, {
        thinking: payload.thinking,
        workspaceId: payload.workspaceId ?? null
      })
    }
    return dispatcher.dispatch(payload.text, directTarget ? "auto" : payload.mode || "auto", directTarget, { thinking: payload.thinking, modelSelection: directTarget ? undefined : payload.modelSelection, workspaceId: payload.workspaceId ?? null })
  })

  ipcMain.handle("hub:routePreview", async (_event, text: string) => routePreview(text, registry, router))

  ipcMain.handle("threads:list", (_event, workspaceId?: string | null) => runtimeStore.listThreads(workspaceId))
  ipcMain.handle("threads:create", (_event, input: { workspaceId?: string | null; title?: string }) => {
    const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
    return runtimeStore.createThread({ ...input, workspaceId })
  })
  ipcMain.handle("threads:rename", (_event, threadId: string, title: string) => runtimeStore.renameThread(threadId, title))
  ipcMain.handle("threads:delete", (_event, threadId: string) => runtimeStore.deleteThread(threadId))
  ipcMain.handle("threads:select", (_event, threadId: string | null) => runtimeStore.selectThread(threadId))
  ipcMain.handle("threads:fork", (_event, input: { sourceThreadId: string; sourceTurnId: string; message: string }) => {
    if (!input || typeof input.message !== 'string' || !input.message.trim()) {
      throw new Error('Invalid fork input: message is required')
    }
    const newThread = runtimeStore.createThread({ title: `Fork: ${input.message.slice(0, 50)}` })
    const sourceEvents = runtimeStore.eventsSince(input.sourceThreadId, 0)
    const turnEvents = sourceEvents.filter((e: any) => e.turnId === input.sourceTurnId)
    for (const event of turnEvents) {
      runtimeStore.appendStreamEvent(newThread.id, { ...event, turnId: newThread.id })
    }
    return newThread
  })

  ipcMain.handle("runtime:snapshot", (_event, workspaceId?: string | null) => runtimeStore.snapshot(workspaceId))
  ipcMain.handle("runtime:eventsSince", (_event, threadId: string, seq = 0) => runtimeStore.eventsSince(threadId, seq))
  ipcMain.handle("context:projection", (_event, input: { threadId?: string | null; workspaceId?: string | null; prompt?: string; attachments?: any[]; writeDraft?: { title: string; content: string } | null; pinnedBlocks?: any[] }) => {
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

  ipcMain.handle("git:query", async (_event, input: { workspaceId?: string | null; threadId?: string | null; query?: string }) => {
    const workspaceId = optionalWorkbenchWorkspace(input?.workspaceId)
    if (!workspaceId) throw new Error("Git 需要先选择工作目录。")
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
      runtimeStore.appendStreamEvent(targetThread.id, {
        turnId: turn.id,
        type: "content",
        content: result,
        agentId: "git"
      })
      runtimeStore.setTurnStatus(turn.id, "completed")
      return { threadId: targetThread.id, turnId: turn.id, result }
    } catch (e: any) {
      runtimeStore.setTurnStatus(turn.id, "failed")
      runtimeStore.appendStreamEvent(targetThread.id, {
        turnId: turn.id,
        type: "content",
        content: `Git query failed: ${e?.message || String(e)}`,
        agentId: "git"
      })
      return { threadId: targetThread.id, turnId: turn.id, result: null, error: e?.message || String(e) }
    }
  })
}

// isProviderDirectSelection is now imported from shared/utils (LOW-08)
