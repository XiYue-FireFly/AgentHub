/**
 * TeamBuilder: multi-agent team configuration.
 *
 * Defines agent team roles (main, router, reviewer, executor, gatekeeper,
 * summarizer, expert) and manages team presets for Firefly scheduling.
 *
 * P4-F5: Team Builder.
 */

import { store } from '../store'

const TEAMS_KEY = 'teams.presets.v1'

export type TeamRole = 'main' | 'router' | 'reviewer' | 'executor' | 'gatekeeper' | 'summarizer' | 'expert'

export interface TeamMember {
  role: TeamRole
  agentId: string
  /** Custom system prompt override for this role */
  systemPrompt?: string
}

export interface TeamPreset {
  id: string
  name: string
  description: string
  members: TeamMember[]
  createdAt: string
  updatedAt: string
  useCount: number
}

function readPresets(): TeamPreset[] {
  const raw: any = store.get(TEAMS_KEY)
  return Array.isArray(raw) ? raw : []
}

function writePresets(presets: TeamPreset[]): void {
  store.set(TEAMS_KEY, presets)
}

export function listTeamPresets(): TeamPreset[] {
  return readPresets()
}

export function getTeamPreset(id: string): TeamPreset | null {
  return readPresets().find(p => p.id === id) || null
}

export function saveTeamPreset(input: Partial<TeamPreset> & { name: string; members: TeamMember[] }): TeamPreset {
  const presets = readPresets()
  const now = new Date().toISOString()
  const id = input.id || `team-${Date.now().toString(36)}`
  const existing = presets.findIndex(p => p.id === id)
  const entry: TeamPreset = {
    id,
    name: input.name,
    description: input.description || '',
    members: input.members,
    createdAt: existing >= 0 ? presets[existing].createdAt : now,
    updatedAt: now,
    useCount: existing >= 0 ? presets[existing].useCount : 0
  }
  if (existing >= 0) presets[existing] = entry
  else presets.push(entry)
  writePresets(presets)
  return entry
}

export function deleteTeamPreset(id: string): boolean {
  const presets = readPresets()
  const before = presets.length
  const next = presets.filter(p => p.id !== id)
  writePresets(next)
  return next.length < before
}

/**
 * Get the default Firefly five-role team for a set of available agents.
 */
export function getDefaultFireflyTeam(availableAgentIds: string[]): TeamMember[] {
  const pick = (idx: number) => availableAgentIds[idx % availableAgentIds.length] || 'default'
  return [
    { role: 'router', agentId: pick(0) },
    { role: 'main', agentId: pick(0) },
    { role: 'reviewer', agentId: pick(1) },
    { role: 'executor', agentId: pick(0) },
    { role: 'gatekeeper', agentId: pick(1) }
  ]
}
