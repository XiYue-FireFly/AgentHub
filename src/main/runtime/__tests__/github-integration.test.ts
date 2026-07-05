import { beforeEach, describe, expect, it, vi } from 'vitest'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn()
}))

vi.mock('node:child_process', () => childProcessMock)

describe('github-integration', () => {
  beforeEach(() => {
    childProcessMock.execFile.mockReset()
    vi.resetModules()
  })

  it('reports unavailable when gh cannot be executed', async () => {
    childProcessMock.execFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
      callback(new Error('missing gh'), '', '')
      return {} as never
    })

    const { checkGhCli } = await import('../github-integration')
    const status = await checkGhCli()

    expect(status.available).toBe(false)
    expect(status.authenticated).toBe(false)
    expect(status.error).toContain('missing gh')
  })

  it('parses pull requests from gh json output', async () => {
    childProcessMock.execFile.mockImplementation((_file: string, args: string[], _options: unknown, callback: ExecCallback) => {
      expect(args).toContain('list')
      callback(null, JSON.stringify([
        {
          number: 42,
          title: 'Add typed IPC',
          state: 'MERGED',
          author: { login: 'alice' },
          url: 'https://github.com/example/repo/pull/42',
          headRefName: 'typed-ipc',
          createdAt: '2026-07-04T00:00:00Z',
          labels: [{ name: 'enhancement' }]
        }
      ]), '')
      return {} as never
    })

    const { listPullRequests } = await import('../github-integration')
    const prs = await listPullRequests('all', 5)

    expect(prs).toEqual([{
      number: 42,
      title: 'Add typed IPC',
      state: 'merged',
      author: 'alice',
      url: 'https://github.com/example/repo/pull/42',
      branch: 'typed-ipc',
      createdAt: '2026-07-04T00:00:00Z',
      labels: ['enhancement']
    }])
  })

  it('returns branch and optional PR for current branch', async () => {
    childProcessMock.execFile.mockImplementation((_file: string, args: string[], _options: unknown, callback: ExecCallback) => {
      if (args[0] === 'git') {
        callback(null, 'new\n', '')
        return {} as never
      }
      callback(null, JSON.stringify({
        number: 7,
        title: 'Fable updates',
        state: 'OPEN',
        author: { login: 'bob' },
        url: 'https://github.com/example/repo/pull/7',
        headRefName: 'new',
        createdAt: '2026-07-04T01:00:00Z',
        labels: ['fable']
      }), '')
      return {} as never
    })

    const { getCurrentBranchPr } = await import('../github-integration')
    const result = await getCurrentBranchPr()

    expect(result.branch).toBe('new')
    expect(result.pr).toMatchObject({
      number: 7,
      state: 'open',
      author: 'bob',
      branch: 'new',
      labels: ['fable']
    })
  })
})
