export const EMPTY_PROVIDER_CONFIG_RETRY_LIMIT = 5
export const EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS = 500

export function isEmptyProviderConfig(providers: unknown): boolean {
  return !Array.isArray(providers) || providers.length === 0
}

export function nextEmptyProviderConfigRetryDelayMs(previousRetries: number): number | null {
  if (previousRetries >= EMPTY_PROVIDER_CONFIG_RETRY_LIMIT) return null
  return EMPTY_PROVIDER_CONFIG_RETRY_DELAY_MS
}
