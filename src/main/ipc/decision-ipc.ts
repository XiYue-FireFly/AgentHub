import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type {
  DecisionRequest,
  DecisionResolveResult,
  DecisionSubmission,
  PendingDecision
} from '../../shared/decision-contract'
import { typedHandle } from './typed-ipc'

interface DecisionServicePort {
  listPending(filter?: {
    threadId?: string
    webContentsId?: number
    workspaceId?: string | null
  }): PendingDecision[]
  resolve(submission: DecisionSubmission, sender: TurnDecisionSender): Promise<DecisionResolveResult>
}

interface DecisionRuntimeStorePort {
  getThread(threadId: string): { id: string; workspaceId: string | null } | undefined
  getTurn(turnId: string): {
    id: string
    threadId: string
    ownerWebContentsId?: number
  } | undefined
  listDurableDecisions(): Array<{ request: DecisionRequest }>
}

interface DecisionIpcDeps {
  decisionService: DecisionServicePort
  runtimeStore: DecisionRuntimeStorePort
  isLiveWorkbenchWindow(window: BrowserWindow): boolean
}

interface SenderScope {
  webContentsId: number
}

interface TurnDecisionSender extends SenderScope {
  workspaceId: string | null
}

function senderScope(event: IpcMainInvokeEvent, deps: DecisionIpcDeps): SenderScope {
  const sender = event.sender
  const window = BrowserWindow.fromWebContents(sender)
  if (
    !window ||
    window.isDestroyed() ||
    sender.isDestroyed() ||
    window.webContents !== sender ||
    !deps.isLiveWorkbenchWindow(window)
  ) {
    throw new Error('Decision IPC requires a live Workbench BrowserWindow sender')
  }
  return { webContentsId: sender.id }
}

function workspaceForThread(runtimeStore: DecisionRuntimeStorePort, threadId: string): string | null | undefined {
  return runtimeStore.getThread(threadId)?.workspaceId
}

function resolveScope(
  submission: DecisionSubmission,
  scope: SenderScope,
  runtimeStore: DecisionRuntimeStorePort
): TurnDecisionSender | null {
  const record = runtimeStore.listDurableDecisions()
    .find(candidate => candidate.request.id === submission.requestId)
  if (!record || record.request.owner.type !== 'turn') return null

  const owner = record.request.owner
  if (owner.webContentsId !== scope.webContentsId) return null
  const turn = runtimeStore.getTurn(owner.turnId)
  const thread = runtimeStore.getThread(owner.threadId)
  if (
    !turn ||
    turn.threadId !== owner.threadId ||
    (turn.ownerWebContentsId !== undefined && turn.ownerWebContentsId !== owner.webContentsId) ||
    !thread ||
    thread.id !== owner.threadId ||
    thread.workspaceId !== owner.workspaceId
  ) {
    return null
  }
  return {
    webContentsId: scope.webContentsId,
    workspaceId: thread.workspaceId
  }
}

export function registerDecisionIpc(deps: DecisionIpcDeps): void {
  typedHandle('turns:listPendingDecisions', (event, threadId) => {
    const scope = senderScope(event, deps)
    if (threadId === undefined) {
      return deps.decisionService.listPending({ webContentsId: scope.webContentsId })
    }
    const workspaceId = workspaceForThread(deps.runtimeStore, threadId)
    if (workspaceId === undefined) return []
    return deps.decisionService.listPending({
      threadId,
      webContentsId: scope.webContentsId,
      workspaceId
    })
  })

  typedHandle('turns:resolveDecision', async (event, submission) => {
    const scope = senderScope(event, deps)
    const decisionSender = resolveScope(submission, scope, deps.runtimeStore)
    if (!decisionSender) return { accepted: false }
    return deps.decisionService.resolve(submission, decisionSender)
  })
}
