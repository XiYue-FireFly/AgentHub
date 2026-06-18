import { execFile } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"
import { getWorkspaceManager } from "../hub/workspace"
import type {
  GitBranch,
  GitBranchListResponse,
  GitCommitDetails,
  GitCommitDiff,
  GitFileDiff,
  GitFileStatus,
  GitLogEntry,
  GitLogResponse,
  GitStatus
} from "./types"

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 10 * 1024 * 1024
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".ico"])

export async function gitStatus(workspaceId?: string | null): Promise<GitStatus> {
  const rootPath = workspaceRoot(workspaceId)
  if (!rootPath) return emptyStatus(workspaceId ?? null, null, "使用 Git 前请先选择工作目录。")
  try {
    await git(rootPath, ["rev-parse", "--is-inside-work-tree"])
    const [branchOut, porcelainOut, upstreamOut] = await Promise.all([
      git(rootPath, ["status", "--short", "--branch"]),
      git(rootPath, ["status", "--porcelain=v1", "-z"]),
      git(rootPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => ({ stdout: "", stderr: "" }))
    ])
    return await parseStatus(workspaceId ?? null, rootPath, branchOut.stdout, porcelainOut.stdout, upstreamOut.stdout.trim())
  } catch (e: any) {
    return emptyStatus(workspaceId ?? null, rootPath, cleanGitError(e))
  }
}

export async function gitBranches(workspaceId?: string | null): Promise<GitBranchListResponse> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await ensureGitRepo(rootPath)
  const currentBranch = await gitCurrentBranch(rootPath)
  const { stdout } = await git(rootPath, [
    "for-each-ref",
    "--format=%(refname)|%(refname:short)|%(HEAD)|%(objectname:short)|%(committerdate:unix)|%(upstream:short)",
    "refs/heads",
    "refs/remotes"
  ])
  const localBranches: GitBranch[] = []
  const remoteBranches: GitBranch[] = []
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const [refname, shortName, head, shortSha, timestamp, upstream] = line.split("|")
    if (!shortName || shortName.endsWith("/HEAD")) continue
    const isRemote = refname.startsWith("refs/remotes/")
    const branch: GitBranch = {
      name: shortName,
      current: head === "*",
      isCurrent: head === "*" || (!isRemote && shortName === currentBranch),
      isRemote,
      remote: isRemote ? shortName.split("/")[0] || null : null,
      upstream: upstream || null,
      headSha: shortSha || null,
      lastCommit: Number(timestamp || 0),
      ahead: 0,
      behind: 0
    }
    if (!isRemote && upstream) {
      const counts = await aheadBehind(rootPath, shortName, upstream)
      branch.ahead = counts.ahead
      branch.behind = counts.behind
    }
    if (isRemote) remoteBranches.push(branch)
    else localBranches.push(branch)
  }
  localBranches.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.name.localeCompare(b.name))
  remoteBranches.sort((a, b) => a.name.localeCompare(b.name))
  return {
    branches: localBranches.map(branch => ({ name: branch.name, current: branch.isCurrent })),
    localBranches,
    remoteBranches,
    currentBranch: currentBranch === "detached" ? null : currentBranch,
    repositoryState: "git_repository"
  }
}

export async function gitDiffs(workspaceId?: string | null): Promise<GitFileDiff[]> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await ensureGitRepo(rootPath)
  const status = await gitStatus(workspaceId)
  const paths = unique(status.files.map(file => file.path))
  const diffs = await Promise.all(paths.map(path => gitDiffEntry(rootPath, path)))
  return diffs.filter(Boolean) as GitFileDiff[]
}

export async function gitCheckoutBranch(workspaceId: string | null | undefined, branch: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const name = normalizeBranchName(branch)
  if (await gitIsDirty(rootPath)) {
    throw new Error("工作区存在未提交变更。请先提交、暂存或丢弃变更后再切换分支。")
  }
  await git(rootPath, ["checkout", name])
  await verifyCurrentBranch(rootPath, name)
  return gitStatus(workspaceId)
}

export async function gitCreateBranch(workspaceId: string | null | undefined, branch: string, checkout = true): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const name = normalizeBranchName(branch)
  if (checkout) {
    if (await gitIsDirty(rootPath)) {
      throw new Error("工作区存在未提交变更。请先提交、暂存或丢弃变更后再创建并切换分支。")
    }
    await git(rootPath, ["checkout", "-b", name])
    await verifyCurrentBranch(rootPath, name)
  } else {
    await git(rootPath, ["branch", name])
  }
  return gitStatus(workspaceId)
}

export async function gitRenameBranch(workspaceId: string | null | undefined, oldName: string, newName: string): Promise<GitBranchListResponse> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await ensureGitRepo(rootPath)
  await git(rootPath, ["branch", "-m", normalizeBranchName(oldName), normalizeBranchName(newName)])
  return gitBranches(workspaceId)
}

export async function gitDeleteBranch(workspaceId: string | null | undefined, branch: string, force = false): Promise<GitBranchListResponse> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await ensureGitRepo(rootPath)
  const name = normalizeBranchName(branch)
  const current = await gitCurrentBranch(rootPath)
  if (current === name) throw new Error("不能删除当前分支。请先切换到其他分支。")
  await git(rootPath, ["branch", force ? "-D" : "-d", name])
  return gitBranches(workspaceId)
}

export async function gitStageFile(workspaceId: string | null | undefined, filePath: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  for (const path of await actionPathsForFile(rootPath, filePath)) {
    await git(rootPath, ["add", "-A", "--", path])
  }
  return gitStatus(workspaceId)
}

export async function gitStageAll(workspaceId: string | null | undefined): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await git(rootPath, ["add", "-A"])
  return gitStatus(workspaceId)
}

export async function gitUnstageFile(workspaceId: string | null | undefined, filePath: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  for (const path of await actionPathsForFile(rootPath, filePath)) {
    await git(rootPath, ["restore", "--staged", "--", path])
  }
  return gitStatus(workspaceId)
}

export async function gitRevertFile(workspaceId: string | null | undefined, filePath: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  for (const path of await actionPathsForFile(rootPath, filePath)) {
    try {
      await git(rootPath, ["restore", "--staged", "--worktree", "--", path])
    } catch {
      await git(rootPath, ["clean", "-f", "--", path])
    }
  }
  return gitStatus(workspaceId)
}

export async function gitRevertAll(workspaceId: string | null | undefined): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await git(rootPath, ["restore", "--staged", "--worktree", "--", "."]).catch(() => null)
  await git(rootPath, ["clean", "-f", "-d"]).catch(() => null)
  return gitStatus(workspaceId)
}

export async function gitLog(workspaceId?: string | null, limit = 30): Promise<GitLogResponse> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await ensureGitRepo(rootPath)
  const max = Math.max(1, Math.min(limit, 200))
  const { stdout } = await git(rootPath, [
    "log",
    `-${max}`,
    "--date=unix",
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%B%x1e"
  ])
  const entries = parseLogEntries(stdout)
  const upstream = (await git(rootPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => ({ stdout: "", stderr: "" }))).stdout.trim() || null
  const counts = upstream ? await aheadBehind(rootPath, "HEAD", upstream) : { ahead: 0, behind: 0 }
  return {
    entries,
    total: entries.length,
    ahead: counts.ahead,
    behind: counts.behind,
    aheadEntries: upstream ? await logRange(rootPath, `${upstream}..HEAD`, 20) : [],
    behindEntries: upstream ? await logRange(rootPath, `HEAD..${upstream}`, 20) : [],
    upstream
  }
}

export async function gitCommitDetails(workspaceId: string | null | undefined, sha: string): Promise<GitCommitDetails> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const rev = normalizeCommitRef(sha)
  const { stdout } = await git(rootPath, ["show", "--date=unix", "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%at%x1f%ct%x1f%P%x1f%s%x1f%B", "--name-status", "--numstat", "--no-renames", rev])
  const [metaBlock, ...rest] = stdout.split(/\r?\n\r?\n/)
  const meta = metaBlock.split("\x1f")
  const files = parseCommitFiles(rest.join("\n"))
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0)
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0)
  return {
    sha: meta[0] || rev,
    shortSha: meta[1] || rev.slice(0, 7),
    summary: meta[9] || "",
    message: meta.slice(10).join("\x1f").trim() || meta[9] || "",
    author: meta[2] || "",
    authorEmail: meta[3] || "",
    committer: meta[4] || "",
    committerEmail: meta[5] || "",
    authorTime: Number(meta[6] || 0),
    commitTime: Number(meta[7] || 0),
    parents: (meta[8] || "").split(/\s+/).filter(Boolean),
    files,
    totalAdditions,
    totalDeletions
  }
}

export async function gitCommitDiff(workspaceId: string | null | undefined, sha: string, filePath?: string): Promise<GitCommitDiff[]> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const rev = normalizeCommitRef(sha)
  const args = ["show", "--format=", "--no-color", "--find-renames", rev]
  if (filePath) args.push("--", filePath)
  const { stdout } = await git(rootPath, args)
  return splitDiffByFile(stdout).map(diff => ({ ...diff, status: diff.status || inferStatusFromDiff(diff.diff) }))
}

export async function gitDiff(workspaceId?: string | null, filePath?: string): Promise<string> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const paths = filePath ? [filePath] : []
  const [cached, working] = await Promise.all([
    git(rootPath, ["diff", "--cached", "--", ...paths]).catch(e => ({ stdout: cleanGitError(e), stderr: "" })),
    git(rootPath, ["diff", "--", ...paths]).catch(e => ({ stdout: cleanGitError(e), stderr: "" }))
  ])
  const sections = [
    cached.stdout.trim() ? `# 已暂存\n${cached.stdout}` : "",
    working.stdout.trim() ? `# 未暂存\n${working.stdout}` : ""
  ]
  if (filePath && await isUntracked(rootPath, filePath)) {
    sections.push(untrackedPreview(rootPath, filePath))
  }
  return sections.filter(Boolean).join("\n")
}

export async function gitCommit(workspaceId: string | null | undefined, message: string, filePaths?: string[]): Promise<{ hash: string }> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const msg = message.trim()
  if (!msg) throw new Error("提交消息不能为空。")
  const before = await gitStatus(workspaceId)
  const selected = normalizeCommitSelections(filePaths, before)
  const selectedSet = new Set([...selected.stagedOnly, ...selected.includeWorktree])
  const previouslyStaged = unique(before.stagedFiles.map(file => file.path))
  const stagedToRestore = previouslyStaged.filter(path => !selectedSet.has(path))

  try {
    for (const filePath of stagedToRestore) {
      await gitUnstageFile(workspaceId, filePath)
    }
    for (const filePath of selected.includeWorktree) {
      await gitStageFile(workspaceId, filePath)
    }
    const status = await gitStatus(workspaceId)
    const stagedSelected = status.stagedFiles.filter(file => selectedSet.has(file.path))
    if (stagedSelected.length === 0) throw new Error("没有已暂存的变更可提交。")
    await git(rootPath, ["commit", "-m", msg])
    const { stdout } = await git(rootPath, ["rev-parse", "--short", "HEAD"])
    return { hash: stdout.trim() }
  } finally {
    const after = await gitStatus(workspaceId).catch(() => null)
    if (after?.isRepo) {
      for (const filePath of stagedToRestore) {
        if (after.files.some(file => file.path === filePath)) {
          await gitStageFile(workspaceId, filePath).catch(() => null)
        }
      }
    }
  }
}

export async function gitFetch(workspaceId: string | null | undefined, remote?: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const args = remote?.trim() ? ["fetch", normalizeRemoteName(remote)] : ["fetch", "--all", "--prune"]
  await git(rootPath, args)
  return gitStatus(workspaceId)
}

export async function gitPull(workspaceId: string | null | undefined, remote?: string, branch?: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const args = ["pull"]
  if (remote?.trim()) args.push(normalizeRemoteName(remote))
  if (branch?.trim()) args.push(normalizeBranchName(branch.trim()))
  await git(rootPath, args)
  return gitStatus(workspaceId)
}

export async function gitPush(workspaceId: string | null | undefined, remote?: string, branch?: string): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const args = ["push"]
  if (remote?.trim()) args.push(normalizeRemoteName(remote))
  if (branch?.trim()) args.push(normalizeBranchName(branch.trim()))
  await git(rootPath, args)
  return gitStatus(workspaceId)
}

export async function gitSync(workspaceId: string | null | undefined): Promise<GitStatus> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  await git(rootPath, ["pull"])
  await git(rootPath, ["push"])
  return gitStatus(workspaceId)
}

export async function gitUpdateBranch(workspaceId: string | null | undefined, branch: string): Promise<{ branch: string; status: "success" | "no-op" | "blocked"; message: string }> {
  const rootPath = requireWorkspaceRoot(workspaceId)
  const name = normalizeBranchName(branch)
  const branches = await gitBranches(workspaceId)
  const target = branches.localBranches.find(item => item.name === name)
  if (!target) throw new Error(`未找到分支：${name}`)
  if (!target.upstream) return { branch: name, status: "blocked", message: "这个分支没有上游分支。" }
  if (target.ahead > 0 && target.behind > 0) return { branch: name, status: "blocked", message: "这个分支已经分叉，请手动处理合并或变基。" }
  if (target.behind === 0) return { branch: name, status: "no-op", message: "分支已经是最新状态。" }
  if (target.isCurrent) {
    await git(rootPath, ["pull"])
  } else {
    await git(rootPath, ["fetch", target.remote || target.upstream.split("/")[0] || "origin"])
    await git(rootPath, ["branch", "-f", name, target.upstream])
  }
  return { branch: name, status: "success", message: "分支已更新。" }
}

export async function runGitQuery(workspaceId?: string | null, query?: string): Promise<string> {
  requireWorkspaceRoot(workspaceId)
  const raw = String(query || "").trim()
  const [head, ...rest] = raw.split(/\s+/)
  const command = (head || "status").toLowerCase()
  const tail = rest.join(" ").trim()

  if (command === "status" || command === "st") return formatStatus(await gitStatus(workspaceId))
  if (command === "branches" || command === "branch") {
    const response = await gitBranches(workspaceId)
    return [
      "# Git branches",
      ...response.localBranches.map(branch => `${branch.isCurrent ? "* " : "- "}${branch.name}${branch.upstream ? ` -> ${branch.upstream}` : ""}`),
      "",
      "# Remote branches",
      ...response.remoteBranches.map(branch => `- ${branch.name}`)
    ].join("\n")
  }
  if (command === "log") {
    const log = await gitLog(workspaceId, 12)
    return ["# Git log", ...log.entries.map(entry => `- ${entry.shortSha} ${entry.summary} (${entry.author})`)].join("\n")
  }
  if (command === "diff" || command === "show") return await gitDiff(workspaceId, tail || undefined)
  if (command === "summary") {
    const status = await gitStatus(workspaceId)
    const log = await gitLog(workspaceId, 5).catch(() => ({ entries: [] }))
    return [
      formatStatus(status),
      "",
      "# Recent commits",
      ...log.entries.map(entry => `- ${entry.shortSha} ${entry.summary}`)
    ].join("\n")
  }
  return [
    "# Git query",
    `Command: ${raw || "status"}`,
    "",
    await gitDiff(workspaceId).catch(() => ""),
    "",
    formatStatus(await gitStatus(workspaceId))
  ].join("\n")
}

export async function gitCurrentBranch(rootPath: string): Promise<string> {
  try {
    const { stdout } = await git(rootPath, ["branch", "--show-current"])
    return stdout.trim() || "detached"
  } catch {
    return "unknown"
  }
}

export async function gitIsDirty(rootPath: string): Promise<boolean> {
  try {
    const { stdout } = await git(rootPath, ["status", "--porcelain"])
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function runGit(rootPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return git(rootPath, args)
}

function workspaceRoot(workspaceId?: string | null): string | null {
  const manager = getWorkspaceManager()
  const id = workspaceId ?? manager.getActive()
  const workspace = id ? manager.getById(id) : null
  return workspace?.rootPath && existsSync(workspace.rootPath) ? workspace.rootPath : null
}

function requireWorkspaceRoot(workspaceId?: string | null): string {
  const root = workspaceRoot(workspaceId)
  if (!root) throw new Error("使用 Git 前请先选择工作目录。")
  return root
}

async function ensureGitRepo(rootPath: string): Promise<void> {
  await git(rootPath, ["rev-parse", "--is-inside-work-tree"])
}

function normalizeBranchName(branch: string): string {
  const name = branch.trim()
  if (!name) throw new Error("分支名称不能为空。")
  if (/[\s~^:?*[\\\]]/.test(name) || name.includes("..") || name.endsWith(".") || name.startsWith("-") || name.includes("@{")) {
    throw new Error("分支名称包含 Git 不支持的字符。")
  }
  return name
}

function normalizeRemoteName(remote: string): string {
  const name = remote.trim()
  if (!name) throw new Error("远端名称不能为空。")
  if (/[\s~^:?*[\\\]]/.test(name) || name.includes("..") || name.endsWith(".") || name.startsWith("-") || name.includes("@{")) {
    throw new Error("远端名称包含 Git 不支持的字符。")
  }
  return name
}

function normalizeCommitRef(ref: string): string {
  const value = ref.trim()
  if (!value) throw new Error("提交引用不能为空。")
  if (/[\s~^:?*[\\\]]/.test(value) || value.includes("..") || value.startsWith("-") || value.includes("@{")) {
    throw new Error("提交引用包含 Git 不支持的字符。")
  }
  return value
}

function normalizeCommitSelections(filePaths: string[] | undefined, status: GitStatus): { stagedOnly: string[]; includeWorktree: string[] } {
  if (!filePaths?.length) {
    return {
      stagedOnly: [],
      includeWorktree: status.files.map(file => file.path)
    }
  }
  const stagedOnly: string[] = []
  const includeWorktree: string[] = []
  for (const raw of filePaths) {
    const text = String(raw || "").trim()
    if (!text) continue
    const match = text.match(/^(staged|unstaged):(.+)$/)
    if (!match) {
      includeWorktree.push(normalizeGitPath(text))
      continue
    }
    const path = normalizeGitPath(match[2])
    if (!path) continue
    if (match[1] === "staged") stagedOnly.push(path)
    else includeWorktree.push(path)
  }
  return {
    stagedOnly: unique(stagedOnly),
    includeWorktree: unique(includeWorktree)
  }
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, windowsHide: true, maxBuffer: MAX_BUFFER })
    return { stdout: String(stdout || ""), stderr: String(stderr || "") }
  } catch (e: any) {
    const stderr = String(e?.stderr || "").trim()
    const stdout = String(e?.stdout || "").trim()
    const detail = stderr || stdout || e?.message || String(e)
    const error = new Error(detail)
    ;(error as any).stdout = stdout
    ;(error as any).stderr = stderr
    throw error
  }
}

async function parseStatus(workspaceId: string | null, rootPath: string, branchStdout: string, porcelainStdout: string, upstream: string): Promise<GitStatus> {
  const lines = branchStdout.split(/\r?\n/).filter(Boolean)
  const head = lines.shift() || "## unknown"
  const branchMatch = head.match(/^##\s+(.+?)(?:\.\.\.[^\s]+)?(?:\s+\[(.*?)\])?$/)
  const aheadBehind = branchMatch?.[2] || ""
  const ahead = Number(aheadBehind.match(/ahead\s+(\d+)/)?.[1] || 0)
  const behind = Number(aheadBehind.match(/behind\s+(\d+)/)?.[1] || 0)
  const parsed = await parsePorcelainZ(rootPath, porcelainStdout)
  const totalAdditions = parsed.files.reduce((sum, file) => sum + file.additions, 0)
  const totalDeletions = parsed.files.reduce((sum, file) => sum + file.deletions, 0)
  return {
    workspaceId,
    rootPath,
    isRepo: true,
    branch: branchMatch?.[1] || "unknown",
    upstream: upstream || null,
    ahead,
    behind,
    files: parsed.files,
    stagedFiles: parsed.stagedFiles,
    unstagedFiles: parsed.unstagedFiles,
    totalAdditions,
    totalDeletions
  }
}

async function parsePorcelainZ(rootPath: string, stdout: string): Promise<{ files: GitFileStatus[]; stagedFiles: GitFileStatus[]; unstagedFiles: GitFileStatus[] }> {
  const parts = stdout.split("\0").filter(Boolean)
  const aggregate = new Map<string, GitFileStatus>()
  const stagedFiles: GitFileStatus[] = []
  const unstagedFiles: GitFileStatus[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const index = entry.slice(0, 1).trim() || " "
    const workingTree = entry.slice(1, 2).trim() || " "
    const path = normalizeGitPath(entry.slice(3))
    const file: GitFileStatus = { path, status: statusFromCode(index, workingTree), index, workingTree, additions: 0, deletions: 0 }
    if ((index === "R" || index === "C") && parts[i + 1] && !/^[ MARCUD?!]{2}\s/.test(parts[i + 1])) {
      file.oldPath = normalizeGitPath(parts[i + 1])
      i += 1
    }
    const stats = await diffStatsForPath(rootPath, path)
    file.additions = stats.additions
    file.deletions = stats.deletions
    const existing = aggregate.get(path)
    if (existing) {
      existing.index = existing.index.trim() !== "" ? existing.index : index
      existing.workingTree = existing.workingTree.trim() !== "" ? existing.workingTree : workingTree
      existing.status = statusFromCode(existing.index, existing.workingTree)
      existing.additions += file.additions
      existing.deletions += file.deletions
    } else {
      aggregate.set(path, { ...file })
    }
    if (index.trim()) stagedFiles.push({ ...file, status: normalizeSingleStatus(index), workingTree: " " })
    if (workingTree.trim()) unstagedFiles.push({ ...file, status: normalizeSingleStatus(workingTree), index: " " })
  }
  return { files: Array.from(aggregate.values()), stagedFiles, unstagedFiles }
}

async function diffStatsForPath(rootPath: string, filePath: string): Promise<{ additions: number; deletions: number }> {
  const [cached, working] = await Promise.all([
    git(rootPath, ["diff", "--cached", "--numstat", "--", filePath]).catch(() => ({ stdout: "", stderr: "" })),
    git(rootPath, ["diff", "--numstat", "--", filePath]).catch(() => ({ stdout: "", stderr: "" }))
  ])
  let additions = 0
  let deletions = 0
  for (const line of `${cached.stdout}\n${working.stdout}`.split(/\r?\n/)) {
    const [a, d] = line.split(/\s+/)
    additions += Number(a) || 0
    deletions += Number(d) || 0
  }
  if (!additions && !deletions && await isUntracked(rootPath, filePath)) {
    try {
      const fullPath = join(rootPath, filePath)
      const st = statSync(fullPath)
      if (st.isFile() && st.size <= 200 * 1024) {
        const text = readFileSync(fullPath, "utf8")
        additions = text.split(/\r?\n/).length
      }
    } catch {}
  }
  return { additions, deletions }
}

async function gitDiffEntry(rootPath: string, filePath: string): Promise<GitFileDiff | null> {
  const diff = await gitDiffByRoot(rootPath, filePath)
  const isBinary = /Binary files .* differ/.test(diff)
  const isImage = isImagePath(filePath)
  if (!diff.trim() && !await isUntracked(rootPath, filePath)) return null
  return {
    path: filePath,
    status: inferStatusFromDiff(diff),
    diff,
    isBinary,
    isImage
  }
}

async function gitDiffByRoot(rootPath: string, filePath: string): Promise<string> {
  const [cached, working] = await Promise.all([
    git(rootPath, ["diff", "--cached", "--no-color", "--find-renames", "--", filePath]).catch(e => ({ stdout: cleanGitError(e), stderr: "" })),
    git(rootPath, ["diff", "--no-color", "--find-renames", "--", filePath]).catch(e => ({ stdout: cleanGitError(e), stderr: "" }))
  ])
  const sections = [
    cached.stdout.trim() ? cached.stdout : "",
    working.stdout.trim() ? working.stdout : ""
  ]
  if (await isUntracked(rootPath, filePath)) sections.push(untrackedPreview(rootPath, filePath))
  return sections.filter(Boolean).join("\n")
}

function splitDiffByFile(diffText: string): GitFileDiff[] {
  const chunks = diffText.split(/(?=^diff --git )/m).filter(chunk => chunk.trim())
  return chunks.map(chunk => {
    const path = normalizeGitPath(
      chunk.match(/^diff --git a\/.+? b\/(.+)$/m)?.[1] ||
      chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1] ||
      "unknown"
    )
    return {
      path,
      status: inferStatusFromDiff(chunk),
      diff: chunk.trimEnd(),
      isBinary: /Binary files .* differ/.test(chunk),
      isImage: isImagePath(path)
    }
  })
}

function inferStatusFromDiff(diff: string): string {
  if (diff.includes("new file mode") || diff.includes("--- /dev/null")) return "A"
  if (diff.includes("deleted file mode") || diff.includes("+++ /dev/null")) return "D"
  if (diff.includes("rename from ") && diff.includes("rename to ")) return "R"
  return "M"
}

function parseLogEntries(stdout: string): GitLogEntry[] {
  return stdout.split("\x1e").map(record => record.trim()).filter(Boolean).map(record => {
    const [sha, shortSha, author, authorEmail, timestamp, summary, ...messageParts] = record.split("\x1f")
    return {
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      hash: shortSha || sha.slice(0, 7),
      summary: summary || "",
      message: (messageParts.join("\x1f").trim() || summary || ""),
      author: author || "",
      authorEmail: authorEmail || "",
      timestamp: Number(timestamp || 0),
      date: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : ""
    }
  })
}

async function logRange(rootPath: string, range: string, limit: number): Promise<GitLogEntry[]> {
  const { stdout } = await git(rootPath, [
    "log",
    `-${Math.max(1, Math.min(limit, 100))}`,
    "--date=unix",
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%B%x1e",
    range
  ]).catch(() => ({ stdout: "", stderr: "" }))
  return parseLogEntries(stdout)
}

function parseCommitFiles(text: string): GitCommitDetails["files"] {
  const files = new Map<string, GitCommitDetails["files"][number]>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split(/\t/)
    if (parts.length >= 3 && /^-|\d+$/.test(parts[0])) {
      const additions = Number(parts[0]) || 0
      const deletions = Number(parts[1]) || 0
      const path = normalizeGitPath(parts[2])
      if (!path) continue
      files.set(path, {
        path,
        status: files.get(path)?.status || "M",
        additions,
        deletions,
        diff: "",
        lineCount: 0,
        truncated: false
      })
    } else if (/^[A-Z]\t/.test(line)) {
      const [status, path] = parts
      const normalized = normalizeGitPath(path)
      if (!normalized) continue
      files.set(normalized, {
        path: normalized,
        status: status.slice(0, 1),
        additions: files.get(normalized)?.additions || 0,
        deletions: files.get(normalized)?.deletions || 0,
        diff: "",
        lineCount: 0,
        truncated: false
      })
    }
  }
  return Array.from(files.values())
}

async function aheadBehind(rootPath: string, left: string, right: string): Promise<{ ahead: number; behind: number }> {
  const { stdout } = await git(rootPath, ["rev-list", "--left-right", "--count", `${right}...${left}`]).catch(() => ({ stdout: "0\t0", stderr: "" }))
  const [aheadRaw, behindRaw] = stdout.trim().split(/\s+/)
  return { ahead: Number(aheadRaw || 0), behind: Number(behindRaw || 0) }
}

async function actionPathsForFile(rootPath: string, filePath: string): Promise<string[]> {
  const normalized = normalizeGitPath(filePath)
  const paths = new Set<string>([normalized])
  const { stdout } = await git(rootPath, ["status", "--porcelain=v1", "-z", "--", normalized]).catch(() => ({ stdout: "", stderr: "" }))
  const parts = stdout.split("\0").filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if ((entry[0] === "R" || entry[0] === "C") && parts[i + 1]) {
      paths.add(normalizeGitPath(parts[i + 1]))
      i += 1
    }
  }
  return Array.from(paths).filter(Boolean)
}

async function verifyCurrentBranch(rootPath: string, expected: string): Promise<void> {
  const current = await gitCurrentBranch(rootPath)
  if (current !== expected) throw new Error(`分支切换校验失败：当前分支是 ${current}，不是 ${expected}。`)
}

function formatStatus(status: GitStatus): string {
  if (!status.isRepo) return ["# Git status", status.error || "不是 Git 仓库"].join("\n")
  return [
    "# Git status",
    `Branch: ${status.branch || "HEAD"}`,
    status.upstream ? `Upstream: ${status.upstream}` : "",
    `Ahead: ${status.ahead}`,
    `Behind: ${status.behind}`,
    `Changed files: ${status.files.length}`,
    ...(status.files.length ? [""] : []),
    ...status.files.map(file => `- ${file.status || statusFromCode(file.index, file.workingTree)} ${file.path}${file.oldPath ? ` -> ${file.oldPath}` : ""}`)
  ].filter(Boolean).join("\n")
}

function statusFromCode(index: string, workingTree: string): string {
  const code = `${index || " "}${workingTree || " "}`
  if (code.includes("?")) return "?"
  if (code.includes("A")) return "A"
  if (code.includes("D")) return "D"
  if (code.includes("R")) return "R"
  if (code.includes("C")) return "C"
  if (code.includes("U")) return "U"
  return "M"
}

function normalizeSingleStatus(status: string): string {
  const value = status.trim()
  return value || "M"
}

async function isUntracked(rootPath: string, filePath: string): Promise<boolean> {
  const { stdout } = await git(rootPath, ["ls-files", "--others", "--exclude-standard", "-z", "--", filePath]).catch(() => ({ stdout: "", stderr: "" }))
  return stdout.split("\0").filter(Boolean).map(normalizeGitPath).includes(normalizeGitPath(filePath))
}

function untrackedPreview(rootPath: string, filePath: string): string {
  try {
    const fullPath = join(rootPath, filePath)
    const st = statSync(fullPath)
    if (!st.isFile()) return `# 未跟踪\n${filePath}\n无法预览非普通文件。`
    if (st.size > 200 * 1024) return `# 未跟踪\n${filePath}\n文件较大，已跳过内容预览。`
    const text = readFileSync(fullPath, "utf8")
    return [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${filePath}`,
      "@@",
      ...text.split(/\r?\n/).map(line => `+${line}`)
    ].join("\n")
  } catch (e: any) {
    return `# 未跟踪\n${filePath}\n${e?.message || String(e)}`
  }
}

function emptyStatus(workspaceId: string | null, rootPath: string | null, error?: string): GitStatus {
  return {
    workspaceId,
    rootPath,
    isRepo: false,
    branch: "",
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    stagedFiles: [],
    unstagedFiles: [],
    totalAdditions: 0,
    totalDeletions: 0,
    error
  }
}

function cleanGitError(error: any): string {
  const raw = String(error?.stderr || error?.stdout || error?.message || error || "").trim()
  return raw || "Git 命令执行失败。"
}

function normalizeGitPath(path: string): string {
  return path.trim().replace(/\\/g, "/").split("/").filter(Boolean).join("/")
}

function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".")
  return dot >= 0 && IMAGE_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}
