export interface LruCacheOptions {
  readonly capacity: number
  readonly ttlMs: number
  readonly now?: () => number
}

interface CacheEntry<V> {
  readonly value: V
  readonly expiresAt: number
}

export class LruCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>()

  constructor(private readonly options: LruCacheOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError("LRU capacity must be a positive integer")
    }
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }

    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs })
    while (this.entries.size > this.options.capacity) {
      const oldest = this.entries.keys().next().value as K | undefined
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }

  get size(): number {
    return this.entries.size
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now()
  }
}
