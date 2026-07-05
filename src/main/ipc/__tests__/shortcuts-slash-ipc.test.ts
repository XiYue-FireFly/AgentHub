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

const shortcutBinding = {
  id: 'open-settings',
  label: 'Open Settings',
  labelZh: '打开设置',
  defaultKey: 'Ctrl+,',
  key: 'Ctrl+,',
  category: 'navigation' as const,
  system: true
}

const slashCommand = {
  shortcut: '/review',
  name: 'Review',
  body: 'Review {{topic}}',
  category: 'custom',
  params: ['topic'],
  system: false
}

const slashSaveInput = {
  shortcut: '/review',
  name: 'Review',
  body: 'Review {{topic}}',
  category: 'custom'
}

describe('shortcuts and slash commands IPC runtime validation', () => {
  it('rejects invalid shortcut payloads before side effects', async () => {
    const listHandler = vi.fn(async () => [])
    const getHandler = vi.fn(async () => null)
    const updateHandler = vi.fn(async () => shortcutBinding)
    const resetHandler = vi.fn(async () => shortcutBinding)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('shortcuts:list', listHandler)
    typedHandle('shortcuts:get', getHandler)
    typedHandle('shortcuts:update', updateHandler)
    typedHandle('shortcuts:reset', resetHandler)

    expect(() => electronMock.handlers.get('shortcuts:list')?.({}, 'system')).toThrow(
      new IpcPayloadValidationError('shortcuts:list', 'category must be one of: navigation, action, editor, agent')
    )
    expect(() => electronMock.handlers.get('shortcuts:get')?.({}, '')).toThrow(
      new IpcPayloadValidationError('shortcuts:get', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('shortcuts:update')?.({}, 'open-settings', '')).toThrow(
      new IpcPayloadValidationError('shortcuts:update', 'key must not be empty')
    )
    expect(() => electronMock.handlers.get('shortcuts:update')?.({}, 'open-settings', 'x'.repeat(129))).toThrow(
      new IpcPayloadValidationError('shortcuts:update', 'key must be at most 128 characters')
    )
    expect(() => electronMock.handlers.get('shortcuts:reset')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('shortcuts:reset', 'id must be a string')
    )

    expect(listHandler).not.toHaveBeenCalled()
    expect(getHandler).not.toHaveBeenCalled()
    expect(updateHandler).not.toHaveBeenCalled()
    expect(resetHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid slash command payloads before side effects', async () => {
    const getHandler = vi.fn(async () => null)
    const saveHandler = vi.fn(async () => ({ ok: true, command: slashCommand }))
    const deleteHandler = vi.fn(async () => true)
    const resolveHandler = vi.fn(async () => ({ ok: true, body: 'Review auth' }))
    const validateHandler = vi.fn(async () => ({ valid: true }))
    const conflictHandler = vi.fn(async () => ({ conflict: false }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('slashCommands:get', getHandler)
    typedHandle('slashCommands:save', saveHandler)
    typedHandle('slashCommands:delete', deleteHandler)
    typedHandle('slashCommands:resolve', resolveHandler)
    typedHandle('slashCommands:validate', validateHandler)
    typedHandle('slashCommands:conflict', conflictHandler)

    expect(() => electronMock.handlers.get('slashCommands:get')?.({}, 'review')).toThrow(
      new IpcPayloadValidationError('slashCommands:get', 'shortcut must start with /')
    )
    expect(() => electronMock.handlers.get('slashCommands:get')?.({}, '/bad/path')).toThrow(
      new IpcPayloadValidationError('slashCommands:get', 'shortcut can only contain letters, numbers, hyphens, and underscores')
    )
    expect(() => electronMock.handlers.get('slashCommands:save')?.({}, {
      ...slashSaveInput,
      shortcut: '/x'.repeat(17)
    })).toThrow(
      new IpcPayloadValidationError('slashCommands:save', 'input.shortcut must be at most 32 characters')
    )
    expect(() => electronMock.handlers.get('slashCommands:save')?.({}, {
      ...slashSaveInput,
      name: ''
    })).toThrow(
      new IpcPayloadValidationError('slashCommands:save', 'input.name must not be empty')
    )
    expect(() => electronMock.handlers.get('slashCommands:save')?.({}, {
      ...slashSaveInput,
      body: ''
    })).toThrow(
      new IpcPayloadValidationError('slashCommands:save', 'input.body must not be empty')
    )
    expect(() => electronMock.handlers.get('slashCommands:resolve')?.({}, '/review', { topic: 42 })).toThrow(
      new IpcPayloadValidationError('slashCommands:resolve', 'params.topic must be a string')
    )
    expect(() => electronMock.handlers.get('slashCommands:resolve')?.({}, '/review', { 'bad-key': 'x' })).toThrow(
      new IpcPayloadValidationError('slashCommands:resolve', 'params.bad-key key must contain only letters, numbers, and underscores')
    )
    expect(() => electronMock.handlers.get('slashCommands:delete')?.({}, '/')).toThrow(
      new IpcPayloadValidationError('slashCommands:delete', 'shortcut must have at least one character after /')
    )
    expect(() => electronMock.handlers.get('slashCommands:validate')?.({}, null)).toThrow(
      new IpcPayloadValidationError('slashCommands:validate', 'shortcut must be a string')
    )
    expect(() => electronMock.handlers.get('slashCommands:conflict')?.({}, 'x'.repeat(129))).toThrow(
      new IpcPayloadValidationError('slashCommands:conflict', 'shortcut must be at most 128 characters')
    )

    expect(getHandler).not.toHaveBeenCalled()
    expect(saveHandler).not.toHaveBeenCalled()
    expect(deleteHandler).not.toHaveBeenCalled()
    expect(resolveHandler).not.toHaveBeenCalled()
    expect(validateHandler).not.toHaveBeenCalled()
    expect(conflictHandler).not.toHaveBeenCalled()
  })

  it('passes valid shortcut and slash command payloads through unchanged', async () => {
    const listHandler = vi.fn(async () => [shortcutBinding])
    const updateHandler = vi.fn(async () => shortcutBinding)
    const saveHandler = vi.fn(async () => ({ ok: true, command: slashCommand }))
    const resolveHandler = vi.fn(async () => ({ ok: true, body: 'Review auth' }))
    const validateHandler = vi.fn(async () => ({ valid: true }))
    const conflictHandler = vi.fn(async () => ({ conflict: false }))
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('shortcuts:list', listHandler)
    typedHandle('shortcuts:update', updateHandler)
    typedHandle('slashCommands:save', saveHandler)
    typedHandle('slashCommands:resolve', resolveHandler)
    typedHandle('slashCommands:validate', validateHandler)
    typedHandle('slashCommands:conflict', conflictHandler)

    await expect(electronMock.handlers.get('shortcuts:list')?.({}, 'navigation')).resolves.toEqual([shortcutBinding])
    await expect(electronMock.handlers.get('shortcuts:update')?.({}, 'open-settings', 'Ctrl+Alt+,')).resolves.toEqual(shortcutBinding)
    await expect(electronMock.handlers.get('slashCommands:save')?.({}, slashSaveInput)).resolves.toEqual({ ok: true, command: slashCommand })
    await expect(electronMock.handlers.get('slashCommands:resolve')?.({}, '/review', { topic: 'auth', empty: '' })).resolves.toEqual({ ok: true, body: 'Review auth' })
    await expect(electronMock.handlers.get('slashCommands:validate')?.({}, '/review')).resolves.toEqual({ valid: true })
    await expect(electronMock.handlers.get('slashCommands:validate')?.({}, 'review')).resolves.toEqual({ valid: true })
    await expect(electronMock.handlers.get('slashCommands:conflict')?.({}, '/bad path')).resolves.toEqual({ conflict: false })

    expect(listHandler).toHaveBeenCalledWith({}, 'navigation')
    expect(updateHandler).toHaveBeenCalledWith({}, 'open-settings', 'Ctrl+Alt+,')
    expect(saveHandler).toHaveBeenCalledWith({}, slashSaveInput)
    expect(resolveHandler).toHaveBeenCalledWith({}, '/review', { topic: 'auth', empty: '' })
    expect(validateHandler).toHaveBeenCalledWith({}, '/review')
    expect(validateHandler).toHaveBeenCalledWith({}, 'review')
    expect(conflictHandler).toHaveBeenCalledWith({}, '/bad path')
  })
})
