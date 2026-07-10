/**
 * IT-2: Provider Doctor — config-level readiness report (cc-switch inspired).
 * No network calls; pure inspection of stored provider shapes.
 */

export type ProviderDoctorSeverity = 'ok' | 'warn' | 'error'

export interface ProviderDoctorInput {
  id: string
  name?: string
  enabled?: boolean
  baseUrl?: string
  apiKey?: string | null
  /** When true, key exists but cannot be used (safeStorage locked / decrypt fail) */
  apiKeyLocked?: boolean
  models?: Array<{ id?: string } | string>
  protocol?: string
}

export interface ProviderDoctorFinding {
  providerId: string
  providerName: string
  severity: ProviderDoctorSeverity
  code: string
  message: string
}

export interface ProviderDoctorReport {
  checkedAt: string
  overall: ProviderDoctorSeverity
  providers: Array<{
    id: string
    name: string
    enabled: boolean
    severity: ProviderDoctorSeverity
    findings: ProviderDoctorFinding[]
  }>
  summary: { ok: number; warn: number; error: number; total: number; enabled: number }
}

function severityRank(s: ProviderDoctorSeverity): number {
  return s === 'error' ? 2 : s === 'warn' ? 1 : 0
}

function worst(a: ProviderDoctorSeverity, b: ProviderDoctorSeverity): ProviderDoctorSeverity {
  return severityRank(a) >= severityRank(b) ? a : b
}

function looksEncrypted(key: string): boolean {
  return key.startsWith('enc:v1:')
}

function hasUsableKey(apiKey: string | null | undefined): boolean {
  if (!apiKey || typeof apiKey !== 'string') return false
  const k = apiKey.trim()
  if (!k) return false
  if (looksEncrypted(k)) return true
  return k.length >= 4
}

/**
 * Diagnose a list of provider configs without network I/O.
 */
export function diagnoseProviders(providers: ProviderDoctorInput[], now = new Date()): ProviderDoctorReport {
  const list = Array.isArray(providers) ? providers : []
  const rows: ProviderDoctorReport['providers'] = []
  let ok = 0
  let warn = 0
  let error = 0
  let enabledCount = 0

  for (const p of list) {
    const id = String(p?.id || '').trim() || 'unknown'
    const name = String(p?.name || id).trim() || id
    const enabled = p?.enabled !== false
    if (enabled) enabledCount += 1
    const findings: ProviderDoctorFinding[] = []

    if (!id || id === 'unknown') {
      findings.push({
        providerId: id,
        providerName: name,
        severity: 'error',
        code: 'missing_id',
        message: 'Provider id is missing'
      })
    }

    if (enabled && !hasUsableKey(p.apiKey)) {
      findings.push({
        providerId: id,
        providerName: name,
        severity: 'error',
        code: 'missing_api_key',
        message: 'Enabled provider has no usable API key'
      })
    }

    if (enabled && p.apiKeyLocked) {
      findings.push({
        providerId: id,
        providerName: name,
        severity: 'error',
        code: 'api_key_locked',
        message: 'API key is locked or failed to decrypt on this machine'
      })
    }

    if (enabled && p.baseUrl) {
      try {
        const u = new URL(String(p.baseUrl))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          findings.push({
            providerId: id,
            providerName: name,
            severity: 'error',
            code: 'bad_base_url_protocol',
            message: `baseUrl must be http(s), got ${u.protocol}`
          })
        } else if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
          findings.push({
            providerId: id,
            providerName: name,
            severity: 'warn',
            code: 'insecure_base_url',
            message: 'baseUrl uses plain HTTP (non-local)'
          })
        }
      } catch {
        findings.push({
          providerId: id,
          providerName: name,
          severity: 'error',
          code: 'invalid_base_url',
          message: 'baseUrl is not a valid URL'
        })
      }
    }

    const modelCount = Array.isArray(p.models) ? p.models.length : 0
    if (enabled && modelCount === 0) {
      findings.push({
        providerId: id,
        providerName: name,
        severity: 'warn',
        code: 'no_models',
        message: 'No models configured for this provider'
      })
    }

    if (!enabled) {
      findings.push({
        providerId: id,
        providerName: name,
        severity: 'ok',
        code: 'disabled',
        message: 'Provider is disabled'
      })
    }

    let severity: ProviderDoctorSeverity = 'ok'
    for (const f of findings) severity = worst(severity, f.severity)
    if (findings.length === 0 && enabled) {
      findings.push({
        providerId: id,
        providerName: name,
        severity: 'ok',
        code: 'ready',
        message: 'Provider config looks ready'
      })
    }

    if (severity === 'error') error += 1
    else if (severity === 'warn') warn += 1
    else ok += 1

    rows.push({ id, name, enabled, severity, findings })
  }

  let overall: ProviderDoctorSeverity = 'ok'
  if (error > 0) overall = 'error'
  else if (warn > 0) overall = 'warn'

  return {
    checkedAt: now.toISOString(),
    overall,
    providers: rows,
    summary: { ok, warn, error, total: list.length, enabled: enabledCount }
  }
}
