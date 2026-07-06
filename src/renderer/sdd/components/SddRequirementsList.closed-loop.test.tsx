// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { SddRequirementsList } from './SddRequirementsList'
import { useSddDraftStore, type SddDraft, type SddTrace } from '../sdd-draft-store'
import { clearDraftHistory, getDraftHistory } from '../sdd-draft-history'

type QuickCompleteInput = { prompt: string; systemPrompt?: string; providerId?: string; modelId?: string }

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

function installElectronApi(planMarkdown: string, options: {
  parseBlocks?: SddTrace['requirementBlocks']
  computeTrace?: () => Promise<SddTrace>
} = {}) {
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
      listDrafts: vi.fn(async () => [draft]),
      createDraft: vi.fn(),
      getDraft: vi.fn(async () => draft),
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
  beforeEach(() => {
    setLang('en')
    clearDraftHistory(draft.id, draft.workspaceRoot)
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

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as any).electronAPI
    clearDraftHistory(draft.id, draft.workspaceRoot)
    useSddDraftStore.getState().clearDraft()
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
      modelId: 'deepseek-chat'
    })
  })

  it('syncs the current requirement document checklist to the active thread from the editor toolbar', async () => {
    const { api } = installElectronApi('- [ ] ignored plan')
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

    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith('thread-1', draft.content, {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    }))
    expect(onThreadTodosChanged).toHaveBeenCalledWith('thread-1')
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
    expect(api.sdd.updateDraft).toHaveBeenCalledWith('E:\\workspace', 'draft-1', dirtyContent)
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
      expect.stringContaining('- [x] submit payment')
    )

    fireEvent.click(await view.findByRole('button', { name: /Apply passed/ }))

    await waitFor(() => expect(api.sdd.updateDraft).toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining('- [x] submit payment')
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
      expect.stringContaining('- [x] submit payment')
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
      expect.stringContaining(assistantResponse)
    )
    await view.findByRole('button', { name: /Apply to document/ })

    fireEvent.click(await view.findByRole('button', { name: /Preview changes/ }))
    await view.findByText(assistantResponse)

    fireEvent.click(await view.findByRole('button', { name: /Apply to document/ }))
    await waitFor(() => expect(api.sdd.updateDraft).toHaveBeenCalledWith(
      'E:\\workspace',
      'draft-1',
      expect.stringContaining(assistantResponse)
    ))
    await waitFor(() => expect(api.todos.syncFromMarkdown).toHaveBeenCalledWith(
      'thread-1',
      expect.stringContaining(assistantResponse),
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
      expect.stringContaining(assistantResponse)
    )
  })
})
