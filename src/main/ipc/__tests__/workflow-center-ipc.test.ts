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

const validVars = [
  { name: 'env', value: 'prod', type: 'string' as const },
  { name: 'retries', value: '3', type: 'number' as const }
]

const validRunRecord = {
  workflowId: 'wf-1',
  runId: 'run-1',
  workflowName: 'Deploy',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
  status: 'succeeded' as const,
  stepResults: [
    { stepId: 'build', status: 'succeeded', output: 'ok', error: '' }
  ]
}

describe('workflow center IPC runtime validation', () => {
  it('rejects invalid workflow variable payloads before side effects', async () => {
    const substituteHandler = vi.fn(async () => 'hello prod')
    const conditionHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workflow:substituteVars', substituteHandler)
    typedHandle('workflow:evaluateCondition', conditionHandler)

    expect(() => electronMock.handlers.get('workflow:substituteVars')?.({}, 123, validVars)).toThrow(
      new IpcPayloadValidationError('workflow:substituteVars', 'template must be a string')
    )
    expect(() => electronMock.handlers.get('workflow:substituteVars')?.({}, '{{env}}', { env: 'prod' })).toThrow(
      new IpcPayloadValidationError('workflow:substituteVars', 'vars must be an array')
    )
    expect(() => electronMock.handlers.get('workflow:substituteVars')?.({}, '{{env}}', [
      { name: 'env', value: 'prod', type: 'object' }
    ])).toThrow(
      new IpcPayloadValidationError('workflow:substituteVars', 'vars[0].type must be one of: string, number, boolean')
    )
    expect(() => electronMock.handlers.get('workflow:evaluateCondition')?.({}, 'x == 1', [
      { name: '', value: '1', type: 'number' }
    ])).toThrow(
      new IpcPayloadValidationError('workflow:evaluateCondition', 'vars[0].name must not be empty')
    )

    expect(substituteHandler).not.toHaveBeenCalled()
    expect(conditionHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid workflow run records before side effects', async () => {
    const saveHandler = vi.fn(async () => true)
    const historyForHandler = vi.fn(async () => [])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workflow:saveRun', saveHandler)
    typedHandle('workflow:runHistoryFor', historyForHandler)

    expect(() => electronMock.handlers.get('workflow:saveRun')?.({}, {
      ...validRunRecord,
      workflowId: ''
    })).toThrow(
      new IpcPayloadValidationError('workflow:saveRun', 'record.workflowId must not be empty')
    )
    expect(() => electronMock.handlers.get('workflow:saveRun')?.({}, {
      ...validRunRecord,
      status: 'paused'
    })).toThrow(
      new IpcPayloadValidationError('workflow:saveRun', 'record.status must be one of: running, succeeded, failed, cancelled')
    )
    expect(() => electronMock.handlers.get('workflow:saveRun')?.({}, {
      ...validRunRecord,
      stepResults: [{ stepId: 'build', status: 1 }]
    })).toThrow(
      new IpcPayloadValidationError('workflow:saveRun', 'record.stepResults[0].status must be a string')
    )
    expect(() => electronMock.handlers.get('workflow:saveRun')?.({}, {
      ...validRunRecord,
      stepResults: Array.from({ length: 129 }, (_, index) => ({ stepId: `s-${index}`, status: 'succeeded' }))
    })).toThrow(
      new IpcPayloadValidationError('workflow:saveRun', 'record.stepResults must contain at most 128 items')
    )
    expect(() => electronMock.handlers.get('workflow:runHistoryFor')?.({}, '')).toThrow(
      new IpcPayloadValidationError('workflow:runHistoryFor', 'workflowId must not be empty')
    )

    expect(saveHandler).not.toHaveBeenCalled()
    expect(historyForHandler).not.toHaveBeenCalled()
  })

  it('passes valid workflow payloads through unchanged', async () => {
    const substituteHandler = vi.fn(async () => 'deploy prod')
    const conditionHandler = vi.fn(async () => true)
    const saveHandler = vi.fn(async () => true)
    const historyForHandler = vi.fn(async () => [validRunRecord])
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('workflow:substituteVars', substituteHandler)
    typedHandle('workflow:evaluateCondition', conditionHandler)
    typedHandle('workflow:saveRun', saveHandler)
    typedHandle('workflow:runHistoryFor', historyForHandler)

    await expect(electronMock.handlers.get('workflow:substituteVars')?.({}, 'deploy {{env}}', validVars)).resolves.toBe('deploy prod')
    await expect(electronMock.handlers.get('workflow:evaluateCondition')?.({}, '{{retries}} >= 1', validVars)).resolves.toBe(true)
    await expect(electronMock.handlers.get('workflow:saveRun')?.({}, validRunRecord)).resolves.toBe(true)
    await expect(electronMock.handlers.get('workflow:runHistoryFor')?.({}, 'wf-1')).resolves.toEqual([validRunRecord])

    expect(substituteHandler).toHaveBeenCalledWith({}, 'deploy {{env}}', validVars)
    expect(conditionHandler).toHaveBeenCalledWith({}, '{{retries}} >= 1', validVars)
    expect(saveHandler).toHaveBeenCalledWith({}, validRunRecord)
    expect(historyForHandler).toHaveBeenCalledWith({}, 'wf-1')
  })
})
