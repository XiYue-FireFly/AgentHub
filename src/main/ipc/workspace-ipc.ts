import { ipcMain, app } from 'electron'
import { resolve, join } from 'node:path'
import * as fs from 'node:fs/promises'
import { createWorktree, listWorktrees, openWorktree, removeWorktree, syncWorktree } from '../runtime/worktrees'
import { listWorkspaceFiles, searchWorkspaceFiles, readFilePreview } from '../runtime/workspace-files'
import { getWorkspaceManager, WorkspaceNotFoundError, WorkspacePathInvalidError } from '../hub/workspace'
import { isPathInsideBase, resolveWorkspaceRelativePath } from './path-guards'

/** Validate that a relative path stays within the workspace root. */
function validateWorkspacePath(workspaceRoot: string, relativePath: string): string | null {
  return resolveWorkspaceRelativePath(workspaceRoot, relativePath)
}

function serialiseWsError(e: unknown): Error {
  if (e instanceof WorkspaceNotFoundError || e instanceof WorkspacePathInvalidError) {
    const err = new Error(e.message); (err as any).code = (e as any).code; return err
  }
  return e as Error
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle("worktrees:list", (_event, parentWorkspaceId?: string | null) => listWorktrees(parentWorkspaceId))
  ipcMain.handle("worktrees:create", (_event, input: { parentWorkspaceId: string; branch?: string; path?: string }) => createWorktree(input))
  ipcMain.handle("worktrees:remove", (_event, id: string, force?: boolean) => removeWorktree(id, !!force))
  ipcMain.handle("worktrees:sync", (_event, id: string) => syncWorktree(id))
  ipcMain.handle("worktrees:open", (_event, id: string) => openWorktree(id))

  ipcMain.handle("workspaceFiles:list", (_e, rootPath: string, max?: number) => {
    if (!rootPath) throw new Error('Invalid workspace path')
    return listWorkspaceFiles(rootPath, max)
  })
  ipcMain.handle("workspaceFiles:search", (_e, rootPath: string, query: string, max?: number) => {
    if (!rootPath) throw new Error('Invalid workspace path')
    return searchWorkspaceFiles(rootPath, query, max)
  })
  ipcMain.handle("workspaceFiles:preview", (_e, filePath: string, maxLines?: number) => {
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
    return readFilePreview(resolved, maxLines)
  })

  // --- SDD: Workspace file read/write/list/image ---
  ipcMain.handle("workspaceFiles:read", async (_e, workspaceRoot: string, relPath: string) => {
    const absPath = validateWorkspacePath(workspaceRoot, relPath)
    if (!absPath) return { ok: false, content: '', path: '', error: 'Invalid path' }
    try {
      const content = await fs.readFile(absPath, 'utf-8')
      return { ok: true, content, path: absPath }
    } catch {
      return { ok: false, content: '', path: '', error: 'File not found' }
    }
  })

  ipcMain.handle("workspaceFiles:write", async (_e, workspaceRoot: string, relPath: string, content: string) => {
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

  ipcMain.handle("workspaceFiles:readImage", async (_e, workspaceRoot: string, relPath: string) => {
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

  ipcMain.handle("workspaceFiles:listDirectory", async (_e, workspaceRoot: string, relPath: string) => {
    const absPath = validateWorkspacePath(workspaceRoot, relPath)
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

  ipcMain.handle("workspaces:list", () => getWorkspaceManager().list())
  ipcMain.handle("workspaces:create", (_e, input: { name: string; rootPath: string }) => {
    try { return getWorkspaceManager().create(input) } catch (e) { throw serialiseWsError(e) }
  })
  ipcMain.handle("workspaces:update", (_e, id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) => {
    try { return getWorkspaceManager().update(id, patch) } catch (e) { throw serialiseWsError(e) }
  })
  ipcMain.handle("workspaces:remove", (_e, id: string) => {
    try { return getWorkspaceManager().remove(id) } catch (e) { throw serialiseWsError(e) }
  })
  ipcMain.handle("workspaces:getActive", () => getWorkspaceManager().getActive())
  ipcMain.handle("workspaces:setActive", (_e, id: string | null) => {
    try { getWorkspaceManager().setActive(id); return getWorkspaceManager().getActive() } catch (e) { throw serialiseWsError(e) }
  })
}
