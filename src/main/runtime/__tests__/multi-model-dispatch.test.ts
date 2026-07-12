import { describe, expect, it, vi } from 'vitest'
import { degradeFusionIfUnavailable, dispatchPreparedTurn } from '../multi-model-dispatch'

const fusion = {
  enabled: true,
  maxCandidates: 3 as const,
  maxRounds: 3 as const,
  allowExecutor: true
}

describe('dispatchPreparedTurn', () => {
  it('audits and dispatches ordinary exactly once when Fusion has fewer than two compatible routes', async () => {
    const envelope = { envelopeId: 'envelope-degraded', effectivePrompt: 'Use the prepared request.' }
    const emitDegraded = vi.fn(async () => undefined)
    const dispatchOrdinary = vi.fn(async () => 'ordinary-result')

    const outcome = await degradeFusionIfUnavailable({
      envelope,
      routeCount: 1,
      emitDegraded
    }, dispatchOrdinary)

    expect(outcome).toEqual({ kind: 'degraded', result: 'ordinary-result' })
    expect(emitDegraded).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'degraded',
      visibility: 'run',
      routeCount: 1,
      reason: expect.stringContaining('MULTI_MODEL_UNAVAILABLE')
    }))
    expect(dispatchOrdinary).toHaveBeenCalledTimes(1)
    expect(dispatchOrdinary).toHaveBeenCalledWith(envelope)
  })

  it('keeps Fusion active when at least two compatible routes are available', async () => {
    const emitDegraded = vi.fn(async () => undefined)
    const dispatchOrdinary = vi.fn()

    await expect(degradeFusionIfUnavailable({
      envelope: { envelopeId: 'envelope-fusion', effectivePrompt: 'Use the prepared request.' },
      routeCount: 2,
      emitDegraded
    }, dispatchOrdinary)).resolves.toEqual({ kind: 'fusion' })

    expect(emitDegraded).not.toHaveBeenCalled()
    expect(dispatchOrdinary).not.toHaveBeenCalled()
  })

  it('rejects a non-finalized Prompt envelope before it can be dispatched', async () => {
    await expect(dispatchPreparedTurn({
      envelope: { envelopeId: 'prepared-only' },
      fusion: { ...fusion, enabled: false }
    }, {
      dispatchOrdinary: vi.fn(),
      runFusion: vi.fn()
    })).rejects.toThrow('finalized Prompt envelope')
  })

  it('passes the finalized effective envelope to the normal dispatcher when fusion is off', async () => {
    const envelope = { envelopeId: 'envelope-1', effectivePrompt: 'Use the clarified request.' }
    const dispatchOrdinary = vi.fn().mockResolvedValue('normal-result')
    const runFusion = vi.fn().mockResolvedValue('fusion-result')

    await expect(dispatchPreparedTurn({
      envelope,
      fusion: { ...fusion, enabled: false }
    }, { dispatchOrdinary, runFusion })).resolves.toBe('normal-result')

    expect(dispatchOrdinary).toHaveBeenCalledWith(envelope)
    expect(runFusion).not.toHaveBeenCalled()
  })

  it('passes the finalized effective envelope to fusion when enabled', async () => {
    const envelope = { envelopeId: 'envelope-2', effectivePrompt: 'Use the optimized request.' }
    const dispatchOrdinary = vi.fn().mockResolvedValue('normal-result')
    const runFusion = vi.fn().mockResolvedValue('fusion-result')

    await expect(dispatchPreparedTurn({
      envelope,
      fusion
    }, { dispatchOrdinary, runFusion })).resolves.toBe('fusion-result')

    expect(runFusion).toHaveBeenCalledWith(envelope, fusion)
    expect(dispatchOrdinary).not.toHaveBeenCalled()
  })
})
