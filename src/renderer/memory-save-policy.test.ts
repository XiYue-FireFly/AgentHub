import { describe, expect, it } from 'vitest'
import {
  IDLE_MEMORY_SAVE_DELAY_MS,
  RUNNING_MEMORY_SAVE_INTERVAL_MS,
  hasRunningTask,
  nextMemorySaveDelayMs
} from './memory-save-policy'

describe('memory save policy', () => {
  it('uses a short debounce when no task is running', () => {
    expect(hasRunningTask([{ status: 'completed' }, { status: 'failed' }])).toBe(false)
    expect(nextMemorySaveDelayMs(false, 10_000, 9_999)).toBe(IDLE_MEMORY_SAVE_DELAY_MS)
  })

  it('throttles saves while a task is running instead of skipping them', () => {
    expect(hasRunningTask([{ status: 'running' }])).toBe(true)
    expect(nextMemorySaveDelayMs(true, 10_000, 8_000)).toBe(RUNNING_MEMORY_SAVE_INTERVAL_MS - 2_000)
    expect(nextMemorySaveDelayMs(true, 10_000, 4_000)).toBe(0)
  })
})
