import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IpcPayloadValidationError,
  validateIpcArgs,
  type IpcChannel
} from '../../../shared/ipc-contract'
import type { DecisionRequest, DecisionResolveResult, PendingDecision } from '../../../shared/decision-contract'

type IpcHandler = (event: any, ...args: any[]) => any

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  BrowserWindow: {
    fromWebContents: electronMock.fromWebContents
  }
}))

const validSubmission = {
  requestId: 'decision-1',
  outcome: 'selected' as const,
  selectedOptionIds: ['allow-once'],
  remember: true
}

function decisionRequest(): DecisionRequest {
  return {
    schemaVersion: 1,
    id: 'decision-1',
    owner: {
      type: 'turn',
      threadId: 'thread-a',
      turnId: 'turn-a',
      workspaceId: 'workspace-a',
      webContentsId: 7
    },
    source: 'tool',
    kind: 'single-select',
    title: 'Decision',
    options: [{ id: 'allow-once', label: 'Allow once' }],
    minSelections: 1,
    maxSelections: 1,
    allowCustom: false,
    allowRemember: true,
    createdAt: 1
  }
}

function decisionRecord(overrides: Partial<{ request: DecisionRequest; state: 'active' }> = {}) {
  return {
    request: decisionRequest(),
    state: 'active',
    ...overrides
  }
}

describe('sender-bound Decision IPC', () => {
  const sender = { id: 7, isDestroyed: vi.fn(() => false) }
  const otherSender = { id: 8, isDestroyed: vi.fn(() => false) }
  const liveWindow = { isDestroyed: vi.fn(() => false), webContents: sender }
  const otherLiveWindow = { isDestroyed: vi.fn(() => false), webContents: otherSender }
  const pending: PendingDecision[] = [{ request: decisionRequest(), state: 'active' }]
  const acceptedResolution: DecisionResolveResult = { accepted: true }
  const decisionService = {
    listPending: vi.fn(() => pending),
    resolve: vi.fn(async (): Promise<DecisionResolveResult> => acceptedResolution)
  }
  const runtimeStore = {
    getThread: vi.fn((threadId: string) => threadId === 'thread-a'
      ? { id: 'thread-a', workspaceId: 'workspace-a' }
      : undefined),
    getTurn: vi.fn((turnId: string) => turnId === 'turn-a'
      ? { id: 'turn-a', threadId: 'thread-a', ownerWebContentsId: 7 }
      : undefined),
    listDurableDecisions: vi.fn(() => [decisionRecord()])
  }

  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.fromWebContents.mockReset()
    electronMock.fromWebContents.mockImplementation((webContents: unknown) => {
      if (webContents === sender) return liveWindow
      if (webContents === otherSender) return otherLiveWindow
      return null
    })
    sender.isDestroyed.mockClear()
    otherSender.isDestroyed.mockClear()
    liveWindow.isDestroyed.mockClear()
    otherLiveWindow.isDestroyed.mockClear()
    decisionService.listPending.mockClear()
    decisionService.resolve.mockClear()
    decisionService.resolve.mockResolvedValue({ accepted: true })
    runtimeStore.getThread.mockClear()
    runtimeStore.getTurn.mockClear()
    runtimeStore.listDurableDecisions.mockClear()
    runtimeStore.listDurableDecisions.mockReturnValue([decisionRecord()])
    vi.resetModules()
  })

  async function setup() {
    const { registerDecisionIpc } = await import('../decision-ipc')
    registerDecisionIpc({
      decisionService,
      runtimeStore,
      isLiveWorkbenchWindow: (candidate: unknown) => (
        candidate === liveWindow || candidate === otherLiveWindow
      )
    })
  }

  it('declares the decision channels and rejects untrusted submission members', () => {
    expect(validateIpcArgs('turns:listPendingDecisions' as IpcChannel, [])).toBeNull()
    expect(validateIpcArgs('turns:resolveDecision' as IpcChannel, [validSubmission])).toBeNull()
    expect(validateIpcArgs('turns:resolveDecision' as IpcChannel, [{
      ...validSubmission,
      workspaceId: 'forged-workspace'
    }])).toMatchObject({ respond: false })
    expect(validateIpcArgs('turns:resolveDecision' as IpcChannel, [{
      ...validSubmission,
      selectedOptionIds: Array.from({ length: 9 }, (_, index) => `option-${index}`)
    }])).toMatchObject({ respond: false })
    expect(validateIpcArgs('turns:resolveDecision' as IpcChannel, [{
      ...validSubmission,
      selectedOptionIds: ['allow-once', 'allow-once']
    }])).toMatchObject({ respond: false })
  })

  it('lists pending decisions only in the trusted sender and thread-derived workspace scope', async () => {
    await setup()

    expect(electronMock.handlers.get('turns:listPendingDecisions')?.({ sender }, 'thread-a'))
      .toBe(pending)
    expect(decisionService.listPending).toHaveBeenCalledWith({
      threadId: 'thread-a',
      webContentsId: 7,
      workspaceId: 'workspace-a'
    })

    electronMock.handlers.get('turns:listPendingDecisions')?.({ sender: otherSender }, 'thread-a')
    expect(decisionService.listPending).toHaveBeenLastCalledWith({
      threadId: 'thread-a',
      webContentsId: 8,
      workspaceId: 'workspace-a'
    })
  })

  it('never accepts a renderer-supplied workspace while listing pending decisions', async () => {
    await setup()

    expect(() => electronMock.handlers.get('turns:listPendingDecisions')?.(
      { sender },
      'thread-a',
      'workspace-b'
    )).toThrow(new IpcPayloadValidationError(
      'turns:listPendingDecisions',
      'expected at most 1 arguments'
    ))
    expect(decisionService.listPending).not.toHaveBeenCalled()
  })

  it('rejects null and duplicate optional submission fields before DecisionService', async () => {
    await setup()
    const handler = electronMock.handlers.get('turns:resolveDecision')
    const invalidSubmissions = [
      { ...validSubmission, selectedOptionIds: null },
      { ...validSubmission, customText: null },
      { ...validSubmission, remember: null },
      { ...validSubmission, selectedOptionIds: ['allow-once', 'allow-once'] }
    ]

    for (const submission of invalidSubmissions) {
      expect(() => handler?.({ sender }, submission)).toThrow('Invalid IPC payload for turns:resolveDecision')
    }
    expect(decisionService.resolve).not.toHaveBeenCalled()
  })

  it('rejects prototype, accessor, symbol, and hidden submission fields before DecisionService', async () => {
    await setup()
    const handler = electronMock.handlers.get('turns:resolveDecision')
    const inheritedSubmission = Object.create(validSubmission)
    let getterCalls = 0
    const accessorSubmission = {
      outcome: 'selected',
      selectedOptionIds: ['allow-once'],
      remember: true
    }
    Object.defineProperty(accessorSubmission, 'requestId', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return 'decision-1'
      }
    })
    const symbolSubmission = { ...validSubmission, [Symbol('forged')]: true }
    const hiddenSubmission = { ...validSubmission }
    Object.defineProperty(hiddenSubmission, 'forged', {
      enumerable: false,
      value: true
    })

    for (const submission of [inheritedSubmission, accessorSubmission, symbolSubmission, hiddenSubmission]) {
      expect(() => handler?.({ sender }, submission)).toThrow('Invalid IPC payload for turns:resolveDecision')
    }
    expect(getterCalls).toBe(0)
    expect(decisionService.resolve).not.toHaveBeenCalled()
  })

  it('resolves with workspace derived from the durable decision owner and Turn', async () => {
    await setup()

    await expect(electronMock.handlers.get('turns:resolveDecision')?.({ sender }, validSubmission))
      .resolves.toEqual({ accepted: true })
    expect(decisionService.resolve).toHaveBeenCalledWith(validSubmission, {
      webContentsId: 7,
      workspaceId: 'workspace-a'
    })
  })

  it('rejects cross-window and cross-workspace resolution before DecisionService', async () => {
    await setup()

    await expect(electronMock.handlers.get('turns:resolveDecision')?.({ sender: otherSender }, validSubmission))
      .resolves.toEqual({ accepted: false })
    expect(decisionService.resolve).not.toHaveBeenCalled()

    runtimeStore.listDurableDecisions.mockReturnValue([decisionRecord({
      request: {
        ...decisionRecord().request,
        owner: {
          type: 'turn',
          threadId: 'thread-a',
          turnId: 'turn-a',
          workspaceId: 'workspace-b',
          webContentsId: 7
        }
      }
    })])
    await expect(electronMock.handlers.get('turns:resolveDecision')?.({ sender }, validSubmission))
      .resolves.toEqual({ accepted: false })
    expect(decisionService.resolve).not.toHaveBeenCalled()
  })

  it('rejects a sender that is not a live Workbench BrowserWindow', async () => {
    await setup()
    electronMock.fromWebContents.mockReturnValue(null)

    expect(() => electronMock.handlers.get('turns:listPendingDecisions')?.({ sender }, 'thread-a'))
      .toThrow('live Workbench BrowserWindow')
    expect(decisionService.listPending).not.toHaveBeenCalled()
  })
})
