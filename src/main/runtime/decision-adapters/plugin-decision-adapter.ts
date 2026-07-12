import type { DecisionOwner, DecisionResolution } from '../../../shared/decision-contract'
import { createGuardDecisionRequest, type CreatedDecisionRequest } from '../decision-request-factories'

const PLUGIN_DECISION_DEADLINE_MS = 5 * 60 * 1000

export interface PluginDecisionServicePort {
  request(request: CreatedDecisionRequest, options?: undefined): Promise<DecisionResolution>
}

export interface PluginDecisionAdapterOptions {
  decisionService?: PluginDecisionServicePort
}

export interface PluginDecisionInput {
  owner: DecisionOwner | null | undefined
  pluginId: string
  hookId: string
  message: string
  idempotencyKey: string
}

/** Maps plugin pre-dispatch gates to the trusted Guard decision factory. */
export class PluginDecisionAdapter {
  constructor(private readonly options: PluginDecisionAdapterOptions) {}

  async request(input: PluginDecisionInput): Promise<boolean> {
    if (!input.owner || !this.options.decisionService) return false
    try {
      const request = createGuardDecisionRequest({
        owner: input.owner,
        agentId: `plugin:${input.pluginId}`,
        role: `plugin:${input.pluginId}:${input.hookId}`,
        risk: 'medium',
        reasons: [input.message],
        deadlineMs: PLUGIN_DECISION_DEADLINE_MS,
        idempotencyKey: input.idempotencyKey
      })
      const resolution = await this.options.decisionService.request(request, undefined)
      return resolution.status === 'selected' &&
        resolution.selectedOptionIds?.length === 1 &&
        resolution.selectedOptionIds[0] === 'allow-once'
    } catch {
      return false
    }
  }
}
