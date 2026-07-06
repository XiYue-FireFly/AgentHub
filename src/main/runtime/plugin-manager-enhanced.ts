/**
 * PluginManagerEnhanced: enhanced plugin lifecycle management.
 *
 * Extends plugin-manager with install/uninstall, dependency checking,
 * version management, and plugin registry.
 *
 * P4-F7: Plugin Manager.
 */

import { store } from '../store'

const REGISTRY_KEY = 'plugins.registry.v1'

export interface PluginDependency {
  name: string
  version: string
  optional: boolean
}

export interface PluginVersion {
  version: string
  installedAt: string
  updatedAt: string
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  dependencies: PluginDependency[]
  installedAt: string
  updatedAt: string
  enabled: boolean
  /** Plugin-provided contributions */
  contributes: {
    commands?: Array<{ id: string; label: string }>
    slashCommands?: Array<{ id: string; label: string; description?: string; insertText?: string; promptTemplate?: string }>
    skills?: Array<{ id: string; path: string }>
    prompts?: Array<{ id: string; name: string; body: string }>
    activityParsers?: Array<{ id: string; pattern: string; flags?: string; kind?: string; fields?: Record<string, string> }>
    preDispatchHooks?: Array<{ id: string; pattern?: string; appendContext?: string; denyMessage?: string; requireApproval?: boolean; message?: string }>
  }
}

function readRegistry(): InstalledPlugin[] {
  const raw: any = store.get(REGISTRY_KEY)
  return Array.isArray(raw) ? raw : []
}

function writeRegistry(plugins: InstalledPlugin[]): void {
  store.set(REGISTRY_KEY, plugins)
}

export function listInstalledPlugins(): InstalledPlugin[] {
  return readRegistry()
}

export function getInstalledPlugin(id: string): InstalledPlugin | null {
  return readRegistry().find(p => p.id === id) || null
}

export function installPlugin(manifest: { id: string; name: string; version: string; description?: string; author?: string; dependencies?: PluginDependency[]; contributes?: InstalledPlugin['contributes'] }): InstalledPlugin {
  const plugins = readRegistry()
  const existing = plugins.findIndex(p => p.id === manifest.id)
  const now = new Date().toISOString()
  const entry: InstalledPlugin = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    dependencies: manifest.dependencies || [],
    installedAt: existing >= 0 ? plugins[existing].installedAt : now,
    updatedAt: now,
    enabled: true,
    contributes: manifest.contributes || {}
  }
  if (existing >= 0) plugins[existing] = entry
  else plugins.push(entry)
  writeRegistry(plugins)
  return entry
}

export function uninstallPlugin(id: string): boolean {
  const plugins = readRegistry()
  const before = plugins.length
  const filtered = plugins.filter(p => p.id !== id)
  writeRegistry(filtered)
  return filtered.length < before
}

export function togglePlugin(id: string): boolean | null {
  const plugins = readRegistry()
  const plugin = plugins.find(p => p.id === id)
  if (!plugin) return null
  plugin.enabled = !plugin.enabled
  plugin.updatedAt = new Date().toISOString()
  writeRegistry(plugins)
  return plugin.enabled
}

/**
 * Get all contributions from enabled plugins.
 */
export function getEnabledContributions(): InstalledPlugin['contributes'] {
  const plugins = readRegistry().filter(p => p.enabled)
  const commands: Array<{ id: string; label: string }> = []
  const slashCommands: Array<{ id: string; label: string; description?: string; insertText?: string; promptTemplate?: string }> = []
  const skills: Array<{ id: string; path: string }> = []
  const prompts: Array<{ id: string; name: string; body: string }> = []
  const activityParsers: Array<{ id: string; pattern: string; flags?: string; kind?: string; fields?: Record<string, string> }> = []
  const preDispatchHooks: Array<{ id: string; pattern?: string; appendContext?: string; denyMessage?: string; requireApproval?: boolean; message?: string }> = []
  for (const p of plugins) {
    if (p.contributes.commands) commands.push(...p.contributes.commands)
    if (p.contributes.slashCommands) slashCommands.push(...p.contributes.slashCommands)
    if (p.contributes.skills) skills.push(...p.contributes.skills)
    if (p.contributes.prompts) prompts.push(...p.contributes.prompts)
    if (p.contributes.activityParsers) activityParsers.push(...p.contributes.activityParsers)
    if (p.contributes.preDispatchHooks) preDispatchHooks.push(...p.contributes.preDispatchHooks)
  }
  return { commands, slashCommands, skills, prompts, activityParsers, preDispatchHooks }
}
