import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { FileMemoryStore } from '../memory-store'

describe('FileMemoryStore', () => {
  let store: FileMemoryStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'))
    store = new FileMemoryStore(tmpDir)
    await store.init()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('init', () => {
    it('should create memory directory', async () => {
      const memoryDir = path.join(tmpDir, 'memory')
      const entriesDir = path.join(memoryDir, 'entries')
      const stat = await fs.stat(entriesDir)
      expect(stat.isDirectory()).toBe(true)
    })

    it('should migrate from legacy index.json', async () => {
      // Create legacy format
      const memoryDir = path.join(tmpDir, 'memory')
      await fs.mkdir(memoryDir, { recursive: true })
      const legacyIndex = {
        version: 2,
        entries: [
          { id: 'mem_1', title: 'Test 1', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 'mem_2', title: 'Test 2', category: 'project', tags: [], pinned: false, confidence: 1, status: 'approved', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        ],
        settings: { enabled: true }
      }
      await fs.writeFile(path.join(memoryDir, 'index.json'), JSON.stringify(legacyIndex))

      // Create new store instance to trigger migration
      const newStore = new FileMemoryStore(tmpDir)
      await newStore.init()

      // Verify migration
      const entries = await newStore.list({ includeDeleted: true })
      expect(entries.length).toBe(2)

      // Verify backup exists
      const backupExists = await fs.stat(path.join(memoryDir, 'index.json.bak')).then(() => true).catch(() => false)
      expect(backupExists).toBe(true)
    })
  })

  describe('create', () => {
    it('should create a new entry', async () => {
      const entry = await store.create({
        title: 'Test Entry',
        category: 'preference',
        tags: ['test'],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      expect(entry.id).toBeDefined()
      expect(entry.title).toBe('Test Entry')
      expect(entry.createdAt).toBeDefined()
      expect(entry.updatedAt).toBeDefined()
    })

    it('should persist entry to disk', async () => {
      const entry = await store.create({
        title: 'Persisted Entry',
        category: 'preference',
        tags: [],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      const retrieved = await store.get(entry.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.title).toBe('Persisted Entry')
    })
  })

  describe('update', () => {
    it('should update an existing entry', async () => {
      const entry = await store.create({
        title: 'Original Title',
        category: 'preference',
        tags: [],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      const updated = await store.update(entry.id, { title: 'Updated Title' })
      expect(updated.title).toBe('Updated Title')
      expect(updated.id).toBe(entry.id)
    })

    it('should throw for non-existent entry', async () => {
      await expect(store.update('non-existent', { title: 'Test' }))
        .rejects.toThrow('Memory not found')
    })
  })

  describe('soft delete and restore', () => {
    it('should soft delete an entry', async () => {
      const entry = await store.create({
        title: 'To Delete',
        category: 'preference',
        tags: [],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      await store.delete(entry.id)

      // Should not be visible in normal list
      const list = await store.list()
      expect(list.find(e => e.id === entry.id)).toBeUndefined()

      // Should be visible with includeDeleted
      const listWithDeleted = await store.list({ includeDeleted: true })
      expect(listWithDeleted.find(e => e.id === entry.id)).toBeDefined()
    })

    it('should restore a deleted entry', async () => {
      const entry = await store.create({
        title: 'To Restore',
        category: 'preference',
        tags: [],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      await store.delete(entry.id)
      const restored = await store.restore(entry.id)

      expect(restored.deletedAt).toBeUndefined()

      // Should be visible in normal list again
      const list = await store.list()
      expect(list.find(e => e.id === entry.id)).toBeDefined()
    })

    it('should throw when restoring non-deleted entry', async () => {
      const entry = await store.create({
        title: 'Not Deleted',
        category: 'preference',
        tags: [],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      await expect(store.restore(entry.id))
        .rejects.toThrow('Memory is not deleted')
    })
  })

  describe('list', () => {
    it('should list all entries', async () => {
      await store.create({ title: 'Entry 1', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })
      await store.create({ title: 'Entry 2', category: 'project', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })

      const entries = await store.list()
      expect(entries.length).toBe(2)
    })

    it('should filter by category', async () => {
      await store.create({ title: 'Pref', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })
      await store.create({ title: 'Proj', category: 'project', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })

      const prefs = await store.list({ category: 'preference' })
      expect(prefs.length).toBe(1)
      expect(prefs[0].category).toBe('preference')
    })

    it('should filter by scope', async () => {
      await store.create({ title: 'User', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'user' })
      await store.create({ title: 'Workspace', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })

      const userEntries = await store.list({ scope: 'user' })
      expect(userEntries.length).toBe(1)
      expect(userEntries[0].scope).toBe('user')
    })

    it('should sort by updatedAt descending', async () => {
      const entry1 = await store.create({ title: 'First', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })
      await new Promise(r => setTimeout(r, 10)) // Small delay
      const entry2 = await store.create({ title: 'Second', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })

      const entries = await store.list()
      expect(entries[0].id).toBe(entry2.id)
      expect(entries[1].id).toBe(entry1.id)
    })
  })

  describe('garbageCollect', () => {
    it('should collect old deleted entries', async () => {
      const entry = await store.create({
        title: 'Old Deleted',
        category: 'preference',
        tags: [],
        pinned: false,
        confidence: 1,
        status: 'approved',
        scope: 'workspace'
      })

      await store.delete(entry.id)

      // Manually set deletedAt to 31 days ago
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 31)
      await store.update(entry.id, { deletedAt: oldDate.toISOString() })

      const collected = await store.garbageCollect()
      expect(collected).toBe(1)

      // Entry should be completely gone
      const retrieved = await store.get(entry.id, { includeDeleted: true })
      expect(retrieved).toBeNull()
    })
  })

  describe('getDiagnostics', () => {
    it('should return correct diagnostics', async () => {
      await store.create({ title: 'Active', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })
      const deleted = await store.create({ title: 'Deleted', category: 'preference', tags: [], pinned: false, confidence: 1, status: 'approved', scope: 'workspace' })
      await store.delete(deleted.id)

      const diag = await store.getDiagnostics()
      expect(diag.enabled).toBe(true)
      expect(diag.activeCount).toBe(1)
      expect(diag.deletedCount).toBe(1)
    })
  })

  describe('settings', () => {
    it('should save and load settings', async () => {
      await store.saveSettings({ enabled: false })
      const settings = store.getSettings()
      expect(settings.enabled).toBe(false)
    })

    it('should persist settings to disk', async () => {
      await store.saveSettings({ enabled: true })

      // Create new store instance
      const newStore = new FileMemoryStore(tmpDir)
      await newStore.init()

      const settings = newStore.getSettings()
      expect(settings.enabled).toBe(true)
    })
  })
})
