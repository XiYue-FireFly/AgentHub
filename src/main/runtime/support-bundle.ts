/**
 * IT-3: Support Bundle / runtime evidence export (desktop-cc-gui inspired).
 * Pure assembly of a redacted JSON snapshot for support / self-debug.
 */

export interface SupportBundleInput {
  appVersion?: string
  platform?: string
  nodeVersion?: string
  diagnosticsOverall?: string
  diagnosticChecks?: Array<{ id?: string; status?: string; message?: string }>
  providers?: Array<{ id?: string; enabled?: boolean; name?: string }>
  providerDoctorOverall?: string
  pluginScan?: Array<{
    id?: string
    enabled?: boolean
    integrity?: { status?: string }
    signature?: { status?: string }
  }>
  threadCount?: number
  turnCount?: number
  recentEventKinds?: string[]
  headlessRunCount?: number
  extra?: Record<string, unknown>
}

export interface SupportBundle {
  kind: 'agenthub-support-bundle-v1'
  createdAt: string
  appVersion: string
  platform: string
  nodeVersion: string
  diagnostics: {
    overall: string
    checks: Array<{ id: string; status: string; message?: string }>
  }
  providers: {
    total: number
    enabled: number
    doctorOverall?: string
    ids: string[]
  }
  plugins: {
    total: number
    enabled: number
    integrity: Record<string, number>
    signature: Record<string, number>
  }
  workbench: {
    threadCount: number
    turnCount: number
    recentEventKinds: string[]
  }
  headless: {
    runCount: number
  }
  extra: Record<string, unknown>
}

function countBy(items: Array<string | undefined>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of items) {
    const k = raw || 'unknown'
    out[k] = (out[k] || 0) + 1
  }
  return out
}

/**
 * Build a redacted support bundle. Never include API keys or prompt bodies.
 */
export function buildSupportBundle(input: SupportBundleInput = {}, now = new Date()): SupportBundle {
  const providers = Array.isArray(input.providers) ? input.providers : []
  const plugins = Array.isArray(input.pluginScan) ? input.pluginScan : []
  const checks = Array.isArray(input.diagnosticChecks) ? input.diagnosticChecks : []

  return {
    kind: 'agenthub-support-bundle-v1',
    createdAt: now.toISOString(),
    appVersion: String(input.appVersion || '0.0.0'),
    platform: String(input.platform || process.platform || 'unknown'),
    nodeVersion: String(input.nodeVersion || process.version || 'unknown'),
    diagnostics: {
      overall: String(input.diagnosticsOverall || 'unknown'),
      checks: checks.slice(0, 64).map(c => ({
        id: String(c.id || 'check'),
        status: String(c.status || 'unknown'),
        message: c.message ? String(c.message).slice(0, 500) : undefined
      }))
    },
    providers: {
      total: providers.length,
      enabled: providers.filter(p => p.enabled !== false).length,
      doctorOverall: input.providerDoctorOverall,
      ids: providers.map(p => String(p.id || 'unknown')).slice(0, 64)
    },
    plugins: {
      total: plugins.length,
      enabled: plugins.filter(p => p.enabled !== false).length,
      integrity: countBy(plugins.map(p => p.integrity?.status)),
      signature: countBy(plugins.map(p => p.signature?.status))
    },
    workbench: {
      threadCount: Math.max(0, Number(input.threadCount) || 0),
      turnCount: Math.max(0, Number(input.turnCount) || 0),
      recentEventKinds: (input.recentEventKinds || []).slice(0, 32).map(String)
    },
    headless: {
      runCount: Math.max(0, Number(input.headlessRunCount) || 0)
    },
    extra: sanitizeExtra(input.extra)
  }
}

const SECRET_KEY = /api[_-]?key|token|password|secret|authorization|passwd|credential/i

function sanitizeExtra(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra || typeof extra !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (SECRET_KEY.test(key)) continue
    if (typeof value === 'string' && /^(sk-|enc:v1:|Bearer\s+)/i.test(value.trim())) continue
    if (typeof value === 'string') out[key] = value.slice(0, 200)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
    else if (value == null) out[key] = value
    else out[key] = '[omitted]'
  }
  return out
}

export function serializeSupportBundle(bundle: SupportBundle): string {
  return JSON.stringify(bundle, null, 2)
}
