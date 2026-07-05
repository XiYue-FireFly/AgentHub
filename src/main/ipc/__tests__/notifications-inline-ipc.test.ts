import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

const validNotification = {
  title: 'Build finished',
  body: '',
  category: 'workflow' as const,
  action: { type: 'navigate' as const, target: 'workbench' }
}

const validInlineRequest = {
  range: {
    filePath: '',
    startLine: 1,
    endLine: 1,
    selectedText: '',
    fullContent: ''
  },
  instruction: 'Refactor this block.',
  providerId: '',
  modelId: ''
}

describe('notifications onboarding and inline edit IPC runtime validation', () => {
  it('rejects invalid notification payloads before side effects', async () => {
    const listHandler = vi.fn(async () => [])
    const pushHandler = vi.fn(async () => ({ id: 'n1', read: false, createdAt: '2026-01-01T00:00:00.000Z', ...validNotification }))
    const markReadHandler = vi.fn(async () => true)
    const deleteHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('notifications:list', listHandler)
    typedHandle('notifications:push', pushHandler)
    typedHandle('notifications:markRead', markReadHandler)
    typedHandle('notifications:delete', deleteHandler)

    expect(() => electronMock.handlers.get('notifications:list')?.({}, 'true')).toThrow(
      new IpcPayloadValidationError('notifications:list', 'unreadOnly must be a boolean')
    )
    expect(() => electronMock.handlers.get('notifications:push')?.({}, {
      ...validNotification,
      title: ''
    })).toThrow(
      new IpcPayloadValidationError('notifications:push', 'input.title must not be empty')
    )
    expect(() => electronMock.handlers.get('notifications:push')?.({}, {
      ...validNotification,
      category: 'chat'
    })).toThrow(
      new IpcPayloadValidationError('notifications:push', 'input.category must be one of: task, approval, mcp, system, workflow, memory, error')
    )
    expect(() => electronMock.handlers.get('notifications:push')?.({}, {
      ...validNotification,
      action: { type: 'open-url', url: 'file:///C:/secret.txt' }
    })).toThrow(
      new IpcPayloadValidationError('notifications:push', 'input.action.url must use http or https')
    )
    expect(() => electronMock.handlers.get('notifications:push')?.({}, {
      ...validNotification,
      action: { type: 'navigate', target: '' }
    })).toThrow(
      new IpcPayloadValidationError('notifications:push', 'input.action.target must not be empty')
    )
    expect(() => electronMock.handlers.get('notifications:markRead')?.({}, '')).toThrow(
      new IpcPayloadValidationError('notifications:markRead', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('notifications:delete')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('notifications:delete', 'id must be a string')
    )

    expect(listHandler).not.toHaveBeenCalled()
    expect(pushHandler).not.toHaveBeenCalled()
    expect(markReadHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid onboarding and inline edit payloads before side effects', async () => {
    const stepHandler = vi.fn(async () => ({ version: 1 as const, completed: false, completedSteps: [], skippedSteps: [] }))
    const buildHandler = vi.fn(async () => 'prompt')
    const validateHandler = vi.fn(async () => ({ valid: true, warnings: [] }))
    const applyHandler = vi.fn(async () => ({ ok: true, content: 'next' }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('onboarding:completeStep', stepHandler)
    typedHandle('inlineEdit:buildPrompt', buildHandler)
    typedHandle('inlineEdit:validate', validateHandler)
    typedHandle('inlineEdit:apply', applyHandler)

    expect(() => electronMock.handlers.get('onboarding:completeStep')?.({}, 'unknown')).toThrow(
      new IpcPayloadValidationError('onboarding:completeStep', 'step must be one of: select-language, bind-provider, detect-agents, choose-default-agent, test-mcp, enable-skills, create-workspace, send-first-message')
    )
    expect(() => electronMock.handlers.get('onboarding:completeStep')?.({}, 'bind-provider', 'yes')).toThrow(
      new IpcPayloadValidationError('onboarding:completeStep', 'skipped must be a boolean')
    )
    expect(() => electronMock.handlers.get('inlineEdit:buildPrompt')?.({}, {
      ...validInlineRequest,
      range: { ...validInlineRequest.range, startLine: 0 }
    })).toThrow(
      new IpcPayloadValidationError('inlineEdit:buildPrompt', 'request.range.startLine must be at least 1')
    )
    expect(() => electronMock.handlers.get('inlineEdit:buildPrompt')?.({}, {
      ...validInlineRequest,
      range: { ...validInlineRequest.range, startLine: 3, endLine: 2 }
    })).toThrow(
      new IpcPayloadValidationError('inlineEdit:buildPrompt', 'request.range.endLine must be greater than or equal to request.range.startLine')
    )
    expect(() => electronMock.handlers.get('inlineEdit:buildPrompt')?.({}, {
      ...validInlineRequest,
      instruction: ''
    })).toThrow(
      new IpcPayloadValidationError('inlineEdit:buildPrompt', 'request.instruction must not be empty')
    )
    expect(() => electronMock.handlers.get('inlineEdit:validate')?.({}, 1, '')).toThrow(
      new IpcPayloadValidationError('inlineEdit:validate', 'original must be a string')
    )
    expect(() => electronMock.handlers.get('inlineEdit:apply')?.({}, 'a\nb', 2, 1, '')).toThrow(
      new IpcPayloadValidationError('inlineEdit:apply', 'endLine must be greater than or equal to startLine')
    )
    expect(() => electronMock.handlers.get('inlineEdit:apply')?.({}, 'a\nb', 1.5, 2, '')).toThrow(
      new IpcPayloadValidationError('inlineEdit:apply', 'startLine must be an integer')
    )

    expect(stepHandler).not.toHaveBeenCalled()
    expect(buildHandler).not.toHaveBeenCalled()
    expect(validateHandler).not.toHaveBeenCalled()
    expect(applyHandler).not.toHaveBeenCalled()
  })

  it('passes valid notification onboarding and inline edit payloads through unchanged', async () => {
    const notificationResult = { id: 'n1', read: false, createdAt: '2026-01-01T00:00:00.000Z', ...validNotification }
    const onboardingResult = { version: 1 as const, completed: false, completedSteps: ['bind-provider' as const], skippedSteps: [] }
    const listHandler = vi.fn(async () => [])
    const pushHandler = vi.fn(async () => notificationResult)
    const stepHandler = vi.fn(async () => onboardingResult)
    const buildHandler = vi.fn(async () => 'prompt')
    const validateHandler = vi.fn(async () => ({ valid: true, warnings: [] }))
    const applyHandler = vi.fn(async () => ({ ok: true, content: 'next' }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('notifications:list', listHandler)
    typedHandle('notifications:push', pushHandler)
    typedHandle('onboarding:completeStep', stepHandler)
    typedHandle('inlineEdit:buildPrompt', buildHandler)
    typedHandle('inlineEdit:validate', validateHandler)
    typedHandle('inlineEdit:apply', applyHandler)

    const urlNotification = {
      ...validNotification,
      body: 'Open details',
      action: { type: 'open-url' as const, url: 'https://example.com/build' }
    }

    await expect(electronMock.handlers.get('notifications:list')?.({}, true)).resolves.toEqual([])
    await expect(electronMock.handlers.get('notifications:push')?.({}, validNotification)).resolves.toEqual(notificationResult)
    await expect(electronMock.handlers.get('notifications:push')?.({}, urlNotification)).resolves.toEqual(notificationResult)
    await expect(electronMock.handlers.get('onboarding:completeStep')?.({}, 'bind-provider', false)).resolves.toEqual(onboardingResult)
    await expect(electronMock.handlers.get('inlineEdit:buildPrompt')?.({}, validInlineRequest)).resolves.toBe('prompt')
    await expect(electronMock.handlers.get('inlineEdit:validate')?.({}, '', '')).resolves.toEqual({ valid: true, warnings: [] })
    await expect(electronMock.handlers.get('inlineEdit:apply')?.({}, '', 1, 1, '')).resolves.toEqual({ ok: true, content: 'next' })

    expect(listHandler).toHaveBeenCalledWith({}, true)
    expect(pushHandler).toHaveBeenCalledWith({}, validNotification)
    expect(pushHandler).toHaveBeenCalledWith({}, urlNotification)
    expect(stepHandler).toHaveBeenCalledWith({}, 'bind-provider', false)
    expect(buildHandler).toHaveBeenCalledWith({}, validInlineRequest)
    expect(validateHandler).toHaveBeenCalledWith({}, '', '')
    expect(applyHandler).toHaveBeenCalledWith({}, '', 1, 1, '')
  })
})
