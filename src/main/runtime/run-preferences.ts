import { store } from "../store"

const RUN_TIMEOUT_KEY = "agenthub.runTimeoutMs.v1"
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60 * 1000
const MIN_RUN_TIMEOUT_MS = 60 * 1000
const MAX_RUN_TIMEOUT_MS = 60 * 60 * 1000

export function getRunTimeoutMs(): number {
  const raw = Number(store.get(RUN_TIMEOUT_KEY))
  return clampRunTimeout(raw || DEFAULT_RUN_TIMEOUT_MS)
}

export function setRunTimeoutMs(value: number): number {
  const next = clampRunTimeout(value)
  store.set(RUN_TIMEOUT_KEY, next)
  return next
}

export function clampRunTimeout(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RUN_TIMEOUT_MS
  return Math.max(MIN_RUN_TIMEOUT_MS, Math.min(MAX_RUN_TIMEOUT_MS, Math.round(value)))
}

export const RUN_TIMEOUT_DEFAULTS = {
  defaultMs: DEFAULT_RUN_TIMEOUT_MS,
  minMs: MIN_RUN_TIMEOUT_MS,
  maxMs: MAX_RUN_TIMEOUT_MS
}
