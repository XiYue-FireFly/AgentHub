/**
 * Memory IPC handlers.
 *
 * Extracted from index.ts to isolate all memory-related IPC registrations.
 * Depends on a memory() accessor function injected at registration time.
 */

import { ipcMain } from 'electron'
import type { MemoryCategory, MemoryLibrary } from '../memory-library'
import { buildMemoryGraph, suggestCleanup } from '../runtime/memory-graph'

type MemoryAccessor = () => MemoryLibrary

export function registerMemoryIpc(memory: MemoryAccessor): void {
  ipcMain.handle("memory:catalog", async () => memory().getCatalog())
  ipcMain.handle("memory:getSettings", async () => memory().getSettings())
  ipcMain.handle("memory:updateSettings", async (_event, patch: any) => memory().updateSettings(patch || {}))
  ipcMain.handle("memory:list", async (_event, category?: MemoryCategory) => memory().listEntries(category))
  ipcMain.handle("memory:search", (_event, query: string, category?: MemoryCategory) => memory().searchEntries(query, category))
  ipcMain.handle("memory:addEntry", async (_event, entry) => memory().upsertEntry(entry))
  ipcMain.handle("memory:importConversation", async (_event, source: string, content: string) => {
    return memory().importConversation(source, content)
  })
  ipcMain.handle("memory:listCandidates", async () => memory().listCandidates())
  ipcMain.handle("memory:approveCandidate", async (_event, id: string) => memory().approveCandidate(id))
  ipcMain.handle("memory:updateEntry", async (_event, id: string, patch: any) => memory().updateEntry(id, patch))
  ipcMain.handle("memory:disableEntry", async (_event, id: string) => memory().disableEntry(id))
  ipcMain.handle("memory:delete", (_event, id: string) => memory().deleteEntry(id))
  ipcMain.handle("memory:restore", (_event, id: string) => memory().restoreEntry(id))
  ipcMain.handle("memory:loadState", async () => memory().loadRuntimeState())
  ipcMain.handle("memory:saveState", async (_event, state) => memory().saveRuntimeState(state))
  ipcMain.handle("memory:graph", (_e, entries: any[]) => buildMemoryGraph(entries))
  ipcMain.handle("memory:cleanupSuggestions", (_e, graph: any) => suggestCleanup(graph))
}
