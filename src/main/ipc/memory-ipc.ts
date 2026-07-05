/**
 * Memory IPC handlers.
 *
 * Extracted from index.ts to isolate all memory-related IPC registrations.
 * Depends on a memory() accessor function injected at registration time.
 */

import type { MemoryLibrary } from '../memory-library'
import { buildMemoryGraph, suggestCleanup } from '../runtime/memory-graph'
import { typedHandle } from './typed-ipc'

type MemoryAccessor = () => MemoryLibrary

export function registerMemoryIpc(memory: MemoryAccessor): void {
  typedHandle("memory:catalog", async () => memory().getCatalog())
  typedHandle("memory:getSettings", async () => memory().getSettings())
  typedHandle("memory:updateSettings", async (_event, patch) => memory().updateSettings(patch || {}))
  typedHandle("memory:list", async (_event, category) => memory().listEntries(category))
  typedHandle("memory:search", (_event, query, category) => memory().searchEntries(query, category))
  typedHandle("memory:addEntry", async (_event, entry) => memory().upsertEntry(entry))
  typedHandle("memory:importConversation", async (_event, source, content) => {
    return memory().importConversation(source, content)
  })
  typedHandle("memory:listCandidates", async () => memory().listCandidates())
  typedHandle("memory:approveCandidate", async (_event, id) => memory().approveCandidate(id))
  typedHandle("memory:updateEntry", async (_event, id, patch) => memory().updateEntry(id, patch))
  typedHandle("memory:disableEntry", async (_event, id) => memory().disableEntry(id))
  typedHandle("memory:delete", (_event, id) => memory().deleteEntry(id))
  typedHandle("memory:restore", (_event, id) => memory().restoreEntry(id))
  typedHandle("memory:graph", (_e, entries) => buildMemoryGraph(entries))
  typedHandle("memory:cleanupSuggestions", (_e, graph) => suggestCleanup(graph))
}
