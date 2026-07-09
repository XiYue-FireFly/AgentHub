import { describe, expect, it } from 'vitest'
import { PromptHistoryRing } from '../prompt-history'

describe('prompt-history (IT-4)', () => {
  it('stores recent prompts and navigates older/newer', () => {
    const ring = new PromptHistoryRing(5)
    ring.push('first')
    ring.push('second')
    ring.push('third')
    expect(ring.size()).toBe(3)
    expect(ring.older()).toBe('third')
    expect(ring.older()).toBe('second')
    expect(ring.older()).toBe('first')
    expect(ring.older()).toBe('first') // clamp
    expect(ring.newer()).toBe('second')
    expect(ring.newer()).toBe('third')
    expect(ring.newer()).toBe('') // leave history
  })

  it('dedupes consecutive duplicates and respects max', () => {
    const ring = new PromptHistoryRing(3)
    ring.push('a')
    ring.push('a')
    expect(ring.size()).toBe(1)
    ring.push('b')
    ring.push('c')
    ring.push('d')
    expect(ring.list()).toEqual(['d', 'c', 'b'])
  })

  it('round-trips JSON snapshot', () => {
    const ring = new PromptHistoryRing(10)
    ring.push('one')
    ring.push('two')
    ring.older()
    const restored = PromptHistoryRing.fromJSON(ring.toJSON(), 10)
    expect(restored.list()).toEqual(['two', 'one'])
    expect(restored.peek()).toBe('two')
  })

  it('ignores empty prompts', () => {
    const ring = new PromptHistoryRing()
    ring.push('   ')
    expect(ring.size()).toBe(0)
  })
})
