/**
 * Memory Store Module
 *
 * Handles file I/O, atomic writes, and data migration for the memory system.
 * Supports both legacy index.json format and new file-per-entry format.
 */

import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import {
  MemoryEntry,
  MemoryIndex,
  MemorySettings,
  MemoryFilter,
  MemoryDiagnostics
} from './memory-types'

const SETTINGS_VERSION = 3
const GC_MAX_AGE_DAYS = 30

/**
 * Normalize a scope path for cross-platform comparison.
 * - trim whitespace
 * - resolve to absolute path
 * - Windows: lowercase for case-insensitive comparison
 */
export function normalizeScopePath(pathStr: string | undefined): string | undefined {
  if (!pathStr) return undefined
  const trimmed = pathStr.trim()
  if (!trimmed) return undefined

  try {
    const resolved = path.resolve(trimmed)
    // Windows case-insensitive comparison
    if (process.platform === 'win32') {
      return resolved.toLowerCase()
    }
    return resolved
  } catch {
    return trimmed
  }
}

/**
 * Check if two scope paths are equivalent.
 */
export function pathsEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return normalizeScopePath(a) === normalizeScopePath(b)
}

export class FileMemoryStore {
  private readonly rootDir: string
  private readonly entriesDir: string
  private readonly settingsPath: string
  private readonly legacyIndexPath: string
  private settings: MemorySettings = { enabled: true }
  private initialized = false

  constructor(rootDir: string) {
    this.rootDir = rootDir.endsWith('memory') ? rootDir : path.join(rootDir, 'memory')
    this.entriesDir = path.join(this.rootDir, 'entries')
    this.settingsPath = path.join(this.rootDir, 'settings.json')
    this.legacyIndexPath = path.join(this.rootDir, 'index.json')
  }

  /**
   * Initialize the store, migrating from legacy format if needed.
   */
  async init(): Promise<void> {
    if (this.initialized) return

    await fs.mkdir(this.rootDir, { recursive: true })
    await fs.mkdir(this.entriesDir, { recursive: true })

    // Try to migrate from legacy format
    await this.migrateIfNeeded()

    // Load settings
    await this.loadSettings()

    this.initialized = true
  }

  /**
   * Check if legacy migration is needed and perform it.
   */
  private async migrateIfNeeded(): Promise<void> {
    const legacyExists = await this.fileExists(this.legacyIndexPath)
    if (!legacyExists) return

    // Check if entries directory has any files
    let hasEntries = false
    try {
      const files = await fs.readdir(this.entriesDir)
      hasEntries = files.some(f => f.endsWith('.json'))
    } catch {
      // Directory doesn't exist yet
    }

    if (hasEntries) return

    try {
      const content = await fs.readFile(this.legacyIndexPath, 'utf-8')
      const index: MemoryIndex = JSON.parse(content)

      // Write each entry to individual file
      for (const entry of index.entries) {
        const sanitizedId = this.sanitizeFilename(entry.id)
        const filePath = path.join(this.entriesDir, `${sanitizedId}.json`)
        await this.atomicWriteFile(filePath, JSON.stringify(entry, null, 2))
      }

      // Write settings
      const settings: MemorySettings = index.settings || { enabled: true }
      await this.atomicWriteFile(this.settingsPath, JSON.stringify({
        version: SETTINGS_VERSION,
        ...settings
      }))

      // Backup legacy file
      await fs.rename(this.legacyIndexPath, `${this.legacyIndexPath}.bak`)

      console.log(`Migrated ${index.entries.length} memories to file-per-entry format`)
    } catch (error) {
      console.error('Migration failed, will use legacy format:', error)
    }
  }

  /**
   * Load settings from file.
   */
  private async loadSettings(): Promise<void> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8')
      const data = JSON.parse(content)
      this.settings = { enabled: data.enabled ?? true }
    } catch {
      this.settings = { enabled: true }
    }
  }

  /**
   * Save settings to file.
   */
  async saveSettings(settings: Partial<MemorySettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings }
    await this.atomicWriteFile(
      this.settingsPath,
      JSON.stringify({ version: SETTINGS_VERSION, ...this.settings })
    )
  }

  /**
   * Get current settings.
   */
  getSettings(): MemorySettings {
    return { ...this.settings }
  }

  /**
   * Create a new memory entry.
   */
  async create(input: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const now = new Date().toISOString()
    const id = `mem_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`

    const entry: MemoryEntry = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now
    }

    await this.write(entry)
    return entry
  }

  /**
   * Update an existing memory entry.
   */
  async update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry> {
    const entry = await this.get(id, { includeDeleted: true })
    if (!entry) throw new Error(`Memory not found: ${id}`)

    // Filter out undefined values to prevent overwriting existing values
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    )

    const updated: MemoryEntry = {
      ...entry,
      ...cleanPatch,
      id: entry.id, // Prevent ID change
      updatedAt: new Date().toISOString()
    }

    await this.write(updated)
    return updated
  }

  /**
   * Soft delete a memory entry.
   */
  async delete(id: string): Promise<void> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`Memory not found: ${id}`)

    entry.deletedAt = new Date().toISOString()
    entry.updatedAt = entry.deletedAt
    await this.write(entry)
  }

  /**
   * Restore a soft-deleted memory entry.
   */
  async restore(id: string): Promise<MemoryEntry> {
    const entry = await this.get(id, { includeDeleted: true })
    if (!entry) throw new Error(`Memory not found: ${id}`)
    if (!entry.deletedAt) throw new Error(`Memory is not deleted: ${id}`)

    entry.deletedAt = undefined
    entry.updatedAt = new Date().toISOString()
    await this.write(entry)
    return entry
  }

  /**
   * Get a single memory entry by ID.
   */
  async get(id: string, options?: { includeDeleted?: boolean }): Promise<MemoryEntry | null> {
    const sanitizedId = this.sanitizeFilename(id)
    const filePath = path.join(this.entriesDir, `${sanitizedId}.json`)

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const entry: MemoryEntry = JSON.parse(content)

      if (!options?.includeDeleted && entry.deletedAt) return null
      return entry
    } catch {
      return null
    }
  }

  /**
   * List memory entries with optional filtering.
   */
  async list(filter?: MemoryFilter): Promise<MemoryEntry[]> {
    const entries = await this.readAll()

    return entries.filter(entry => {
      // Filter deleted
      if (!filter?.includeDeleted && entry.deletedAt) return false

      // Filter disabled
      if (!filter?.includeDisabled && entry.disabledAt) return false

      // Filter by category
      if (filter?.category && filter.category !== 'all' && entry.category !== filter.category) {
        return false
      }

      // Filter by scope
      if (filter?.scope && filter.scope !== 'all' && entry.scope !== filter.scope) {
        return false
      }

      // Filter by status
      if (filter?.status && filter.status !== 'all' && entry.status !== filter.status) {
        return false
      }

      return true
    }).sort((a, b) => {
      // Sort by updatedAt descending
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }

  /**
   * Read all entries from the store.
   */
  private async readAll(): Promise<MemoryEntry[]> {
    try {
      const files = await fs.readdir(this.entriesDir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))

      const entries: MemoryEntry[] = []
      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(this.entriesDir, file), 'utf-8')
          entries.push(JSON.parse(content))
        } catch {
          // Skip corrupted files
        }
      }

      return entries
    } catch {
      return []
    }
  }

  /**
   * Write a single entry to disk.
   */
  private async write(entry: MemoryEntry): Promise<void> {
    const sanitizedId = this.sanitizeFilename(entry.id)
    const filePath = path.join(this.entriesDir, `${sanitizedId}.json`)
    await this.atomicWriteFile(filePath, JSON.stringify(entry, null, 2))
  }

  /**
   * Get diagnostics information.
   */
  async getDiagnostics(): Promise<MemoryDiagnostics> {
    const entries = await this.readAll()
    const active = entries.filter(e => !e.deletedAt && !e.disabledAt)
    const deleted = entries.filter(e => e.deletedAt)

    return {
      enabled: this.settings.enabled,
      rootDir: this.rootDir,
      activeCount: active.length,
      deletedCount: deleted.length,
      lastInjectedIds: []
    }
  }

  /**
   * Garbage collect old deleted entries.
   */
  async garbageCollect(): Promise<number> {
    const entries = await this.readAll()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - GC_MAX_AGE_DAYS)

    let collected = 0
    for (const entry of entries) {
      if (entry.deletedAt && new Date(entry.deletedAt) < cutoff) {
        const sanitizedId = this.sanitizeFilename(entry.id)
        const filePath = path.join(this.entriesDir, `${sanitizedId}.json`)
        try {
          await fs.unlink(filePath)
          collected++
        } catch {
          // Ignore errors
        }
      }
    }

    return collected
  }

  /**
   * Atomic write with Windows fallback.
   */
  private async atomicWriteFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`

    try {
      await fs.writeFile(tmpPath, content, 'utf-8')

      try {
        await this.renameWithRetry(tmpPath, filePath)
      } catch {
        // Windows fallback: direct write
        await fs.writeFile(filePath, content, 'utf-8')
        await fs.unlink(tmpPath).catch(() => {})
      }
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => {})
      throw error
    }
  }

  /**
   * Rename with retry for Windows compatibility.
   */
  private async renameWithRetry(from: string, to: string, maxRetries = 6): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.rename(from, to)
        return
      } catch (error: any) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 25 * attempt))
          continue
        }
        throw error
      }
    }
  }

  /**
   * Sanitize filename for safe file system usage.
   */
  private sanitizeFilename(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  }

  /**
   * Check if a directory exists.
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Check if a file exists.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath)
      return stat.isFile()
    } catch {
      return false
    }
  }
}

/**
 * Create a FileMemoryStore instance.
 */
export function createMemoryStore(rootDir: string): FileMemoryStore {
  return new FileMemoryStore(rootDir)
}
