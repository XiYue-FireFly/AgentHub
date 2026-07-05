import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'
import type { TurnCreateInputLike, TurnCreateResultLike } from '../../../shared/ipc-contract'

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

const validTurnPayload: TurnCreateInputLike = {
  threadId: null,
  workspaceId: null,
  prompt: 'Implement the selected requirement',
  mode: 'custom',
  targetAgent: '',
  thinking: { mode: 'auto', level: 'medium', collapseInUI: true },
  modelSelection: {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    source: 'provider'
  },
  attachments: [
    {
      id: 'att-1',
      kind: 'text',
      name: 'notes.md',
      text: 'context',
      createdAt: 1
    }
  ],
  customSchedule: {
    preset: 'custom',
    label: 'Review then execute',
    description: '',
    steps: [
      { id: 'review', label: 'Review', agentId: 'codex', role: 'reviewer', mode: 'auto' },
      { id: 'execute', label: 'Execute', agentId: 'opencode', role: 'executor', mode: 'auto', dependsOn: ['review'] }
    ]
  }
}

const turnResult: TurnCreateResultLike = {
  thread: {
    id: 'thread-1',
    workspaceId: null,
    title: 'Thread',
    createdAt: 1,
    updatedAt: 1
  },
  turn: {
    id: 'turn-1',
    threadId: 'thread-1',
    prompt: validTurnPayload.prompt,
    mode: 'custom',
    status: 'queued',
    taskIds: [],
    createdAt: 1,
    attachments: validTurnPayload.attachments,
    customSchedule: validTurnPayload.customSchedule,
    modelSelection: validTurnPayload.modelSelection,
    thinking: validTurnPayload.thinking
  }
}

describe('turns IPC runtime validation', () => {
  it('rejects invalid turn creation payloads before side effects', async () => {
    const createHandler = vi.fn(async () => turnResult)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('turns:create', createHandler)

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      prompt: ''
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.prompt must not be empty'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      mode: 'manual'
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.mode must be one of: auto, broadcast, chain, orchestrate, lead-workers, parallel-review, firefly-custom, custom'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      modelSelection: { providerId: 'deepseek', modelId: 'deepseek-chat', source: 'shell' }
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.modelSelection.source must be one of: provider, local-cli'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      attachments: [{ id: 'att-1', kind: 'binary', name: 'bad.bin' }]
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.attachments[0].kind must be one of: file, image, text'))

    expect(() => electronMock.handlers.get('turns:create')?.({}, {
      ...validTurnPayload,
      customSchedule: {
        ...validTurnPayload.customSchedule,
        steps: [
          { id: 'review', label: 'Review', agentId: 'codex', role: 'reviewer', mode: 'auto' },
          { id: 'review', label: 'Again', agentId: 'codex', role: 'executor', mode: 'auto' }
        ]
      }
    })).toThrow(new IpcPayloadValidationError('turns:create', 'payload.customSchedule.steps must not contain duplicate step id review'))

    expect(createHandler).not.toHaveBeenCalled()
  })

  it('rejects invalid turn action payloads before side effects', async () => {
    const retryHandler = vi.fn(async () => turnResult)
    const cancelHandler = vi.fn(async () => true)
    const cancelAgentHandler = vi.fn(async () => true)
    const resolveGuardHandler = vi.fn(async () => true)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('turns:retry', retryHandler)
    typedHandle('turns:cancel', cancelHandler)
    typedHandle('turns:cancelAgent', cancelAgentHandler)
    typedHandle('turns:resolveGuard', resolveGuardHandler)

    expect(() => electronMock.handlers.get('turns:retry')?.({}, '')).toThrow(
      new IpcPayloadValidationError('turns:retry', 'turnId must not be empty')
    )
    expect(() => electronMock.handlers.get('turns:cancel')?.({}, 42)).toThrow(
      new IpcPayloadValidationError('turns:cancel', 'turnId must be a string')
    )
    expect(() => electronMock.handlers.get('turns:cancelAgent')?.({}, 'turn-1', '')).toThrow(
      new IpcPayloadValidationError('turns:cancelAgent', 'agentId must not be empty')
    )
    expect(() => electronMock.handlers.get('turns:resolveGuard')?.({}, 'approval-1', 'yes')).toThrow(
      new IpcPayloadValidationError('turns:resolveGuard', 'approved must be a boolean')
    )

    expect(retryHandler).not.toHaveBeenCalled()
    expect(cancelHandler).not.toHaveBeenCalled()
    expect(cancelAgentHandler).not.toHaveBeenCalled()
    expect(resolveGuardHandler).not.toHaveBeenCalled()
  })

  it('passes valid turn payloads through unchanged', async () => {
    const createHandler = vi.fn(async () => turnResult)
    const retryHandler = vi.fn(async () => turnResult)
    const cancelHandler = vi.fn(async () => true)
    const cancelAgentHandler = vi.fn(async () => true)
    const resolveGuardHandler = vi.fn(async () => false)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('turns:create', createHandler)
    typedHandle('turns:retry', retryHandler)
    typedHandle('turns:cancel', cancelHandler)
    typedHandle('turns:cancelAgent', cancelAgentHandler)
    typedHandle('turns:resolveGuard', resolveGuardHandler)

    await expect(electronMock.handlers.get('turns:create')?.({}, validTurnPayload)).resolves.toBe(turnResult)
    await expect(electronMock.handlers.get('turns:retry')?.({}, 'turn-1')).resolves.toBe(turnResult)
    await expect(electronMock.handlers.get('turns:cancel')?.({}, 'turn-1')).resolves.toBe(true)
    await expect(electronMock.handlers.get('turns:cancelAgent')?.({}, 'turn-1', 'codex')).resolves.toBe(true)
    await expect(electronMock.handlers.get('turns:resolveGuard')?.({}, 'approval-1', false)).resolves.toBe(false)

    expect(createHandler).toHaveBeenCalledWith({}, validTurnPayload)
    expect(retryHandler).toHaveBeenCalledWith({}, 'turn-1')
    expect(cancelHandler).toHaveBeenCalledWith({}, 'turn-1')
    expect(cancelAgentHandler).toHaveBeenCalledWith({}, 'turn-1', 'codex')
    expect(resolveGuardHandler).toHaveBeenCalledWith({}, 'approval-1', false)
  })
})
