import { existsSync, mkdirSync, rmSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { store } from "../store"
import { getWorkspaceManager } from "../hub/workspace"
import { gitCurrentBranch, gitIsDirty, runGit } from "./git"
import type { WorktreeItem } from "./types"

const STORAGE_KEY = "runtime.worktrees.v1"

interface WorktreeState {
  version: 1
  items: WorktreeItem[]
}

export function listWorktrees(parentWorkspaceId?: string | null): WorktreeItem[] {
  const state = read()
  const filtered = parentWorkspaceId ? state.items.filter(item => item.parentWorkspaceId === parentWorkspaceId) : state.items
  return filtered.map(item => ({ ...item, status: existsSync(item.path) ? item.status : "missing" }))
}

export async function createWorktree(input: { parentWorkspaceId: string; branch?: string; path?: string }): Promise<WorktreeItem> {
  const parent = getWorkspaceManager().getById(input.parentWorkspaceId)
  if (!parent) throw new Error("Parent workspace not found")
  const branchBase = sanitize(input.branch || `agenthub-${Date.now().toString(36)}`)
  const safeRoot = dirname(resolve(parent.rootPath))
  const targetPath = resolve(input.path?.trim() || join(safeRoot, `${basename(parent.rootPath)}-${branchBase}`))
  if (!isInside(targetPath, safeRoot)) throw new Error("Worktree path must stay next to the parent workspace.")
  if (existsSync(targetPath)) throw new Error(`Worktree path already exists: ${targetPath}`)
  mkdirSync(dirname(targetPath), { recursive: true })
  await runGit(parent.rootPath, ["worktree", "add", "-b", branchBase, targetPath])
  const item: WorktreeItem = {
    id: `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    parentWorkspaceId: parent.id,
    path: targetPath,
    branch: await gitCurrentBranch(targetPath),
    status: "clean",
    createdAt: Date.now()
  }
  const state = read()
  state.items.unshift(item)
  write(state)
  return item
}

export async function removeWorktree(id: string, force = false): Promise<boolean> {
  const state = read()
  const item = state.items.find(wt => wt.id === id)
  if (!item) return false
  const parent = getWorkspaceManager().getById(item.parentWorkspaceId)
  if (!parent) throw new Error("Parent workspace not found; refusing to remove worktree.")
  const safeRoot = dirname(resolve(parent.rootPath))
  if (!isInside(resolve(item.path), safeRoot)) throw new Error("Refusing to remove a worktree outside the managed root.")
  if (existsSync(item.path) && !force && await gitIsDirty(item.path)) {
    throw new Error("Worktree has uncommitted changes. Commit or pass force=true.")
  }
  if (parent && existsSync(parent.rootPath)) {
    try { await runGit(parent.rootPath, ["worktree", "remove", force ? "--force" : "", item.path].filter(Boolean)) } catch { /* remove manually below */ }
  }
  if (existsSync(item.path) && force) rmSync(item.path, { recursive: true, force: true })
  state.items = state.items.filter(wt => wt.id !== id)
  write(state)
  return true
}

export async function syncWorktree(id: string): Promise<WorktreeItem> {
  const state = read()
  const item = state.items.find(wt => wt.id === id)
  if (!item) throw new Error("Worktree not found")
  if (!existsSync(item.path)) {
    item.status = "missing"
  } else {
    await runGit(item.path, ["fetch", "--all", "--prune"]).catch(() => ({ stdout: "", stderr: "" }))
    item.status = await gitIsDirty(item.path) ? "dirty" : "clean"
    item.branch = await gitCurrentBranch(item.path)
  }
  write(state)
  return item
}

export async function openWorktree(id: string): Promise<any> {
  const item = listWorktrees().find(wt => wt.id === id)
  if (!item) throw new Error("Worktree not found")
  const manager = getWorkspaceManager()
  const existing = manager.list().find(ws => ws.rootPath === item.path)
  if (existing) {
    manager.setActive(existing.id)
    return existing
  }
  const created = manager.create({ name: basename(item.path), rootPath: item.path })
  manager.setActive(created.id)
  return created
}

function read(): WorktreeState {
  const raw = store.get(STORAGE_KEY)
  return raw && typeof raw === "object" && Array.isArray((raw as any).items)
    ? { version: 1, items: (raw as any).items }
    : { version: 1, items: [] }
}

function write(state: WorktreeState): void {
  store.set(STORAGE_KEY, state)
}

function sanitize(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "") || `agenthub-${Date.now().toString(36)}`
}

function isInside(targetPath: string, rootPath: string): boolean {
  const root = resolve(rootPath)
  const target = resolve(targetPath)
  const sep = process.platform === 'win32' ? '\\' : '/'
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}
