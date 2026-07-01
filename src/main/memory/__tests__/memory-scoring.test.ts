import { describe, it, expect } from 'vitest'
import {
  tokenizeMemoryQuery,
  searchableText,
  scoreMemoryEntry,
  estimateMemoryTokens,
  hasValueSignal
} from '../memory-scoring'

describe('memory-scoring', () => {
  describe('tokenizeMemoryQuery', () => {
    it('should tokenize ASCII words', () => {
      const tokens = tokenizeMemoryQuery('hello world test')
      expect(tokens).toContain('hello')
      expect(tokens).toContain('world')
      expect(tokens).toContain('test')
    })

    it('should extract ASCII trigrams', () => {
      const tokens = tokenizeMemoryQuery('testing')
      expect(tokens).toContain('testing')
    })

    it('should handle CJK bigrams', () => {
      const tokens = tokenizeMemoryQuery('你好世界')
      expect(tokens).toContain('你好')
      expect(tokens).toContain('好世')
      expect(tokens).toContain('世界')
    })

    it('should handle mixed ASCII and CJK', () => {
      const tokens = tokenizeMemoryQuery('hello你好world')
      expect(tokens).toContain('hello')
      expect(tokens).toContain('你好')
      expect(tokens).toContain('world')
    })

    it('should handle empty input', () => {
      expect(tokenizeMemoryQuery('')).toEqual([])
      expect(tokenizeMemoryQuery(null as any)).toEqual([])
    })

    it('should deduplicate tokens', () => {
      const tokens = tokenizeMemoryQuery('hello hello')
      const helloCount = tokens.filter(t => t === 'hello').length
      expect(helloCount).toBe(1)
    })

    it('should handle Japanese characters', () => {
      const tokens = tokenizeMemoryQuery('こんにちは')
      expect(tokens.length).toBeGreaterThan(0)
    })

    it('should handle Korean characters', () => {
      const tokens = tokenizeMemoryQuery('안녕하세요')
      expect(tokens.length).toBeGreaterThan(0)
    })
  })

  describe('searchableText', () => {
    it('should lowercase text', () => {
      expect(searchableText('Hello World')).toBe('hello world')
    })

    it('should normalize whitespace', () => {
      expect(searchableText('  hello   world  ')).toBe('hello world')
    })

    it('should handle undefined', () => {
      expect(searchableText(undefined)).toBe('')
    })

    it('should handle empty string', () => {
      expect(searchableText('')).toBe('')
    })
  })

  describe('scoreMemoryEntry', () => {
    const baseEntry = {
      title: 'Test Entry',
      category: 'preference',
      tags: ['test'],
      updatedAt: new Date().toISOString()
    }

    it('should score title matches highly', () => {
      const terms = ['test']
      const score = scoreMemoryEntry(baseEntry, terms)
      expect(score).toBeGreaterThan(0)
    })

    it('should give pinned entries a bonus', () => {
      const terms = ['test']
      const pinnedEntry = { ...baseEntry, pinned: true }
      const unpinnedScore = scoreMemoryEntry(baseEntry, terms)
      const pinnedScore = scoreMemoryEntry(pinnedEntry, terms)
      expect(pinnedScore).toBeGreaterThan(unpinnedScore)
    })

    it('should give preference/correction category a bonus', () => {
      const terms = ['test']
      const prefEntry = { ...baseEntry, category: 'preference' as const }
      const taskEntry = { ...baseEntry, category: 'task' as const }
      const prefScore = scoreMemoryEntry(prefEntry, terms)
      const taskScore = scoreMemoryEntry(taskEntry, terms)
      expect(prefScore).toBeGreaterThan(taskScore)
    })

    it('should give value signal bonus', () => {
      const terms = ['pnpm']
      const signalEntry = { ...baseEntry, title: 'I prefer pnpm over npm' }
      const noSignalEntry = { ...baseEntry, title: 'Just a random entry' }
      const signalScore = scoreMemoryEntry(signalEntry, terms)
      const noSignalScore = scoreMemoryEntry(noSignalEntry, terms)
      expect(signalScore).toBeGreaterThan(noSignalScore)
    })

    it('should handle empty terms', () => {
      const score = scoreMemoryEntry(baseEntry, [])
      expect(score).toBeGreaterThanOrEqual(0)
    })

    it('should weight title higher than content', () => {
      const titleMatch = { ...baseEntry, title: 'test', content: '' }
      const contentMatch = { ...baseEntry, title: '', content: 'test' }
      const terms = ['test']
      const titleScore = scoreMemoryEntry(titleMatch, terms)
      const contentScore = scoreMemoryEntry(contentMatch, terms)
      expect(titleScore).toBeGreaterThan(contentScore)
    })
  })

  describe('estimateMemoryTokens', () => {
    it('should estimate tokens based on content length', () => {
      const entry = {
        title: 'Hello World',
        category: 'preference'
      }
      const tokens = estimateMemoryTokens(entry)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should include tags in estimate', () => {
      const entry = {
        title: 'Test',
        category: 'preference',
        tags: ['tag1', 'tag2']
      }
      const withTags = estimateMemoryTokens(entry)
      const withoutTags = estimateMemoryTokens({ ...entry, tags: [] })
      expect(withTags).toBeGreaterThan(withoutTags)
    })

    it('should return at least 1 token', () => {
      const entry = { title: '', category: 'preference' }
      expect(estimateMemoryTokens(entry)).toBeGreaterThanOrEqual(1)
    })
  })

  describe('hasValueSignal', () => {
    it('should detect English value signals', () => {
      expect(hasValueSignal('I prefer pnpm')).toBe(true)
      expect(hasValueSignal('Always use TypeScript')).toBe(true)
      expect(hasValueSignal('Default to dark mode')).toBe(true)
    })

    it('should detect Chinese value signals', () => {
      expect(hasValueSignal('我偏好使用 pnpm')).toBe(true)
      expect(hasValueSignal('以后默认使用暗色模式')).toBe(true)
    })

    it('should return false for neutral text', () => {
      expect(hasValueSignal('Hello world')).toBe(false)
      expect(hasValueSignal('这是一个测试')).toBe(false)
    })
  })
})
