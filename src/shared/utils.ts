/**
 * Shared utility functions used across main process and renderer.
 */

/**
 * Type guard: check if a model selection is a direct provider selection
 * (source === "provider" with valid providerId and modelId).
 * Extracted from index.ts and hub-threads-ipc.ts to avoid duplication (LOW-08).
 */
export function isProviderDirectSelection<T extends { source?: string; providerId?: string; modelId?: string }>(
  selection: T | undefined | null
): selection is T {
  return !!selection && selection.source === "provider" && !!selection.providerId && !!selection.modelId
}
