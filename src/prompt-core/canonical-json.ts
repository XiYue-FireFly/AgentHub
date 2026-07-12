import { createHash } from "node:crypto"

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue }

function normalize(value: unknown, seen: Set<object>): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers")
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Canonical JSON rejects cycles")
    seen.add(value)
    const result = value.map(item => item === undefined ? null : normalize(item, seen))
    seen.delete(value)
    return result
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (seen.has(record)) throw new TypeError("Canonical JSON rejects cycles")
    seen.add(record)
    const result: Record<string, CanonicalValue> = {}
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue
      result[key] = normalize(item, seen)
    }
    seen.delete(record)
    return result
  }
  throw new TypeError("Canonical JSON rejects unsupported values")
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()))
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function hashPromptText(value: string): string {
  return sha256Hex(String(value))
}
