import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const gitMock = vi.hoisted(() => ({
  gitStatus: vi.fn(),
  gitBranches: vi.fn(),
  gitCheckoutBranch: vi.fn(),
  gitCommit: vi.fn(),
  gitCommitDetails: vi.fn(),
  gitCommitDiff: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitDiff: vi.fn(),
  gitDiffs: vi.fn(),
  gitFetch: vi.fn(),
  gitLog: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitRenameBranch: vi.fn(),
  gitRevertAll: vi.fn(),
  gitRevertFile: vi.fn(),
  gitStageAll: vi.fn(),
  gitStageFile: vi.fn(),
  gitSync: vi.fn(),
  gitUnstageFile: vi.fn(),
  gitUpdateBranch: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../runtime/git', () => gitMock)

describe('git IPC', () => {
  const status = {
    workspaceId: 'ws-1',
    rootPath: 'E:/repo',
    isRepo: true,
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    stagedFiles: [],
    unstagedFiles: [],
    totalAdditions: 0,
    totalDeletions: 0
  }
  const branches = {
    branches: [{ name: 'main', current: true }],
    localBranches: [{ name: 'main', current: true, isCurrent: true, ahead: 0, behind: 0 }],
    remoteBranches: [],
    currentBranch: 'main',
    repositoryState: 'git_repository'
  }

  beforeEach(() => {
    electronMock.handlers.clear()
    for (const value of Object.values(gitMock)) value.mockReset()
    gitMock.gitStatus.mockResolvedValue(status)
    gitMock.gitBranches.mockResolvedValue(branches)
    gitMock.gitLog.mockResolvedValue({ total: 0, entries: [], ahead: 0, behind: 0, aheadEntries: [], behindEntries: [], upstream: null })
    gitMock.gitDiff.mockResolvedValue('diff text')
    gitMock.gitDiffs.mockResolvedValue([{ path: 'README.md', diff: 'diff text' }])
    gitMock.gitCommitDetails.mockResolvedValue({
      sha: 'abcdef',
      shortSha: 'abcdef',
      summary: 'summary',
      message: 'message',
      author: 'AgentHub',
      authorEmail: 'agenthub@example.test',
      committer: 'AgentHub',
      committerEmail: 'agenthub@example.test',
      authorTime: 1,
      commitTime: 1,
      parents: [],
      files: [],
      totalAdditions: 0,
      totalDeletions: 0
    })
    gitMock.gitCommitDiff.mockResolvedValue([{ path: 'README.md', status: 'M', diff: 'diff text' }])
    gitMock.gitCommit.mockResolvedValue({ hash: 'abcdef' })
    gitMock.gitUpdateBranch.mockResolvedValue({ branch: 'main', status: 'no-op', message: 'up to date' })
    for (const name of [
      'gitCheckoutBranch',
      'gitCreateBranch',
      'gitStageFile',
      'gitStageAll',
      'gitUnstageFile',
      'gitRevertFile',
      'gitRevertAll',
      'gitFetch',
      'gitPull',
      'gitPush',
      'gitSync'
    ] as const) {
      gitMock[name].mockResolvedValue(status)
    }
    gitMock.gitRenameBranch.mockResolvedValue(branches)
    gitMock.gitDeleteBranch.mockResolvedValue(branches)
    vi.resetModules()
  })

  async function setup() {
    const { registerGitIpc } = await import('../git-ipc')
    registerGitIpc()
  }

  it('delegates read-only Git requests with arguments intact', async () => {
    await setup()

    await expect(Promise.resolve(electronMock.handlers.get('git:status')?.({}, 'ws-1'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:branches')?.({}, 'ws-1'))).resolves.toEqual(branches)
    await expect(Promise.resolve(electronMock.handlers.get('git:log')?.({}, 'ws-1', 80))).resolves.toMatchObject({ total: 0 })
    await expect(Promise.resolve(electronMock.handlers.get('git:diff')?.({}, 'ws-1', 'README.md'))).resolves.toBe('diff text')
    await expect(Promise.resolve(electronMock.handlers.get('git:diffs')?.({}, 'ws-1'))).resolves.toEqual([{ path: 'README.md', diff: 'diff text' }])
    await expect(Promise.resolve(electronMock.handlers.get('git:commitDetails')?.({}, 'ws-1', 'abcdef'))).resolves.toMatchObject({ sha: 'abcdef' })
    await expect(Promise.resolve(electronMock.handlers.get('git:commitDiff')?.({}, 'ws-1', 'abcdef', 'README.md'))).resolves.toEqual([{ path: 'README.md', status: 'M', diff: 'diff text' }])

    expect(gitMock.gitStatus).toHaveBeenCalledWith('ws-1')
    expect(gitMock.gitBranches).toHaveBeenCalledWith('ws-1')
    expect(gitMock.gitLog).toHaveBeenCalledWith('ws-1', 80)
    expect(gitMock.gitDiff).toHaveBeenCalledWith('ws-1', 'README.md')
    expect(gitMock.gitDiffs).toHaveBeenCalledWith('ws-1')
    expect(gitMock.gitCommitDetails).toHaveBeenCalledWith('ws-1', 'abcdef')
    expect(gitMock.gitCommitDiff).toHaveBeenCalledWith('ws-1', 'abcdef', 'README.md')
  })

  it('rejects invalid read-only Git workspace ids before runtime calls', async () => {
    await setup()

    expect(() => electronMock.handlers.get('git:status')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('git:status', 'workspaceId must be a string')
    )
    expect(() => electronMock.handlers.get('git:branches')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('git:branches', 'workspaceId must be a string')
    )
    expect(() => electronMock.handlers.get('git:diffs')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('git:diffs', 'workspaceId must be a string')
    )

    expect(gitMock.gitStatus).not.toHaveBeenCalled()
    expect(gitMock.gitBranches).not.toHaveBeenCalled()
    expect(gitMock.gitDiffs).not.toHaveBeenCalled()
  })

  it('delegates branch, staging, commit, and remote mutation requests', async () => {
    await setup()

    await expect(Promise.resolve(electronMock.handlers.get('git:checkoutBranch')?.({}, 'ws-1', 'feature'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:createBranch')?.({}, 'ws-1', 'feature'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:renameBranch')?.({}, 'ws-1', 'old', 'new'))).resolves.toEqual(branches)
    await expect(Promise.resolve(electronMock.handlers.get('git:deleteBranch')?.({}, 'ws-1', 'old', true))).resolves.toEqual(branches)
    await expect(Promise.resolve(electronMock.handlers.get('git:stageFile')?.({}, 'ws-1', 'README.md'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:stageAll')?.({}, 'ws-1'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:unstageFile')?.({}, 'ws-1', 'README.md'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:revertFile')?.({}, 'ws-1', 'README.md'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:revertAll')?.({}, 'ws-1'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:commit')?.({}, 'ws-1', 'message', ['README.md']))).resolves.toEqual({ hash: 'abcdef' })
    await expect(Promise.resolve(electronMock.handlers.get('git:fetch')?.({}, 'ws-1', 'origin'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:pull')?.({}, 'ws-1', 'origin', 'main'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:push')?.({}, 'ws-1', 'origin', 'main'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:sync')?.({}, 'ws-1'))).resolves.toEqual(status)
    await expect(Promise.resolve(electronMock.handlers.get('git:updateBranch')?.({}, 'ws-1', 'main'))).resolves.toMatchObject({ status: 'no-op' })

    expect(gitMock.gitCreateBranch).toHaveBeenCalledWith('ws-1', 'feature', true)
    expect(gitMock.gitDeleteBranch).toHaveBeenCalledWith('ws-1', 'old', true)
    expect(gitMock.gitCommit).toHaveBeenCalledWith('ws-1', 'message', ['README.md'])
    expect(gitMock.gitPull).toHaveBeenCalledWith('ws-1', 'origin', 'main')
    expect(gitMock.gitUpdateBranch).toHaveBeenCalledWith('ws-1', 'main')
  })

  it('preserves the create-branch default checkout behavior', async () => {
    await setup()

    await Promise.resolve(electronMock.handlers.get('git:createBranch')?.({}, 'ws-1', 'feature', undefined))
    await Promise.resolve(electronMock.handlers.get('git:createBranch')?.({}, 'ws-1', 'feature', false))

    expect(gitMock.gitCreateBranch).toHaveBeenNthCalledWith(1, 'ws-1', 'feature', true)
    expect(gitMock.gitCreateBranch).toHaveBeenNthCalledWith(2, 'ws-1', 'feature', false)
  })

  it('sanitizes path details from wrapped Git errors', async () => {
    await setup()
    gitMock.gitStageFile.mockRejectedValueOnce(new Error('fatal: cannot open E:\\Agent\\secret\\.env and /home/user/.ssh/id_rsa'))

    await expect(Promise.resolve(electronMock.handlers.get('git:stageFile')?.({}, 'ws-1', 'README.md')))
      .rejects.toThrow('fatal: cannot open <path> and <path>')
  })
})
