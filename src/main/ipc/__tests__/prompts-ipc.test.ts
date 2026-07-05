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

const validPromptInput = {
  name: 'Code Review',
  body: 'Review this code.',
  category: 'review' as const,
  tags: ['review', 'code'],
  isSlashCommand: true,
  shortcut: '/review'
}

describe('prompts IPC runtime validation', () => {
  it('rejects invalid prompt list/get/delete/search/increment payloads before side effects', async () => {
    const listHandler = vi.fn(async () => [])
    const getHandler = vi.fn(async () => null)
    const deleteHandler = vi.fn(async () => true)
    const searchHandler = vi.fn(async () => [])
    const incrementHandler = vi.fn(async () => undefined)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('prompts:list', listHandler)
    typedHandle('prompts:get', getHandler)
    typedHandle('prompts:delete', deleteHandler)
    typedHandle('prompts:search', searchHandler)
    typedHandle('prompts:incrementUse', incrementHandler)

    expect(() => electronMock.handlers.get('prompts:list')?.({}, 'sales')).toThrow(
      new IpcPayloadValidationError('prompts:list', 'category must be one of: general, coding, review, research, writing, custom')
    )
    expect(() => electronMock.handlers.get('prompts:get')?.({}, '')).toThrow(
      new IpcPayloadValidationError('prompts:get', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('prompts:delete')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('prompts:delete', 'id must be a string')
    )
    expect(() => electronMock.handlers.get('prompts:search')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('prompts:search', 'query must be a string')
    )
    expect(() => electronMock.handlers.get('prompts:incrementUse')?.({}, null)).toThrow(
      new IpcPayloadValidationError('prompts:incrementUse', 'id must be a string')
    )

    expect(listHandler).not.toHaveBeenCalled()
    expect(getHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
    expect(searchHandler).not.toHaveBeenCalled()
    expect(incrementHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid prompt upsert payloads before side effects', async () => {
    const handler = vi.fn(async () => ({
      id: 'prompt-1',
      ...validPromptInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      useCount: 0
    }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('prompts:upsert', handler)

    expect(() => electronMock.handlers.get('prompts:upsert')?.({}, {
      ...validPromptInput,
      name: ''
    })).toThrow(
      new IpcPayloadValidationError('prompts:upsert', 'input.name must not be empty')
    )
    expect(() => electronMock.handlers.get('prompts:upsert')?.({}, {
      ...validPromptInput,
      body: 'x'.repeat(256 * 1024 + 1)
    })).toThrow(
      new IpcPayloadValidationError('prompts:upsert', 'input.body must be at most 262144 characters')
    )
    expect(() => electronMock.handlers.get('prompts:upsert')?.({}, {
      ...validPromptInput,
      category: 'ops'
    })).toThrow(
      new IpcPayloadValidationError('prompts:upsert', 'input.category must be one of: general, coding, review, research, writing, custom')
    )
    expect(() => electronMock.handlers.get('prompts:upsert')?.({}, {
      ...validPromptInput,
      tags: Array.from({ length: 33 }, (_, index) => `tag-${index}`)
    })).toThrow(
      new IpcPayloadValidationError('prompts:upsert', 'input.tags must contain at most 32 items')
    )
    expect(() => electronMock.handlers.get('prompts:upsert')?.({}, {
      ...validPromptInput,
      shortcut: 'review code'
    })).toThrow(
      new IpcPayloadValidationError('prompts:upsert', 'input.shortcut must start with / and contain no whitespace')
    )
    expect(() => electronMock.handlers.get('prompts:upsert')?.({}, {
      ...validPromptInput,
      isSlashCommand: 'yes'
    })).toThrow(
      new IpcPayloadValidationError('prompts:upsert', 'input.isSlashCommand must be a boolean')
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('passes valid prompt payloads through unchanged', async () => {
    const upsertHandler = vi.fn(async () => ({
      id: 'prompt-1',
      ...validPromptInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      useCount: 0
    }))
    const listHandler = vi.fn(async () => [])
    const searchHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('prompts:upsert', upsertHandler)
    typedHandle('prompts:list', listHandler)
    typedHandle('prompts:search', searchHandler)

    await expect(electronMock.handlers.get('prompts:upsert')?.({}, validPromptInput)).resolves.toMatchObject({ id: 'prompt-1' })
    await expect(electronMock.handlers.get('prompts:list')?.({}, 'review')).resolves.toEqual([])
    await expect(electronMock.handlers.get('prompts:search')?.({}, '')).resolves.toEqual([])

    expect(upsertHandler).toHaveBeenCalledWith({}, validPromptInput)
    expect(listHandler).toHaveBeenCalledWith({}, 'review')
    expect(searchHandler).toHaveBeenCalledWith({}, '')
  })
})
