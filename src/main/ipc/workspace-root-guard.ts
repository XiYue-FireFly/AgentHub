import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { realpathSync, statSync } from 'node:fs'
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

function isRealPathInsideBase(basePath: string, targetPath: string): boolean {
  let baseReal: string
  try { baseReal = realpathSync(basePath) } catch { return true }
  let current = targetPath
  for (let i = 0; i < 64; i++) {
    try {
      statSync(current)
      const targetReal = realpathSync(current)
      const rel = relative(baseReal, targetReal)
      return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('../') && !isAbsolute(rel))
    } catch {
      const parent = dirname(current)
      if (parent === current) return false
      current = parent
    }
  }
  return false
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
    .find(item => isPathInsideBase(requestedPath, item.rootPath) && isRealPathInsideBase(item.rootPath, requestedPath))
  return workspace ? requestedPath : null
}

export function isPathRealpathInsideBase(basePath: string, targetPath: string): boolean {
  if (!isValidIpcPathString(basePath) || !isValidIpcPathString(targetPath)) return false
  return isPathInsideBase(resolve(targetPath), resolve(basePath)) && isRealPathInsideBase(basePath, resolve(targetPath))
}

export function assertRegisteredWorkspaceRoot(workspaceRoot: string): string {
  const registeredRoot = resolveRegisteredWorkspaceRoot(workspaceRoot)
  if (!registeredRoot) throw new Error('Access denied: workspace root is not registered')
  return registeredRoot
}
