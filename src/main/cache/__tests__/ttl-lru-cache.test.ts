import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TtlLruCache } from '../ttl-lru-cache'

describe('TtlLruCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should cleanup all expired entries', () => {
    const cache = new TtlLruCache<string, number>(100, 100)  // 100ms TTL

    // Add 50 entries
    for (let i = 0; i < 50; i++) {
      cache.set(`key-${i}`, i)
    }

    expect(cache.size).toBe(50)

    // Advance time past TTL
    vi.advanceTimersByTime(150)

    // Cleanup should remove all expired entries
    const removed = cache.cleanup()
    expect(removed).toBe(50)
    expect(cache.size).toBe(0)
  })

  it('should not cleanup non-expired entries', () => {
    const cache = new TtlLruCache<string, number>(100, 1000)  // 1000ms TTL

    // Add entries
    for (let i = 0; i < 10; i++) {
      cache.set(`key-${i}`, i)
    }

    expect(cache.size).toBe(10)

    // Advance time but not past TTL
    vi.advanceTimersByTime(500)

    // Cleanup should not remove any entries
    const removed = cache.cleanup()
    expect(removed).toBe(0)
    expect(cache.size).toBe(10)
  })

  it('should cleanup expired entries and keep non-expired ones', () => {
    const cache = new TtlLruCache<string, number>(100, 100)  // 100ms TTL

    // Add first batch
    for (let i = 0; i < 25; i++) {
      cache.set(`batch1-${i}`, i)
    }

    // Advance time by 50ms
    vi.advanceTimersByTime(50)

    // Add second batch
    for (let i = 0; i < 25; i++) {
      cache.set(`batch2-${i}`, i)
    }

    expect(cache.size).toBe(50)

    // Advance time by another 60ms (total 110ms, batch1 expired, batch2 not)
    vi.advanceTimersByTime(60)

    // Cleanup should remove only batch1
    const removed = cache.cleanup()
    expect(removed).toBe(25)
    expect(cache.size).toBe(25)

    // Verify batch2 entries still exist
    for (let i = 0; i < 25; i++) {
      expect(cache.has(`batch2-${i}`)).toBe(true)
    }
  })
})
