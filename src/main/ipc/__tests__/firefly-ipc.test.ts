import { describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'
import type { FireflyRole, FireflyStateLike } from '../../../shared/ipc-contract'

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

const validFireflyState: FireflyStateLike = {
  phase: 'main_candidate' as const,
  currentRole: 'main' as const,
  routerOutput: '{"taskType":"coding"}',
  mainOutput: '',
  reviewerOutput: '',
  executorOutput: '',
  gatekeeperOutput: '',
  approvedActions: ['edit files'],
  rejectedActions: [],
  guardReasons: [],
  blockedByGuard: false,
  startedAt: 1,
  roleTimings: new Map<FireflyRole, { startedAt: number; completedAt?: number }>([
    ['router', { startedAt: 1, completedAt: 2 }],
    ['main', { startedAt: 3 }]
  ])
}

const serializedFireflyState = {
  ...validFireflyState,
  roleTimings: [
    ['router', { startedAt: 1, completedAt: 2 }],
    ['main', { startedAt: 3 }]
  ]
}

describe('firefly IPC runtime validation', () => {
  it('rejects invalid firefly payloads before side effects', async () => {
    const createHandler = vi.fn(async () => validFireflyState)
    const completeHandler = vi.fn(async () => validFireflyState)
    const contextHandler = vi.fn(async () => ({ messages: [], constraints: [] }))
    const isCompleteHandler = vi.fn(async () => false)
    const outputHandler = vi.fn(async () => null)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('firefly:createState', createHandler)
    typedHandle('firefly:completeRole', completeHandler)
    typedHandle('firefly:getRoleContext', contextHandler)
    typedHandle('firefly:isComplete', isCompleteHandler)
    typedHandle('firefly:getOutput', outputHandler)

    expect(() => electronMock.handlers.get('firefly:createState')?.({}, 'extra')).toThrow(
      new IpcPayloadValidationError('firefly:createState', 'expected no arguments')
    )
    expect(() => electronMock.handlers.get('firefly:completeRole')?.({}, {
      ...validFireflyState,
      phase: 'launch'
    }, 'main', 'done')).toThrow(
      new IpcPayloadValidationError('firefly:completeRole', 'state.phase must be one of: idle, router_decision, main_candidate, review_verdict, executor_actions, gatekeeper_verdict, final_release, blocked, error')
    )
    expect(() => electronMock.handlers.get('firefly:completeRole')?.({}, validFireflyState, 'observer', 'done')).toThrow(
      new IpcPayloadValidationError('firefly:completeRole', 'role must be one of: router, main, reviewer, executor, gatekeeper')
    )
    expect(() => electronMock.handlers.get('firefly:getRoleContext')?.({}, {
      ...validFireflyState,
      roleTimings: { router: { startedAt: 1 } }
    }, 'reviewer', 'review')).toThrow(
      new IpcPayloadValidationError('firefly:getRoleContext', 'state.roleTimings must be a Map or entries array')
    )
    expect(() => electronMock.handlers.get('firefly:isComplete')?.({}, {
      ...validFireflyState,
      roleTimings: [
        ['router', { startedAt: 2 }],
        ['router', { startedAt: 3 }]
      ]
    })).toThrow(
      new IpcPayloadValidationError('firefly:isComplete', 'state.roleTimings must not contain duplicate role router')
    )
    expect(() => electronMock.handlers.get('firefly:getOutput')?.({}, {
      ...validFireflyState,
      approvedActions: Array.from({ length: 129 }, (_, index) => `action-${index}`)
    })).toThrow(
      new IpcPayloadValidationError('firefly:getOutput', 'state.approvedActions must contain at most 128 items')
    )

    expect(createHandler).not.toHaveBeenCalled()
    expect(completeHandler).not.toHaveBeenCalled()
    expect(contextHandler).not.toHaveBeenCalled()
    expect(isCompleteHandler).not.toHaveBeenCalled()
    expect(outputHandler).not.toHaveBeenCalled()
  })

  it('passes valid firefly payloads through unchanged', async () => {
    const createHandler = vi.fn(async () => validFireflyState)
    const completeHandler = vi.fn(async () => validFireflyState)
    const contextHandler = vi.fn(async () => ({ messages: ['prompt'], constraints: ['constraint'] }))
    const isCompleteHandler = vi.fn(async () => false)
    const outputHandler = vi.fn(async () => null)
    const { typedHandle } = await import('../typed-ipc')
    typedHandle('firefly:createState', createHandler)
    typedHandle('firefly:completeRole', completeHandler)
    typedHandle('firefly:getRoleContext', contextHandler)
    typedHandle('firefly:isComplete', isCompleteHandler)
    typedHandle('firefly:getOutput', outputHandler)

    await expect(electronMock.handlers.get('firefly:createState')?.({})).resolves.toBe(validFireflyState)
    await expect(electronMock.handlers.get('firefly:completeRole')?.({}, validFireflyState, 'main', '')).resolves.toBe(validFireflyState)
    await expect(electronMock.handlers.get('firefly:getRoleContext')?.({}, serializedFireflyState, 'reviewer', 'review', '', '')).resolves.toEqual({
      messages: ['prompt'],
      constraints: ['constraint']
    })
    await expect(electronMock.handlers.get('firefly:isComplete')?.({}, serializedFireflyState)).resolves.toBe(false)
    await expect(electronMock.handlers.get('firefly:getOutput')?.({}, validFireflyState)).resolves.toBeNull()

    expect(createHandler).toHaveBeenCalledWith({})
    expect(completeHandler).toHaveBeenCalledWith({}, validFireflyState, 'main', '')
    expect(contextHandler).toHaveBeenCalledWith({}, serializedFireflyState, 'reviewer', 'review', '', '')
    expect(isCompleteHandler).toHaveBeenCalledWith({}, serializedFireflyState)
    expect(outputHandler).toHaveBeenCalledWith({}, validFireflyState)
  })
})
