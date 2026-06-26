/**
 * Plugin Manager: safe plugin manifest management.
 *
 * Plugins contribute metadata (commands, skills, prompts) but cannot
 * inject arbitrary JavaScript. Security model: manifest-only, no code
 * execution from plugins.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, lstatSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, basename, dirname, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

export interface PluginManifest {
  name: string
  version: string
  description?: string
  author?: string
  /** What this plugin contributes */
  contributes?: {
    commands?: Array<{ id: string; label: string }>
    skills?: Array<{ id: string; path: string }>
    prompts?: Array<{ id: string; name: string; body: string }>
  }
}

export interface PluginEntry {
  id: string
  manifest: PluginManifest
  path: string
  enabled: boolean
  source: 'local' | 'global'
}

export interface PluginRepositoryPreset {
  id: string
  name: string
  url: string
  description?: string
  source: 'builtin'
}

export interface PluginRepositoryImportInput {
  url: string
  id?: string
  name?: string
  branch?: string
}

export interface PluginRepositoryImportResult {
  ok: boolean
  plugin?: PluginEntry
  plugins?: PluginEntry[]
  path?: string
  error?: string
  diagnostics?: string[]
}

export const BUILTIN_PLUGIN_REPOSITORIES: PluginRepositoryPreset[] = [
  {
    id: 'echobird-superpowers',
    name: 'EchoBird Superpowers',
    url: 'https://gitcode.com/edison7009/EchoBird-Superpowers.git',
    description: 'Codex-style Superpowers skills packaged as an AgentHub plugin repository.',
    source: 'builtin'
  }
]

const PLUGIN_DIRS = [
  { path: join(homedir(), '.agenthub', 'plugins'), source: 'global' as const },
  { path: '.agenthub', source: 'local' as const }
]

const execFileAsync = promisify(execFile)
const SUPPORTED_REPOSITORY_HOSTS = new Set(['github.com', 'gitcode.com'])

/**
 * Scan for installed plugins.
 */
export function scanPlugins(workspaceRoot?: string): PluginEntry[] {
  const plugins: PluginEntry[] = []
  for (const dir of PLUGIN_DIRS) {
    const dirPath = dir.source === 'local' && workspaceRoot ? join(workspaceRoot, dir.path) : dir.path
    if (!existsSync(dirPath)) continue
    try {
      const entries = readdirSync(dirPath)
      for (const entry of entries) {
        const pluginDir = join(dirPath, entry)
        if (!statSync(pluginDir).isDirectory()) continue
        plugins.push(...readPluginEntries(pluginDir, dir.source, entry))
      }
    } catch { /* skip inaccessible dir */ }
  }
  return plugins
}

export function listPluginRepositories(): PluginRepositoryPreset[] {
  return [...BUILTIN_PLUGIN_REPOSITORIES]
}

export function validatePluginRepositoryUrl(urlText: string): { valid: boolean; error?: string } {
  if (!urlText || typeof urlText !== 'string') return { valid: false, error: 'Repository URL is required' }
  let parsed: URL
  try {
    parsed = new URL(urlText.trim())
  } catch {
    return { valid: false, error: 'Repository URL must be a valid HTTPS URL' }
  }
  if (parsed.protocol !== 'https:') return { valid: false, error: 'Only HTTPS repository URLs are supported' }
  if (!SUPPORTED_REPOSITORY_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { valid: false, error: 'Only GitHub and GitCode repositories are supported' }
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return { valid: false, error: 'Repository URL must include owner and repository name' }
  return { valid: true }
}

export async function importPluginRepository(input: PluginRepositoryImportInput): Promise<PluginRepositoryImportResult> {
  const validation = validatePluginRepositoryUrl(input.url)
  if (!validation.valid) return { ok: false, error: validation.error }

  const pluginId = safePluginId(input.id || repositoryIdFromUrl(input.url))
  const pluginsDir = globalPluginDir()
  const destination = join(pluginsDir, pluginId)
  const diagnostics: string[] = []

  try {
    mkdirSync(pluginsDir, { recursive: true })
    if (existsSync(destination)) {
      const existing = readPluginEntries(destination, 'global', pluginId)
      return {
        ok: existing.length > 0,
        plugin: existing[0],
        plugins: existing,
        path: destination,
        diagnostics: ['Repository already exists locally; using the existing copy.'],
        error: existing.length === 0 ? 'Existing repository does not contain an AgentHub manifest or Codex-style SKILL.md files.' : undefined
      }
    }

    const args = ['clone', '--depth', '1']
    if (input.branch?.trim()) args.push('--branch', input.branch.trim())
    args.push(input.url.trim(), destination)
    await execFileAsync('git', args, { timeout: 120_000, windowsHide: true })

    const entries = readPluginEntries(destination, 'global', pluginId, input.name)
    if (entries.length === 0) {
      // P1-3: Rollback — clean up cloned directory when no valid plugins found
      try { rmSync(destination, { recursive: true, force: true }) } catch { /* best effort */ }
      return {
        ok: false,
        path: destination,
        diagnostics,
        error: 'Repository was cloned, but no AgentHub manifest or Codex-style SKILL.md files were found. Cleaned up.'
      }
    }
    return { ok: true, plugin: entries[0], plugins: entries, path: destination, diagnostics }
  } catch (err: any) {
    // P1-3: Rollback — clean up partial clone on any error
    try { if (existsSync(destination)) rmSync(destination, { recursive: true, force: true }) } catch { /* best effort */ }
    return {
      ok: false,
      path: destination,
      diagnostics,
      error: String(err?.stderr || err?.message || err || 'Failed to import plugin repository').trim()
    }
  }
}

/**
 * Validate a plugin manifest.
 */
export function validateManifest(manifest: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!manifest || typeof manifest !== 'object') return { valid: false, errors: ['Not an object'] }
  if (!manifest.name || typeof manifest.name !== 'string') errors.push('Missing or invalid name')
  if (!manifest.version || typeof manifest.version !== 'string') errors.push('Missing or invalid version')
  if (manifest.contributes) {
    if (manifest.contributes.commands && !Array.isArray(manifest.contributes.commands)) errors.push('contributes.commands must be an array')
    if (manifest.contributes.skills && !Array.isArray(manifest.contributes.skills)) errors.push('contributes.skills must be an array')
    if (manifest.contributes.prompts && !Array.isArray(manifest.contributes.prompts)) errors.push('contributes.prompts must be an array')
  }
  return { valid: errors.length === 0, errors }
}

/**
 * Get all contributions from enabled plugins.
 */
export function getPluginContributions(plugins: PluginEntry[]): {
  commands: Array<{ pluginId: string; id: string; label: string }>
  skills: Array<{ pluginId: string; id: string; path: string; content?: string }>
  prompts: Array<{ pluginId: string; id: string; name: string; body: string }>
} {
  const commands: Array<{ pluginId: string; id: string; label: string }> = []
  const skills: Array<{ pluginId: string; id: string; path: string; content?: string }> = []
  const prompts: Array<{ pluginId: string; id: string; name: string; body: string }> = []

  for (const plugin of plugins.filter(p => p.enabled)) {
    const c = plugin.manifest.contributes
    if (!c) continue
    if (c.commands) commands.push(...c.commands.map(cmd => ({ pluginId: plugin.id, ...cmd })))
    if (c.skills) skills.push(...c.skills.map(s => ({ pluginId: plugin.id, ...s, content: readPluginSkillContent(plugin.path, s.path) })))
    if (c.prompts) prompts.push(...c.prompts.map(p => ({ pluginId: plugin.id, ...p })))
  }
  return { commands, skills, prompts }
}

function readPluginSkillContent(pluginRoot: string, skillPath: string): string | undefined {
  try {
    const realRoot = realpathSync(pluginRoot)
    const fullPath = isAbsolute(skillPath) ? skillPath : join(pluginRoot, skillPath)
    const realSkillPath = realpathSync(fullPath)
    if (!realSkillPath.startsWith(realRoot)) return undefined
    const stat = statSync(realSkillPath)
    if (!stat.isFile() || stat.size > 256 * 1024) return undefined
    return readFileSync(realSkillPath, 'utf-8').slice(0, 24000)
  } catch {
    return undefined
  }
}

function globalPluginDir(): string {
  return PLUGIN_DIRS[0].path
}

function readPluginEntries(pluginDir: string, source: 'local' | 'global', entryName: string, displayName?: string): PluginEntry[] {
  const manifestEntry = readManifestEntry(pluginDir, source, entryName)
  if (manifestEntry) return [manifestEntry]

  const codexPackageEntries = readCodexPackageEntries(pluginDir, source, entryName)
  if (codexPackageEntries.length > 0) return codexPackageEntries

  const codexEntry = readCodexStyleEntry(pluginDir, source, entryName, displayName)
  return codexEntry ? [codexEntry] : []
}

function readManifestEntry(pluginDir: string, source: 'local' | 'global', entryName: string): PluginEntry | null {
  const manifestPath = join(pluginDir, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    if (!manifest.name || !manifest.version) return null
    return {
      id: `${source}::${entryName}`,
      manifest,
      path: pluginDir,
      enabled: true,
      source
    }
  } catch {
    return null
  }
}

function readCodexStyleEntry(pluginDir: string, source: 'local' | 'global', entryName: string, displayName?: string): PluginEntry | null {
  const skillFiles = findSkillFiles(pluginDir)
  if (skillFiles.length === 0) return null

  const pluginJson = findFirstPluginJson(pluginDir)
  const pluginMeta = pluginJson ? readJsonSafe(pluginJson) : null
  const name = displayName || pluginMeta?.interface?.displayName || pluginMeta?.name || titleFromId(entryName)
  const description = pluginMeta?.interface?.shortDescription || pluginMeta?.description || `Codex-style plugin repository with ${skillFiles.length} skill${skillFiles.length === 1 ? '' : 's'}.`

  return {
    id: `${source}::${entryName}`,
    manifest: {
      name,
      version: String(pluginMeta?.version || '0.0.0'),
      description,
      author: normalizeAuthor(pluginMeta?.author),
      contributes: {
        skills: skillFiles.map(file => ({ id: skillIdFromPath(file), path: file }))
      }
    },
    path: pluginDir,
    enabled: true,
    source
  }
}

function readCodexPackageEntries(pluginDir: string, source: 'local' | 'global', entryName: string): PluginEntry[] {
  return findPluginJsonFiles(pluginDir)
    .map(pluginJson => {
      const packageRoot = dirname(dirname(pluginJson))
      const pluginMeta = readJsonSafe(pluginJson)
      const packageName = safePluginId(pluginMeta?.name || basename(dirname(packageRoot)) || basename(packageRoot))
      return readCodexPackageEntry(packageRoot, source, `${entryName}/${packageName}`, pluginMeta)
    })
    .filter((entry): entry is PluginEntry => Boolean(entry))
}

function readCodexPackageEntry(packageRoot: string, source: 'local' | 'global', entryName: string, pluginMeta: any): PluginEntry | null {
  const skillFiles = findSkillFiles(packageRoot)
  if (skillFiles.length === 0) return null
  const name = pluginMeta?.interface?.displayName || pluginMeta?.name || titleFromId(entryName)
  const description = pluginMeta?.interface?.shortDescription || pluginMeta?.description || `Codex-style plugin package with ${skillFiles.length} skill${skillFiles.length === 1 ? '' : 's'}.`
  return {
    id: `${source}::${entryName}`,
    manifest: {
      name,
      version: String(pluginMeta?.version || '0.0.0'),
      description,
      author: normalizeAuthor(pluginMeta?.author),
      contributes: {
        skills: skillFiles.map(file => ({ id: skillIdFromPath(file), path: file }))
      }
    },
    path: packageRoot,
    enabled: true,
    source
  }
}

function findSkillFiles(root: string, maxDepth = 7): string[] {
  // LOW-33: If realpathSync fails on root, reject traversal (don't fall back to unresolved path)
  let realRoot: string
  try { realRoot = realpathSync(root) } catch { return [] }
  const results: string[] = []
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === '.git' || entry === 'node_modules') continue
      const full = join(dir, entry)
      // P1-3: Symlink protection — check if symlink target escapes the plugin root
      let stat
      try {
        stat = lstatSync(full)
      } catch {
        continue
      }
      if (stat.isSymbolicLink()) {
        try {
          const realPath = realpathSync(full)
          if (!realPath.startsWith(realRoot)) continue // skip symlinks escaping root
          stat = statSync(full)
        } catch {
          continue
        }
      }
      if (stat.isDirectory()) visit(full, depth + 1)
      else if (entry === 'SKILL.md') results.push(full)
    }
  }
  visit(root, 0)
  return results.sort()
}

function findFirstPluginJson(root: string, maxDepth = 4): string | null {
  return findPluginJsonFiles(root, maxDepth)[0] || null
}

function findPluginJsonFiles(root: string, maxDepth = 4): string[] {
  const found: string[] = []
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    const direct = join(dir, '.codex-plugin', 'plugin.json')
    if (existsSync(direct)) {
      found.push(direct)
      return
    }
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === '.git' || entry === 'node_modules') continue
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) visit(full, depth + 1)
      } catch {
        continue
      }
    }
  }
  visit(root, 0)
  return found.sort()
}

function readJsonSafe(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function normalizeAuthor(author: any): string | undefined {
  if (!author) return undefined
  if (typeof author === 'string') return author
  if (typeof author.name === 'string') return author.name
  return undefined
}

function skillIdFromPath(path: string): string {
  const parent = basename(path.replace(/\\SKILL\.md$/i, '').replace(/\/SKILL\.md$/i, ''))
  return safePluginId(parent) || 'skill'
}

function repositoryIdFromUrl(urlText: string): string {
  const parsed = new URL(urlText.trim())
  const parts = parsed.pathname.split('/').filter(Boolean)
  const repo = parts[parts.length - 1]?.replace(/\.git$/i, '') || 'plugin'
  const owner = parts[parts.length - 2] || parsed.hostname
  return `${owner}-${repo}`
}

function safePluginId(value: string): string {
  return String(value || 'plugin')
    .replace(/\.git$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'plugin'
}

function titleFromId(id: string): string {
  return safePluginId(id).split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Plugin'
}
