/**
 * Memory Library - Business Logic Layer
 *
 * Combines FileMemoryStore and memory-scoring to provide the complete
 * memory API for the application.
 */

import { FileMemoryStore, createMemoryStore } from './memory-store'
import {
  tokenizeMemoryQuery,
  scoreMemoryEntry,
  estimateMemoryTokens,
  hasValueSignal,
  searchableText
} from './memory-scoring'
import {
  MemoryEntry,
  MemoryEntryInput,
  MemoryCategory,
  MemoryScope,
  MemoryFilter,
  MemoryContextOptions,
  MemoryCatalog,
  MemoryDiagnostics
} from './memory-types'

export class MemoryLibrary {
  private readonly store: FileMemoryStore
  private lastInjectedIds: string[] = []

  constructor(rootDir: string) {
    this.store = createMemoryStore(rootDir)
  }

  /**
   * Initialize the memory library.
   */
  async init(): Promise<void> {
    await this.store.init()
  }

  /**
   * Get the full catalog of memories.
   */
  async getCatalog(): Promise<MemoryCatalog> {
    const entries = await this.store.list({ includeDisabled: true })
    const counts = this.computeCounts(entries)
    const settings = this.store.getSettings()

    return {
      entries,
      counts,
      settings,
      runtimeUpdatedAt: undefined
    }
  }

  /**
   * Compute category counts.
   */
  private computeCounts(entries: MemoryEntry[]): Record<MemoryCategory, number> {
    const counts: Record<string, number> = {}
    for (const entry of entries) {
      if (!entry.deletedAt) {
        counts[entry.category] = (counts[entry.category] || 0) + 1
      }
    }
    return counts as Record<MemoryCategory, number>
  }

  /**
   * List memories with optional filtering.
   */
  async list(filter?: MemoryFilter): Promise<MemoryEntry[]> {
    return this.store.list(filter)
  }

  /**
   * Search memories by query.
   */
  async search(query: string, filter?: MemoryFilter): Promise<MemoryEntry[]> {
    const entries = await this.store.list(filter)
    const terms = tokenizeMemoryQuery(query)

    if (!terms.length) {
      return entries.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
    }

    return entries
      .map(entry => ({ entry, score: scoreMemoryEntry(entry, terms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => entry)
  }

  /**
   * Select context entries for injection into agent prompt.
   *
   * Implements User scope unconditional injection:
   * - User-scoped memories are always injected (identity facts)
   * - Workspace/Project memories are scored and selected
   */
  async selectContextEntries(
    query: string,
    options: MemoryContextOptions = {}
  ): Promise<MemoryEntry[]> {
    const { limit = 8, tokenBudget = 4000, scope, workspacePath } = options
    const terms = tokenizeMemoryQuery(query)

    // Get all active entries
    const allEntries = await this.store.list({
      scope: scope || 'all',
      includeDeleted: false,
      includeDisabled: false
    })

    // Score all entries globally
    const scoredEntries = allEntries
      .map(entry => ({ entry, score: scoreMemoryEntry(entry, terms) }))
      .filter(({ entry, score }) => score > 0 || entry.pinned || entry.scope === 'user')
      .sort((a, b) => {
        // Pinned first, then by score
        if (a.entry.pinned !== b.entry.pinned) return a.entry.pinned ? -1 : 1
        return b.score - a.score
      })
      .map(({ entry }) => entry)

    // Merge: all entries sorted by relevance
    const merged = scoredEntries

    // Apply token budget
    const result: MemoryEntry[] = []
    let totalTokens = 0

    for (const entry of merged) {
      const tokens = estimateMemoryTokens(entry)

      // Pinned entries bypass token budget
      if (entry.pinned || totalTokens + tokens <= tokenBudget) {
        result.push(entry)
        totalTokens += tokens
      }

      if (result.length >= limit) break
    }

    // Record injected IDs
    this.lastInjectedIds = result.map(e => e.id)

    return result
  }

  /**
   * Add a new memory entry.
   */
  async addEntry(input: MemoryEntryInput): Promise<MemoryEntry> {
    // Determine scope
    const scope = input.scope || this.inferScope(input)

    return this.store.create({
      ...input,
      scope,
      tags: input.tags || [],
      pinned: input.pinned || false,
      confidence: input.confidence || 1,
      status: 'approved'
    })
  }

  /**
   * Infer scope from entry content.
   */
  private inferScope(input: MemoryEntryInput): MemoryScope {
    // Global preferences -> user scope
    if (input.category === 'preference' || input.category === 'style') {
      return 'user'
    }
    // Project-specific -> project scope
    if (input.category === 'project' || input.category === 'decision') {
      return 'project'
    }
    // Default to workspace
    return 'workspace'
  }

  /**
   * Update an existing memory entry.
   */
  async updateEntry(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
    return this.store.update(id, patch)
  }

  /**
   * Delete a memory entry (soft delete).
   */
  async deleteEntry(id: string): Promise<void> {
    await this.store.delete(id)
  }

  /**
   * Restore a soft-deleted memory entry.
   */
  async restoreEntry(id: string): Promise<MemoryEntry> {
    return this.store.restore(id)
  }

  /**
   * Approve a candidate memory entry.
   */
  async approveCandidate(id: string): Promise<MemoryEntry> {
    return this.store.update(id, { status: 'approved' })
  }

  /**
   * Disable a memory entry.
   */
  async disableEntry(id: string): Promise<MemoryEntry> {
    return this.store.update(id, {
      status: 'disabled',
      disabledAt: new Date().toISOString()
    })
  }

  /**
   * Enable a disabled memory entry.
   */
  async enableEntry(id: string): Promise<MemoryEntry> {
    return this.store.update(id, {
      status: 'approved',
      disabledAt: undefined
    })
  }

  /**
   * Toggle pinned status.
   */
  async togglePinned(id: string): Promise<MemoryEntry> {
    const entry = await this.store.get(id)
    if (!entry) throw new Error(`Memory not found: ${id}`)
    return this.store.update(id, { pinned: !entry.pinned })
  }

  /**
   * Import conversation text and extract candidate memories.
   */
  async importConversation(text: string): Promise<MemoryEntry[]> {
    const candidates = this.extractCandidates(text)
    const results: MemoryEntry[] = []

    for (const candidate of candidates) {
      const entry = await this.store.create({
        ...candidate,
        tags: candidate.tags || [],
        pinned: candidate.pinned || false,
        confidence: candidate.confidence || 1,
        status: 'candidate',
        scope: this.inferScope(candidate)
      })
      results.push(entry)
    }

    return results
  }

  /**
   * Extract candidate memories from conversation text.
   */
  private extractCandidates(text: string): MemoryEntryInput[] {
    const lines = text.split('\n').filter(line => line.trim().length > 0)
    const candidates: MemoryEntryInput[] = []

    // Rules for extraction
    const rules = [
      { pattern: /偏好|prefer/i, category: 'preference' as MemoryCategory, confidence: 0.7 },
      { pattern: /风格|style/i, category: 'style' as MemoryCategory, confidence: 0.66 },
      { pattern: /项目|project/i, category: 'project' as MemoryCategory, confidence: 0.7 },
      { pattern: /决定|decision/i, category: 'decision' as MemoryCategory, confidence: 0.78 },
      { pattern: /纠正|correction/i, category: 'correction' as MemoryCategory, confidence: 0.78 }
    ]

    for (const line of lines) {
      if (line.length < 12) continue
      if (this.isNoiseText(line)) continue

      for (const rule of rules) {
        if (rule.pattern.test(line)) {
          candidates.push({
            title: line.slice(0, 80),
            category: rule.category,
            summary: line,
            confidence: rule.confidence,
            tags: []
          })
          break
        }
      }
    }

    return candidates.slice(0, 8)
  }

  /**
   * Check if text is noise.
   */
  private isNoiseText(text: string): boolean {
    const noisePatterns = [
      /^好的|^是的|^明白|^收到|^继续|^test|^测试/i,
      /^\s*$/,
      /^[\s\S]{0,11}$/
    ]
    return noisePatterns.some(p => p.test(text))
  }

  /**
   * Get diagnostics.
   */
  async getDiagnostics(): Promise<MemoryDiagnostics> {
    const diag = await this.store.getDiagnostics()
    return {
      ...diag,
      lastInjectedIds: this.lastInjectedIds
    }
  }

  /**
   * Garbage collect old deleted entries.
   */
  async garbageCollect(): Promise<number> {
    return this.store.garbageCollect()
  }

  /**
   * Save settings.
   */
  async saveSettings(settings: { enabled: boolean }): Promise<void> {
    await this.store.saveSettings(settings)
  }

  /**
   * Get settings.
   */
  getSettings() {
    return this.store.getSettings()
  }
}

/**
 * Create a MemoryLibrary instance.
 */
export function createMemoryLibrary(rootDir: string): MemoryLibrary {
  return new MemoryLibrary(rootDir)
}
