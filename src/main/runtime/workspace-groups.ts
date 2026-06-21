/**
 * WorkspaceGroups: multi-workspace management with groups.
 *
 * Groups allow organizing multiple workspaces into logical sets
 * (e.g., "Frontend", "Backend", "Infrastructure").
 *
 * Phase 3.3: Workspace enhancement.
 */

import { store } from '../store'

const STORAGE_KEY = 'workspace.groups.v1'

export interface WorkspaceGroup {
  id: string
  name: string
  color?: string
  workspaceIds: string[]
  createdAt: string
  updatedAt: string
}

function readGroups(): WorkspaceGroup[] {
  const raw: any = store.get(STORAGE_KEY)
  return Array.isArray(raw) ? raw.filter((g: any) => g?.id && g?.name) : []
}

function writeGroups(groups: WorkspaceGroup[]): void {
  store.set(STORAGE_KEY, groups)
}

export function listGroups(): WorkspaceGroup[] {
  return readGroups()
}

export function getGroup(id: string): WorkspaceGroup | null {
  return readGroups().find(g => g.id === id) || null
}

export function createGroup(name: string, workspaceIds: string[] = [], color?: string): WorkspaceGroup {
  const groups = readGroups()
  const group: WorkspaceGroup = {
    id: `wg-${Date.now().toString(36)}`,
    name,
    color,
    workspaceIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  groups.push(group)
  writeGroups(groups)
  return group
}

export function updateGroup(id: string, patch: Partial<Pick<WorkspaceGroup, 'name' | 'color' | 'workspaceIds'>>): WorkspaceGroup | null {
  const groups = readGroups()
  const group = groups.find(g => g.id === id)
  if (!group) return null
  if (patch.name !== undefined) group.name = patch.name
  if (patch.color !== undefined) group.color = patch.color
  if (patch.workspaceIds !== undefined) group.workspaceIds = patch.workspaceIds
  group.updatedAt = new Date().toISOString()
  writeGroups(groups)
  return group
}

export function deleteGroup(id: string): boolean {
  const groups = readGroups()
  const filtered = groups.filter(g => g.id !== id)
  if (filtered.length === groups.length) return false
  writeGroups(filtered)
  return true
}

export function addWorkspaceToGroup(groupId: string, workspaceId: string): boolean {
  const groups = readGroups()
  const group = groups.find(g => g.id === groupId)
  if (!group) return false
  if (!group.workspaceIds.includes(workspaceId)) {
    group.workspaceIds.push(workspaceId)
    group.updatedAt = new Date().toISOString()
    writeGroups(groups)
  }
  return true
}

export function removeWorkspaceFromGroup(groupId: string, workspaceId: string): boolean {
  const groups = readGroups()
  const group = groups.find(g => g.id === groupId)
  if (!group) return false
  const idx = group.workspaceIds.indexOf(workspaceId)
  if (idx >= 0) {
    group.workspaceIds.splice(idx, 1)
    group.updatedAt = new Date().toISOString()
    writeGroups(groups)
    return true
  }
  return false
}
