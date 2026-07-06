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

const runTimeoutResult = {
  value: 60000,
  defaultMs: 600000,
  minMs: 60000,
  maxMs: 3600000
}

const updateStatus = {
  version: '1.0.0',
  channel: 'stable' as const,
  checking: false
}

describe('settings updates and tasks IPC runtime validation', () => {
  it('rejects invalid payloads before side effects', async () => {
    const timeoutHandler = vi.fn(async () => runTimeoutResult)
    const checkHandler = vi.fn(async () => updateStatus)
    const setChannelHandler = vi.fn(async () => updateStatus)
    const downloadHandler = vi.fn(async () => updateStatus)
    const installHandler = vi.fn(async () => updateStatus)
    const deleteTaskHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('settings:setRunTimeout', timeoutHandler)
    typedHandle('updates:check', checkHandler)
    typedHandle('updates:setChannel', setChannelHandler)
    typedHandle('updates:download', downloadHandler)
    typedHandle('updates:install', installHandler)
    typedHandle('tasks:delete', deleteTaskHandler)

    expect(() => electronMock.handlers.get('settings:setRunTimeout')?.({}, 59999)).toThrow(
      new IpcPayloadValidationError('settings:setRunTimeout', 'value must be at least 60000')
    )
    expect(() => electronMock.handlers.get('settings:setRunTimeout')?.({}, 3600001)).toThrow(
      new IpcPayloadValidationError('settings:setRunTimeout', 'value must be at most 3600000')
    )
    expect(() => electronMock.handlers.get('settings:setRunTimeout')?.({}, Number.NaN)).toThrow(
      new IpcPayloadValidationError('settings:setRunTimeout', 'value must be a finite number')
    )
    expect(() => electronMock.handlers.get('updates:check')?.({}, 'nightly')).toThrow(
      new IpcPayloadValidationError('updates:check', 'channel must be one of: stable, preview')
    )
    expect(() => electronMock.handlers.get('updates:setChannel')?.({}, undefined)).toThrow(
      new IpcPayloadValidationError('updates:setChannel', 'channel must be one of: stable, preview')
    )
    expect(() => electronMock.handlers.get('updates:download')?.({}, 'extra')).toThrow(
      new IpcPayloadValidationError('updates:download', 'expected no arguments')
    )
    expect(() => electronMock.handlers.get('updates:install')?.({}, true)).toThrow(
      new IpcPayloadValidationError('updates:install', 'expected no arguments')
    )
    expect(() => electronMock.handlers.get('tasks:delete')?.({}, '')).toThrow(
      new IpcPayloadValidationError('tasks:delete', 'taskId must not be empty')
    )
    expect(() => electronMock.handlers.get('tasks:delete')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('tasks:delete', 'taskId must be a string')
    )

    expect(timeoutHandler).not.toHaveBeenCalled()
    expect(checkHandler).not.toHaveBeenCalled()
    expect(setChannelHandler).not.toHaveBeenCalled()
    expect(downloadHandler).not.toHaveBeenCalled()
    expect(installHandler).not.toHaveBeenCalled()
    expect(deleteTaskHandler).not.toHaveBeenCalled()
  })

  it('passes valid payloads through unchanged', async () => {
    const timeoutHandler = vi.fn(async () => runTimeoutResult)
    const checkHandler = vi.fn(async () => updateStatus)
    const setChannelHandler = vi.fn(async () => ({ ...updateStatus, channel: 'preview' as const }))
    const downloadHandler = vi.fn(async () => ({ ...updateStatus, state: 'downloading' as const }))
    const installHandler = vi.fn(async () => ({ ...updateStatus, state: 'downloaded' as const }))
    const deleteTaskHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('settings:setRunTimeout', timeoutHandler)
    typedHandle('updates:check', checkHandler)
    typedHandle('updates:setChannel', setChannelHandler)
    typedHandle('updates:download', downloadHandler)
    typedHandle('updates:install', installHandler)
    typedHandle('tasks:delete', deleteTaskHandler)

    await expect(electronMock.handlers.get('settings:setRunTimeout')?.({}, 60000)).resolves.toEqual(runTimeoutResult)
    await expect(electronMock.handlers.get('updates:check')?.({}, undefined)).resolves.toEqual(updateStatus)
    await expect(electronMock.handlers.get('updates:check')?.({}, 'preview')).resolves.toEqual(updateStatus)
    await expect(electronMock.handlers.get('updates:setChannel')?.({}, 'preview')).resolves.toMatchObject({ channel: 'preview' })
    await expect(electronMock.handlers.get('updates:download')?.({})).resolves.toMatchObject({ state: 'downloading' })
    await expect(electronMock.handlers.get('updates:install')?.({})).resolves.toMatchObject({ state: 'downloaded' })
    await expect(electronMock.handlers.get('tasks:delete')?.({}, 'task-1')).resolves.toBe(true)

    expect(timeoutHandler).toHaveBeenCalledWith({}, 60000)
    expect(checkHandler).toHaveBeenCalledWith({}, undefined)
    expect(checkHandler).toHaveBeenCalledWith({}, 'preview')
    expect(setChannelHandler).toHaveBeenCalledWith({}, 'preview')
    expect(downloadHandler).toHaveBeenCalledWith({})
    expect(installHandler).toHaveBeenCalledWith({})
    expect(deleteTaskHandler).toHaveBeenCalledWith({}, 'task-1')
  })
})
