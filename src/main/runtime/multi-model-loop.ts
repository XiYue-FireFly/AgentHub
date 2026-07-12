import type { DispatchHandle } from '../hub/dispatcher'
import type { ChatCompletionMessage } from '../providers/types'
import type {
  DispatchEnvelope,
  PromptDispatchLineage,
  PromptEnvelope,
  PromptOrigin
} from '../../shared/prompt-contract'
import { childDispatchLineage } from './dispatch-envelope'
import type { BudgetReservationAmount, BudgetReservationCenter } from './budget-reservations'
import { selectFusionTopology, type ResolvedFusionRoute } from './multi-model-routes'
import { requirePromptIngress } from './prompt-ingress-registry'
import {
  buildCandidatePrompt,
  buildJudgePrompt,
  buildSynthesisPrompt,
  parseJudgeResult,
  selectBestRevision,
  type ScoredRevision
} from './multi-model-loop-prompts'

export type LoopRole = 'candidate' | 'synthesizer' | 'judge' | 'executor'
export type LoopPromptOrigin =
  | 'internal:loop-candidate'
  | 'internal:loop-synthesizer'
  | 'internal:loop-judge'
  | 'internal:loop-executor'

export const LOOP_ORIGIN_BY_ROLE = {
  candidate: 'internal:loop-candidate',
  synthesizer: 'internal:loop-synthesizer',
  judge: 'internal:loop-judge',
  executor: 'internal:loop-executor'
} as const satisfies Record<LoopRole, PromptOrigin>

export interface LoopBranchResult {
  status: 'completed' | 'failed' | 'cancelled'
  content: string
  error?: string
  dispatchEnvelope: DispatchEnvelope
}

export interface LoopDispatchRequest {
  role: LoopRole
  origin: LoopPromptOrigin
  route: ResolvedFusionRoute
  prompt: string
  branchId: string
  revisionId?: string
  options: {
    parentRunId: string
    sessionKey: string
    signal?: AbortSignal
    deadline: number
    budgetReservationId: string
    visibility: 'run'
    capabilityMode: 'normal' | 'read-only'
    optimizationCount: 0
    turnId: string
    threadId: string
    lineage: PromptDispatchLineage
    messages?: ChatCompletionMessage[]
    conversationText?: string
  }
}

export interface LoopDispatchGateway {
  start(request: LoopDispatchRequest): DispatchHandle<LoopBranchResult>
}

export interface MultiModelLoopEvent {
  kind: string
  runId: string
  round?: number
  visibility: 'run' | 'chat'
  gatedRelease?: boolean
  content?: string
  metadata?: Record<string, unknown>
}

export interface MultiModelLoopDependencies {
  gateway: LoopDispatchGateway
  reservations: BudgetReservationCenter
  emit(event: MultiModelLoopEvent): void
  estimateRound(candidateCount: number, round: number): BudgetReservationAmount
  estimateSingle(role: 'candidate' | 'executor'): BudgetReservationAmount
}

export interface MultiModelLoopInput {
  runId: string
  envelope: PromptEnvelope
  lineage: PromptDispatchLineage
  routes: ResolvedFusionRoute[]
  turnId: string
  threadId: string
  signal?: AbortSignal
  deadline: number
  branchTimeoutMs: number
  maxCandidates: 2 | 3
  maxRounds: number
  requiresExecution: boolean
  /** Already-prepared history and plugin/workspace context from the Turn. */
  messages?: ChatCompletionMessage[]
  conversationText?: string
}

export interface MultiModelLoopResult {
  content: string
  mode: 'fusion' | 'degraded'
  rounds: number
  budgetLimited: boolean
  unverified: boolean
  failures: string[]
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason
  return reason instanceof Error ? reason : new Error(String(reason || 'cancelled'))
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal)
}

function deadlineError(scope: 'branch' | 'global'): Error {
  return new Error(`Multi-model ${scope} deadline exceeded`)
}

function throwIfDeadlineExceeded(deadline: number): void {
  if (Date.now() >= deadline) throw deadlineError('global')
}

/**
 * The transport contract does not require a cancelled branch to settle.  Racing
 * the branch promise with the root abort signal keeps cancellation terminal even
 * for a broken provider implementation.
 */
function settleOrAbort<T>(
  result: Promise<T>,
  signal: AbortSignal | undefined,
  deadline: number,
  onDeadline: () => void
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    const onDeadlineExceeded = () => {
      cleanup()
      onDeadline()
      reject(deadlineError('branch'))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) queueMicrotask(onDeadlineExceeded)
    else timer = setTimeout(onDeadlineExceeded, remainingMs)
    result.then(
      value => {
        cleanup()
        resolve(value)
      },
      error => {
        cleanup()
        reject(error)
      }
    )
  })
}

function normalizedRounds(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(1, Math.floor(value)))
}

function normalizedCandidates(value: number): number {
  if (!Number.isFinite(value)) return 2
  return Math.min(3, Math.max(2, Math.floor(value)))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function cancelHandle(handle: DispatchHandle<unknown>, reason: string): void {
  try {
    void Promise.resolve(handle.cancel(reason)).catch(() => undefined)
  } catch {
    // Best-effort cancellation must not mask the root abort or block siblings.
  }
}

export class MultiModelLoopRunner {
  constructor(private readonly deps: MultiModelLoopDependencies) {}

  async run(input: MultiModelLoopInput): Promise<MultiModelLoopResult> {
    this.assertPreparedRoot(input)
    throwIfAborted(input.signal)
    throwIfDeadlineExceeded(input.deadline)

    const topology = selectFusionTopology(input.routes, normalizedCandidates(input.maxCandidates))
    const maxRounds = normalizedRounds(input.maxRounds)
    const active = new Set<DispatchHandle<LoopBranchResult>>()
    const seenDispatchIds = new Set<string>()
    const failures: string[] = []
    const revisions: ScoredRevision[] = []
    const synthesisDispatchIds = new Map<string, string>()
    let latestJudgeDispatchId: string | undefined
    let finalReleased = false

    // Do not await cancellation: a faulty transport is allowed to leave a
    // cancelled result pending, while the root run must still reject promptly.
    const cancelAll = (reason: string) => {
      for (const handle of active) {
        cancelHandle(handle, reason)
      }
    }
    const onAbort = () => cancelAll(errorMessage(input.signal?.reason || 'cancelled'))
    input.signal?.addEventListener('abort', onAbort, { once: true })

    const dispatch = async (
      role: LoopRole,
      route: ResolvedFusionRoute,
      prompt: string,
      branchId: string,
      reservationId: string,
      revisionId?: string,
      parentDispatchId?: string
    ): Promise<LoopBranchResult> => {
      throwIfAborted(input.signal)
      throwIfDeadlineExceeded(input.deadline)
      const origin = LOOP_ORIGIN_BY_ROLE[role]
      const lineage = parentDispatchId
        ? childDispatchLineage(input.lineage, parentDispatchId, origin)
        : this.rootBranchLineage(input.lineage, origin)
      const messages = input.messages
        ? [...input.messages.map(message => ({ ...message })), { role: 'user' as const, content: prompt }]
        : undefined
      const request: LoopDispatchRequest = {
        role,
        origin,
        route,
        prompt,
        branchId,
        revisionId,
        options: {
          parentRunId: input.runId,
          sessionKey: input.threadId + ':' + input.runId + ':' + branchId,
          signal: input.signal,
          deadline: Math.min(input.deadline, Date.now() + Math.max(0, input.branchTimeoutMs)),
          budgetReservationId: reservationId,
          visibility: 'run',
          capabilityMode: role === 'executor' ? 'normal' : 'read-only',
          optimizationCount: 0,
          turnId: input.turnId,
          threadId: input.threadId,
          lineage,
          messages,
          conversationText: input.conversationText
        }
      }
      const handle = this.deps.gateway.start(request)
      if (!handle || typeof handle.cancel !== 'function' || !handle.result || typeof handle.result.then !== 'function') {
        throw new Error('Loop dispatch gateway returned an invalid DispatchHandle.')
      }
      active.add(handle)
      try {
        if (input.signal?.aborted) {
          cancelHandle(handle, errorMessage(input.signal.reason || 'cancelled'))
          throw abortError(input.signal)
        }
        const result = await settleOrAbort(
          handle.result,
          input.signal,
          request.options.deadline,
          () => cancelHandle(handle, 'branch deadline exceeded')
        )
        this.assertBranchResult(result, request, seenDispatchIds)
        return result
      } finally {
        active.delete(handle)
      }
    }

    const release = async (
      content: string,
      mode: 'fusion' | 'degraded',
      rounds: number,
      budgetLimited: boolean,
      unverified: boolean,
      acceptedParentDispatchId?: string
    ): Promise<MultiModelLoopResult> => {
      throwIfAborted(input.signal)
      let releasedContent = content
      if (input.requiresExecution) {
        const executorBudget = this.deps.reservations.reserve(
          input.runId + ':executor',
          this.deps.estimateSingle('executor')
        )
        if (!executorBudget.ok) {
          failures.push(executorBudget.reason)
          budgetLimited = true
        } else {
          try {
            const executor = await dispatch(
              'executor',
              topology.candidates[0],
              [
                '[Final Executor]',
                'Execute the accepted synthesis once under normal approval policy.',
                'Prepared root request:\n' + input.envelope.effectivePrompt,
                'Accepted synthesis:\n' + content
              ].join('\n\n'),
              'executor',
              executorBudget.receipt.id,
              undefined,
              acceptedParentDispatchId
            )
            if (executor.status === 'completed' && executor.content) releasedContent = executor.content
            else failures.push(executor.error || 'Final Executor failed.')
          } catch (error) {
            // Abort is terminal and must never be converted into a release.
            throwIfAborted(input.signal)
            failures.push(errorMessage(error))
          } finally {
            this.deps.reservations.release(executorBudget.receipt.id)
          }
        }
      }

      throwIfAborted(input.signal)
      if (finalReleased) throw new Error('Multi-model final output was released more than once.')
      finalReleased = true
      this.deps.emit({
        kind: 'multi-model:final',
        runId: input.runId,
        visibility: 'chat',
        gatedRelease: true,
        content: releasedContent,
        metadata: { mode, rounds, budgetLimited, unverified, failures: [...failures] }
      })
      return { content: releasedContent, mode, rounds, budgetLimited, unverified, failures: [...failures] }
    }

    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        throwIfAborted(input.signal)
        const reservation = this.deps.reservations.reserve(
          input.runId + ':round:' + round,
          this.deps.estimateRound(topology.candidates.length, round)
        )
        if (!reservation.ok) {
          if (round > 1) {
            const best = selectBestRevision(revisions)
            const fallback = best || revisions.at(-1)
            if (!fallback) throw new Error(reservation.reason)
            return await release(
              fallback.content,
              'fusion',
              round - 1,
              true,
              !(best?.judge.valid && best.judge.verdict === 'PASS'),
              synthesisDispatchIds.get(fallback.revisionId)
            )
          }
          return await this.runSingleFallback(input, topology.candidates[0], dispatch, release)
        }

        try {
          this.deps.emit({ kind: 'multi-model:round-started', runId: input.runId, round, visibility: 'run' })
          const feedback = revisions.at(-1)?.judge.feedback
          // map starts every branch before Promise.allSettled waits for any result.
          const settled = await Promise.allSettled(topology.candidates.map((route, index) =>
            dispatch(
              'candidate',
              route,
              buildCandidatePrompt({
                effectivePrompt: input.envelope.effectivePrompt,
                round,
                candidateIndex: index + 1,
                feedback
              }),
              'round-' + round + '-candidate-' + (index + 1),
              reservation.receipt.id,
              undefined,
              latestJudgeDispatchId
            ).then(result => ({ route, result }))
          ))
          throwIfAborted(input.signal)
          const successful = settled.flatMap(item => {
            if (item.status === 'rejected') {
              failures.push(errorMessage(item.reason))
              return []
            }
            const branch = item.value.result
            if (branch.status !== 'completed' || !branch.content) {
              failures.push(branch.error || item.value.route.key + ' candidate failed')
              return []
            }
            return [{
              routeKey: item.value.route.key,
              content: branch.content,
              dispatchEnvelope: branch.dispatchEnvelope
            }]
          })

          if (successful.length === 0) {
            throw new Error('All multi-model candidates failed: ' + failures.join('; '))
          }
          if (successful.length === 1) {
            return await release(
              successful[0].content,
              'degraded',
              round,
              false,
              true,
              successful[0].dispatchEnvelope.dispatchId
            )
          }

          const revisionId = 'revision-' + round
          let synthesis: LoopBranchResult
          try {
            synthesis = await dispatch(
              'synthesizer',
              topology.synthesizer,
              buildSynthesisPrompt({
                effectivePrompt: input.envelope.effectivePrompt,
                round,
                candidates: successful.map(candidate => ({ routeKey: candidate.routeKey, content: candidate.content }))
              }),
              'round-' + round + '-synthesizer',
              reservation.receipt.id,
              revisionId,
              successful[0].dispatchEnvelope.dispatchId
            )
          } catch (error) {
            throwIfAborted(input.signal)
            failures.push(errorMessage(error))
            continue
          }
          if (synthesis.status !== 'completed' || !synthesis.content) {
            failures.push(synthesis.error || 'Synthesizer failed.')
            continue
          }
          // Preserve the synthesis identity before judging.  If the judge is
          // unavailable, the next round still has a verified parent lineage.
          synthesisDispatchIds.set(revisionId, synthesis.dispatchEnvelope.dispatchId)

          let judged: LoopBranchResult
          try {
            judged = await dispatch(
              'judge',
              topology.judge,
              buildJudgePrompt({
                effectivePrompt: input.envelope.effectivePrompt,
                revisionId,
                revision: synthesis.content
              }),
              'round-' + round + '-judge',
              reservation.receipt.id,
              revisionId,
              synthesis.dispatchEnvelope.dispatchId
            )
          } catch (error) {
            throwIfAborted(input.signal)
            this.recordFailedJudge({
              revisions,
              revisionId,
              content: synthesis.content,
              round,
              synthesisDispatchId: synthesis.dispatchEnvelope.dispatchId,
              synthesisDispatchIds,
              setLatestJudgeDispatchId: id => { latestJudgeDispatchId = id },
              failures,
              error: errorMessage(error)
            })
            continue
          }
          if (judged.status !== 'completed' || !judged.content) {
            this.recordFailedJudge({
              revisions,
              revisionId,
              content: synthesis.content,
              round,
              synthesisDispatchId: synthesis.dispatchEnvelope.dispatchId,
              synthesisDispatchIds,
              setLatestJudgeDispatchId: id => { latestJudgeDispatchId = id },
              failures,
              error: judged.error || 'Judge failed.'
            })
            continue
          }
          const judge = parseJudgeResult(judged.content, revisionId)
          revisions.push({ revisionId, content: synthesis.content, round, judge })
          latestJudgeDispatchId = judged.dispatchEnvelope.dispatchId
          if (judge.valid && judge.verdict === 'PASS') {
            return await release(
              synthesis.content,
              'fusion',
              round,
              false,
              false,
              synthesis.dispatchEnvelope.dispatchId
            )
          }
        } finally {
          this.deps.reservations.release(reservation.receipt.id)
        }
      }

      throwIfAborted(input.signal)
      const best = selectBestRevision(revisions)
      if (best) {
        return await release(
          best.content,
          'fusion',
          maxRounds,
          false,
          !(best.judge.valid && best.judge.verdict === 'PASS'),
          synthesisDispatchIds.get(best.revisionId)
        )
      }
      const latest = revisions.at(-1)
      if (!latest) throw new Error('No multi-model revision was produced.')
      return await release(
        latest.content,
        'fusion',
        maxRounds,
        false,
        true,
        synthesisDispatchIds.get(latest.revisionId)
      )
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
      if (input.signal?.aborted) cancelAll(errorMessage(input.signal.reason || 'cancelled'))
    }
  }

  private async runSingleFallback(
    input: MultiModelLoopInput,
    route: ResolvedFusionRoute,
    dispatch: (
      role: LoopRole,
      route: ResolvedFusionRoute,
      prompt: string,
      branchId: string,
      reservationId: string,
      revisionId?: string,
      parentDispatchId?: string
    ) => Promise<LoopBranchResult>,
    release: (
      content: string,
      mode: 'fusion' | 'degraded',
      rounds: number,
      budgetLimited: boolean,
      unverified: boolean,
      acceptedParentDispatchId?: string
    ) => Promise<MultiModelLoopResult>
  ): Promise<MultiModelLoopResult> {
    const reservation = this.deps.reservations.reserve(
      input.runId + ':single',
      this.deps.estimateSingle('candidate')
    )
    if (!reservation.ok) throw new Error(reservation.reason)
    try {
      const single = await dispatch(
        'candidate',
        route,
        buildCandidatePrompt({ effectivePrompt: input.envelope.effectivePrompt, round: 1, candidateIndex: 1 }),
        'single-fallback',
        reservation.receipt.id
      )
      if (single.status !== 'completed' || !single.content) {
        throw new Error(single.error || 'Single-model fallback failed.')
      }
      return await release(single.content, 'degraded', 1, true, true, single.dispatchEnvelope.dispatchId)
    } finally {
      this.deps.reservations.release(reservation.receipt.id)
    }
  }

  private assertPreparedRoot(input: MultiModelLoopInput): void {
    const envelope = input.envelope
    const lineage = input.lineage
    if (!envelope || !nonEmptyString(envelope.envelopeId) || !nonEmptyString(envelope.effectivePrompt)) {
      throw new Error('Prepared root Prompt envelope is required.')
    }
    if (requirePromptIngress(envelope.origin).scope !== 'root') {
      throw new Error('Multi-model root Prompt origin must be root-scoped.')
    }
    if (
      !lineage
      || lineage.origin !== envelope.origin
      || lineage.policy !== envelope.policy
      || !nonEmptyString(envelope.rootInputId)
      || !nonEmptyString(envelope.preparedTextHash)
      || lineage.rootInputId !== envelope.rootInputId
      || lineage.rootEnvelopeId !== envelope.envelopeId
      || lineage.rootPreparedTextHash !== envelope.preparedTextHash
      || lineage.parentDispatchId !== undefined
    ) {
      throw new Error('Multi-model root lineage does not match the prepared Prompt envelope.')
    }
  }

  private rootBranchLineage(root: PromptDispatchLineage, origin: LoopPromptOrigin): PromptDispatchLineage {
    return Object.freeze({
      origin,
      policy: 'internal',
      rootInputId: root.rootInputId,
      rootEnvelopeId: root.rootEnvelopeId,
      rootPreparedTextHash: root.rootPreparedTextHash
    })
  }

  private assertBranchResult(
    result: LoopBranchResult,
    request: LoopDispatchRequest,
    seenDispatchIds: Set<string>
  ): void {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Loop branch returned an invalid result.')
    }
    if (result.status !== 'completed' && result.status !== 'failed' && result.status !== 'cancelled') {
      throw new Error('Loop branch returned an invalid status.')
    }
    if (typeof result.content !== 'string') throw new Error('Loop branch returned invalid content.')
    const envelope = result.dispatchEnvelope
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new Error('Loop branch did not return a DispatchEnvelope.')
    }
    if (!nonEmptyString(envelope.dispatchId)) throw new Error('DispatchEnvelope dispatchId is invalid.')
    if (!nonEmptyString(envelope.canonicalPayloadHash)) {
      throw new Error('DispatchEnvelope canonical payload hash is invalid.')
    }
    if (seenDispatchIds.has(envelope.dispatchId)) throw new Error('DispatchEnvelope dispatchId was reused.')
    if (envelope.providerId !== request.route.providerId || envelope.modelId !== request.route.modelId) {
      throw new Error('DispatchEnvelope provider/model mismatch.')
    }
    if (
      envelope.origin !== request.origin
      || envelope.policy !== 'internal'
      || envelope.rootInputId !== request.options.lineage.rootInputId
      || envelope.rootEnvelopeId !== request.options.lineage.rootEnvelopeId
      || envelope.rootPreparedTextHash !== request.options.lineage.rootPreparedTextHash
      || envelope.parentDispatchId !== request.options.lineage.parentDispatchId
      || envelope.optimizationCount !== 0
    ) {
      throw new Error('DispatchEnvelope lineage does not match the ' + request.role + ' branch.')
    }
    seenDispatchIds.add(envelope.dispatchId)
  }

  private recordFailedJudge(input: {
    revisions: ScoredRevision[]
    revisionId: string
    content: string
    round: number
    synthesisDispatchId: string
    synthesisDispatchIds: Map<string, string>
    setLatestJudgeDispatchId(id: string): void
    failures: string[]
    error: string
  }): void {
    input.failures.push(input.error)
    input.revisions.push({
      revisionId: input.revisionId,
      content: input.content,
      round: input.round,
      judge: {
        valid: false,
        verdict: 'REVISE',
        score: 0,
        revisionId: input.revisionId,
        feedback: input.error,
        unresolved: []
      }
    })
    input.synthesisDispatchIds.set(input.revisionId, input.synthesisDispatchId)
    input.setLatestJudgeDispatchId(input.synthesisDispatchId)
  }
}
