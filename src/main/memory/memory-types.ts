/**
 * Memory System Type Definitions
 *
 * Centralized type definitions for the memory system.
 */

export type MemoryScope = 'user' | 'workspace' | 'project'

export type MemoryCategory =
  | 'conversation'
  | 'task'
  | 'skill'
  | 'file'
  | 'system'
  | 'preference'
  | 'project'
  | 'style'
  | 'decision'
  | 'correction'
  | 'imported_conversation'

export type MemoryEntryStatus = 'candidate' | 'approved' | 'disabled'

export interface MemoryEntry {
  id: string
  title: string
  category: MemoryCategory
  summary?: string
  content?: string
  tags: string[]
  pinned: boolean
  confidence: number
  status: MemoryEntryStatus
  scope: MemoryScope
  workspacePath?: string
  sourceThreadId?: string
  sourceTurnId?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt?: string
  disabledAt?: string
}

export interface MemoryEntryInput {
  title: string
  category: MemoryCategory
  summary?: string
  content?: string
  tags?: string[]
  pinned?: boolean
  confidence?: number
  scope?: MemoryScope
  workspacePath?: string
  sourceThreadId?: string
  sourceTurnId?: string
  metadata?: Record<string, unknown>
}

export interface MemorySettings {
  enabled: boolean
}

export interface MemoryCatalog {
  entries: MemoryEntry[]
  counts: Record<MemoryCategory, number>
  settings: MemorySettings
  runtimeUpdatedAt?: string
}

export interface MemoryIndex {
  version: number
  entries: MemoryEntry[]
  settings: MemorySettings
}

export interface MemoryFilter {
  category?: MemoryCategory | 'all'
  scope?: MemoryScope | 'all'
  status?: MemoryEntryStatus | 'all'
  includeDeleted?: boolean
  includeDisabled?: boolean
}

export interface MemoryContextOptions {
  limit?: number
  tokenBudget?: number
  scope?: MemoryScope
  workspacePath?: string
}

export interface MemoryDiagnostics {
  enabled: boolean
  rootDir: string
  activeCount: number
  deletedCount: number
  lastInjectedIds: string[]
}
