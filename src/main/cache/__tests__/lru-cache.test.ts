import { describe, it, expect, beforeEach } from 'vitest'
import { LruCache } from '../lru-cache'

describe('LruCache', () => {
  let cache: LruCache<string, number>

  beforeEach(() => {
    cache = new LruCache(3)
  })

  describe('constructor', () => {
    it('should create cache with valid limit', () => {
      expect(cache.size).toBe(0)
    })

    it('should throw for invalid limit', () => {
      expect(() => new LruCache(0)).toThrow()
      expect(() => new LruCache(-1)).toThrow()
    })
  })

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      cache.set('a', 1)
      expect(cache.get('a')).toBe(1)
    })

    it('should return undefined for missing keys', () => {
      expect(cache.get('missing')).toBeUndefined()
    })

    it('should evict least recently used when full', () => {
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4) // should evict 'a'
      expect(cache.get('a')).toBeUndefined()
      expect(cache.get('b')).toBe(2)
      expect(cache.get('c')).toBe(3)
      expect(cache.get('d')).toBe(4)
    })

    it('should promote accessed items', () => {
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.get('a') // promote 'a'
      cache.set('d', 4) // should evict 'b'
      expect(cache.get('a')).toBe(1)
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('c')).toBe(3)
      expect(cache.get('d')).toBe(4)
    })

    it('should update existing keys', () => {
      cache.set('a', 1)
      cache.set('a', 2)
      expect(cache.get('a')).toBe(2)
      expect(cache.size).toBe(1)
    })
  })

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('a', 1)
      expect(cache.has('a')).toBe(true)
    })

    it('should return false for missing keys', () => {
      expect(cache.has('missing')).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete existing keys', () => {
      cache.set('a', 1)
      expect(cache.delete('a')).toBe(true)
      expect(cache.get('a')).toBeUndefined()
    })

    it('should return false for missing keys', () => {
      expect(cache.delete('missing')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all entries', () => {
      cache.set('a', 1)
      cache.set('b', 2)
      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.get('a')).toBeUndefined()
    })
  })

  describe('size', () => {
    it('should track size correctly', () => {
      expect(cache.size).toBe(0)
      cache.set('a', 1)
      expect(cache.size).toBe(1)
      cache.set('b', 2)
      expect(cache.size).toBe(2)
      cache.delete('a')
      expect(cache.size).toBe(1)
    })
  })
})
