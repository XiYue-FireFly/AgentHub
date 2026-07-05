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

describe('typed IPC runtime validation', () => {
  it('returns existing error-shaped responses for invalid workspace file writes', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workspaceFiles:write', handler)

    const result = await electronMock.handlers.get('workspaceFiles:write')?.({}, 'C:\\repo', 'README.md', 42)

    expect(result).toEqual({
      ok: false,
      error: 'Invalid IPC payload: content must be a string'
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns existing error-shaped responses for invalid app path payloads', async () => {
    const handler = vi.fn(async () => ({ ok: true, path: 'README.md', target: 'editor' }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('app:openPath', handler)

    const result = await electronMock.handlers.get('app:openPath')?.({}, {
      path: 123,
      target: 'editor'
    })

    expect(result).toEqual({
      ok: false,
      path: '',
      target: 'editor',
      error: 'Invalid IPC payload: input.path must be a string'
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('throws a typed validation error before side effects for mutation channels without response envelopes', async () => {
    const handler = vi.fn(async () => ({ hash: 'abc123' }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('git:commit', handler)

    expect(() => electronMock.handlers.get('git:commit')?.({}, 'ws-1', '', ['README.md'])).toThrow(
      new IpcPayloadValidationError('git:commit', 'message must not be empty')
    )
    expect(handler).not.toHaveBeenCalled()

    try {
      electronMock.handlers.get('git:commit')?.({}, 'ws-1', '', ['README.md'])
    } catch (error) {
      expect(error).toMatchObject({
      name: 'IpcPayloadValidationError',
      code: 'IPC_PAYLOAD_INVALID',
      channel: 'git:commit',
      message: 'Invalid IPC payload for git:commit: message must not be empty'
      } satisfies Partial<IpcPayloadValidationError>)
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes valid high-risk payloads through unchanged', async () => {
    const handler = vi.fn(async () => ({ ok: true }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workspaceFiles:write', handler)

    const result = await electronMock.handlers.get('workspaceFiles:write')?.({}, 'C:\\repo', 'notes/readme.md', '')

    expect(result).toEqual({ ok: true })
    expect(handler).toHaveBeenCalledWith({}, 'C:\\repo', 'notes/readme.md', '')
  })

  it('rejects invalid local agent configuration before side effects', async () => {
    const handler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('localAgents:configure', handler)

    expect(() => electronMock.handlers.get('localAgents:configure')?.({}, 'opencode', {
      protocol: 'shell',
      binary: 'opencode'
    })).toThrow(new IpcPayloadValidationError('localAgents:configure', 'patch.protocol must be one of: stdio-plain, acp'))

    expect(() => electronMock.handlers.get('localAgents:configure')?.({}, '', {
      protocol: 'stdio-plain'
    })).toThrow(new IpcPayloadValidationError('localAgents:configure', 'agentId must not be empty'))

    expect(handler).not.toHaveBeenCalled()
  })
})
