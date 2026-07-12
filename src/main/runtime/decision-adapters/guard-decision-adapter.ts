import type { DecisionResolution } from '../../../shared/decision-contract'
import {
  createGuardDecisionRequest,
  type CreatedDecisionRequest,
  type GuardDecisionInput
} from '../decision-request-factories'

const GUARD_DECISION_DEADLINE_MS = 5 * 60 * 1000

export type GuardDecision = {
  requestId: string
  decision: 'approved' | 'denied' | 'timeout' | 'cancelled'
}

export interface GuardDecisionServicePort {
  request(request: CreatedDecisionRequest): Promise<DecisionResolution>
}

export interface GuardDecisionAdapterOptions {
  decisionService?: GuardDecisionServicePort
}

export type GuardDecisionRequestInput = Omit<GuardDecisionInput, 'owner'> & {
  owner?: GuardDecisionInput['owner'] | null
}

/** Bridges trusted Guard verdicts to the durable DecisionService lifecycle. */
export class GuardDecisionAdapter {
  constructor(private readonly options: GuardDecisionAdapterOptions) {}

  async request(input: GuardDecisionRequestInput): Promise<GuardDecision> {
    if (!this.options.decisionService || !isTrustedTurnOwner(input.owner)) {
      return { requestId: '', decision: 'cancelled' }
    }

    let request: CreatedDecisionRequest
    try {
      request = createGuardDecisionRequest({
        ...input,
        owner: input.owner,
        deadlineMs: GUARD_DECISION_DEADLINE_MS
      })
    } catch {
      return { requestId: '', decision: 'cancelled' }
    }

    try {
      const resolution = await this.options.decisionService.request(request)
      return {
        requestId: typeof resolution.requestId === 'string' && resolution.requestId
          ? resolution.requestId
          : request.id,
        decision: guardDecisionFromResolution(resolution)
      }
    } catch {
      return { requestId: request.id, decision: 'cancelled' }
    }
  }
}

function guardDecisionFromResolution(resolution: DecisionResolution): GuardDecision['decision'] {
  if (
    resolution.status === 'selected' &&
    resolution.selectedOptionIds?.length === 1 &&
    resolution.selectedOptionIds[0] === 'allow-once'
  ) {
    return 'approved'
  }
  if (resolution.status === 'timeout') return 'timeout'
  if (resolution.status === 'cancelled' || resolution.status === 'stale') return 'cancelled'
  return 'denied'
}

function isTrustedTurnOwner(owner: GuardDecisionRequestInput['owner']): owner is GuardDecisionInput['owner'] {
  return !!owner &&
    owner.type === 'turn' &&
    typeof owner.threadId === 'string' && owner.threadId.trim().length > 0 &&
    typeof owner.turnId === 'string' && owner.turnId.trim().length > 0 &&
    (owner.workspaceId === null || (typeof owner.workspaceId === 'string' && owner.workspaceId.trim().length > 0)) &&
    Number.isInteger(owner.webContentsId) && owner.webContentsId > 0
}
