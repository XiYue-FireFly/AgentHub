/**
 * Wave4+: plugin marketplace catalog + install from trusted HTTPS sources.
 *
 * - Built-in catalog (local, no network required to list)
 * - Optional remote catalog URL (HTTPS only, host allowlist)
 * - Install via git clone (reuses plugin-manager import) then integrity+signature verify
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  importPluginRepository,
  type PluginEntry,
  type PluginRepositoryImportResult,
  verifyPluginIntegrity
} from './plugin-manager'
import { loadTrustStore, verifyPluginSignature, type PluginSignatureResult } from './plugin-signature'

export interface MarketplacePlugin {
  id: string
  name: string
  version: string
  description?: string
  publisher: string
  /** HTTPS git URL or catalog-relative note */
  repositoryUrl: string
  branch?: string
  source: 'builtin' | 'remote'
  homepage?: string
}

export interface MarketplaceListResult {
  ok: boolean
  plugins: MarketplacePlugin[]
  error?: string
  source?: string
}

export interface MarketplaceInstallResult {
  ok: boolean
  plugin?: PluginEntry
  plugins?: PluginEntry[]
  path?: string
  error?: string
  integrity?: ReturnType<typeof verifyPluginIntegrity>
  signature?: PluginSignatureResult
  diagnostics?: string[]
}

const ALLOWED_REGISTRY_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'gitcode.com',
  'cdn.jsdelivr.net'
])

/** Built-in catalog — discoverable without network. Install still needs git HTTPS. */
export const BUILTIN_MARKETPLACE: MarketplacePlugin[] = [
  {
    id: 'echobird-superpowers',
    name: 'EchoBird Superpowers',
    version: '1.0.0',
    description: 'Codex-style Superpowers skills as an AgentHub plugin repository.',
    publisher: 'echobird',
    repositoryUrl: 'https://gitcode.com/edison7009/EchoBird-Superpowers.git',
    source: 'builtin',
    homepage: 'https://gitcode.com/edison7009/EchoBird-Superpowers'
  },
  {
    id: 'agenthub-sample-skills',
    name: 'AgentHub Sample Skills',
    version: '0.1.0',
    description: 'Placeholder sample pack entry for marketplace UI (install uses repository URL).',
    publisher: 'agenthub-official',
    repositoryUrl: 'https://github.com/agenthub-dev/sample-skills.git',
    source: 'builtin'
  }
]

export function listBuiltinMarketplace(): MarketplacePlugin[] {
  return BUILTIN_MARKETPLACE.map(p => ({ ...p }))
}

export function validateRegistryUrl(urlText: string): { valid: boolean; error?: string } {
  if (!urlText || typeof urlText !== 'string') return { valid: false, error: 'Registry URL is required' }
  let parsed: URL
  try {
    parsed = new URL(urlText.trim())
  } catch {
    return { valid: false, error: 'Registry URL must be a valid HTTPS URL' }
  }
  if (parsed.protocol !== 'https:') return { valid: false, error: 'Only HTTPS registry URLs are supported' }
  if (!ALLOWED_REGISTRY_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { valid: false, error: 'Registry host is not in the allowlist' }
  }
  return { valid: true }
}

/**
 * Fetch remote catalog JSON: { plugins: MarketplacePlugin[] }
 */
export async function fetchRemoteMarketplace(registryUrl: string): Promise<MarketplaceListResult> {
  const validation = validateRegistryUrl(registryUrl)
  if (!validation.valid) return { ok: false, plugins: [], error: validation.error }

  try {
    const res = await fetch(registryUrl.trim(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'AgentHub-Marketplace/1.0' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return { ok: false, plugins: [], error: `Registry HTTP ${res.status}` }
    const data = await res.json() as any
    const raw = Array.isArray(data) ? data : data?.plugins
    if (!Array.isArray(raw)) return { ok: false, plugins: [], error: 'Invalid catalog format' }

    const plugins: MarketplacePlugin[] = []
    for (const item of raw.slice(0, 200)) {
      if (!item || typeof item.id !== 'string' || typeof item.repositoryUrl !== 'string') continue
      // repository must be https git host
      let repoOk = false
      try {
        const u = new URL(item.repositoryUrl)
        repoOk = u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname === 'gitcode.com')
      } catch {
        repoOk = false
      }
      if (!repoOk) continue
      plugins.push({
        id: String(item.id).slice(0, 80),
        name: String(item.name || item.id).slice(0, 200),
        version: String(item.version || '0.0.0').slice(0, 40),
        description: typeof item.description === 'string' ? item.description.slice(0, 500) : undefined,
        publisher: String(item.publisher || 'unknown').slice(0, 80),
        repositoryUrl: item.repositoryUrl.trim(),
        branch: typeof item.branch === 'string' ? item.branch.slice(0, 100) : undefined,
        source: 'remote',
        homepage: typeof item.homepage === 'string' ? item.homepage.slice(0, 500) : undefined
      })
    }
    return { ok: true, plugins, source: registryUrl }
  } catch (e: any) {
    return { ok: false, plugins: [], error: e?.message || String(e) }
  }
}

export async function listMarketplace(registryUrl?: string): Promise<MarketplaceListResult> {
  const builtin = listBuiltinMarketplace()
  if (!registryUrl?.trim()) {
    return { ok: true, plugins: builtin, source: 'builtin' }
  }
  const remote = await fetchRemoteMarketplace(registryUrl)
  if (!remote.ok) {
    return { ok: true, plugins: builtin, error: remote.error, source: 'builtin+remote-error' }
  }
  const byId = new Map<string, MarketplacePlugin>()
  for (const p of builtin) byId.set(p.id, p)
  for (const p of remote.plugins) byId.set(p.id, p)
  return { ok: true, plugins: [...byId.values()], source: `builtin+${registryUrl}` }
}

export function getMarketplacePlugin(id: string, catalog: MarketplacePlugin[] = BUILTIN_MARKETPLACE): MarketplacePlugin | null {
  return catalog.find(p => p.id === id) || null
}

/**
 * Install a marketplace entry via git clone + integrity/signature reporting.
 */
export async function installMarketplacePlugin(
  plugin: MarketplacePlugin,
  options: { requireSignature?: boolean } = {}
): Promise<MarketplaceInstallResult> {
  if (!plugin?.repositoryUrl) return { ok: false, error: 'Invalid marketplace plugin' }

  const imported: PluginRepositoryImportResult = await importPluginRepository({
    url: plugin.repositoryUrl,
    id: plugin.id,
    name: plugin.name,
    branch: plugin.branch
  })

  if (!imported.ok) {
    return {
      ok: false,
      error: imported.error,
      path: imported.path,
      diagnostics: imported.diagnostics
    }
  }

  const entries = imported.plugins || (imported.plugin ? [imported.plugin] : [])
  const path = imported.path || entries[0]?.path
  let integrity = path ? verifyPluginIntegrity(path) : undefined
  let signature = path ? verifyPluginSignature(path, loadTrustStore()) : undefined

  if (options.requireSignature && signature && signature.status !== 'ok') {
    return {
      ok: false,
      plugin: entries[0],
      plugins: entries,
      path,
      integrity,
      signature,
      error: `Signature required but status is ${signature.status}: ${signature.message || ''}`,
      diagnostics: imported.diagnostics
    }
  }

  // Re-scan integrity attaches to entries already via withIntegrity on import
  return {
    ok: true,
    plugin: entries[0],
    plugins: entries,
    path,
    integrity,
    signature,
    diagnostics: imported.diagnostics
  }
}

/** Persist last used registry URL (plain json under ~/.agenthub). */
export function getMarketplacePrefsPath(): string {
  return join(homedir(), '.agenthub', 'marketplace-prefs.json')
}

export function loadMarketplacePrefs(): { registryUrl?: string; requireSignature?: boolean } {
  const path = getMarketplacePrefsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveMarketplacePrefs(prefs: { registryUrl?: string; requireSignature?: boolean }): void {
  const dir = join(homedir(), '.agenthub')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getMarketplacePrefsPath(), JSON.stringify(prefs, null, 2), 'utf-8')
}
