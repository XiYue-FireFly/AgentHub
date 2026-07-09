import { app } from 'electron'
import { resolve, join } from 'node:path'
import * as fs from 'node:fs/promises'
import { createWorktree, listWorktrees, openWorktree, removeWorktree, syncWorktree } from '../runtime/worktrees'
import { listWorkspaceFiles, searchWorkspaceFiles, readFilePreview } from '../runtime/workspace-files'
import { getWorkspaceManager, WorkspaceNotFoundError, WorkspacePathInvalidError } from '../hub/workspace'
import { isPathInsideBase, resolveWorkspaceRelativePath } from './path-guards'
import { resolvePathInRegisteredWorkspace, resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
import { isSensitiveTextFilePath } from './sensitive-files'
import { typedHandle } from './typed-ipc'

/** Validate that a relative path stays within the workspace root. */
function validateWorkspacePath(workspaceRoot: string, relativePath: string): string | null {
  const registeredRoot = resolveRegisteredWorkspaceRoot(workspaceRoot)
  if (!registeredRoot) return null
  return resolveWorkspaceRelativePath(registeredRoot, relativePath)
}

function serialiseWsError(e: unknown): Error {
  if (e instanceof WorkspaceNotFoundError || e instanceof WorkspacePathInvalidError) {
    const err = new Error(e.message); (err as any).code = (e as any).code; return err
  }
  return e as Error
}

export function registerWorkspaceIpc(): void {
  typedHandle("worktrees:list", (_event, parentWorkspaceId) => listWorktrees(parentWorkspaceId))
  typedHandle("worktrees:create", (_event, input) => createWorktree(input))
  typedHandle("worktrees:remove", (_event, id, force) => removeWorktree(id, !!force))
  typedHandle("worktrees:sync", (_event, id) => syncWorktree(id))
  typedHandle("worktrees:open", (_event, id) => openWorktree(id))

  typedHandle("workspaceFiles:list", async (_e, rootPath, max) => {
    const directoryPath = resolvePathInRegisteredWorkspace(rootPath)
    if (!directoryPath) return []
    return listWorkspaceFiles(directoryPath, max)
  })
  typedHandle("workspaceFiles:search", async (_e, rootPath, query, max) => {
    const directoryPath = resolvePathInRegisteredWorkspace(rootPath)
    if (!directoryPath) return []
    return searchWorkspaceFiles(directoryPath, query, max)
  })
  typedHandle("workspaceFiles:preview", async (_e, filePath, maxLines) => {
    const resolved = resolve(filePath)
    const activeId = getWorkspaceManager()?.getActive()
    const ws = activeId ? getWorkspaceManager()?.getById(activeId) : null
    const root = ws?.rootPath
    const home = app.getPath('home')
    const inWorkspace = root && isPathInsideBase(resolved, root)
    const inHome = isPathInsideBase(resolved, home)
    if (!inWorkspace && !inHome) {
      return { ok: false, error: 'Access denied: path outside allowed directories' }
    }
    if (isSensitiveTextFilePath(resolved)) {
      return { ok: false, error: 'Access denied: sensitive file' }
    }
    return readFilePreview(resolved, maxLines)
  })

  // --- SDD: Workspace file read/write/list/image ---
  typedHandle("workspaceFiles:read", async (_e, workspaceRoot, relPath) => {
    const absPath = validateWorkspacePath(workspaceRoot, relPath)
    if (!absPath) return { ok: false, content: '', path: '', error: 'Invalid path' }
    if (isSensitiveTextFilePath(absPath)) {
      return { ok: false, content: '', path: '', error: 'Access denied: sensitive file' }
    }
    try {
      const content = await fs.readFile(absPath, 'utf-8')
      return { ok: true, content, path: absPath }
    } catch {
      return { ok: false, content: '', path: '', error: 'File not found' }
    }
  })

  typedHandle("workspaceFiles:write", async (_e, workspaceRoot, relPath, content) => {
    const absPath = validateWorkspacePath(workspaceRoot, relPath)
    if (!absPath) return { ok: false, error: 'Invalid path' }
    try {
      await fs.mkdir(join(absPath, '..'), { recursive: true })
      await fs.writeFile(absPath, content, 'utf-8')
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: `Write failed: ${err?.message ?? 'unknown'}` }
    }
  })

  typedHandle("workspaceFiles:readImage", async (_e, workspaceRoot, relPath) => {
    const absPath = validateWorkspacePath(workspaceRoot, relPath)
    if (!absPath) return { ok: false, dataUrl: '', mimeType: '', size: 0, error: 'Invalid path' }
    try {
      const buffer = await fs.readFile(absPath)
      const ext = absPath.toLowerCase().split('.').pop() || ''
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp'
      }
      const mimeType = mimeMap[ext] || 'application/octet-stream'
      return { ok: true, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`, mimeType, size: buffer.length }
    } catch {
      return { ok: false, dataUrl: '', mimeType: '', size: 0, error: 'Image not found' }
    }
  })

  typedHandle("workspaceFiles:listDirectory", async (_e, workspaceRoot, relPath) => {
    const registeredRoot = resolveRegisteredWorkspaceRoot(workspaceRoot)
    const absPath = registeredRoot ? resolveWorkspaceRelativePath(registeredRoot, relPath, { allowRoot: true }) : null
    if (!absPath) return { ok: false, entries: [], error: 'Invalid path' }
    try {
      const dirents = await fs.readdir(absPath, { withFileTypes: true })
      const entries = dirents.map(d => ({
        name: d.name,
        type: d.isDirectory() ? 'directory' as const : 'file' as const,
        path: join(relPath, d.name).replaceAll('\\', '/')
      }))
      return { ok: true, entries }
    } catch {
      return { ok: false, entries: [], error: 'Directory not found' }
    }
  })

  typedHandle("workspaces:list", () => getWorkspaceManager().list())
  typedHandle("workspaces:create", (_e, input) => {
    try { return getWorkspaceManager().create(input) } catch (e) { throw serialiseWsError(e) }
  })
  typedHandle("workspaces:update", (_e, id, patch) => {
    try { return getWorkspaceManager().update(id, patch) } catch (e) { throw serialiseWsError(e) }
  })
  typedHandle("workspaces:remove", (_e, id) => {
    try { return getWorkspaceManager().remove(id) } catch (e) { throw serialiseWsError(e) }
  })
  typedHandle("workspaces:getActive", () => getWorkspaceManager().getActive())
  typedHandle("workspaces:setActive", (_e, id) => {
    try { getWorkspaceManager().setActive(id); return getWorkspaceManager().getActive() } catch (e) { throw serialiseWsError(e) }
  })
}
