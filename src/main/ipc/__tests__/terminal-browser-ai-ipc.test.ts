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

const terminalContext = {
  recentCommands: ['npm test'],
  recentOutput: ['ok'],
  cwd: 'E:/Agent/AgentHub-v123-main',
  lastExitCode: 0
}

const browserSnapshot = {
  url: 'https://example.com',
  title: 'Example',
  textContent: 'Example content',
  meta: {
    description: 'Example page',
    keywords: ['example'],
    ogTitle: '',
    ogDescription: ''
  },
  links: [{ text: 'Docs', href: 'https://example.com/docs' }],
  hasForms: false,
  capturedAt: '2026-01-01T00:00:00.000Z'
}

describe('terminal AI browser and quick complete IPC runtime validation', () => {
  it('rejects invalid terminal AI payloads before side effects', async () => {
    const buildHandler = vi.fn(async () => 'prompt')
    const suggestHandler = vi.fn(async () => 'prompt')
    const explainHandler = vi.fn(async () => 'prompt')
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('terminalAi:buildPrompt', buildHandler)
    typedHandle('terminalAi:suggestCommand', suggestHandler)
    typedHandle('terminalAi:explainOutput', explainHandler)

    expect(() => electronMock.handlers.get('terminalAi:buildPrompt')?.({}, '', terminalContext)).toThrow(
      new IpcPayloadValidationError('terminalAi:buildPrompt', 'userPrompt must not be empty')
    )
    expect(() => electronMock.handlers.get('terminalAi:buildPrompt')?.({}, 'Explain', {
      ...terminalContext,
      recentCommands: 'npm test'
    })).toThrow(
      new IpcPayloadValidationError('terminalAi:buildPrompt', 'context.recentCommands must be an array')
    )
    expect(() => electronMock.handlers.get('terminalAi:suggestCommand')?.({}, 'fix', {
      ...terminalContext,
      recentOutput: Array.from({ length: 201 }, (_, index) => `line-${index}`)
    })).toThrow(
      new IpcPayloadValidationError('terminalAi:suggestCommand', 'context.recentOutput must contain at most 200 items')
    )
    expect(() => electronMock.handlers.get('terminalAi:explainOutput')?.({}, {
      ...terminalContext,
      lastExitCode: 1.5
    })).toThrow(
      new IpcPayloadValidationError('terminalAi:explainOutput', 'context.lastExitCode must be an integer')
    )

    expect(buildHandler).not.toHaveBeenCalled()
    expect(suggestHandler).not.toHaveBeenCalled()
    expect(explainHandler).not.toHaveBeenCalled()
  })

  it('returns error-shaped response for invalid quick complete payloads before side effects', async () => {
    const handler = vi.fn(async () => ({ ok: true, content: 'done' }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('ai:quickComplete', handler)

    expect(electronMock.handlers.get('ai:quickComplete')?.({}, { prompt: '' })).toEqual({
      ok: false,
      error: 'Invalid IPC payload: input.prompt must not be empty'
    })
    expect(electronMock.handlers.get('ai:quickComplete')?.({}, {
      prompt: 'Hello',
      timeoutMs: 999
    })).toEqual({
      ok: false,
      error: 'Invalid IPC payload: input.timeoutMs must be at least 1000'
    })

    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects invalid browser payloads before side effects', async () => {
    const openHandler = vi.fn(async () => ({ id: 'browser-1', workspaceId: null, url: 'about:blank', title: '', canGoBack: false, canGoForward: false }))
    const captureHandler = vi.fn(async () => ({ url: '', title: '', text: '', headings: [], links: [], forms: [], capturedAt: 1 }))
    const summarizeHandler = vi.fn(async () => 'summary')
    const extractHandler = vi.fn(async () => 'text')
    const analyzeHandler = vi.fn(async () => 'prompt')
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('browser:open', openHandler)
    typedHandle('browser:capture', captureHandler)
    typedHandle('browser:summarize', summarizeHandler)
    typedHandle('browser:extractText', extractHandler)
    typedHandle('browser:analyzePrompt', analyzeHandler)

    expect(() => electronMock.handlers.get('browser:open')?.({}, { url: 'ftp://example.com' })).toThrow(
      new IpcPayloadValidationError('browser:open', 'input.url must use http, https, or about:blank')
    )
    expect(() => electronMock.handlers.get('browser:capture')?.({}, {
      links: [{ text: 'x', href: 42 }]
    })).toThrow(
      new IpcPayloadValidationError('browser:capture', 'attachment.links[0].href must be a string')
    )
    expect(() => electronMock.handlers.get('browser:summarize')?.({}, {
      ...browserSnapshot,
      meta: null
    })).toThrow(
      new IpcPayloadValidationError('browser:summarize', 'snapshot.meta must be an object')
    )
    expect(() => electronMock.handlers.get('browser:extractText')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('browser:extractText', 'html must be a string')
    )
    expect(() => electronMock.handlers.get('browser:analyzePrompt')?.({}, {
      ...browserSnapshot,
      links: Array.from({ length: 513 }, (_, index) => ({ text: `link-${index}`, href: 'https://example.com' }))
    })).toThrow(
      new IpcPayloadValidationError('browser:analyzePrompt', 'snapshot.links must contain at most 512 items')
    )

    expect(openHandler).not.toHaveBeenCalled()
    expect(captureHandler).not.toHaveBeenCalled()
    expect(summarizeHandler).not.toHaveBeenCalled()
    expect(extractHandler).not.toHaveBeenCalled()
    expect(analyzeHandler).not.toHaveBeenCalled()
  })

  it('passes valid terminal AI browser and quick complete payloads through unchanged', async () => {
    const buildHandler = vi.fn(async () => 'prompt')
    const quickHandler = vi.fn(async () => ({ ok: true, content: 'done' }))
    const openHandler = vi.fn(async () => ({ id: 'browser-1', workspaceId: null, url: 'about:blank', title: '', canGoBack: false, canGoForward: false }))
    const captureHandler = vi.fn(async () => ({ url: 'https://example.com', title: 'Example', text: 'text', headings: [], links: [], forms: [], capturedAt: 1 }))
    const summarizeHandler = vi.fn(async () => 'summary')
    const extractHandler = vi.fn(async () => 'text')
    const analyzeHandler = vi.fn(async () => 'prompt')
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('terminalAi:buildPrompt', buildHandler)
    typedHandle('ai:quickComplete', quickHandler)
    typedHandle('browser:open', openHandler)
    typedHandle('browser:capture', captureHandler)
    typedHandle('browser:summarize', summarizeHandler)
    typedHandle('browser:extractText', extractHandler)
    typedHandle('browser:analyzePrompt', analyzeHandler)

    const quickInput = { prompt: 'Hello', systemPrompt: '', providerId: 'openai', modelId: 'gpt-5.4', timeoutMs: 30000 }
    const captureInput = { url: 'https://example.com', title: 'Example', text: '', headings: [], links: [], forms: [], capturedAt: 1 }

    await expect(electronMock.handlers.get('terminalAi:buildPrompt')?.({}, 'Explain this', terminalContext)).resolves.toBe('prompt')
    await expect(electronMock.handlers.get('ai:quickComplete')?.({}, quickInput)).resolves.toEqual({ ok: true, content: 'done' })
    await expect(electronMock.handlers.get('browser:open')?.({}, { workspaceId: null, url: 'about:blank' })).resolves.toMatchObject({ id: 'browser-1' })
    await expect(electronMock.handlers.get('browser:capture')?.({}, captureInput)).resolves.toMatchObject({ url: 'https://example.com' })
    await expect(electronMock.handlers.get('browser:summarize')?.({}, browserSnapshot)).resolves.toBe('summary')
    await expect(electronMock.handlers.get('browser:extractText')?.({}, '<p>Hello</p>')).resolves.toBe('text')
    await expect(electronMock.handlers.get('browser:analyzePrompt')?.({}, browserSnapshot, '')).resolves.toBe('prompt')

    expect(buildHandler).toHaveBeenCalledWith({}, 'Explain this', terminalContext)
    expect(quickHandler).toHaveBeenCalledWith({}, quickInput)
    expect(openHandler).toHaveBeenCalledWith({}, { workspaceId: null, url: 'about:blank' })
    expect(captureHandler).toHaveBeenCalledWith({}, captureInput)
    expect(summarizeHandler).toHaveBeenCalledWith({}, browserSnapshot)
    expect(extractHandler).toHaveBeenCalledWith({}, '<p>Hello</p>')
    expect(analyzeHandler).toHaveBeenCalledWith({}, browserSnapshot, '')
  })
})
