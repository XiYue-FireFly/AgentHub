/**
 * IT-4: Composer prompt history ring buffer (ccgui-inspired recall).
 * Pure in-memory structure; callers may persist snapshots.
 */

export interface PromptHistorySnapshot {
  version: 1
  items: string[]
  /** Index into history for ↑/↓ navigation; -1 = not browsing */
  cursor: number
}

export class PromptHistoryRing {
  private items: string[] = []
  private cursor = -1
  readonly max: number

  constructor(max = 50) {
    this.max = Math.max(1, Math.min(500, Math.floor(max) || 50))
  }

  /** Push a sent prompt (dedupe consecutive duplicates). */
  push(prompt: string): void {
    const text = String(prompt ?? '').trim()
    if (!text) return
    if (this.items[0] === text) {
      this.cursor = -1
      return
    }
    this.items.unshift(text)
    if (this.items.length > this.max) this.items.length = this.max
    this.cursor = -1
  }

  /** Move toward older entries (↑). Returns prompt or null at end. */
  older(): string | null {
    if (this.items.length === 0) return null
    if (this.cursor < this.items.length - 1) this.cursor += 1
    return this.items[this.cursor] ?? null
  }

  /** Move toward newer entries (↓). Returns prompt or empty string when leaving history. */
  newer(): string | null {
    if (this.cursor <= 0) {
      this.cursor = -1
      return ''
    }
    this.cursor -= 1
    return this.items[this.cursor] ?? null
  }

  peek(): string | null {
    if (this.cursor < 0) return null
    return this.items[this.cursor] ?? null
  }

  list(limit = 20): string[] {
    const n = Math.max(1, Math.min(this.max, Math.floor(limit) || 20))
    return this.items.slice(0, n)
  }

  size(): number {
    return this.items.length
  }

  clear(): void {
    this.items = []
    this.cursor = -1
  }

  toJSON(): PromptHistorySnapshot {
    return { version: 1, items: [...this.items], cursor: this.cursor }
  }

  static fromJSON(raw: PromptHistorySnapshot | null | undefined, max = 50): PromptHistoryRing {
    const ring = new PromptHistoryRing(max)
    if (!raw || raw.version !== 1 || !Array.isArray(raw.items)) return ring
    for (const item of [...raw.items].reverse()) {
      ring.push(String(item))
    }
    // restore cursor clamped
    if (typeof raw.cursor === 'number' && raw.cursor >= 0) {
      ring.cursor = Math.min(raw.cursor, ring.items.length - 1)
    }
    return ring
  }
}
