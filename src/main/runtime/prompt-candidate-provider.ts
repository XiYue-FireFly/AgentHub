import { buildProviderClient, type ResolvedCall } from '../providers/client'
import { getProviderManager } from '../providers/manager'
import type { AgentRouteBinding, ThinkingConfig } from '../providers/types'
import { appendAppEventLog } from './app-event-log'
import { canonicalProviderPayload, createDispatchEnvelope, createDispatchId } from './dispatch-envelope'
import type { PromptCandidateInvocation } from './prompt-candidate-generator'

type CandidateClient = ReturnType<typeof buildProviderClient>

export interface PromptCandidateModelIdentity {
  readonly providerId: string
  readonly modelId: string
}

export interface PromptCandidateProviderDependencies {
  readonly resolve: (identity: PromptCandidateModelIdentity) => ResolvedCall
  readonly buildClient: (resolved: ResolvedCall) => CandidateClient
  readonly createId: () => string
  readonly audit: (kind: string, payload: Record<string, unknown>) => void
}

function auditDispatchPrepared(
  audit: PromptCandidateProviderDependencies['audit'],
  envelope: ReturnType<typeof createDispatchEnvelope>
): void {
  audit('dispatch:prepared', {
    dispatchId: envelope.dispatchId,
    providerId: envelope.providerId,
    modelId: envelope.modelId,
    canonicalPayloadHash: envelope.canonicalPayloadHash,
    origin: envelope.origin,
    policy: envelope.policy,
    rootInputId: envelope.rootInputId,
    rootEnvelopeId: envelope.rootEnvelopeId,
    rootPreparedTextHash: envelope.rootPreparedTextHash,
    parentDispatchId: envelope.parentDispatchId
  })
}

/**
 * Sends the candidate-generator's JSON-only request through the same verified
 * ProviderClient boundary as ordinary dispatches. This is an internal model
 * call, never a root PromptPreparationSession.
 */
export function createPromptCandidateProviderInvoker(
  dependencies: PromptCandidateProviderDependencies
): (input: PromptCandidateInvocation) => Promise<string> {
  return async input => {
    const identity = requirePromptCandidateIdentity(input)
    const resolved = dependencies.resolve(identity)
    const messages = [{ role: 'user' as const, content: input.userPrompt }]
    const dispatchEnvelope = createDispatchEnvelope({
      dispatchId: dependencies.createId(),
      lineage: { origin: 'internal:prompt-candidate', policy: 'internal' },
      payload: canonicalProviderPayload({
        providerId: resolved.provider.id,
        modelId: resolved.model.id,
        protocol: resolved.provider.capabilities.protocol,
        systemPrompt: input.systemPrompt,
        messages,
        tools: [],
        toolChoice: null,
        thinking: resolved.thinking
      })
    })
    auditDispatchPrepared(dependencies.audit, dispatchEnvelope)

    return await new Promise<string>((resolve, reject) => {
      let content = ''
      let settled = false
      const complete = (value: string) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      let stream: Promise<void>
      try {
        stream = Promise.resolve(dependencies.buildClient(resolved).stream({
          messages,
          systemPrompt: input.systemPrompt,
          thinkingOverride: resolved.thinking,
          tools: [],
          toolChoice: input.toolChoice,
          dispatchEnvelope
        }, {
          onContent: delta => { content += delta },
          onDone: final => complete(final.content || content),
          onError: fail
        }))
      } catch (error) {
        fail(error)
        return
      }
      void stream.catch(fail)
    })
  }
}

export function resolveProductionPromptCandidateIdentity(
  preferred?: Partial<PromptCandidateModelIdentity>
): PromptCandidateModelIdentity {
  const providerId = selectedIdentifier(preferred?.providerId)
  const modelId = selectedIdentifier(preferred?.modelId)
  if (providerId || modelId) {
    if (!providerId || !modelId) {
      throw new Error('Prompt candidate provider and model must be selected together')
    }
    resolveEnabledCandidateModel({ providerId, modelId })
    return Object.freeze({ providerId, modelId })
  }

  const provider = getProviderManager().getEnabledProviders()
    .find(item => item.models.some(model => model.enabled !== false))
  const model = provider?.models.find(item => item.enabled !== false)
  if (!provider || !model) {
    throw new Error('No enabled provider model is available for prompt candidates')
  }
  return Object.freeze({ providerId: provider.id, modelId: model.id })
}

function requirePromptCandidateIdentity(input: PromptCandidateInvocation): PromptCandidateModelIdentity {
  const providerId = selectedIdentifier(input.providerId)
  const modelId = selectedIdentifier(input.modelId)
  if (!providerId || !modelId) {
    throw new Error('Prompt candidate invocation requires a selected provider and model')
  }
  return Object.freeze({ providerId, modelId })
}

function selectedIdentifier(value: unknown): string | undefined {
  const identifier = typeof value === 'string' ? value.trim() : ''
  return identifier && identifier !== 'unselected' ? identifier : undefined
}

function resolveEnabledCandidateModel(identity: PromptCandidateModelIdentity) {
  const provider = getProviderManager().getEnabledProviders()
    .find(item => item.id === identity.providerId)
  const model = provider?.models.find(item => item.id === identity.modelId && item.enabled !== false)
  if (!provider || !model) {
    throw new Error(`Prompt candidate provider/model is not enabled: ${identity.providerId}/${identity.modelId}`)
  }
  return { provider, model }
}

function resolveProductionCandidateCall(identity: PromptCandidateModelIdentity): ResolvedCall {
  const { provider, model } = resolveEnabledCandidateModel(identity)
  const thinking: ThinkingConfig = { mode: 'off', level: 'medium' }
  const binding: AgentRouteBinding = {
    agentId: 'prompt-candidate-generator',
    providerId: provider.id,
    modelId: model.id,
    thinkingAllow: ['off'],
    thinking,
    maxOutputTokens: 2048,
    temperature: 0.2,
    protocol: 'http'
  }
  return { provider, model, binding, thinking }
}

export const invokeProductionPromptCandidateModel = createPromptCandidateProviderInvoker({
  resolve: resolveProductionCandidateCall,
  buildClient: buildProviderClient,
  createId: createDispatchId,
  audit: appendAppEventLog
})
