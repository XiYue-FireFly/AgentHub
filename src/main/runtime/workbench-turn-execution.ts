import type { RuntimeModelSelectionLike, TurnCreateInputLike } from '../../shared/ipc-contract'
import { isProviderDirectSelection } from '../../shared/utils'
import type { DispatchInputOptions, Dispatcher } from '../hub/dispatcher'
import { planDispatch, type DispatchPlan } from './dispatch-planner'
import type { PromptDispatchAnalysis } from './prompt-optimizer'
import type { WorkbenchAttachment } from './types'

export interface QueuedWorkbenchTurnRouting {
  requestedMode: NonNullable<TurnCreateInputLike['mode']>
  directTarget: string | undefined
  providerDirect: boolean
  directRun: boolean
  turnModelSelection: RuntimeModelSelectionLike | undefined
  dispatchPlan: DispatchPlan
}

/**
 * Resolves a durable submission into the same routing data consumed by the
 * Workbench executor. Local selections win over provider selections so a
 * selected local agent cannot accidentally inherit a schedule or provider
 * direct route.
 */
export function resolveQueuedWorkbenchTurnDispatch(input: {
  payload: TurnCreateInputLike
  availableAgentIds: string[]
  attachments: WorkbenchAttachment[]
  optimization: PromptDispatchAnalysis
}): QueuedWorkbenchTurnRouting {
  const requestedMode = input.payload.mode || 'auto'
  const requestedDirectTarget = input.payload.targetAgent?.trim() || undefined
  const directTarget = requestedDirectTarget && input.availableAgentIds.includes(requestedDirectTarget)
    ? requestedDirectTarget
    : undefined
  const providerDirect = !directTarget && isProviderDirectSelection(input.payload.modelSelection)
  const directRun = providerDirect || !!directTarget
  const turnModelSelection = providerDirect
    ? input.payload.modelSelection
    : directTarget
      ? undefined
      : input.payload.modelSelection
  const dispatchPlan = planDispatch({
    requestedMode,
    directRun,
    directTarget,
    customSchedule: input.payload.customSchedule,
    availableAgentIds: input.availableAgentIds,
    attachments: input.attachments,
    optimization: input.optimization
  })

  return { requestedMode, directTarget, providerDirect, directRun, turnModelSelection, dispatchPlan }
}

/**
 * The final dispatch branch shared by durable Workbench turns. The caller
 * performs preflight and cancellation checks before reaching this boundary.
 */
export function executeQueuedWorkbenchTurnDispatch(input: {
  routing: QueuedWorkbenchTurnRouting
  plan: DispatchPlan
  dispatcher: Pick<Dispatcher, 'dispatch' | 'dispatchProviderDirect'>
  prompt: string
  providerOptions: DispatchInputOptions
  dispatchOptions: DispatchInputOptions
  runSchedule: () => Promise<any>
}): Promise<any> {
  if (input.routing.providerDirect && input.routing.turnModelSelection) {
    return input.dispatcher.dispatchProviderDirect(input.prompt, input.routing.turnModelSelection, input.providerOptions)
  }
  if (!input.routing.directTarget && input.plan.schedule) {
    return input.runSchedule()
  }
  return input.dispatcher.dispatch(
    input.prompt,
    input.routing.directTarget ? 'auto' : input.plan.dispatchMode,
    input.routing.directTarget,
    input.dispatchOptions
  )
}
