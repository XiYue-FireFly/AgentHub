import { describe, expect, it, vi } from 'vitest'
import {
  readMultiModelFusionPreference,
  writeMultiModelFusionPreference
} from '../utils/multiModelFusionPreference'

const KEY = 'agenthub.multiModelFusion.v1'

function storage(value: string | null = null) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn()
  }
}

describe('multi-model fusion preference', () => {
  it('reads the persisted true and false values from its dedicated key', () => {
    expect(readMultiModelFusionPreference(storage('true'), KEY)).toBe(true)
    expect(readMultiModelFusionPreference(storage('false'), KEY)).toBe(false)
  })

  it('writes boolean preferences under the dedicated key', () => {
    const target = storage()

    expect(writeMultiModelFusionPreference(target, KEY, true)).toBe(true)
    expect(target.setItem).toHaveBeenCalledWith(KEY, 'true')
  })

  it('fails closed when storage reads or writes throw', () => {
    const unavailable = {
      getItem: vi.fn(() => { throw new Error('blocked') }),
      setItem: vi.fn(() => { throw new Error('blocked') })
    }

    expect(readMultiModelFusionPreference(unavailable, KEY)).toBe(false)
    expect(writeMultiModelFusionPreference(unavailable, KEY, true)).toBe(false)
  })
})
