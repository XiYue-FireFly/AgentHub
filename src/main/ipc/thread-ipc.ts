/**
 * Thread/Turn IPC handlers.
 *
 * Extracted from index.ts to isolate thread and turn management IPC.
 * Dependencies are injected at registration time.
 */

import { ipcMain } from 'electron'
import type { DispatchPreset, ModelSelection, SchedulePreview, WorkbenchAttachment } from '../runtime/types'

interface ThreadIpcDeps {
  runtimeStore: any
  dispatcher: any
  memory: () => any
  getWorkspaceManager: () => any
  resolveGuardApproval: (requestId: string, approved: boolean) => boolean
}

export function registerThreadIpc(deps: ThreadIpcDeps): void {
  const { runtimeStore, dispatcher, memory, getWorkspaceManager, resolveGuardApproval } = deps

  ipcMain.handle("threads:list", (_event, workspaceId?: string | null) => runtimeStore.listThreads(workspaceId))
  ipcMain.handle("threads:create", (_event, input: { workspaceId?: string | null; title?: string }) => {
    return runtimeStore.createThread({ ...input, workspaceId: input?.workspaceId ?? null })
  })
  ipcMain.handle("threads:rename", (_event, threadId: string, title: string) => runtimeStore.renameThread(threadId, title))
  ipcMain.handle("threads:delete", (_event, threadId: string) => runtimeStore.deleteThread(threadId))
  ipcMain.handle("threads:select", (_event, threadId: string | null) => runtimeStore.selectThread(threadId))
  ipcMain.handle("threads:fork", (_event, input: { sourceThreadId: string; sourceTurnId: string; message: string }) => {
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

  ipcMain.handle("turns:create", async (_event, payload: {
    threadId?: string | null
    workspaceId?: string | null
    prompt: string
    mode?: DispatchPreset
    targetAgent?: string | null
    thinking?: any
    modelSelection?: ModelSelection
    attachments?: WorkbenchAttachment[]
    customSchedule?: SchedulePreview
  }) => {
    // Delegates to the main dispatch logic in index.ts
    // This handler is registered here for IPC organization but the logic stays in index.ts
    // until the full dispatch module is extracted
    return null // placeholder — actual logic in index.ts
  })

  ipcMain.handle("turns:cancel", (_event, turnId: string) => {
    if (dispatcher) dispatcher.cancel(turnId)
    return true
  })

  ipcMain.handle("turns:cancelAgent", (_event, turnId: string, agentId: string) => {
    if (dispatcher) dispatcher.cancelAgent(turnId, agentId)
    return true
  })

  ipcMain.handle("turns:resolveGuard", (_event, requestId: string, approved: boolean) => resolveGuardApproval(requestId, approved))
}
