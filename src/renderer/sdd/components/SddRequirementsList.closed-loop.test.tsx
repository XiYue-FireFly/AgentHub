// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { SddRequirementsList } from './SddRequirementsList'
import { useSddDraftStore, type SddDraft, type SddTrace } from '../sdd-draft-store'
import { clearDraftHistory, getDraftHistory } from '../sdd-draft-history'

type QuickCompleteInput = { prompt: string; systemPrompt?: string; providerId?: string; modelId?: string; workspaceRoot?: string }

vi.mock('../../workbench/MarkdownBlock', () => ({
  MarkdownBlock: ({ content }: { content: string }) => <div>{content}</div>
}))

const draft: SddDraft = {
  id: 'draft-1',
  workspaceRoot: 'E:\\workspace',
  relativePath: '.agenthub/requirements/draft-1/requirement.md',
  title: 'Checkout flow',
  content: [
    '# Checkout flow',
    '',
    '### R-1: Cart checkout {draft}',
    'Users can buy items.',
    '- [ ] submit payment'
  ].join('\n'),
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z'
}

const trace: SddTrace = {
  draftId: 'draft-1',
  requirementBlocks: [],
  planItems: [{
    id: 'P-1',
    text: 'Implement checkout (covers: R-1)',
    covers: ['R-1'],
    status: 'pending',
    lineNumber: 1
  }],
  coverage: { 'R-1': ['P-1'] },
  derivedStatuses: { 'R-1': 'planned' },
  uncoveredRequirementIds: [],
  timestamp: '2026-07-04T00:01:00.000Z'
}

const providers = [{
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-test',
  enabled: true,
  builtIn: false,
  models: [{ id: 'deepseek-chat', label: 'DeepSeek Chat', enabled: true }]
}]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installElectronApi(planMarkdown: string, options: {
  draftOverride?: SddDraft
  parseBlocks?: SddTrace['requirementBlocks']
  computeTrace?: () => Promise<SddTrace>
} = {}) {
  const activeDraft = options.draftOverride ?? draft
  const syncTodos = [{
    id: 'todo-1',
    threadId: 'thread-1',
    content: 'Implement checkout (covers: R-1)',
    status: 'pending' as const,
    source: { kind: 'plan' },
    updatedAt: Date.now()
  }]
  const calls: string[] = []
  const quickComplete = vi.fn(async (_input: QuickCompleteInput) => {
    calls.push('quickComplete')
    return { ok: true, content: planMarkdown }
  })
  const api = {
    ai: {
      quickComplete
    },
    sdd: {
      listDrafts: vi.fn(async () => [activeDraft]),
      createDraft: vi.fn(),
      getDraft: vi.fn(async (): Promise<SddDraft | null> => activeDraft),
      getTrace: vi.fn(async () => null),
      updateDraft: vi.fn(async () => { calls.push('updateDraft') }),
      updateDesignContext: vi.fn(),
      deleteDraft: vi.fn(),
      parseBlocks: vi.fn(async () => options.parseBlocks ?? []),
      computeTrace: vi.fn(options.computeTrace ?? (async () => trace)),
      saveTrace: vi.fn(async () => undefined),
      exists: vi.fn()
    },
    todos: {
      syncFromMarkdown: vi.fn(async () => syncTodos)
    }
  }
  ;(window as any).electronAPI = api
  return { api, calls }
}

describe('SddRequirementsList closed loop', () => {
  beforeEach(async () => {
    setLang('en')
    await clearDraftHistory(draft.id, draft.workspaceRoot)
    useSddDraftStore.persist.clearStorage()
    useSddDraftStore.getState().clearDraft()
    useSddDraftStore.getState().setActiveDraft(draft)
    useSddDraftStore.getState().setRequirementBlocks([{
      id: 'R-1',
      title: 'Cart checkout',
      status: 'draft',
      description: 'Users can buy items.',
      acceptanceCriteria: [{ text: 'submit payment', checked: false }],
      lineNumber: 3
    }])
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    await clearDraftHistory(draft.id, draft.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
  })

  it('stays in the list when opening a draft does not commit', async () => {
    const { api } = installElectronApi('- [ ] ignored')
    api.sdd.getDraft.mockResolvedValue(null)
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(useSddDraftStore.getState().error).toBe('Draft not found'))

    expect(view.container.querySelector('.sdd-list-mode')).toBeTruthy()
    expect(view.container.querySelector('.sdd-editor-container')).toBeNull()
  })

  it('invalidates an old pending open when workspaceRoot changes', async () => {
    const oldDraft = { ...draft, title: 'Old workspace draft' }
    const newDraft = { ...draft, id: 'draft-2', workspaceRoot: 'E:\\workspace-new', title: 'New workspace draft' }
    const pendingOldDraft = deferred<SddDraft | null>()
    const getDraft = vi.fn(() => pendingOldDraft.promise)
    const getTrace = vi.fn(async () => null)
    ;(window as any).electronAPI = {
      sdd: {
        listDrafts: vi.fn(async (workspaceRoot: string) => workspaceRoot === oldDraft.workspaceRoot ? [oldDraft] : [newDraft]),
        getDraft,
        getTrace
      }
    }
    useSddDraftStore.getState().clearDraft()
    const view = render(<SddRequirementsList workspaceRoot={oldDraft.workspaceRoot} threadId="thread-1" />)

    fireEvent.click(await view.findByText(oldDraft.title))
    await waitFor(() => expect(getDraft).toHaveBeenCalledWith(oldDraft.workspaceRoot, oldDraft.id))
    view.rerender(<SddRequirementsList workspaceRoot={newDraft.workspaceRoot} threadId="thread-1" />)
    await view.findByText(newDraft.title)

    await act(async () => {
      pendingOldDraft.resolve(oldDraft)
      await pendingOldDraft.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getTrace).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
    expect(view.container.querySelector('.sdd-list-mode')).toBeTruthy()
    expect(view.container.querySelector('.sdd-editor-container')).toBeNull()
  })

  it('invalidates an old pending open when the component unmounts', async () => {
    const pendingDraft = deferred<SddDraft | null>()
    const getDraft = vi.fn(() => pendingDraft.promise)
    const getTrace = vi.fn(async () => null)
    ;(window as any).electronAPI = {
      sdd: {
        listDrafts: vi.fn(async () => [draft]),
        getDraft,
        getTrace
      }
    }
    useSddDraftStore.getState().clearDraft()
    const view = render(<SddRequirementsList workspaceRoot={draft.workspaceRoot} threadId="thread-1" />)

    fireEvent.click(await view.findByText(draft.title))
    await waitFor(() => expect(getDraft).toHaveBeenCalledWith(draft.workspaceRoot, draft.id))
    view.unmount()

    await act(async () => {
      pendingDraft.resolve(draft)
      await pendingDraft.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getTrace).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft).toBeNull()
  })

  it('persists plan trace and syncs assistant plan todos to the active thread', async () => {
    const planMarkdown = '- [ ] Implement checkout (covers: R-1)'
    const { api } = installElectronApi(planMarkdown)
    const onThreadTodosChanged = vi.fn(async () => undefined)

    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        onThreadTodosChanged={onThreadTodosChanged}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Generate Plan/ }))

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.sdd.saveTrace).toHaveBeenCalledWith('E:\\workspace', 'draft-1', trace))
    expect(api.sdd.computeTrace).toHaveBeenCalledWith('E:\\workspace', 'draft-1', planMarkdown)
    expect(useSddDraftStore.getState().trace).toEqual(trace)

    const syncButton = await view.findByRole('button', { name: /Sync to Todo/ })
    fireEvent.click(syncButton)

    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith('thread-1', planMarkdown, {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    }))
    expect(onThreadTodosChanged).toHaveBeenCalledWith('thread-1')
    await view.findByText('Synced 1 todos')
  })

  it('does not persist an old plan response after an A-B-A draft session change', async () => {
    const planMarkdown = '- [ ] Stale plan for A (covers: R-1)'
    const pendingResponse = deferred<{ ok: true; content: string }>()
    const { api } = installElectronApi(planMarkdown)
    api.ai.quickComplete.mockImplementation(() => pendingResponse.promise)
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Generate Plan/ }))
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    act(() => {
      useSddDraftStore.getState().setActiveDraft({
        ...draft,
        id: 'draft-2',
        relativePath: '.agenthub/requirements/draft-2/requirement.md',
        title: 'Other draft'
      })
    })
    act(() => {
      useSddDraftStore.getState().setActiveDraft(draft)
    })

    await act(async () => {
      pendingResponse.resolve({ ok: true, content: planMarkdown })
      await pendingResponse.promise
    })
    await waitFor(() => expect(view.container.querySelector('.sdd-message-loading')).toBeNull())

    expect(api.sdd.computeTrace).not.toHaveBeenCalled()
    expect(api.sdd.saveTrace).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().trace).toBeNull()
  })

  it('does not attribute an old chat response after an A-B-A draft session change', async () => {
    const staleResponse = 'Add an A-only shipping address requirement.'
    const pendingResponse = deferred<{ ok: true; content: string }>()
    const { api } = installElectronApi(staleResponse)
    api.ai.quickComplete.mockImplementation(() => pendingResponse.promise)
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    fireEvent.click(view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement)
    const input = await view.findByPlaceholderText('Ask the assistant...')
    fireEvent.change(input, { target: { value: 'Improve draft A.' } })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    act(() => {
      useSddDraftStore.getState().setActiveDraft({
        ...draft,
        id: 'draft-2',
        relativePath: '.agenthub/requirements/draft-2/requirement.md',
        title: 'Other draft'
      })
    })
    act(() => {
      useSddDraftStore.getState().setActiveDraft(draft)
    })

    await act(async () => {
      pendingResponse.resolve({ ok: true, content: staleResponse })
      await pendingResponse.promise
    })
    await waitFor(() => expect(view.container.querySelector('.sdd-message-loading')).toBeNull())

    expect(view.queryByText(staleResponse)).toBeNull()
    expect(view.queryByRole('button', { name: /Apply to document/ })).toBeNull()
  })

  it('uses the selected provider model for requirement AI requests', async () => {
    const { api } = installElectronApi('- [ ] Implement checkout')
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        providers={providers}
        modelSelection={{ providerId: 'deepseek', modelId: 'deepseek-chat', source: 'provider' }}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Generate Plan/ }))

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    expect(api.ai.quickComplete.mock.calls[0][0]).toMatchObject({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      workspaceRoot: 'E:\\workspace'
    })
  })

  it('uses the latest selected provider model after a parent rerender', async () => {
    const { api } = installElectronApi('- [ ] Implement checkout')
    const stableEvents: RuntimeEvent[] = []
    const stableThreadTodos: ThreadTodo[] = []
    const stableProviders = [{
      ...providers[0],
      models: [
        { id: 'M1', label: 'Model M1', enabled: true },
        { id: 'M2', label: 'Model M2', enabled: true }
      ]
    }]
    const modelM1 = { providerId: 'deepseek', modelId: 'M1', source: 'provider' as const }
    const modelM2 = { providerId: 'deepseek', modelId: 'M2', source: 'provider' as const }
    const renderList = (modelSelection: typeof modelM1) => (
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        events={stableEvents}
        threadTodos={stableThreadTodos}
        providers={stableProviders}
        modelSelection={modelSelection}
      />
    )
    const view = render(renderList(modelM1))

    view.rerender(renderList(modelM2))
    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Generate Plan/ }))

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    expect(api.ai.quickComplete.mock.calls[0][0]).toMatchObject({
      providerId: 'deepseek',
      modelId: 'M2'
    })
  })

  it('syncs the current requirement document checklist to the active thread from the editor toolbar', async () => {
    const { api } = installElectronApi('- [ ] ignored plan', {
      parseBlocks: [{
        id: 'R-1',
        title: 'Cart checkout',
        status: 'draft',
        description: 'Users can buy items.',
        acceptanceCriteria: [{ text: 'submit payment', checked: false }],
        lineNumber: 3
      }]
    })
    const onThreadTodosChanged = vi.fn(async () => undefined)
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        onThreadTodosChanged={onThreadTodosChanged}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Sync Todo/ }))

    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith('thread-1', '- [ ] R-1: submit payment (covers: R-1)', {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    }))
    expect(onThreadTodosChanged).toHaveBeenCalledWith('thread-1')
    await view.findByText('Synced 1 todos')
  })

  it('does not reuse V1 requirement blocks when V2 document Todo parsing succeeds with no blocks', async () => {
    const oldBlocks = useSddDraftStore.getState().requirementBlocks
    const v2Content = '# Checkout V2\n\n- [ ] generic current-document task'
    const { api } = installElectronApi('- [ ] ignored plan', { parseBlocks: [] })
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    const syncButton = await view.findByRole('button', { name: /Sync Todo/ })
    act(() => {
      useSddDraftStore.getState().setRequirementBlocks(oldBlocks)
      useSddDraftStore.getState().setContent(v2Content)
    })
    fireEvent.click(syncButton)

    await waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalledWith(v2Content))
    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith('thread-1', '', {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    }))
    expect(api.todos.syncFromMarkdown).not.toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('R-1'),
      expect.anything()
    )
  })

  it('shows explicit feedback when the requirement document has no todo checklist items', async () => {
    const noChecklistDraft = {
      ...draft,
      content: [
        '# Checkout flow',
        '',
        '### R-1: Cart checkout {draft}',
        'Users can buy items.'
      ].join('\n')
    }
    const { api } = installElectronApi('- [ ] ignored plan', {
      draftOverride: noChecklistDraft
    })
    useSddDraftStore.getState().setActiveDraft(noChecklistDraft)
    useSddDraftStore.getState().setRequirementBlocks([{
      id: 'R-1',
      title: 'Cart checkout',
      status: 'draft',
      description: 'Users can buy items.',
      acceptanceCriteria: [],
      lineNumber: 3
    }])
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Sync Todo/ }))

    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith('thread-1', '', {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    }))
    await view.findByText('No todos parsed. Use - [ ] checklist items in the document.')
  })

  it('keeps document todo sync visible and explains when no thread is open', async () => {
    const { api } = installElectronApi('- [ ] ignored plan')
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId={null}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Sync Todo/ }))

    expect(api.todos.syncFromMarkdown).not.toHaveBeenCalled()
    await view.findByText('Open a thread first.')
  })

  it('does not send a requirement document to chat when block parsing fails', async () => {
    const { api } = installElectronApi('- [ ] ignored plan')
    ;(api.sdd.parseBlocks as any).mockRejectedValue(new Error('parse unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSendRequirementToChat = vi.fn(async () => undefined)
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        onSendRequirementToChat={onSendRequirementToChat}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Send doc to chat/ }))
    await waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(onSendRequirementToChat).not.toHaveBeenCalled()
  })

  it('does not sync document todos when block parsing fails', async () => {
    const { api } = installElectronApi('- [ ] ignored plan')
    ;(api.sdd.parseBlocks as any).mockRejectedValue(new Error('parse unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Sync Todo/ }))
    await waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(api.todos.syncFromMarkdown).not.toHaveBeenCalled()
  })

  it.each([
    ['plan', /Generate Plan/],
    ['verify', /Verify/]
  ] as const)('does not send an assistant %s request when block parsing fails', async (_mode, buttonName) => {
    const { api } = installElectronApi('- [ ] ignored plan')
    ;(api.sdd.parseBlocks as any).mockRejectedValue(new Error('parse unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: buttonName }))
    await waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(api.ai.quickComplete).not.toHaveBeenCalled()
  })

  it('saves dirty draft content before generating a plan and sends the latest content to AI', async () => {
    const dirtyContent = [
      '# Checkout flow',
      '',
      '### R-1: Cart checkout {draft}',
      'Users can buy items with a saved card.',
      '- [ ] submit saved-card payment'
    ].join('\n')
    const parsedBlocks = [{
      id: 'R-1',
      title: 'Cart checkout',
      status: 'draft' as const,
      description: 'Users can buy items with a saved card.',
      acceptanceCriteria: [{ text: 'submit saved-card payment', checked: false }],
      lineNumber: 3
    }]
    const { api, calls } = installElectronApi('- [ ] Implement saved card checkout (covers: R-1)', {
      parseBlocks: parsedBlocks
    })
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    await view.findByRole('textbox')
    act(() => {
      useSddDraftStore.getState().setContent(dirtyContent)
    })
    await waitFor(() => expect(useSddDraftStore.getState().saveStatus).toBe('dirty'))
    fireEvent.click(await view.findByRole('button', { name: /Generate Plan/ }))

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    expect(calls.indexOf('updateDraft')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('updateDraft')).toBeLessThan(calls.indexOf('quickComplete'))
    expect(api.sdd.updateDraft).toHaveBeenCalledWith('E:\\workspace', 'draft-1', dirtyContent, undefined)
    expect(api.sdd.parseBlocks).toHaveBeenCalledWith(dirtyContent)
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('saved card')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).not.toContain('Users can buy items.\n- [ ] submit payment')
  })

  it('runs acceptance verification and applies passing verdicts only after user action', async () => {
    const verification = [
      '## Verification report',
      '```sdd-verify-json',
      '{"criteria":[{"requirementId":"R-1","criterionIndex":0,"status":"pass","reason":"payment implemented"}]}',
      '```'
    ].join('\n')
    const { api } = installElectronApi(verification, {
      parseBlocks: [{
        id: 'R-1',
        title: 'Cart checkout',
        status: 'draft',
        description: 'Users can buy items.',
        acceptanceCriteria: [{ text: 'submit payment', checked: false }],
        lineNumber: 3
      }]
    })
    const threadTodos: ThreadTodo[] = [{
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'completed',
      source: {
        kind: 'plan',
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        planItemId: 'T-1',
        turnId: 'turn-1'
      },
      updatedAt: 1
    }]
    const events: RuntimeEvent[] = [{
      id: 'event-2',
      threadId: 'thread-1',
      turnId: 'turn-1',
      seq: 1,
      kind: 'turn:summary',
      agentId: 'dispatch-planner',
      payload: {
        intent: 'implementation',
        matchedSkills: ['tdd'],
        strategy: 'single',
        effectiveMode: 'direct',
        dispatchMode: 'auto',
        selectedAgentId: 'codex'
      },
      createdAt: 1
    }, {
      id: 'event-3',
      threadId: 'thread-1',
      turnId: 'turn-1',
      seq: 2,
      kind: 'run:status',
      agentId: 'codex',
      payload: { status: 'completed', taskId: 'task-1' },
      createdAt: 2
    }]
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        threadTodos={threadTodos}
        events={events}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Verify/ }))

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    expect(api.ai.quickComplete.mock.calls[0][0].systemPrompt).toContain('sdd-verify-json')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('R-1::0 [ ] submit payment')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('Verification Evidence')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('Current thread SDD todos')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('intent=implementation')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('selected=codex')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('run - completed - task-1')
    expect(api.sdd.updateDraft).not.toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining('- [x] submit payment'),
      undefined
    )

    fireEvent.click(await view.findByRole('button', { name: /Apply passed/ }))

    await waitFor(() => expect(api.sdd.updateDraft).toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining('- [x] submit payment'),
      undefined
    ))
    await view.findByText('Applied 1 passing criteria')
  })

  it('automatically starts verification when a scoped dispatched plan Todo completes', async () => {
    const verification = [
      '## Verification report',
      '```sdd-verify-json',
      '{"criteria":[{"requirementId":"R-1","criterionIndex":0,"status":"unknown"}]}',
      '```'
    ].join('\n')
    const { api } = installElectronApi(verification, {
      parseBlocks: [{
        id: 'R-1',
        title: 'Cart checkout',
        status: 'draft',
        description: 'Users can buy items.',
        acceptanceCriteria: [{ text: 'submit payment', checked: false }],
        lineNumber: 3
      }]
    })
    const scopedTrace: SddTrace = {
      ...trace,
      planItems: [{
        id: 'T-1',
        text: 'T-1: Implement checkout (covers: R-1)',
        covers: ['R-1'],
        status: 'completed',
        lineNumber: 1,
        turnId: 'turn-1'
      }],
      coverage: { 'R-1': ['T-1'] }
    }
    useSddDraftStore.getState().setTrace(scopedTrace)
    const pendingThreadTodos: ThreadTodo[] = [{
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'pending',
      source: {
        kind: 'plan',
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        relativePath: '.agenthub/requirements/draft-1/requirement.md',
        planItemId: 'T-1',
        turnId: 'turn-1'
      },
      updatedAt: 1
    }]
    const completedThreadTodos: ThreadTodo[] = [{
      ...pendingThreadTodos[0],
      status: 'completed'
    }]
    const completedEvents: RuntimeEvent[] = [{
      id: 'event-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      seq: 1,
      kind: 'turn:status',
      payload: { status: 'completed' },
      createdAt: 1
    }]

    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        threadTodos={pendingThreadTodos}
        events={[]}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    expect(api.ai.quickComplete).not.toHaveBeenCalled()

    view.rerender(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        threadTodos={completedThreadTodos}
        events={completedEvents}
      />
    )

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    expect(api.ai.quickComplete.mock.calls[0][0].systemPrompt).toContain('sdd-verify-json')
    expect(api.ai.quickComplete.mock.calls[0][0].prompt).toContain('turn - completed')
    await view.findByText('Unknown 1')
  })

  it('rejects stale verification apply after the draft content changes', async () => {
    const verification = [
      '## Verification report',
      '```sdd-verify-json',
      '{"criteria":[{"requirementId":"R-1","criterionIndex":0,"status":"pass"}]}',
      '```'
    ].join('\n')
    const { api } = installElectronApi(verification, {
      parseBlocks: [{
        id: 'R-1',
        title: 'Cart checkout',
        status: 'draft',
        description: 'Users can buy items.',
        acceptanceCriteria: [{ text: 'submit payment', checked: false }],
        lineNumber: 3
      }]
    })
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    fireEvent.click(await view.findByRole('button', { name: /Verify/ }))
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    act(() => {
      useSddDraftStore.getState().setContent(`${useSddDraftStore.getState().content}\n- [ ] later criterion`)
    })
    fireEvent.click(await view.findByRole('button', { name: /Apply passed/ }))

    await view.findByText('Requirement document changed after verification. Re-run verification before applying results.')
    expect(api.sdd.updateDraft).not.toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining('- [x] submit payment'),
      undefined
    )
  })

  it('can run verification twice while the assistant panel stays open', async () => {
    const verification = [
      '## Verification report',
      '```sdd-verify-json',
      '{"criteria":[{"requirementId":"R-1","criterionIndex":0,"status":"unknown"}]}',
      '```'
    ].join('\n')
    const { api } = installElectronApi(verification)
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    const verifyButton = await view.findByRole('button', { name: /Verify/ })
    fireEvent.click(verifyButton)
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    fireEvent.click(verifyButton)
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(2))
  })

  it('requires confirmation before normal assistant chat updates the requirement document', async () => {
    const assistantResponse = 'Add shipping address collection to the checkout requirement.'
    const { api } = installElectronApi(assistantResponse)
    const onThreadTodosChanged = vi.fn(async () => undefined)
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
        onThreadTodosChanged={onThreadTodosChanged}
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    const assistantButton = view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement
    fireEvent.click(assistantButton!)

    const input = await view.findByPlaceholderText('Ask the assistant...')
    fireEvent.change(input, { target: { value: 'Please improve the requirement.' } })
    const sendButton = view.container.querySelector('.sdd-composer-send') as HTMLButtonElement | null
    expect(sendButton).toBeTruthy()
    fireEvent.click(sendButton!)

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    expect(api.sdd.updateDraft).not.toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining(assistantResponse),
      undefined
    )
    await view.findByRole('button', { name: /Apply to document/ })

    fireEvent.click(await view.findByRole('button', { name: /Preview changes/ }))
    await view.findByText(assistantResponse)

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))
    await waitFor(() => expect(api.sdd.updateDraft).toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining(assistantResponse),
      undefined
    ))
    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith(
      'thread-1',
      '- [ ] R-1: submit payment (covers: R-1)',
      {
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        relativePath: '.agenthub/requirements/draft-1/requirement.md'
      }
    ))
    expect(onThreadTodosChanged).toHaveBeenCalledWith('thread-1')

    const history = getDraftHistory('draft-1', 'E:\\workspace')
    expect(history).toHaveLength(1)
    expect(history[0].message).toContain('assistant requirement writeback')
    expect(history[0].content).toBe(draft.content)
  })

  it('rejects stale normal assistant apply after the draft content changes', async () => {
    const assistantResponse = 'Add shipping address collection to the checkout requirement.'
    const { api } = installElectronApi(assistantResponse)
    const view = render(
      <SddRequirementsList
        workspaceRoot="E:\\workspace"
        threadId="thread-1"
      />
    )

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    fireEvent.click(view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement)

    const input = await view.findByPlaceholderText('Ask the assistant...')
    fireEvent.change(input, { target: { value: 'Please improve the requirement.' } })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)

    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))
    act(() => {
      useSddDraftStore.getState().setContent(`${useSddDraftStore.getState().content}\n- [ ] later criterion`)
    })

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))

    await view.findByText('Requirement document changed after this AI response. Ask again before applying it.')
    expect(api.sdd.updateDraft).not.toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining(assistantResponse),
      undefined
    )
  })

  it('does not overwrite an edit made while assistant apply history is saving', async () => {
    const assistantResponse = 'Add shipping address collection to the checkout requirement.'
    const historySave = deferred<void>()
    const { api } = installElectronApi(assistantResponse)
    const saveHistory = vi.fn(() => historySave.promise)
    ;(api.sdd as any).saveHistory = saveHistory
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    fireEvent.click(view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement)
    const input = await view.findByPlaceholderText('Ask the assistant...')
    fireEvent.change(input, { target: { value: 'Please improve the requirement.' } })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))
    await waitFor(() => expect(saveHistory).toHaveBeenCalledOnce())
    act(() => {
      useSddDraftStore.getState().setContent('# newer edit during history save')
    })
    historySave.resolve()

    await view.findByText('Requirement document changed after this AI response. Ask again before applying it.')
    expect(useSddDraftStore.getState().content).toBe('# newer edit during history save')
    expect(api.sdd.updateDraft).not.toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining(assistantResponse),
      undefined
    )
  })

  it('does not reuse V1 requirement blocks after assistant apply replaces the document with generic V2 checklist content', async () => {
    const oldBlocks = useSddDraftStore.getState().requirementBlocks
    const assistantResponse = [
      '# Checkout V2',
      '',
      '## 验收标准',
      '',
      '- [ ] generic current-document task'
    ].join('\n')
    const { api } = installElectronApi(assistantResponse, { parseBlocks: [] })
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    act(() => {
      useSddDraftStore.getState().setRequirementBlocks(oldBlocks)
    })
    fireEvent.click(view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement)
    const input = await view.findByPlaceholderText('Ask the assistant...')
    fireEvent.change(input, { target: { value: 'Replace this with the V2 document.' } })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))

    await waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalledWith(expect.stringContaining('generic current-document task')))
    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith('thread-1', '', {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    }))
    expect(api.todos.syncFromMarkdown).not.toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining('R-1'),
      expect.anything()
    )
  })

  it('does not sync or pollute another workspace draft when assistant apply parsing becomes stale', async () => {
    const assistantResponse = 'Add shipping address collection to the checkout requirement.'
    const pendingBlocks = deferred<SddTrace['requirementBlocks']>()
    const parsedWorkspaceABlocks = [{
      id: 'R-A',
      title: 'Workspace A checkout',
      status: 'draft' as const,
      description: assistantResponse,
      acceptanceCriteria: [{ text: 'collect shipping address', checked: false }],
      lineNumber: 3
    }]
    const workspaceBBlocks = [{
      id: 'R-B',
      title: 'Workspace B checkout',
      status: 'planned' as const,
      description: 'Must remain owned by workspace B.',
      acceptanceCriteria: [{ text: 'keep workspace B intact', checked: false }],
      lineNumber: 3
    }]
    const { api } = installElectronApi(assistantResponse)
    ;(api.sdd.parseBlocks as any).mockImplementation((content: string) => (
      content.includes(assistantResponse) ? pendingBlocks.promise : Promise.resolve([])
    ))
    const view = render(<SddRequirementsList workspaceRoot="E:\\workspace" threadId="thread-1" />)

    fireEvent.click(await view.findByText('Checkout flow'))
    await waitFor(() => expect(view.container.querySelector('button[title="AI Assistant"]')).toBeTruthy())
    fireEvent.click(view.container.querySelector('button[title="AI Assistant"]') as HTMLButtonElement)
    const input = await view.findByPlaceholderText('Ask the assistant...')
    fireEvent.change(input, { target: { value: 'Please improve the requirement.' } })
    fireEvent.click(view.container.querySelector('.sdd-composer-send') as HTMLButtonElement)
    await waitFor(() => expect(api.ai.quickComplete).toHaveBeenCalledTimes(1))

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))
    await waitFor(() => expect(api.sdd.parseBlocks).toHaveBeenCalledWith(expect.stringContaining(assistantResponse)))
    const appliedContent = useSddDraftStore.getState().content
    act(() => {
      useSddDraftStore.getState().setActiveDraft({
        ...draft,
        workspaceRoot: 'E:\\workspace-b',
        relativePath: '.agenthub/requirements-b/draft-1/requirement.md',
        title: 'Workspace B checkout',
        content: appliedContent
      })
      useSddDraftStore.getState().setRequirementBlocks(workspaceBBlocks)
    })

    await act(async () => {
      pendingBlocks.resolve(parsedWorkspaceABlocks)
      await pendingBlocks.promise
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(api.todos.syncFromMarkdown).not.toHaveBeenCalled()
    expect(useSddDraftStore.getState().activeDraft?.workspaceRoot).toBe('E:\\workspace-b')
    expect(useSddDraftStore.getState().requirementBlocks).toEqual(workspaceBBlocks)
  })
})
