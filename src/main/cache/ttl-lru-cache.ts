import { LruCache } from './lru-cache'

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

/**
 * TTL + LRU cache.
 *
 * Entries expire after `ttlMs` milliseconds. Expired entries are lazily
 * evicted on access. The cache is bounded by `limit` entries.
 */
export class TtlLruCache<K, V> {
  private readonly cache: LruCache<K, CacheEntry<V>>
  private readonly ttlMs: number

  constructor(limit: number, ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('TtlLruCache requires ttlMs > 0')
    }
    this.cache = new LruCache(limit)
    this.ttlMs = ttlMs
  }

  get size(): number {
    return this.cache.size
  }

  has(key: K): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }
    return true
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: K, value: V): void {
    const expiresAt = Date.now() + this.ttlMs
    this.cache.set(key, { value, expiresAt })
  }

  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  keys(): IterableIterator<K> {
    return this.cache.keys()
  }

  /**
   * Remove all expired entries.
   */
  cleanup(): number {
    const now = Date.now()
    let removed = 0
    for (const key of this.cache.keys()) {
      const entry = this.cache.peek(key)
      if (entry && now > entry.expiresAt) {
        this.cache.delete(key)
        removed++
      }
    }
    return removed
  }
}
