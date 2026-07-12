import type { DecisionResolution } from '../../../shared/decision-contract'
import {
  createToolDecisionRequest,
  type CreatedDecisionRequest,
  type ToolDecisionInput
} from '../decision-request-factories'

const TOOL_DECISION_DEADLINE_MS = 5 * 60 * 1000

export interface ToolDecisionServicePort {
  request(
    request: CreatedDecisionRequest,
    options?: { onRemember?: (resolution: DecisionResolution) => Promise<void> }
  ): Promise<DecisionResolution>
}

export interface ToolApprovalConfigPort {
  getConfig?(): { preset?: string }
  setOverrideAndFlush(
    agentId: string,
    tool: ToolDecisionInput['tool'],
    policy: 'allow' | 'deny'
  ): Promise<unknown>
}

export interface ToolDecisionAdapterOptions {
  decisionService?: ToolDecisionServicePort
  approvalConfig?: ToolApprovalConfigPort
}

export interface ToolDecisionRequestOptions {
  onRequested?: (request: CreatedDecisionRequest) => void
}

/**
 * Bridges trusted tool calls to the durable DecisionService lifecycle. The
 * adapter never retries a decision: a terminal allow remains a single tool
 * execution even if its optional remembered override cannot be persisted.
 */
export class ToolDecisionAdapter {
  constructor(private readonly options: ToolDecisionAdapterOptions) {}

  async request(input: ToolDecisionInput, options: ToolDecisionRequestOptions = {}): Promise<boolean> {
    if (!this.options.decisionService || !this.options.approvalConfig) return false

    const request = createToolDecisionRequest({
      ...input,
      deadlineMs: TOOL_DECISION_DEADLINE_MS,
      allowRemember: this.canRememberOverride()
    })
    options.onRequested?.(request)
    try {
      const resolution = await this.options.decisionService.request(request, {
        onRemember: async remembered => {
          await this.persistRememberedOverride(input, remembered)
        }
      })
      return selectedAllowOnce(resolution)
    } catch {
      return false
    }
  }

  private persistRememberedOverride(
    input: ToolDecisionInput,
    resolution: DecisionResolution
  ): Promise<unknown> {
    const policy = selectedAllowOnce(resolution) ? 'allow' : 'deny'
    return this.options.approvalConfig!.setOverrideAndFlush(input.agentId, input.tool, policy)
  }

  private canRememberOverride(): boolean {
    const preset = this.options.approvalConfig?.getConfig?.().preset
    return preset !== 'ask-all' && preset !== 'read-only' && preset !== 'full-access'
  }
}

function selectedAllowOnce(resolution: DecisionResolution): boolean {
  return resolution.status === 'selected' &&
    resolution.selectedOptionIds?.length === 1 &&
    resolution.selectedOptionIds[0] === 'allow-once'
}
