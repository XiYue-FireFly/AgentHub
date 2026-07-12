import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dispatchPreparedTurn } from '../../runtime/multi-model-dispatch'
import type { PromptEnvelope } from '../../../shared/prompt-contract'

const envelope: PromptEnvelope = {
  envelopeId: 'env-1',
  sessionId: 'session-1',
  rootInputId: 'input-1',
  displayOriginalPrompt: 'Original request',
  effectivePrompt: 'Optimized request',
  origin: 'workbench:create',
  policy: 'optimize',
  status: 'optimized',
  optimizerVersion: 'prompt-preparation-v1',
  inputHash: 'input-hash-1',
  preparedTextHash: 'prepared-hash-1',
  optimizationCount: 1,
  finalizedAt: 1
}

describe('prepared turn multi-model dispatch', () => {
  it('refuses a raw string without a finalized root envelope before either route starts', async () => {
    const dispatchOrdinary = vi.fn()
    const runFusion = vi.fn()

    await expect(dispatchPreparedTurn({
      envelope: undefined,
      fusion: { enabled: true, maxCandidates: 3, maxRounds: 3, allowExecutor: false }
    }, { dispatchOrdinary, runFusion })).rejects.toThrow(/finalized Prompt envelope/)

    expect(dispatchOrdinary).not.toHaveBeenCalled()
    expect(runFusion).not.toHaveBeenCalled()
  })

  it('routes ordinary and Fusion modes with the same effective prepared root', async () => {
    const dispatchOrdinary = vi.fn(async () => ({ content: 'ordinary' }))
    const runFusion = vi.fn(async () => ({ content: 'fusion' }))
    const off = { enabled: false, maxCandidates: 3, maxRounds: 3, allowExecutor: false } as const
    const on = { enabled: true, maxCandidates: 3, maxRounds: 3, allowExecutor: false } as const

    await expect(dispatchPreparedTurn({
      envelope,
      fusion: off
    }, { dispatchOrdinary, runFusion }))
      .resolves.toEqual({ content: 'ordinary' })
    await expect(dispatchPreparedTurn({
      envelope,
      fusion: on
    }, { dispatchOrdinary, runFusion }))
      .resolves.toEqual({ content: 'fusion' })

    expect(dispatchOrdinary).toHaveBeenCalledWith(envelope)
    expect(runFusion).toHaveBeenCalledWith(envelope, on)
  })

  it('does not silently fall back to ordinary dispatch when Fusion is unavailable', async () => {
    const dispatchOrdinary = vi.fn(async () => ({ content: 'ordinary' }))
    const runFusion = vi.fn(async () => {
      throw new Error('MULTI_MODEL_UNAVAILABLE: at least two distinct resolved models are required')
    })

    await expect(dispatchPreparedTurn({
      envelope,
      fusion: { enabled: true, maxCandidates: 3, maxRounds: 3, allowExecutor: false }
    }, { dispatchOrdinary, runFusion })).rejects.toThrow(/MULTI_MODEL_UNAVAILABLE/)

    expect(runFusion).toHaveBeenCalledWith(envelope, expect.objectContaining({ enabled: true }))
    expect(dispatchOrdinary).not.toHaveBeenCalled()
  })

  it('does not authorize the normal-capability executor from fusion config or lexical intent', () => {
    const indexSource = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')
    const executionStart = indexSource.indexOf('async function executeQueuedWorkbenchTurn')
    const executionEnd = indexSource.indexOf('\nfunction appAssetPath', executionStart)
    const execution = indexSource.slice(executionStart, executionEnd)

    expect(execution).toContain('requiresExecution: false')
    expect(execution).not.toContain('config.allowExecutor')
    expect(execution).not.toContain("['implementation', 'bugfix', 'operations'].includes(optimization.intent)")
  })

  it('wires the durable prepared Turn to a cancellable read-only Dispatcher gateway', () => {
    const indexSource = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8')
    const executionStart = indexSource.indexOf('async function executeQueuedWorkbenchTurn')
    const executionEnd = indexSource.indexOf('\nfunction appAssetPath', executionStart)
    const execution = indexSource.slice(executionStart, executionEnd)

    expect(execution).toContain('turn.promptEnvelope')
    const finalizedEnvelopeGuard = execution.indexOf('A finalized Prompt envelope is required before routing.')
    expect(finalizedEnvelopeGuard).toBeGreaterThanOrEqual(0)
    expect(finalizedEnvelopeGuard)
      .toBeLessThan(execution.indexOf('resolveQueuedWorkbenchTurnDispatch('))
    expect(execution).toContain('dispatchPreparedTurn(')
    expect(execution).toContain('envelope.effectivePrompt !== promptEnvelope.effectivePrompt')
    expect(execution).toContain('new MultiModelLoopRunner({')
    expect(execution).toContain('resolveDistinctFusionRoutes(')
    expect(execution).toContain('dispatchBudgetReservations')
    expect(execution).toContain('activeDispatcher.startDispatch(')
    expect(execution).toContain('task.latestDispatchEnvelope')
    expect(execution).toContain("capabilityMode: request.options.capabilityMode")
    expect(execution).toContain('signal: input.signal')
    expect(execution).toContain('messages: request.options.messages')
    expect(execution).toContain('conversationText: request.options.conversationText')
    expect(execution).toContain('messages,')
    expect(execution).toContain('conversationText: dispatchPrompt')
    expect(execution).toContain('optimizationCount: 0')
    expect(execution).toContain('runtimeStore.completeTurnWithFinalEvent(')
    expect(execution).toContain("event.kind === 'multi-model:final'")
    expect(execution).toContain("agentId: 'multi-model-loop'")
    expect(execution).toContain("visibility: 'chat'")
    expect(execution).toContain('gatedRelease: true')
    expect(execution).toContain("{ ...event, visibility: 'run', gatedRelease: false }")
    expect(execution).toContain('if (task?.fusionReleased === true) return')
    const availabilityStart = execution.indexOf('const availability = await degradeFusionIfUnavailable')
    const availability = execution.slice(availabilityStart, execution.indexOf('const loopGateway', availabilityStart))
    expect(availabilityStart).toBeGreaterThanOrEqual(0)
    expect(availability).toContain("'turn:summary'")
    expect(availability).toContain("'multi-model-loop'")
    expect(availability).toContain("if (availability.kind === 'degraded')")
    expect(availability).toContain('return dispatchOrdinary()')
    expect(availability).not.toContain("throw new Error('MULTI_MODEL_UNAVAILABLE")
  })
})
