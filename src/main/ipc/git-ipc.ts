/**
 * Git IPC handlers.
 *
 * Extracted from index.ts to isolate all git-related IPC registrations.
 * These handlers delegate to the runtime/git module.
 */

import {
  gitBranches,
  gitCheckoutBranch,
  gitCommit,
  gitCommitDetails,
  gitCommitDiff,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiff,
  gitDiffs,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitRenameBranch,
  gitRevertAll,
  gitRevertFile,
  gitStageAll,
  gitStageFile,
  gitStatus,
  gitSync,
  gitUnstageFile,
  gitUpdateBranch
} from '../runtime/git'
import { typedHandle } from './typed-ipc'

function sanitizeGitError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  // Strip potentially sensitive path info from git errors
  const sanitized = msg.replace(/[A-Z]:\\[^\s]+/gi, '<path>').replace(/\/home\/[^\s]+/g, '<path>')
  const err = new Error(sanitized)
  return err
}

function wrapGit<T extends (...args: any[]) => any>(fn: T): T {
  return ((...args: any[]) => fn(...args).catch((e: unknown) => { throw sanitizeGitError(e) })) as unknown as T
}

export function registerGitIpc(): void {
  typedHandle("git:status", (_event, workspaceId) => gitStatus(workspaceId))
  typedHandle("git:branches", (_event, workspaceId) => gitBranches(workspaceId))
  typedHandle("git:checkoutBranch", (_event, workspaceId, branch) => wrapGit(gitCheckoutBranch)(workspaceId, branch))
  typedHandle("git:createBranch", (_event, workspaceId, branch, checkout) => wrapGit(gitCreateBranch)(workspaceId, branch, checkout !== false))
  typedHandle("git:renameBranch", (_event, workspaceId, oldName, newName) => wrapGit(gitRenameBranch)(workspaceId, oldName, newName))
  typedHandle("git:deleteBranch", (_event, workspaceId, branch, force) => wrapGit(gitDeleteBranch)(workspaceId, branch, !!force))
  typedHandle("git:log", (_event, workspaceId, limit) => gitLog(workspaceId, limit))
  typedHandle("git:diff", (_event, workspaceId, filePath) => gitDiff(workspaceId, filePath))
  typedHandle("git:diffs", (_event, workspaceId) => gitDiffs(workspaceId))
  typedHandle("git:commitDetails", (_event, workspaceId, sha) => gitCommitDetails(workspaceId, sha))
  typedHandle("git:commitDiff", (_event, workspaceId, sha, filePath) => gitCommitDiff(workspaceId, sha, filePath))
  typedHandle("git:stageFile", (_event, workspaceId, filePath) => wrapGit(gitStageFile)(workspaceId, filePath))
  typedHandle("git:stageAll", (_event, workspaceId) => wrapGit(gitStageAll)(workspaceId))
  typedHandle("git:unstageFile", (_event, workspaceId, filePath) => wrapGit(gitUnstageFile)(workspaceId, filePath))
  typedHandle("git:revertFile", (_event, workspaceId, filePath) => wrapGit(gitRevertFile)(workspaceId, filePath))
  typedHandle("git:revertAll", (_event, workspaceId) => wrapGit(gitRevertAll)(workspaceId))
  typedHandle("git:commit", (_event, workspaceId, message, filePaths) => wrapGit(gitCommit)(workspaceId, message, filePaths))
  typedHandle("git:fetch", (_event, workspaceId, remote) => wrapGit(gitFetch)(workspaceId, remote))
  typedHandle("git:pull", (_event, workspaceId, remote, branch) => wrapGit(gitPull)(workspaceId, remote, branch))
  typedHandle("git:push", (_event, workspaceId, remote, branch) => wrapGit(gitPush)(workspaceId, remote, branch))
  typedHandle("git:sync", (_event, workspaceId) => wrapGit(gitSync)(workspaceId))
  typedHandle("git:updateBranch", (_event, workspaceId, branch) => wrapGit(gitUpdateBranch)(workspaceId, branch))
}
