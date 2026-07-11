// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { SddDraftEditor } from './SddDraftEditor'
import { SddTracePanel } from './SddTracePanel'
import { useSddDraftStore, type SddDraft, type SddRequirementBlock, type SddTrace } from '../sdd-draft-store'
import { addHistoryEntry, clearDraftHistory } from '../sdd-draft-history'
import { parseRequirementBlocks, saveDraftToDisk } from '../sdd-draft-actions'

vi.mock('../sdd-draft-actions', async () => ({
  saveDraftToDisk: vi.fn(async () => true),
  parseRequirementBlocks: vi.fn(async () => true)
}))

const blocks: SddRequirementBlock[] = [
  {
    id: 'R-1',
    title: 'Checkout flow',
    status: 'draft',
    description: 'Users can buy items.',
    acceptanceCriteria: [{ text: 'submit payment', checked: false }],
    lineNumber: 3
  },
  {
    id: 'R-2',
    title: 'Receipt email',
    status: 'draft',
    description: 'Users receive a receipt.',
    acceptanceCriteria: [{ text: 'send receipt', checked: false }],
    lineNumber: 8
  }
]

const trace: SddTrace = {
  draftId: 'draft-1',
  requirementBlocks: blocks,
  planItems: [
    {
      id: 'T-1',
      text: 'T-1: Implement checkout (covers: R-1)',
      covers: ['R-1'],
      status: 'in_progress',
      lineNumber: 1,
      turnId: 'turn-1234567890abcdef',
      commits: [{
        sha: 'abcdef1234567890abcdef1234567890abcdef12',
        shortSha: 'abcdef1',
        summary: 'Implement checkout flow',
        linkedAt: '2026-07-04T00:02:00.000Z',
        turnId: 'turn-1234567890abcdef',
        files: [{ path: 'src/checkout.ts', status: 'M', additions: 5, deletions: 1 }]
      }]
    }
  ],
  coverage: { 'R-1': ['T-1'], 'R-2': [] },
  derivedStatuses: { 'R-1': 'building', 'R-2': 'draft' },
  uncoveredRequirementIds: ['R-2'],
  timestamp: '2026-07-04T00:01:00.000Z'
}

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Checkout',
  content: '# Checkout',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

describe('SddTracePanel', () => {
  beforeEach(async () => {
    setLang('en')
    await clearDraftHistory(draft.id, draft.workspaceRoot)
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    await clearDraftHistory(draft.id, draft.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
  })

  it('renders requirement to plan item to dispatched turn links', () => {
    const view = render(<SddTracePanel trace={trace} blocks={blocks} />)

    expect(view.getByText('Trace Matrix')).toBeTruthy()
    expect(view.getByText('1/2 requirements covered · 1 tasks dispatched')).toBeTruthy()
    expect(view.getByText('R-1')).toBeTruthy()
    expect(view.getByText('Checkout flow')).toBeTruthy()
    expect(view.getByText('T-1')).toBeTruthy()
    expect(view.getByText('Implement checkout')).toBeTruthy()
    expect(view.getByText('In progress')).toBeTruthy()
    expect(view.getByTitle('turn-1234567890abcdef')).toBeTruthy()
    expect(view.getByText('Commit abcdef1')).toBeTruthy()
    expect(view.getByTitle(/Implement checkout flow/)).toBeTruthy()
  })

  it('shows uncovered requirements without linked plan items', () => {
    const view = render(<SddTracePanel trace={trace} blocks={blocks} />)

    expect(view.getByText('R-2')).toBeTruthy()
    expect(view.getByText('Receipt email')).toBeTruthy()
    expect(view.getByText('No linked plan item')).toBeTruthy()
  })

  it('is mounted by the draft editor when trace exists in the store', () => {
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setRequirementBlocks(blocks)
    useSddDraftStore.getState().setTrace(trace)

    const view = render(<SddDraftEditor />)

    expect(view.getByText('Trace Matrix')).toBeTruthy()
    expect(view.getByText('Implement checkout')).toBeTruthy()
  })

  it('restores a selected history version through the draft editor and saves it to disk', async () => {
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setContent('# Current')
    await addHistoryEntry(draft.id, '# Previous', draft.title, 'AI: assistant requirement writeback', 'ai', draft.workspaceRoot)
    vi.mocked(saveDraftToDisk).mockClear()
    vi.mocked(parseRequirementBlocks).mockClear()

    const view = render(<SddDraftEditor />)

    fireEvent.click(view.getByText('Version History'))
    fireEvent.click(view.getByText('AI: assistant requirement writeback'))
    fireEvent.click(view.getByRole('button', { name: /Restore/ }))

    await waitFor(() => expect(useSddDraftStore.getState().content).toBe('# Previous'))
    await waitFor(() => expect(saveDraftToDisk).toHaveBeenCalled())
    expect(parseRequirementBlocks).toHaveBeenCalled()
    await view.findByText('Restored and saved')
  })

  it('does not report a restored history version as complete when block parsing aborts', async () => {
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setContent('# Current')
    await addHistoryEntry(draft.id, '# Previous', draft.title, 'AI: assistant requirement writeback', 'ai', draft.workspaceRoot)
    vi.mocked(saveDraftToDisk).mockClear()
    vi.mocked(parseRequirementBlocks).mockResolvedValueOnce(false)

    const view = render(<SddDraftEditor />)

    fireEvent.click(view.getByText('Version History'))
    fireEvent.click(view.getByText('AI: assistant requirement writeback'))
    fireEvent.click(view.getByRole('button', { name: /Restore/ }))

    await waitFor(() => expect(parseRequirementBlocks).toHaveBeenCalled())
    await view.findByText('Restore stopped because the requirement draft changed')
    expect(view.queryByText('Restored and saved')).toBeNull()
  })
})
