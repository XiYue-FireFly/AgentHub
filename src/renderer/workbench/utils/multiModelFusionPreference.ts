export type FusionPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readMultiModelFusionPreference(storage: Pick<FusionPreferenceStorage, 'getItem'>, key: string): boolean {
  try {
    const stored = storage.getItem(key)
    if (stored === 'true') return true
    if (stored === 'false' || !stored) return false
    const parsed = JSON.parse(stored) as unknown
    return parsed === true || (!!parsed && typeof parsed === 'object' && (parsed as { enabled?: unknown }).enabled === true)
  } catch {
    return false
  }
}

export function writeMultiModelFusionPreference(
  storage: Pick<FusionPreferenceStorage, 'setItem'>,
  key: string,
  enabled: boolean
): boolean {
  try {
    storage.setItem(key, String(enabled))
    return true
  } catch {
    return false
  }
}
