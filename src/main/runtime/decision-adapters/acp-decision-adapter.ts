import type { DecisionRequest, DecisionResolution } from '../../../shared/decision-contract'
import {
  createAcpDecisionRequest,
  type AcpDecisionInput,
  type CreatedDecisionRequest
} from '../decision-request-factories'

const ACP_DECISION_DEADLINE_MS = 5 * 60 * 1000

export type AcpDecisionResolution =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

export interface AcpDecisionServicePort {
  request(
    request: CreatedDecisionRequest,
    options?: { onAdmitted?: (request: DecisionRequest) => void }
  ): Promise<DecisionResolution>
}

export interface AcpDecisionAdapterOptions {
  decisionService?: AcpDecisionServicePort
}

export interface AcpDecisionRequestOptions {
  onRequested?(request: DecisionRequest): void
}

/** Bridges ACP protocol choices to the trusted durable DecisionService. */
export class AcpDecisionAdapter {
  constructor(private readonly options: AcpDecisionAdapterOptions) {}

  async request(
    input: AcpDecisionInput,
    options: AcpDecisionRequestOptions = {}
  ): Promise<AcpDecisionResolution> {
    if (!this.options.decisionService) return { outcome: 'cancelled' }
    try {
      const request = createAcpDecisionRequest({
        ...input,
        deadlineMs: ACP_DECISION_DEADLINE_MS
      })
      const resolution = await this.options.decisionService.request(request, {
        onAdmitted: admitted => options.onRequested?.(admitted)
      })
      const optionId = selectedOriginalAcpOptionId(resolution, request)
      return optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }
    } catch {
      return { outcome: 'cancelled' }
    }
  }
}

function selectedOriginalAcpOptionId(
  resolution: DecisionResolution,
  request: CreatedDecisionRequest
): string | null {
  if (resolution.status !== 'selected' || resolution.selectedOptionIds?.length !== 1) return null
  const optionId = resolution.selectedOptionIds[0]
  return typeof optionId === 'string' && request.options.some(option => option.id === optionId)
    ? optionId
    : null
}
