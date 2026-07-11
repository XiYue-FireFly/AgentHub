// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSddDraftStore, type SddDraft } from './sdd-draft-store'

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Draft',
  content: '# Draft',
  designContext: { tone: ['calm'] },
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z'
}

describe('sdd draft edit revisions', () => {
  beforeEach(() => {
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
    useSddDraftStore.getState().setActiveDraft(draft)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as any).electronAPI
  })

  it('increments only for actual content or design changes and marks design-only edits dirty', () => {
    expect(useSddDraftStore.getState().editRevision).toBe(0)

    useSddDraftStore.getState().setContent('# Draft')
    useSddDraftStore.getState().updateDesignContext({ tone: ['calm'] })
    expect(useSddDraftStore.getState().editRevision).toBe(0)
    expect(useSddDraftStore.getState().saveStatus).toBe('saved')

    useSddDraftStore.getState().setContent('# Draft edited')
    expect(useSddDraftStore.getState().editRevision).toBe(1)
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
    useSddDraftStore.getState().setContent('# Draft edited')
    expect(useSddDraftStore.getState().editRevision).toBe(1)

    useSddDraftStore.getState().updateDesignContext({ brandColor: '#123456' })
    expect(useSddDraftStore.getState().editRevision).toBe(2)
    expect(useSddDraftStore.getState().activeDraft?.designContext?.brandColor).toBe('#123456')
    useSddDraftStore.getState().updateDesignContext({ brandColor: '#123456' })
    expect(useSddDraftStore.getState().editRevision).toBe(2)
  })

  it('applies saved and error completions only to their expected revision', () => {
    useSddDraftStore.getState().setContent('# edit A')
    const session = useSddDraftStore.getState().draftSession
    const revisionA = useSddDraftStore.getState().editRevision
    useSddDraftStore.getState().setSaveStatus('saving')
    useSddDraftStore.getState().setContent('# edit B')
    const revisionB = useSddDraftStore.getState().editRevision

    useSddDraftStore.getState().markSaved(session, revisionA)
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
    expect(useSddDraftStore.getState().lastSavedContent).toBe('# Draft')

    expect(useSddDraftStore.getState().markError).toBeTypeOf('function')
    useSddDraftStore.getState().markError(session, revisionA, 'stale failure')
    expect(useSddDraftStore.getState().saveStatus).toBe('dirty')
    expect(useSddDraftStore.getState().error).toBeNull()

    useSddDraftStore.getState().markSaved(session, revisionB)
    expect(useSddDraftStore.getState().saveStatus).toBe('saved')
    expect(useSddDraftStore.getState().lastSavedContent).toBe('# edit B')
  })

  it('drops a delayed rehydrate reload after the same draft key is replaced', async () => {
    const queued: Array<() => void> = []
    vi.stubGlobal('queueMicrotask', vi.fn((callback: () => void) => { queued.push(callback) }))
    const getDraft = vi.fn(async () => null)
    ;(window as any).electronAPI = { sdd: { getDraft } }
    localStorage.setItem('sdd-draft-store', JSON.stringify({
      state: {
        activeDraft: { ...draft, content: '# rehydrated snapshot' },
        lastSavedContent: '# rehydrated snapshot',
        saveStatus: 'saved'
      },
      version: 1
    }))

    await useSddDraftStore.persist.rehydrate()
    expect(queued).toHaveLength(1)
    const rehydratedSession = useSddDraftStore.getState().draftSession
    useSddDraftStore.getState().setActiveDraft({ ...draft, content: '# replacement snapshot' })
    expect(useSddDraftStore.getState().draftSession).not.toBe(rehydratedSession)

    queued[0]()
    await import('./sdd-draft-actions')
    await Promise.resolve()

    expect(getDraft).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().content).toBe('# replacement snapshot')
  })
})
