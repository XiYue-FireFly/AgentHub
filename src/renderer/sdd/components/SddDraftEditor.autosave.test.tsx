// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { loadDraft } from '../sdd-draft-actions'
import { useSddDraftStore, type SddDraft, type SddRequirementBlock } from '../sdd-draft-store'
import { SddDraftEditor } from './SddDraftEditor'

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Draft',
  content: '# Draft',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z'
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('SddDraftEditor design autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setLang('en')
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    delete (window as any).electronAPI
    useSddDraftStore.getState().clearDraft()
  })

  it('autosaves a design-only edit after 650ms and retains it after disk reload', async () => {
    let diskDraft: SddDraft = { ...draft }
    const updateDraft = vi.fn(async (
      _workspaceRoot: string,
      _draftId: string,
      content: string,
      designContext?: SddDesignContext
    ) => {
      diskDraft = { ...diskDraft, content, designContext }
    })
    ;(window as any).electronAPI = {
      sdd: {
        updateDraft,
        updateDesignContext: vi.fn(async () => undefined),
        parseBlocks: vi.fn(async () => []),
        getDraft: vi.fn(async () => diskDraft),
        getTrace: vi.fn(async () => null),
        getHistory: vi.fn(async () => [])
      }
    }
    useSddDraftStore.getState().setActiveDraft(draft)
    const view = render(<SddDraftEditor providers={[]} modelSelection={null} />)

    fireEvent.click(screen.getByText('Design Context'))
    const colorText = screen.getAllByRole('textbox').find(element => element.tagName === 'INPUT')!
    fireEvent.change(colorText, { target: { value: '#123456' } })

    await act(async () => {
      vi.advanceTimersByTime(650)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(updateDraft).toHaveBeenCalledWith(
      draft.workspaceRoot,
      draft.id,
      draft.content,
      { brandColor: '#123456' }
    )
    view.unmount()
    useSddDraftStore.getState().clearDraft()

    await loadDraft(draft.workspaceRoot, draft.id)

    expect(useSddDraftStore.getState().activeDraft?.designContext?.brandColor).toBe('#123456')
  })

  it('reparses a different workspace draft when its id and content match a stale pending parse', async () => {
    const sharedContent = '# Shared requirement'
    const pendingWorkspaceA = deferred<SddRequirementBlock[]>()
    const workspaceBBlocks = [{
      id: 'R-B',
      title: 'Workspace B requirement',
      status: 'draft' as const,
      description: 'Parsed for workspace B.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const parseBlocks = vi.fn()
      .mockImplementationOnce(() => pendingWorkspaceA.promise)
      .mockResolvedValueOnce(workspaceBBlocks)
    ;(window as any).electronAPI = {
      sdd: {
        parseBlocks,
        getHistory: vi.fn(async () => [])
      }
    }
    useSddDraftStore.getState().setActiveDraft({ ...draft, content: sharedContent })
    render(<SddDraftEditor providers={[]} modelSelection={null} />)

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    expect(parseBlocks).toHaveBeenCalledTimes(1)

    act(() => {
      useSddDraftStore.getState().setActiveDraft({
        ...draft,
        workspaceRoot: 'E:\\workspace-b',
        content: sharedContent
      })
    })
    await act(async () => {
      pendingWorkspaceA.resolve([{
        id: 'R-A',
        title: 'Workspace A requirement',
        status: 'draft',
        description: 'Stale workspace A parse.',
        acceptanceCriteria: [],
        lineNumber: 1
      }])
      await pendingWorkspaceA.promise
      vi.advanceTimersByTime(301)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(parseBlocks).toHaveBeenCalledTimes(2)
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe('E:\\workspace-b')
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(workspaceBBlocks)
  })

  it('reparses after an edit revision makes a pending background parse stale', async () => {
    const pendingParse = deferred<SddRequirementBlock[]>()
    const currentBlocks = [{
      id: 'R-1',
      title: 'Current requirement',
      status: 'draft' as const,
      description: 'Parsed after the revision changed.',
      acceptanceCriteria: [],
      lineNumber: 1
    }]
    const parseBlocks = vi.fn()
      .mockImplementationOnce(() => pendingParse.promise)
      .mockResolvedValueOnce(currentBlocks)
    ;(window as any).electronAPI = {
      sdd: {
        parseBlocks,
        getHistory: vi.fn(async () => [])
      }
    }
    useSddDraftStore.getState().setActiveDraft(draft)
    render(<SddDraftEditor providers={[]} modelSelection={null} />)

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })
    expect(parseBlocks).toHaveBeenCalledTimes(1)

    act(() => {
      useSddDraftStore.getState().updateDesignContext({ brandColor: '#123456' })
    })
    await act(async () => {
      pendingParse.resolve([])
      await pendingParse.promise
      vi.advanceTimersByTime(301)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(parseBlocks).toHaveBeenCalledTimes(2)
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(currentBlocks)
  })
})
