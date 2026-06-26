import { ipcMain, app } from 'electron'
import { resolve } from 'node:path'
import { createWorktree, listWorktrees, openWorktree, removeWorktree, syncWorktree } from '../runtime/worktrees'
import { listWorkspaceFiles, searchWorkspaceFiles, readFilePreview } from '../runtime/workspace-files'
import { getWorkspaceManager, WorkspaceNotFoundError, WorkspacePathInvalidError } from '../hub/workspace'

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
    // Validate workspace path is an absolute path (not traversal)
    if (!rootPath || rootPath.includes('..')) throw new Error('Invalid workspace path')
    return listWorkspaceFiles(rootPath, max)
  })
  ipcMain.handle("workspaceFiles:search", (_e, rootPath: string, query: string, max?: number) => {
    if (!rootPath || rootPath.includes('..')) throw new Error('Invalid workspace path')
    return searchWorkspaceFiles(rootPath, query, max)
  })
  ipcMain.handle("workspaceFiles:preview", (_e, filePath: string, maxLines?: number) => {
    if (filePath.includes('..')) return { ok: false, error: 'Invalid path: traversal not allowed' }
    // Validate absolute path is within workspace root or user directory
    const resolved = resolve(filePath)
    const activeId = getWorkspaceManager()?.getActive()
    const ws = activeId ? getWorkspaceManager()?.getById(activeId) : null
    const root = ws?.rootPath
    if (root && !resolved.startsWith(root)) {
      const home = app.getPath('home')
      if (!resolved.startsWith(home)) return { ok: false, error: 'Access denied: path outside allowed directories' }
    }
    return readFilePreview(resolved, maxLines)
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
