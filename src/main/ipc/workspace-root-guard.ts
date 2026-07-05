import { resolve } from 'node:path'
import { getWorkspaceManager } from '../hub/workspace'
import { isPathInsideBase } from './path-guards'

export function isValidIpcPathString(pathText: unknown): pathText is string {
  return typeof pathText === 'string' && pathText.trim().length > 0 && !pathText.includes('\0')
}

function sameResolvedPath(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  if (process.platform === 'win32') return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
  return resolvedLeft === resolvedRight
}

export function resolveRegisteredWorkspaceRoot(workspaceRoot: string): string | null {
  if (!isValidIpcPathString(workspaceRoot)) return null
  const registered = getWorkspaceManager()
    .list()
    .find(workspace => sameResolvedPath(workspace.rootPath, workspaceRoot))
  return registered ? resolve(registered.rootPath) : null
}

export function resolvePathInRegisteredWorkspace(pathText: string): string | null {
  if (!isValidIpcPathString(pathText)) return null
  const requestedPath = resolve(pathText)
  const workspace = getWorkspaceManager()
    .list()
    .find(item => isPathInsideBase(requestedPath, item.rootPath))
  return workspace ? requestedPath : null
}

export function assertRegisteredWorkspaceRoot(workspaceRoot: string): string {
  const registeredRoot = resolveRegisteredWorkspaceRoot(workspaceRoot)
  if (!registeredRoot) throw new Error('Access denied: workspace root is not registered')
  return registeredRoot
}
