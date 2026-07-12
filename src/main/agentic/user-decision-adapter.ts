import type { DecisionOwner, DecisionResolution } from '../../shared/decision-contract'
import { createAgentDecisionRequest } from '../runtime/decision-request-factories'
import type { DecisionService } from '../runtime/decision-service'
import type { AgentDecisionRequester } from './user-decision-tool'

const CUSTOM_INPUT_MAX_CHARS = 16 * 1024

export interface UserDecisionAdapter {
  forAgent(agentId: string, signal?: AbortSignal): AgentDecisionRequester
}

export interface UserDecisionAdapterOptions {
  decisionService: Pick<DecisionService, 'request'>
  owner: DecisionOwner
}

export function createUserDecisionAdapter({
  decisionService,
  owner
}: UserDecisionAdapterOptions): UserDecisionAdapter {
  assertSupportedOwner(owner)

  return {
    forAgent(agentId, signal) {
      const normalizedAgentId = normalizeAgentId(agentId)

      return async input => {
        const request = createAgentDecisionRequest({
          owner,
          title: input.title,
          description: input.description,
          kind: input.selectionMode === 'multi' ? 'multi-select' : 'single-select',
          options: input.options.map(option => ({
            id: option.id,
            label: option.label,
            description: option.description
          })),
          minSelections: input.minSelections,
          maxSelections: input.maxSelections,
          allowCustom: input.allowCustom,
          ...(input.allowCustom
            ? {
                customInput: {
                  placeholder: 'Enter another answer',
                  maxChars: CUSTOM_INPUT_MAX_CHARS
                }
              }
            : {}),
          idempotencyKey: `${normalizedAgentId}:${input.idempotencyKey}`
        })
        const resolution = await decisionService.request(request, { signal })
        return toAgentDecisionResolution(resolution)
      }
    }
  }
}

function assertSupportedOwner(owner: DecisionOwner): void {
  if (!owner || (owner.type !== 'turn' && owner.type !== 'hub')) {
    throw new Error('Unsupported decision owner type')
  }
}

function normalizeAgentId(agentId: string): string {
  if (typeof agentId !== 'string' || !agentId.trim()) {
    throw new Error('Agent ID must be a non-empty string')
  }
  return agentId.trim()
}

function toAgentDecisionResolution(resolution: DecisionResolution) {
  return {
    status: resolution.status,
    selectedOptionIds: resolution.selectedOptionIds,
    text: resolution.text,
    resolvedAt: resolution.resolvedAt
  }
}
