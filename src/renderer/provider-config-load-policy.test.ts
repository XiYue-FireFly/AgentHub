import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS,
  EMPTY_PROVIDER_CONFIG_RETRY_LIMIT,
  isEmptyProviderConfig,
  nextEmptyProviderConfigRetryDelayMs
} from './provider-config-load-policy'

describe('provider config load policy', () => {
  it('identifies empty provider configs', () => {
    expect(isEmptyProviderConfig(undefined)).toBe(true)
    expect(isEmptyProviderConfig(null)).toBe(true)
    expect(isEmptyProviderConfig([])).toBe(true)
    expect(isEmptyProviderConfig([{ id: 'openai' }])).toBe(false)
  })

  it('caps empty provider config retries', () => {
    expect(nextEmptyProviderConfigRetryDelayMs(0)).toBe(EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS)
    expect(nextEmptyProviderConfigRetryDelayMs(EMPTY_PROVIDER_CONFIG_RETRY_LIMIT - 1)).toBe(EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS)
    expect(nextEmptyProviderConfigRetryDelayMs(EMPTY_PROVIDER_CONFIG_RETRY_LIMIT)).toBeNull()
  })
})
