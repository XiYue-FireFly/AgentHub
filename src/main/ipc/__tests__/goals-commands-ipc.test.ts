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

const validGoal = {
  threadId: 'thread-1',
  goal: 'Ship the feature',
  loopLimit: 5,
  status: 'active' as const,
  createdAt: 1,
  updatedAt: 1
}

const validCommand = {
  id: 'builtin:goal',
  label: '/goal',
  description: 'Set goal',
  category: 'session' as const,
  insertText: '/goal ',
  action: 'set-goal' as const,
  source: 'builtin' as const
}

const validSchedule = {
  preset: 'firefly-custom' as const,
  label: 'Smart five-role',
  description: 'Run smart five-role scheduling.',
  steps: []
}

describe('goals commands and schedules IPC runtime validation', () => {
  it('rejects invalid goal payloads before side effects', async () => {
    const getHandler = vi.fn(async () => null)
    const setHandler = vi.fn(async () => validGoal)
    const clearHandler = vi.fn(async () => null)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('goals:get', getHandler)
    typedHandle('goals:set', setHandler)
    typedHandle('goals:clear', clearHandler)

    expect(() => electronMock.handlers.get('goals:get')?.({}, 123)).toThrow(
      new IpcPayloadValidationError('goals:get', 'threadId must be a string')
    )
    expect(() => electronMock.handlers.get('goals:set')?.({}, '', 'Ship', 5)).toThrow(
      new IpcPayloadValidationError('goals:set', 'threadId must not be empty')
    )
    expect(() => electronMock.handlers.get('goals:set')?.({}, 'thread-1', '   ', 5)).toThrow(
      new IpcPayloadValidationError('goals:set', 'goal must not be empty')
    )
    expect(() => electronMock.handlers.get('goals:set')?.({}, 'thread-1', 'x'.repeat(4001), 5)).toThrow(
      new IpcPayloadValidationError('goals:set', 'goal must be at most 4000 characters')
    )
    expect(() => electronMock.handlers.get('goals:set')?.({}, 'thread-1', 'Ship', 0)).toThrow(
      new IpcPayloadValidationError('goals:set', 'loopLimit must be at least 1')
    )
    expect(() => electronMock.handlers.get('goals:set')?.({}, 'thread-1', 'Ship', 21)).toThrow(
      new IpcPayloadValidationError('goals:set', 'loopLimit must be at most 20')
    )
    expect(() => electronMock.handlers.get('goals:set')?.({}, 'thread-1', 'Ship', 1.5)).toThrow(
      new IpcPayloadValidationError('goals:set', 'loopLimit must be an integer')
    )
    expect(() => electronMock.handlers.get('goals:clear')?.({}, null)).toThrow(
      new IpcPayloadValidationError('goals:clear', 'threadId must be a string')
    )

    expect(getHandler).not.toHaveBeenCalled()
    expect(setHandler).not.toHaveBeenCalled()
    expect(clearHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid command and schedule payloads before side effects', async () => {
    const commandHandler = vi.fn(async () => null)
    const scheduleHandler = vi.fn(async () => validSchedule)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('commands:run', commandHandler)
    typedHandle('schedules:runPreview', scheduleHandler)

    expect(() => electronMock.handlers.get('commands:run')?.({}, null)).toThrow(
      new IpcPayloadValidationError('commands:run', 'input must be an object')
    )
    expect(() => electronMock.handlers.get('commands:run')?.({}, { id: 123 })).toThrow(
      new IpcPayloadValidationError('commands:run', 'input.id must be a string')
    )
    expect(() => electronMock.handlers.get('commands:run')?.({}, { text: 'x'.repeat(8193) })).toThrow(
      new IpcPayloadValidationError('commands:run', 'input.text must be at most 8192 characters')
    )
    expect(() => electronMock.handlers.get('schedules:runPreview')?.({}, 'unknown')).toThrow(
      new IpcPayloadValidationError('schedules:runPreview', 'preset must be one of: auto, broadcast, chain, orchestrate, lead-workers, parallel-review, firefly-custom, custom')
    )
    expect(() => electronMock.handlers.get('schedules:runPreview')?.({}, null)).toThrow(
      new IpcPayloadValidationError('schedules:runPreview', 'preset must be one of: auto, broadcast, chain, orchestrate, lead-workers, parallel-review, firefly-custom, custom')
    )

    expect(commandHandler).not.toHaveBeenCalled()
    expect(scheduleHandler).not.toHaveBeenCalled()
  })

  it('passes valid goal command and schedule payloads through unchanged', async () => {
    const getHandler = vi.fn(async () => validGoal)
    const setHandler = vi.fn(async () => validGoal)
    const clearHandler = vi.fn(async () => null)
    const commandHandler = vi.fn(async () => validCommand)
    const scheduleHandler = vi.fn(async () => validSchedule)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('goals:get', getHandler)
    typedHandle('goals:set', setHandler)
    typedHandle('goals:clear', clearHandler)
    typedHandle('commands:run', commandHandler)
    typedHandle('schedules:runPreview', scheduleHandler)

    await expect(electronMock.handlers.get('goals:get')?.({}, undefined)).resolves.toEqual(validGoal)
    await expect(electronMock.handlers.get('goals:get')?.({}, null)).resolves.toEqual(validGoal)
    await expect(electronMock.handlers.get('goals:set')?.({}, 'thread-1', 'Ship the feature', 5)).resolves.toEqual(validGoal)
    await expect(electronMock.handlers.get('goals:clear')?.({}, 'thread-1')).resolves.toBeNull()
    await expect(electronMock.handlers.get('commands:run')?.({}, {})).resolves.toEqual(validCommand)
    await expect(electronMock.handlers.get('commands:run')?.({}, { text: '' })).resolves.toEqual(validCommand)
    await expect(electronMock.handlers.get('commands:run')?.({}, { id: 'builtin:goal' })).resolves.toEqual(validCommand)
    await expect(electronMock.handlers.get('commands:run')?.({}, { text: '/goal ship' })).resolves.toEqual(validCommand)
    await expect(electronMock.handlers.get('schedules:runPreview')?.({}, 'firefly-custom')).resolves.toEqual(validSchedule)

    expect(getHandler).toHaveBeenCalledWith({}, undefined)
    expect(getHandler).toHaveBeenCalledWith({}, null)
    expect(setHandler).toHaveBeenCalledWith({}, 'thread-1', 'Ship the feature', 5)
    expect(clearHandler).toHaveBeenCalledWith({}, 'thread-1')
    expect(commandHandler).toHaveBeenCalledWith({}, {})
    expect(commandHandler).toHaveBeenCalledWith({}, { text: '' })
    expect(commandHandler).toHaveBeenCalledWith({}, { id: 'builtin:goal' })
    expect(commandHandler).toHaveBeenCalledWith({}, { text: '/goal ship' })
    expect(scheduleHandler).toHaveBeenCalledWith({}, 'firefly-custom')
  })
})
