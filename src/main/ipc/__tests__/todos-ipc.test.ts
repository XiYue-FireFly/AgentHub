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

describe('todos IPC runtime validation', () => {
  it('rejects invalid todo list/delete/clear ids before side effects', async () => {
    const listHandler = vi.fn(async () => [])
    const deleteHandler = vi.fn(async () => true)
    const clearHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('todos:list', listHandler)
    typedHandle('todos:delete', deleteHandler)
    typedHandle('todos:clear', clearHandler)

    expect(() => electronMock.handlers.get('todos:list')?.({}, '')).toThrow(
      new IpcPayloadValidationError('todos:list', 'threadId must not be empty')
    )
    expect(() => electronMock.handlers.get('todos:delete')?.({}, 'thread-1', 123)).toThrow(
      new IpcPayloadValidationError('todos:delete', 'todoId must be a string')
    )
    expect(() => electronMock.handlers.get('todos:clear')?.({}, null)).toThrow(
      new IpcPayloadValidationError('todos:clear', 'threadId must be a string')
    )

    expect(listHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
    expect(clearHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid todo set payloads before side effects', async () => {
    const handler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('todos:set', handler)

    expect(() => electronMock.handlers.get('todos:set')?.({}, 'thread-1', null)).toThrow(
      new IpcPayloadValidationError('todos:set', 'todos must be an array')
    )
    expect(() => electronMock.handlers.get('todos:set')?.({}, 'thread-1', Array.from({ length: 121 }, () => ({
      content: 'Review plan',
      status: 'pending'
    })))).toThrow(
      new IpcPayloadValidationError('todos:set', 'todos must contain at most 120 items')
    )
    expect(() => electronMock.handlers.get('todos:set')?.({}, 'thread-1', [{
      content: 'Review plan',
      status: 'blocked'
    }])).toThrow(
      new IpcPayloadValidationError('todos:set', 'todos[0].status must be one of: pending, in_progress, completed')
    )
    expect(() => electronMock.handlers.get('todos:set')?.({}, 'thread-1', [{
      content: 'Review plan',
      status: 'pending',
      source: { kind: 'external' }
    }])).toThrow(
      new IpcPayloadValidationError('todos:set', 'todos[0].source.kind must be one of: manual, plan, agent')
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects invalid todo upsert and sync payloads before side effects', async () => {
    const upsertHandler = vi.fn(async () => ({
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'Review plan',
      status: 'pending' as const,
      updatedAt: 1
    }))
    const syncHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('todos:upsert', upsertHandler)
    typedHandle('todos:syncFromMarkdown', syncHandler)

    expect(() => electronMock.handlers.get('todos:upsert')?.({}, {
      threadId: 'thread-1',
      content: '',
      status: 'pending'
    })).toThrow(
      new IpcPayloadValidationError('todos:upsert', 'input.content must not be empty')
    )
    expect(() => electronMock.handlers.get('todos:upsert')?.({}, {
      threadId: 'thread-1',
      content: 'x'.repeat(2049)
    })).toThrow(
      new IpcPayloadValidationError('todos:upsert', 'input.content must be at most 2048 characters')
    )
    expect(() => electronMock.handlers.get('todos:syncFromMarkdown')?.({}, 'thread-1', 42)).toThrow(
      new IpcPayloadValidationError('todos:syncFromMarkdown', 'markdown must be a string')
    )
    expect(() => electronMock.handlers.get('todos:syncFromMarkdown')?.({}, 'thread-1', 'x'.repeat(256 * 1024 + 1))).toThrow(
      new IpcPayloadValidationError('todos:syncFromMarkdown', 'markdown must be at most 262144 characters')
    )
    expect(() => electronMock.handlers.get('todos:syncFromMarkdown')?.({}, 'thread-1', '', {
      draftId: 123
    })).toThrow(
      new IpcPayloadValidationError('todos:syncFromMarkdown', 'sourceContext.draftId must be a string')
    )

    expect(upsertHandler).not.toHaveBeenCalled()
    expect(syncHandler).not.toHaveBeenCalled()
  })

  it('passes valid todo mutation payloads through unchanged', async () => {
    const setHandler = vi.fn(async () => [])
    const upsertHandler = vi.fn(async () => ({
      id: 'todo-1',
      threadId: 'thread-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'pending' as const,
      updatedAt: 1
    }))
    const syncHandler = vi.fn(async () => [])
    const todos = [{
      id: 'todo-1',
      content: 'T-1: Implement checkout (covers: R-1)',
      status: 'pending',
      source: {
        kind: 'plan',
        threadId: 'thread-1',
        gitHeadAtDispatch: 'abcdef1234567890',
        gitRootAtDispatch: 'E:\\workspace',
        workspaceRoot: 'E:\\workspace',
        draftId: 'draft-1',
        relativePath: '.agenthub/requirements/draft-1/requirement.md',
        planItemId: 'T-1',
        contentHash: 'abc123'
      }
    }] as const
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('todos:set', setHandler)
    typedHandle('todos:upsert', upsertHandler)
    typedHandle('todos:syncFromMarkdown', syncHandler)

    await expect(electronMock.handlers.get('todos:set')?.({}, 'thread-1', todos)).resolves.toEqual([])
    await expect(electronMock.handlers.get('todos:upsert')?.({}, {
      threadId: 'thread-1',
      content: 'Review plan',
      source: { kind: 'manual' }
    })).resolves.toMatchObject({ id: 'todo-1' })
    await expect(electronMock.handlers.get('todos:syncFromMarkdown')?.({}, 'thread-1', '- [ ] T-1: Implement checkout (covers: R-1)', {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    })).resolves.toEqual([])

    expect(setHandler).toHaveBeenCalledWith({}, 'thread-1', todos)
    expect(upsertHandler).toHaveBeenCalledWith({}, {
      threadId: 'thread-1',
      content: 'Review plan',
      source: { kind: 'manual' }
    })
    expect(syncHandler).toHaveBeenCalledWith({}, 'thread-1', '- [ ] T-1: Implement checkout (covers: R-1)', {
      workspaceRoot: 'E:\\workspace',
      draftId: 'draft-1',
      relativePath: '.agenthub/requirements/draft-1/requirement.md'
    })
  })
})
