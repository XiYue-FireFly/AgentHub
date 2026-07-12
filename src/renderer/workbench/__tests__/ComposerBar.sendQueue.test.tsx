// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../glass/i18n'
import { ComposerBar, sha256Text, type ComposerSendResult } from '../ComposerBar'
import * as mainContentModule from '../WorkbenchMainContent'
import { resolveDispatchRequest } from '../utils/dispatchRequest'
import type { DecisionItem } from '../decisions/decisionAdapters'

const PersistentComposer = (mainContentModule as unknown as {
  PersistentComposer?: React.ComponentType<{
    active: boolean
    composerProps: React.ComponentProps<typeof ComposerBar>
  }>
}).PersistentComposer

const attachment: WorkbenchAttachment = {
  id: 'attachment-1',
  kind: 'file',
  name: 'notes.md',
  path: 'C:\\repo\\notes.md',
  createdAt: 1
}

const schedule: SchedulePreview = {
  preset: 'custom',
  label: 'Snapshot schedule',
  description: 'snapshot',
  steps: [
    { id: 'first', label: 'First', agentId: 'codex', role: 'worker', mode: 'auto' },
    { id: 'second', label: 'Second', agentId: 'codex', role: 'reviewer', mode: 'auto', dependsOn: ['first'] }
  ]
}

function installApi(commands: WorkbenchCommand[] = []) {
  ;(window as any).electronAPI = {
    agentic: {
      getApprovalConfig: vi.fn().mockResolvedValue({ version: 1, preset: 'auto', default: { write: 'allow', exec: 'allow' }, overrides: {} })
    },
    commands: { list: vi.fn().mockResolvedValue(commands) },
    plugins: { scan: vi.fn().mockResolvedValue([]), contributions: vi.fn().mockResolvedValue([]) },
    budget: {
      estimateDispatch: vi.fn().mockResolvedValue({ check: { allowed: true }, estimate: {} })
    },
    notifications: { push: vi.fn().mockResolvedValue(undefined) }
  }
}

function baseProps(overrides: Partial<React.ComponentProps<typeof ComposerBar>> = {}): React.ComponentProps<typeof ComposerBar> {
  return {
    mode: 'auto',
    setMode: vi.fn(),
    providers: [],
    bindings: [],
    modelSelection: null,
    setModelSelection: vi.fn(),
    thinking: { mode: 'off', level: 'minimal' },
    setThinking: vi.fn(),
    schedules: [],
    scheduleForMode: () => undefined,
    sending: false,
    onSend: vi.fn().mockResolvedValue({ ok: true }),
    onCancel: vi.fn(),
    workspaceId: 'workspace-1',
    workspaces: [],
    setWorkspaceId: vi.fn(),
    onCreateProject: vi.fn(),
    localAgents: [{
      agentId: 'codex',
      label: 'Codex',
      installed: true,
      configured: true,
      loginState: 'ready',
      candidates: [],
      workspaceSession: 'per-dispatch'
    }],
    targetAgent: null,
    setTargetAgent: vi.fn(),
    agents: {},
    ...overrides
  }
}

function renderComposer(overrides: Partial<React.ComponentProps<typeof ComposerBar>> = {}) {
  let props = baseProps(overrides)
  const view = render(<ComposerBar {...props} />)
  return {
    props,
    rerender(next: Partial<React.ComponentProps<typeof ComposerBar>>) {
      props = { ...props, ...next }
      view.rerender(<ComposerBar {...props} />)
      this.props = props
    }
  }
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

function composerEditor(): HTMLTextAreaElement {
  return document.querySelector('.wb-composer-input') as HTMLTextAreaElement
}

function enter(text: string) {
  fireEvent.change(editor(), { target: { value: text } })
  fireEvent.keyDown(editor(), { key: 'Enter', code: 'Enter' })
}

beforeEach(() => {
  setLang('en')
  installApi()
})

afterEach(() => {
  cleanup()
  delete (window as any).electronAPI
  vi.restoreAllMocks()
})

describe('ComposerBar submission results', () => {
  it.each([
    ['create rejected', { ok: false, reason: 'create-failed' }],
    ['routing unavailable', { ok: false, reason: 'routing-unavailable' }],
    ['busy', { ok: false, reason: 'busy' }],
    ['cancelled', { ok: false, reason: 'cancelled' }]
  ] as Array<[string, ComposerSendResult]>)('preserves prompt and attachments when %s', async (_label, result) => {
    const onSend = vi.fn().mockResolvedValue(result)
    renderComposer({ onSend, externalAttachments: [attachment] })
    await screen.findByText('notes.md')
    fireEvent.change(editor(), { target: { value: 'Keep this draft' } })

    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(editor().value).toBe('Keep this draft'))
    expect(screen.getByText('notes.md')).toBeTruthy()
  })

  it('preserves an attachment-only submission when sending fails', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, reason: 'create-failed' })
    renderComposer({ onSend, externalAttachments: [attachment] })
    await screen.findByText('notes.md')

    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(screen.getByText('notes.md')).toBeTruthy()
  })

  it('clears an unchanged draft only after deferred success and never overwrites a newer draft', async () => {
    let finish!: (result: ComposerSendResult) => void
    const onSend = vi.fn(() => new Promise<ComposerSendResult>(resolve => { finish = resolve }))
    renderComposer({ onSend })
    enter('Submitted draft')
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(editor().value).toBe('Submitted draft')

    fireEvent.change(editor(), { target: { value: 'New draft while waiting' } })
    await act(async () => finish({ ok: true }))

    expect(editor().value).toBe('New draft while waiting')
  })

  it('clears the submitted draft after deferred success when the user has not changed it', async () => {
    let finish!: (result: ComposerSendResult) => void
    const onSend = vi.fn(() => new Promise<ComposerSendResult>(resolve => { finish = resolve }))
    renderComposer({ onSend })
    enter('Clear after success')
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(editor().value).toBe('Clear after success')

    await act(async () => finish({ ok: true }))

    await waitFor(() => expect(editor().value).toBe(''))
  })

  it('does not overwrite a newer draft when a deferred submission fails', async () => {
    let finish!: (result: ComposerSendResult) => void
    const onSend = vi.fn(() => new Promise<ComposerSendResult>(resolve => { finish = resolve }))
    renderComposer({ onSend })
    enter('Failed submission')
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    fireEvent.change(editor(), { target: { value: 'New draft while failing' } })

    await act(async () => finish({ ok: false, reason: 'create-failed' }))

    expect(editor().value).toBe('New draft while failing')
    expect(screen.getByText(/1 queued/)).toBeTruthy()
  })
})

describe('ComposerBar multi-model fusion control', () => {
  it('renders one accessible toggle and reports its selected state', () => {
    const setMultiModelFusion = vi.fn()
    const view = renderComposer({ multiModelFusion: false, setMultiModelFusion })
    const toggles = screen.getAllByRole('button', { name: 'Multi-model fusion' })

    expect(toggles).toHaveLength(1)
    expect(toggles[0].getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggles[0])
    expect(setMultiModelFusion).toHaveBeenCalledWith(true)

    view.rerender({ multiModelFusion: true })
    expect(screen.getByRole('button', { name: 'Multi-model fusion' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('ComposerBar queue worker', () => {
  it.each([
    ['auto', 'auto'],
    ['broadcast', 'all']
  ] as const)('sends the built-in %s placeholder through normal routing without a custom schedule snapshot', async (mode, agentId) => {
    const preview: SchedulePreview = {
      preset: mode,
      label: `${mode} preview`,
      description: 'built-in preview',
      steps: [{ id: mode, label: mode, agentId, role: 'worker', mode }]
    }
    let resolved: ReturnType<typeof resolveDispatchRequest> | null = null
    const onSend = vi.fn(async (_text: string, _attachments?: WorkbenchAttachment[], overrides = {}): Promise<ComposerSendResult> => {
      resolved = resolveDispatchRequest({
        targetAgent: null,
        modelSelection: null,
        mode,
        overrides,
        usableLocalAgents: ['codex'],
        scheduleForMode: () => undefined
      })
      return resolved.scheduleUnavailable ? { ok: false, reason: 'schedule-unavailable' } : { ok: true }
    })
    const view = renderComposer({ sending: true, mode, scheduleForMode: () => preview, onSend })
    enter(`${mode} prompt`)

    view.rerender({ sending: false })

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    expect(onSend.mock.calls[0][2]?.customSchedule).toBeNull()
    expect(resolved).toMatchObject({ mode, customSchedule: undefined, scheduleUnavailable: false })
  })

  it('drains three items FIFO exactly once without leaving sent text in the editor', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    const view = renderComposer({ sending: true, onSend })
    enter('first')
    enter('second')
    enter('third')
    expect(screen.getByText(/3 queued/)).toBeTruthy()

    view.rerender({ sending: false })

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3))
    expect(onSend.mock.calls.map(call => call[0])).toEqual(['first', 'second', 'third'])
    await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull())
    expect(editor().value).toBe('')
  })

  it('retains a failed head, stops later items, then retries the head before continuing', async () => {
    const onSend = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'create-failed' })
      .mockResolvedValue({ ok: true })
    const view = renderComposer({ sending: true, onSend })
    enter('first')
    enter('second')

    view.rerender({ sending: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/2 queued/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3))
    expect(onSend.mock.calls.map(call => call[0])).toEqual(['first', 'first', 'second'])
    expect(screen.queryByText(/queued/)).toBeNull()
  })

  it('does not duplicate an in-flight head when effects rerun or sending toggles', async () => {
    let finish!: (result: ComposerSendResult) => void
    const onSend = vi.fn(() => new Promise<ComposerSendResult>(resolve => { finish = resolve }))
    const view = renderComposer({ sending: true, onSend })
    enter('only once')
    view.rerender({ sending: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))

    view.rerender({ sending: true })
    view.rerender({ sending: false })
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(onSend).toHaveBeenCalledTimes(1)

    await act(async () => finish({ ok: true }))
    await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull())
  })

  it('sends an immutable routing, schedule, attachment, and explicit-null snapshot', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    const originalAttachment = { ...attachment }
    const originalSchedule: SchedulePreview = {
      ...schedule,
      steps: schedule.steps.map(step => ({ ...step, dependsOn: step.dependsOn ? [...step.dependsOn] : undefined }))
    }
    const view = renderComposer({
      sending: true,
      onSend,
      mode: 'custom',
      targetAgent: null,
      modelSelection: null,
      scheduleForMode: () => originalSchedule,
      externalAttachments: [originalAttachment]
    })
    await screen.findByText('notes.md')
    enter('snapshot')

    originalAttachment.name = 'mutated.md'
    originalSchedule.steps[1].label = 'Mutated'
    originalSchedule.steps[1].dependsOn?.push('mutated')
    view.rerender({
      sending: false,
      mode: 'auto',
      targetAgent: 'codex',
      modelSelection: { source: 'provider', providerId: 'deepseek', modelId: 'deepseek-chat' },
      scheduleForMode: () => undefined
    })

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0][1]).toEqual([attachment])
    expect(onSend.mock.calls[0][2]).toMatchObject({
      mode: 'custom',
      targetAgent: null,
      modelSelection: null,
      customSchedule: {
        steps: [
          expect.objectContaining({ id: 'first' }),
          expect.objectContaining({ id: 'second', label: 'Second', dependsOn: ['first'] })
        ]
      }
    })
  })

  it('snapshots the enabled multi-model fusion choice for a queued submission', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    const view = renderComposer({ sending: true, onSend, multiModelFusion: true })
    enter('Compare independent approaches')

    view.rerender({ sending: false, multiModelFusion: false })

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0][2]).toMatchObject({ multiModelFusion: true })
  })

  it('rebuilds an invalid-route head with the current route, then continues its tail', async () => {
    const codexSchedule: SchedulePreview = {
      ...schedule,
      steps: [{ id: 'codex', label: 'Codex', agentId: 'codex', role: 'worker', mode: 'auto' }]
    }
    const geminiSchedule: SchedulePreview = {
      ...schedule,
      steps: [{ id: 'gemini', label: 'Gemini', agentId: 'gemini', role: 'worker', mode: 'auto' }]
    }
    const onSend = vi.fn(async (_text: string, _attachments: WorkbenchAttachment[] | undefined, overrides: any): Promise<ComposerSendResult> => (
      overrides.customSchedule.steps[0].agentId === 'codex'
        ? { ok: false, reason: 'schedule-target-unavailable' }
        : { ok: true }
    ))
    const view = renderComposer({ sending: true, onSend, mode: 'custom', scheduleForMode: () => codexSchedule })
    enter('head')
    view.rerender({ scheduleForMode: () => geminiSchedule })
    enter('tail')
    view.rerender({ sending: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/2 queued/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Send'))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3))
    expect(onSend.mock.calls.map(call => [call[0], call[2].customSchedule.steps[0].agentId])).toEqual([
      ['head', 'codex'],
      ['head', 'gemini'],
      ['tail', 'gemini']
    ])
  })

  it.each([
    'routing-unavailable',
    'schedule-target-unavailable',
    'schedule-unavailable'
  ] as const)('requires an explicit owner move before rebuilding a %s head on the current route', async reason => {
    const codexSchedule: SchedulePreview = {
      ...schedule,
      steps: [{ id: 'codex', label: 'Codex', agentId: 'codex', role: 'worker', mode: 'auto' }]
    }
    const geminiSchedule: SchedulePreview = {
      ...schedule,
      steps: [{ id: 'gemini', label: 'Gemini', agentId: 'gemini', role: 'worker', mode: 'auto' }]
    }
    let finishRetry!: (result: ComposerSendResult) => void
    const onSend = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason })
      .mockImplementationOnce(() => new Promise<ComposerSendResult>(resolve => { finishRetry = resolve }))
      .mockResolvedValue({ ok: true })
    const view = renderComposer({
      onSend,
      mode: 'custom',
      workspaceId: 'workspace-a',
      threadId: 'thread-a',
      scheduleForMode: () => codexSchedule
    })
    enter('A head')
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())

    view.rerender({
      workspaceId: 'workspace-b',
      threadId: 'thread-b',
      scheduleForMode: () => geminiSchedule
    })
    fireEvent.click(screen.getByTitle('Send'))
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(onSend).toHaveBeenCalledOnce()
    const move = await screen.findByRole('button', { name: 'Move queued message to current thread and retry' })

    fireEvent.click(move)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend.mock.calls[1][2].customSchedule.steps[0].agentId).toBe('gemini')

    enter('B tail')
    await act(async () => finishRetry({ ok: true }))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3))
    expect(onSend.mock.calls.map(call => [call[0], call[2].customSchedule.steps[0].agentId])).toEqual([
      ['A head', 'codex'],
      ['A head', 'gemini'],
      ['B tail', 'gemini']
    ])
    expect(screen.queryByText(/queued/)).toBeNull()
  })

  it('does not leak a route-rebuild move marker into a later owner-only submission', async () => {
    const codexSchedule: SchedulePreview = {
      ...schedule,
      steps: [{ id: 'codex', label: 'Codex', agentId: 'codex', role: 'worker', mode: 'auto' }]
    }
    const geminiSchedule: SchedulePreview = {
      ...schedule,
      steps: [{ id: 'gemini', label: 'Gemini', agentId: 'gemini', role: 'worker', mode: 'auto' }]
    }
    let head1Attempts = 0
    const onSend = vi.fn(async (
      text: string,
      _attachments?: WorkbenchAttachment[],
      _overrides?: any
    ): Promise<ComposerSendResult> => {
      if (text === 'head 1' && head1Attempts++ === 0) return { ok: false, reason: 'routing-unavailable' }
      return { ok: true }
    })
    const view = renderComposer({
      onSend,
      mode: 'custom',
      workspaceId: 'workspace-a',
      threadId: 'thread-a',
      scheduleForMode: () => codexSchedule
    })
    enter('head 1')
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())

    view.rerender({
      workspaceId: 'workspace-b',
      threadId: 'thread-b',
      scheduleForMode: () => geminiSchedule
    })
    fireEvent.click(screen.getByTitle('Send'))
    await screen.findByRole('button', { name: 'Move queued message to current thread and retry' })
    expect(onSend).toHaveBeenCalledOnce()

    view.rerender({
      workspaceId: 'workspace-a',
      threadId: 'thread-a',
      scheduleForMode: () => codexSchedule
    })
    fireEvent.click(screen.getByTitle('Send'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull())

    view.rerender({ sending: true })
    enter('head 2')
    view.rerender({
      sending: false,
      workspaceId: 'workspace-b',
      threadId: 'thread-b',
      scheduleForMode: () => geminiSchedule
    })
    const moveHead2 = await screen.findByRole('button', { name: 'Move queued message to current thread and retry' })

    fireEvent.click(moveHead2)

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3))
    expect(onSend.mock.calls[2][0]).toBe('head 2')
    expect(onSend.mock.calls[2]?.[2]?.customSchedule.steps[0].agentId).toBe('codex')
    expect(screen.queryByText(/queued/)).toBeNull()
  })

  it('pauses an in-flight head on Stop, ignores its late success, and resumes head then tail', async () => {
    let finishFirst!: (result: ComposerSendResult) => void
    const onSend = vi.fn()
      .mockImplementationOnce(() => new Promise<ComposerSendResult>(resolve => { finishFirst = resolve }))
      .mockResolvedValue({ ok: true })
    const onCancel = vi.fn()
    const view = renderComposer({ sending: true, onSend, onCancel })
    enter('A')
    enter('B')
    view.rerender({ sending: false })
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTitle('Stop'))
    expect(onCancel).toHaveBeenCalledOnce()
    await act(async () => finishFirst({ ok: true }))
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/2 queued/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Send'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(3))
    expect(onSend.mock.calls.map(call => call[0])).toEqual(['A', 'A', 'B'])
  })

  it('pauses queued work when Stop happens during external sending', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    const view = renderComposer({ sending: true, onSend })
    enter('wait')
    fireEvent.click(screen.getByTitle('Stop'))

    view.rerender({ sending: false })
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/1 queued/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Send'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
  })

  it('does not silently send a snapshotted item after its thread or workspace owner changes', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    const view = renderComposer({ sending: true, onSend, workspaceId: 'workspace-1', threadId: 'thread-1' })
    enter('owned')

    view.rerender({ sending: false, workspaceId: 'workspace-2', threadId: 'thread-2' })
    await new Promise(resolve => setTimeout(resolve, 80))

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/1 queued/)).toBeTruthy()
  })

  it('moves an owner-blocked head to the current thread explicitly, then drains its current-owner tail', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    const view = renderComposer({ sending: true, onSend, workspaceId: 'workspace-a', threadId: 'thread-a' })
    enter('A head')

    view.rerender({ workspaceId: 'workspace-b', threadId: 'thread-b' })
    enter('B tail')
    view.rerender({ sending: false })

    const move = await screen.findByRole('button', { name: 'Move queued message to current thread and retry' })
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/2 queued/)).toBeTruthy()

    fireEvent.click(move)

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend.mock.calls.map(call => call[0])).toEqual(['A head', 'B tail'])
    await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull())
  })
})

describe('PersistentComposer view lifetime', () => {
  it('keeps an in-flight head and queued tail across Tasks and Chat view changes', async () => {
    expect(PersistentComposer).toBeTypeOf('function')
    if (!PersistentComposer) return
    let finishA!: (result: ComposerSendResult) => void
    let finishB!: (result: ComposerSendResult) => void
    const onSend = vi.fn()
      .mockImplementationOnce(() => new Promise<ComposerSendResult>(resolve => { finishA = resolve }))
      .mockImplementationOnce(() => new Promise<ComposerSendResult>(resolve => { finishB = resolve }))
    let props = baseProps({ sending: true, onSend })
    const view = render(<PersistentComposer active composerProps={props} />)
    enter('A')
    enter('B')
    props = { ...props, sending: false }
    view.rerender(<PersistentComposer active composerProps={props} />)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))

    view.rerender(<PersistentComposer active={false} composerProps={props} />)
    await act(async () => finishA({ ok: true }))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    view.rerender(<PersistentComposer active composerProps={props} />)
    await act(async () => finishB({ ok: true }))

    await waitFor(() => expect(screen.queryByText(/queued/)).toBeNull())
    expect(onSend.mock.calls.map(call => call[0])).toEqual(['A', 'B'])
  })
})

describe('ComposerBar inline decisions', () => {
  it('does not steal textarea focus on mount and returns focus after accepted removal', async () => {
    const decision: DecisionItem = {
      origin: 'runtime',
      id: 'focus-decision',
      threadId: 'thread-1',
      createdAt: 1,
      state: 'active',
      request: {
        schemaVersion: 1,
        id: 'focus-decision',
        owner: { type: 'turn', threadId: 'thread-1', turnId: 'turn-1', workspaceId: 'workspace-1', webContentsId: 1 },
        source: 'agent',
        kind: 'single-select',
        title: 'Focus decision',
        options: [{ id: 'continue', label: 'Continue' }],
        minSelections: 1,
        maxSelections: 1,
        allowCustom: false,
        allowRemember: false,
        createdAt: 1
      }
    }
    const onDecisionSubmit = vi.fn().mockResolvedValue({ accepted: true })
    const view = renderComposer({
      threadId: 'thread-1',
      decisionItem: decision,
      decisionPosition: 1,
      decisionCount: 1,
      onDecisionSubmit
    } as any)

    editor().focus()
    expect(document.activeElement).toBe(editor())
    fireEvent.click(screen.getByLabelText('Continue'))
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))
    view.rerender({ decisionItem: null })

    await waitFor(() => expect(onDecisionSubmit).toHaveBeenCalledWith(decision, expect.objectContaining({ requestId: 'focus-decision' })))
    await waitFor(() => expect(document.activeElement).toBe(editor()))
  })

  it('focuses the next decision primary control before returning to the composer', async () => {
    const decision = (id: string, label: string): DecisionItem => ({
      origin: 'runtime',
      id,
      threadId: 'thread-1',
      createdAt: 1,
      state: 'active',
      request: {
        schemaVersion: 1,
        id,
        owner: { type: 'turn', threadId: 'thread-1', turnId: `turn-${id}`, workspaceId: 'workspace-1', webContentsId: 1 },
        source: 'agent',
        kind: 'single-select',
        title: id,
        options: [{ id: `${id}-option`, label }],
        minSelections: 1,
        maxSelections: 1,
        allowCustom: false,
        allowRemember: false,
        createdAt: 1
      }
    })
    const first = decision('first-decision', 'First choice')
    const second = decision('second-decision', 'Second choice')
    function Sequence() {
      const [item, setItem] = React.useState<DecisionItem | null>(first)
      return (
        <ComposerBar
          {...baseProps({
            threadId: 'thread-1',
            decisionItem: item,
            decisionPosition: item ? 1 : 0,
            decisionCount: item ? 1 : 0,
            onDecisionSubmit: async () => {
              setItem(current => current?.id === first.id ? second : null)
              return { accepted: true }
            }
          } as any)}
        />
      )
    }
    render(<Sequence />)

    fireEvent.click(screen.getByLabelText('First choice'))
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Second choice')))

    fireEvent.click(screen.getByLabelText('Second choice'))
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))
    await waitFor(() => expect(document.activeElement).toBe(editor()))
  })

  it('never applies a stale prompt-enhancer selection after a newer user draft revision', async () => {
    const original = 'Original draft'
    const decision: DecisionItem = {
      origin: 'draft',
      id: 'stale-prompt-enhancer',
      threadId: 'thread-1',
      createdAt: 1,
      state: 'active',
      draftRevision: 1,
      draftHash: await sha256Text(original),
      valuesByOptionId: { 'use-enhanced': 'Enhanced draft' },
      request: {
        schemaVersion: 1,
        id: 'stale-prompt-enhancer',
        source: 'prompt-optimizer',
        kind: 'single-select',
        title: 'Use enhanced prompt?',
        options: [{ id: 'use-enhanced', label: 'Use enhanced' }],
        minSelections: 1,
        maxSelections: 1,
        allowCustom: false,
        allowRemember: false,
        createdAt: 1
      }
    }
    const onDecisionSubmit = vi.fn().mockResolvedValue({ accepted: true })
    renderComposer({
      threadId: 'thread-1',
      decisionItem: decision,
      decisionPosition: 1,
      decisionCount: 1,
      onDecisionSubmit
    } as any)

    fireEvent.change(composerEditor(), { target: { value: original } })
    fireEvent.change(editor(), { target: { value: 'Newer user draft' } })
    fireEvent.click(screen.getByLabelText('Use enhanced'))
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(onDecisionSubmit).toHaveBeenCalledOnce())
    await waitFor(() => expect(editor().value).toBe('Newer user draft'))
  })

  it('applies a bounded local custom draft after selecting Use custom text', async () => {
    const original = 'Original draft'
    const decision: DecisionItem = {
      origin: 'draft',
      id: 'custom-option-draft',
      threadId: 'thread-1',
      createdAt: 1,
      state: 'active',
      draftRevision: 1,
      draftHash: await sha256Text(original),
      valuesByOptionId: {},
      request: {
        schemaVersion: 1,
        id: 'custom-option-draft',
        source: 'prompt-optimizer',
        kind: 'single-select',
        title: 'Use custom text?',
        options: [{ id: 'use-custom', label: 'Use custom text' }],
        minSelections: 1,
        maxSelections: 1,
        allowCustom: true,
        customInput: { maxChars: 40 },
        allowRemember: false,
        createdAt: 1
      }
    }
    renderComposer({
      threadId: 'thread-1',
      decisionItem: decision,
      decisionPosition: 1,
      decisionCount: 1,
      onDecisionSubmit: vi.fn().mockResolvedValue({ accepted: true })
    } as any)

    fireEvent.change(composerEditor(), { target: { value: original } })
    fireEvent.click(screen.getByLabelText('Use custom text'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom response' }), { target: { value: 'Local custom draft' } })
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(composerEditor().value).toBe('Local custom draft'))
  })

  it('applies a bounded custom-only local draft without an option selection', async () => {
    const original = 'Original draft'
    const decision: DecisionItem = {
      origin: 'draft',
      id: 'custom-only-draft',
      threadId: 'thread-1',
      createdAt: 1,
      state: 'active',
      draftRevision: 1,
      draftHash: await sha256Text(original),
      valuesByOptionId: { 'use-enhanced': 'Enhanced draft' },
      request: {
        schemaVersion: 1,
        id: 'custom-only-draft',
        source: 'prompt-optimizer',
        kind: 'single-select',
        title: 'Use enhanced prompt?',
        options: [{ id: 'use-enhanced', label: 'Use enhanced' }],
        minSelections: 1,
        maxSelections: 1,
        allowCustom: true,
        customInput: { maxChars: 40 },
        allowRemember: false,
        createdAt: 1
      }
    }
    renderComposer({
      threadId: 'thread-1',
      decisionItem: decision,
      decisionPosition: 1,
      decisionCount: 1,
      onDecisionSubmit: vi.fn().mockResolvedValue({ accepted: true })
    } as any)

    fireEvent.change(composerEditor(), { target: { value: original } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom response' }), { target: { value: 'Custom only draft' } })
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(composerEditor().value).toBe('Custom only draft'))
  })

  it('does not apply a stale local custom draft after the composer changes', async () => {
    const original = 'Original draft'
    const decision: DecisionItem = {
      origin: 'draft',
      id: 'stale-custom-draft',
      threadId: 'thread-1',
      createdAt: 1,
      state: 'active',
      draftRevision: 1,
      draftHash: await sha256Text(original),
      valuesByOptionId: {},
      request: {
        schemaVersion: 1,
        id: 'stale-custom-draft',
        source: 'prompt-optimizer',
        kind: 'single-select',
        title: 'Use custom text?',
        options: [{ id: 'use-custom', label: 'Use custom text' }],
        minSelections: 1,
        maxSelections: 1,
        allowCustom: true,
        customInput: { maxChars: 40 },
        allowRemember: false,
        createdAt: 1
      }
    }
    renderComposer({
      threadId: 'thread-1',
      decisionItem: decision,
      decisionPosition: 1,
      decisionCount: 1,
      onDecisionSubmit: vi.fn().mockResolvedValue({ accepted: true })
    } as any)

    fireEvent.change(composerEditor(), { target: { value: original } })
    fireEvent.change(composerEditor(), { target: { value: 'Newer user draft' } })
    fireEvent.click(screen.getByLabelText('Use custom text'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom response' }), { target: { value: 'Stale custom draft' } })
    await waitFor(() => expect(screen.getByTestId('decision-primary')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByTestId('decision-primary'))

    await waitFor(() => expect(composerEditor().value).toBe('Newer user draft'))
  })
})

describe('ComposerBar commands while sending', () => {
  it('routes a slash command to onRunCommand instead of queueing it as a prompt', async () => {
    const command = { id: 'goal', label: '/goal', description: 'Set goal', action: 'set-goal', source: 'builtin' } as WorkbenchCommand
    installApi([command])
    const onRunCommand = vi.fn().mockResolvedValue(true)
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    renderComposer({ sending: true, onRunCommand, onSend })
    await waitFor(() => expect((window as any).electronAPI.commands.list).toHaveBeenCalled())

    enter('/goal ship B11')

    await waitFor(() => expect(onRunCommand).toHaveBeenCalledWith({ text: '/goal ship B11' }))
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByText(/queued/)).toBeNull()
  })

  it('explicitly rejects a slash command when no command handler is available', async () => {
    const command = { id: 'goal', label: '/goal', description: 'Set goal', action: 'set-goal', source: 'builtin' } as WorkbenchCommand
    installApi([command])
    const onSend = vi.fn().mockResolvedValue({ ok: true })
    renderComposer({ sending: true, onRunCommand: undefined, onSend })
    await waitFor(() => expect((window as any).electronAPI.commands.list).toHaveBeenCalled())

    enter('/goal ship B11')

    await waitFor(() => expect(screen.getByText('Unknown command. Choose one from the / palette, or remove the leading / or @ before sending.')).toBeTruthy())
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByText(/queued/)).toBeNull()
  })
})
