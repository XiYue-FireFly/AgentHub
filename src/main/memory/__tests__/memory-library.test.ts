import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { MemoryLibrary } from '../memory-library'

describe('MemoryLibrary', () => {
  let library: MemoryLibrary
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-lib-test-'))
    library = new MemoryLibrary(tmpDir)
    await library.init()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('addEntry', () => {
    it('should add a new entry', async () => {
      const entry = await library.addEntry({
        title: 'Test Preference',
        category: 'preference',
        summary: 'User prefers pnpm',
        tags: ['package-manager']
      })

      expect(entry.id).toBeDefined()
      expect(entry.status).toBe('approved')
      expect(entry.scope).toBe('user') // preference -> user scope
    })

    it('should infer scope correctly', async () => {
      const pref = await library.addEntry({ title: 'Pref', category: 'preference', tags: [] })
      expect(pref.scope).toBe('user')

      const proj = await library.addEntry({ title: 'Proj', category: 'project', tags: [] })
      expect(proj.scope).toBe('project')

      const task = await library.addEntry({ title: 'Task', category: 'task', tags: [] })
      expect(task.scope).toBe('workspace')
    })
  })

  describe('search', () => {
    it('should search by query', async () => {
      await library.addEntry({ title: 'TypeScript Config', category: 'preference', tags: ['typescript'], summary: 'Use strict mode' })
      await library.addEntry({ title: 'Package Manager', category: 'preference', tags: ['pnpm'], summary: 'Prefer pnpm over npm' })

      const results = await library.search('typescript strict')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].title).toBe('TypeScript Config')
    })

    it('should handle CJK queries', async () => {
      await library.addEntry({ title: '偏好设置', category: 'preference', tags: [], summary: '用户偏好使用 pnpm' })

      const results = await library.search('偏好')
      expect(results.length).toBe(1)
    })

    it('should sort by relevance', async () => {
      await library.addEntry({ title: 'Primary Match', category: 'preference', tags: [], summary: 'test' })
      await library.addEntry({ title: 'Secondary', category: 'preference', tags: ['test'], summary: 'other' })

      const results = await library.search('test')
      expect(results[0].title).toBe('Secondary') // tag match has higher weight
    })
  })

  describe('selectContextEntries', () => {
    it('should inject user scope entries unconditionally', async () => {
      await library.addEntry({ title: 'User Pref', category: 'preference', tags: [], scope: 'user' })
      await library.addEntry({ title: 'Workspace Entry', category: 'task', tags: [], scope: 'workspace' })

      const context = await library.selectContextEntries('unrelated query', { limit: 10 })
      expect(context.some(e => e.title === 'User Pref')).toBe(true)
    })

    it('should respect token budget', async () => {
      // Add many entries
      for (let i = 0; i < 20; i++) {
        await library.addEntry({
          title: `Entry ${i}`,
          category: 'task',
          summary: 'A'.repeat(200), // ~50 tokens each
          tags: []
        })
      }

      const context = await library.selectContextEntries('', { tokenBudget: 200 })
      expect(context.length).toBeLessThan(20)
    })

    it('should prioritize pinned entries', async () => {
      await library.addEntry({ title: 'Pinned', category: 'task', tags: [], pinned: true })
      await library.addEntry({ title: 'Normal', category: 'task', tags: [] })

      const context = await library.selectContextEntries('', { limit: 1 })
      expect(context[0].title).toBe('Pinned')
    })
  })

  describe('soft delete and restore', () => {
    it('should soft delete and restore', async () => {
      const entry = await library.addEntry({ title: 'To Delete', category: 'task', tags: [] })

      await library.deleteEntry(entry.id)

      const list = await library.list()
      expect(list.find(e => e.id === entry.id)).toBeUndefined()

      await library.restoreEntry(entry.id)

      const listAfter = await library.list()
      expect(listAfter.find(e => e.id === entry.id)).toBeDefined()
    })
  })

  describe('approveCandidate', () => {
    it('should approve a candidate', async () => {
      const entry = await library.addEntry({
        title: 'Candidate',
        category: 'task',
        tags: [],
        scope: 'workspace'
      })

      // Manually set to candidate status
      await library.updateEntry(entry.id, { status: 'candidate' })

      const approved = await library.approveCandidate(entry.id)
      expect(approved.status).toBe('approved')
    })
  })

  describe('importConversation', () => {
    it('should extract preference candidates', async () => {
      const text = `
        我偏好使用 pnpm 作为包管理器
        Always use TypeScript strict mode
        这是一个测试
      `

      const candidates = await library.importConversation(text)
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.some(c => c.category === 'preference')).toBe(true)
    })

    it('should not extract noise text', async () => {
      const text = `
        好的
        明白
        test
      `

      const candidates = await library.importConversation(text)
      expect(candidates.length).toBe(0)
    })
  })

  describe('garbageCollect', () => {
    it('should collect old deleted entries', async () => {
      const entry = await library.addEntry({ title: 'Old', category: 'task', tags: [] })
      await library.deleteEntry(entry.id)

      // Manually set deletedAt to old date
      await library.updateEntry(entry.id, {
        deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
      })

      const collected = await library.garbageCollect()
      expect(collected).toBe(1)
    })
  })

  describe('diagnostics', () => {
    it('should return correct diagnostics', async () => {
      await library.addEntry({ title: 'Active', category: 'task', tags: [] })
      await library.addEntry({ title: 'Deleted', category: 'task', tags: [] })
      await library.deleteEntry((await library.list({ includeDeleted: true })).find(e => e.title === 'Deleted')!.id)

      const diag = await library.getDiagnostics()
      expect(diag.activeCount).toBe(1)
      expect(diag.deletedCount).toBe(1)
    })
  })
})
