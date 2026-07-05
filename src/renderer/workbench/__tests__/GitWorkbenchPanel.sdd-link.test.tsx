// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitWorkbenchPanel } from '../GitWorkbenchPanel'
import { useSddDraftStore, type SddDraft, type SddTrace } from '../../sdd/sdd-draft-store'
import { persistSddPlanCommitEvidence } from '../../sdd/sdd-trace-dispatch'
import { setLang } from '../../glass/i18n'

vi.mock('../../sdd/sdd-trace-dispatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sdd/sdd-trace-dispatch')>()
  return {
    ...actual,
    persistSddPlanCommitEvidence: vi.fn(async () => ({ draftId: 'draft-1', planItems: [] }))
  }
})

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Checkout',
  content: '# Checkout',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

const trace: SddTrace = {
  draftId: 'draft-1',
  requirementBlocks: [{
    id: 'R-1',
    title: 'Checkout',
    status: 'draft',
    description: 'Users can buy items.',
    acceptanceCriteria: [{ text: 'submit payment', checked: false }],
    lineNumber: 1
  }],
  planItems: [{
    id: 'T-1',
    text: 'T-1: Implement checkout (covers: R-1)',
    covers: ['R-1'],
    status: 'completed',
    lineNumber: 1,
    turnId: 'turn-1'
  }],
  coverage: { 'R-1': ['T-1'] },
  derivedStatuses: { 'R-1': 'done' },
  uncoveredRequirementIds: [],
  timestamp: '2026-07-04T00:01:00.000Z'
}

const commitDetails: GitCommitDetails = {
  sha: 'abcdef1234567890abcdef1234567890abcdef12',
  shortSha: 'abcdef1',
  summary: 'Implement checkout',
  message: 'Implement checkout',
  author: 'Dev',
  authorEmail: 'dev@example.com',
  committer: 'Dev',
  committerEmail: 'dev@example.com',
  authorTime: 1,
  commitTime: 1,
  parents: [],
  files: [{
    path: 'src/checkout.ts',
    status: 'M',
    additions: 3,
    deletions: 1,
    diff: 'diff --git a/src/checkout.ts b/src/checkout.ts',
    lineCount: 8,
    truncated: false
  }],
  totalAdditions: 3,
  totalDeletions: 1
}

function installGitApi(options: { rootPath?: string | null } = {}) {
  ;(window as any).electronAPI = {
    git: {
      status: vi.fn(async () => ({
        workspaceId: 'ws-1',
        rootPath: options.rootPath === undefined ? 'E:\\workspace' : options.rootPath,
        isRepo: true,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [],
        stagedFiles: [],
        unstagedFiles: [],
        totalAdditions: 0,
        totalDeletions: 0
      })),
      branches: vi.fn(async () => ({
        branches: [],
        localBranches: [],
        remoteBranches: [],
        currentBranch: 'main',
        repositoryState: 'git_repository'
      })),
      log: vi.fn(async () => ({
        total: 1,
        entries: [{
          sha: commitDetails.sha,
          shortSha: commitDetails.shortSha,
          hash: commitDetails.shortSha,
          summary: commitDetails.summary,
          message: commitDetails.message,
          author: commitDetails.author,
          authorEmail: commitDetails.authorEmail,
          timestamp: commitDetails.commitTime,
          date: '1970-01-01T00:00:01.000Z'
        }],
        ahead: 0,
        behind: 0,
        aheadEntries: [],
        behindEntries: [],
        upstream: null
      })),
      commitDetails: vi.fn(async () => commitDetails),
      commitDiff: vi.fn(async () => []),
      diff: vi.fn(async () => ''),
      fetch: vi.fn(),
      pull: vi.fn(),
      push: vi.fn(),
      sync: vi.fn()
    }
  }
}

describe('GitWorkbenchPanel SDD commit linkage', () => {
  beforeEach(() => {
    setLang('en')
    installGitApi()
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
    vi.mocked(persistSddPlanCommitEvidence).mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    useSddDraftStore.getState().clearDraft()
  })

  it('does not show SDD link controls without an active SDD trace', async () => {
    render(<GitWorkbenchPanel workspaceId="ws-1" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Commits'))
    fireEvent.click(await screen.findByText('Implement checkout'))

    await screen.findByText(/src\/checkout\.ts/)
    expect(screen.queryByText('Requirement trace')).toBeNull()
  })

  it('does not show SDD link controls when Git root is not proven to match the active draft', async () => {
    delete (window as any).electronAPI
    installGitApi({ rootPath: null })
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setTrace(trace)

    render(<GitWorkbenchPanel workspaceId="ws-1" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Commits'))
    fireEvent.click(await screen.findByText('Implement checkout'))

    await screen.findByText(/src\/checkout\.ts/)
    expect(screen.queryByText('Requirement trace')).toBeNull()
    expect(screen.queryByText('Link commit')).toBeNull()
  })

  it('links the selected commit to a user-selected SDD plan item', async () => {
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setTrace(trace)

    render(<GitWorkbenchPanel workspaceId="ws-1" activeThreadId="thread-1" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Commits'))
    fireEvent.click(await screen.findByText('Implement checkout'))

    const select = await screen.findByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'T-1' } })
    fireEvent.click(screen.getByText('Link commit'))

    await waitFor(() => expect(persistSddPlanCommitEvidence).toHaveBeenCalledWith({
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      planItemId: 'T-1',
      commit: commitDetails,
      turnId: 'turn-1',
      threadId: 'thread-1'
    }))
  })

  it('allows re-linking an unscoped existing commit to the active thread', async () => {
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setTrace({
      ...trace,
      planItems: [{
        ...trace.planItems[0],
        commits: [{
          sha: commitDetails.sha,
          shortSha: commitDetails.shortSha,
          summary: commitDetails.summary,
          linkedAt: '2026-07-04T00:02:00.000Z'
        }]
      }]
    })

    render(<GitWorkbenchPanel workspaceId="ws-1" activeThreadId="thread-1" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Commits'))
    fireEvent.click(await screen.findByText('Implement checkout'))

    fireEvent.click(await screen.findByText('Link commit'))

    await waitFor(() => expect(persistSddPlanCommitEvidence).toHaveBeenCalledWith({
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      planItemId: 'T-1',
      commit: commitDetails,
      turnId: 'turn-1',
      threadId: 'thread-1'
    }))
  })

  it('disables commit linking when the selected commit is already linked to the active thread', async () => {
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setTrace({
      ...trace,
      planItems: [{
        ...trace.planItems[0],
        commits: [{
          sha: commitDetails.sha,
          shortSha: commitDetails.shortSha,
          summary: commitDetails.summary,
          linkedAt: '2026-07-04T00:02:00.000Z',
          threadId: 'thread-1'
        }]
      }]
    })

    render(<GitWorkbenchPanel workspaceId="ws-1" activeThreadId="thread-1" onClose={() => {}} />)

    fireEvent.click(await screen.findByText('Commits'))
    fireEvent.click(await screen.findByText('Implement checkout'))

    const button = await screen.findByText('Link commit') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('This commit is already linked to this plan item.')).toBeTruthy()
  })
})
