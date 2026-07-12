import type { DecisionOwner } from '../../shared/decision-contract'
import type { PromptEnvelope } from '../../shared/prompt-contract'
import type { PromptCacheContext, PromptPreparationService } from './prompt-preparation-service'
import type { QueuedThreadSubmission, WorkbenchThread, WorkbenchTurn } from './types'

export interface WorkbenchPreparedPrompt {
  readonly envelope: PromptEnvelope
  readonly artifact: unknown
}

export interface WorkbenchTurnExecutionInput<TPreDispatch = void> {
  submission: QueuedThreadSubmission
  thread: WorkbenchThread
  turn: WorkbenchTurn
  /** Aborted immediately when this durable Turn is cancelled. */
  signal: AbortSignal
  isStillActive: () => boolean
  preparedPrompt?: WorkbenchPreparedPrompt
  /** The single durable pre-dispatch result prepared before execution. */
  preDispatch: TPreDispatch
}

type WorkbenchTurnPreDispatchInput = Omit<WorkbenchTurnExecutionInput<never>, 'preDispatch'>

export interface WorkbenchTurnRunnerOptions<TPreDispatch = void> {
  runtimeStore: {
    getThread(threadId: string): WorkbenchThread | undefined
    getTurn(turnId: string): WorkbenchTurn | undefined
    listQueuedSubmissions(threadId?: string): QueuedThreadSubmission[]
    commitRuntimeMutation?<T>(mutate: (tx: {
      attachPromptEnvelope(turnId: string, envelope: PromptEnvelope): WorkbenchTurn
    }) => T): Promise<T>
  }
  promptPreparation?: {
    promptPreparationService: Pick<PromptPreparationService, 'prepareRoot'>
    cacheContext(input: { submission: QueuedThreadSubmission; thread: WorkbenchThread; turn: WorkbenchTurn }): PromptCacheContext
  }
  execute(input: WorkbenchTurnExecutionInput<TPreDispatch>): Promise<void>
  preDispatch?(input: WorkbenchTurnPreDispatchInput): Promise<TPreDispatch>
  cancel(turnId: string): void | Promise<void>
}

/**
 * Adapter between durable queue admission and the legacy Workbench dispatch
 * machinery. The coordinator has already persisted `starting`/`running`
 * before this runner is called; this class never creates a second Turn.
 */
export class WorkbenchTurnRunner<TPreDispatch = void> {
  private readonly executionControllers = new Map<string, AbortController>()

  constructor(private readonly options: WorkbenchTurnRunnerOptions<TPreDispatch>) {}

  async start(submission: QueuedThreadSubmission): Promise<void> {
    const thread = this.options.runtimeStore.getThread(submission.threadId)
    const storedTurn = this.options.runtimeStore.getTurn(submission.turnId)
    if (!thread || !storedTurn || storedTurn.threadId !== thread.id) {
      throw new Error('Queued submission no longer has a valid durable Turn')
    }
    let turn: WorkbenchTurn = storedTurn
    let preparedPrompt: WorkbenchPreparedPrompt | undefined
    if (this.options.promptPreparation) {
      const retryOfTurn = submission.retryOfTurnId
        ? this.options.runtimeStore.getTurn(submission.retryOfTurnId)
        : undefined
      if (submission.source === 'retry' && !retryOfTurn) {
        throw new Error(`Retry source Turn is missing: ${submission.retryOfTurnId}`)
      }
      const originalPrompt = retryOfTurn
        ? retryOfTurn.displayOriginalPrompt || retryOfTurn.prompt
        : turn.displayOriginalPrompt || turn.prompt
      const decisionOwner: DecisionOwner = {
        type: "turn",
        workspaceId: thread.workspaceId ?? null,
        threadId: thread.id,
        turnId: turn.id,
        webContentsId: submission.ownerWebContentsId
      }
      const prepared = await this.options.promptPreparation.promptPreparationService.prepareRoot({
        origin: submission.source === "retry" ? "workbench:retry" : "workbench:create",
        prompt: originalPrompt,
        cacheContext: this.options.promptPreparation.cacheContext({ submission, thread, turn }),
        decisionOwner,
        reuseEnvelope: retryOfTurn?.promptEnvelope,
        retryStrategy: submission.retryStrategy
      })
      if (prepared.kind !== 'ready') {
        throw new Error(prepared.kind === 'failed' ? prepared.error : 'Prompt preparation cancelled')
      }
      const commitRuntimeMutation = this.options.runtimeStore.commitRuntimeMutation
      if (!commitRuntimeMutation) throw new Error('Prompt preparation requires runtime mutation support')
      await commitRuntimeMutation(tx => {
        tx.attachPromptEnvelope(turn.id, prepared.envelope)
      })
      const persisted = this.options.runtimeStore.getTurn(turn.id)
      if (!persisted) throw new Error(`Prepared Turn is missing: ${turn.id}`)
      turn = persisted
      preparedPrompt = Object.freeze({ envelope: prepared.envelope, artifact: prepared.artifact })
    }
    const controller = new AbortController()
    this.executionControllers.set(turn.id, controller)
    try {
      const executionInput: WorkbenchTurnPreDispatchInput = {
        submission,
        thread,
        turn,
        preparedPrompt,
        signal: controller.signal,
        isStillActive: () => {
          const current = this.options.runtimeStore.getTurn(submission.turnId)
          const activeSubmission = this.options.runtimeStore.listQueuedSubmissions(submission.threadId)
            .find(candidate => candidate.id === submission.id)
          return current?.status === 'running' && activeSubmission?.state === 'starting'
        }
      }
      const preDispatch = await this.options.preDispatch?.(executionInput) as TPreDispatch
      if (!executionInput.isStillActive()) return
      await this.options.execute({ ...executionInput, preDispatch })
    } finally {
      if (this.executionControllers.get(turn.id) === controller) {
        this.executionControllers.delete(turn.id)
      }
    }
  }

  abort(turnId: string, reason: unknown = 'Turn cancelled'): void {
    const controller = this.executionControllers.get(turnId)
    if (controller && !controller.signal.aborted) controller.abort(reason)
  }

  cancel(turnId: string): void | Promise<void> {
    this.abort(turnId)
    return this.options.cancel(turnId)
  }
}
