import { describe, it, expect, beforeEach } from 'vitest'
import { ContextCompactor, createContextCompactor } from '../context-compactor'

describe('ContextCompactor', () => {
  let compactor: ContextCompactor

  beforeEach(() => {
    compactor = createContextCompactor({
      softThreshold: 1000,
      hardThreshold: 2000
    })
  })

  describe('estimateTokens', () => {
    it('should estimate tokens for a simple message', () => {
      const message = {
        id: '1',
        role: 'user' as const,
        content: 'Hello world',
        timestamp: Date.now()
      }
      const tokens = compactor.estimateTokens(message)
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(10)
    })

    it('should include tool call tokens', () => {
      const message = {
        id: '1',
        role: 'assistant' as const,
        content: 'Let me check that',
        timestamp: Date.now(),
        toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }]
      }
      const tokens = compactor.estimateTokens(message)
      expect(tokens).toBeGreaterThan(50)
    })
  })

  describe('estimateTotalTokens', () => {
    it('should sum tokens across messages', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
        { id: '2', role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() }
      ]
      const total = compactor.estimateTotalTokens(messages)
      expect(total).toBeGreaterThan(0)
    })
  })

  describe('shouldCompact', () => {
    it('should return false for short conversations', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }
      ]
      expect(compactor.shouldCompact(messages)).toBe(false)
    })

    it('should return true for long conversations', () => {
      // Create a conversation that exceeds the soft threshold
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50), // ~12 tokens each
        timestamp: Date.now()
      }))
      expect(compactor.shouldCompact(messages)).toBe(true)
    })
  })

  describe('planCompaction', () => {
    it('should return null for short conversations', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }
      ]
      expect(compactor.planCompaction(messages)).toBeNull()
    })

    it('should return normal plan for moderate conversations', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
        timestamp: Date.now()
      }))
      const plan = compactor.planCompaction(messages)
      expect(plan).not.toBeNull()
      expect(plan?.mode).toBe('normal')
      expect(plan?.keepRecent).toBe(4)
    })

    it('should return aggressive plan for large conversations', () => {
      // Create a conversation that exceeds soft threshold but not hard threshold
      // softThreshold = 1000, hardThreshold = 2000
      // Each message ~12 tokens, need ~150 messages for aggressive (150 * 12 = 1800)
      const messages = Array.from({ length: 150 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
        timestamp: Date.now()
      }))
      const plan = compactor.planCompaction(messages)
      expect(plan).not.toBeNull()
      expect(plan?.mode).toBe('aggressive')
      expect(plan?.keepRecent).toBe(2)
    })

    it('should return force plan for very large conversations', () => {
      const messages = Array.from({ length: 400 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
        timestamp: Date.now()
      }))
      const plan = compactor.planCompaction(messages)
      expect(plan).not.toBeNull()
      expect(plan?.mode).toBe('force')
      expect(plan?.keepRecent).toBe(1)
    })
  })

  describe('compact', () => {
    it('should not compact short conversations', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }
      ]
      const result = compactor.compact(messages)
      expect(result.compacted).toBe(false)
      expect(result.replacedCount).toBe(0)
      expect(result.keptCount).toBe(1)
    })

    it('should compact long conversations', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}: ${'A'.repeat(50)}`,
        timestamp: Date.now()
      }))
      const result = compactor.compact(messages)
      expect(result.compacted).toBe(true)
      expect(result.replacedCount).toBeGreaterThan(0)
      expect(result.keptCount).toBeGreaterThan(0)
      expect(result.summary).toBeDefined()
    })

    it('should use custom summary if provided', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
        timestamp: Date.now()
      }))
      const customSummary = 'Custom summary'
      const result = compactor.compact(messages, { summaryOverride: customSummary })
      expect(result.summary).toBe(customSummary)
    })

    it('should respect custom keepRecent', () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: 'A'.repeat(50),
        timestamp: Date.now()
      }))
      const result = compactor.compact(messages, { keepRecent: 10 })
      expect(result.keptCount).toBe(10)
    })
  })
})

describe('createContextCompactor', () => {
  it('should create a compactor with default thresholds', () => {
    const compactor = createContextCompactor()
    expect(compactor).toBeInstanceOf(ContextCompactor)
  })

  it('should create a compactor with custom thresholds', () => {
    const compactor = createContextCompactor({
      softThreshold: 5000,
      hardThreshold: 10000
    })
    expect(compactor).toBeInstanceOf(ContextCompactor)
  })
})
