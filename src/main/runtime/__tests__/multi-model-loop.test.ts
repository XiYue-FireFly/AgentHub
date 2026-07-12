import { describe, expect, it, vi } from 'vitest'
import { BudgetReservationCenter } from '../budget-reservations'
import { MultiModelLoopRunner, type LoopDispatchGateway } from '../multi-model-loop'
import type {
  DispatchEnvelope,
  PromptDispatchLineage,
  PromptEnvelope
} from '../../../shared/prompt-contract'

const routes = [
  { key: 'p1\u0000m1', agentId: 'a', providerId: 'p1', modelId: 'm1', protocol: 'http' },
  { key: 'p2\u0000m2', agentId: 'b', providerId: 'p2', modelId: 'm2', protocol: 'http' },
  { key: 'p3\u0000m3', agentId: 'c', providerId: 'p3', modelId: 'm3', protocol: 'http' }
] as const

function envelope(id: string): PromptEnvelope {
  return {
    envelopeId: id,
    sessionId: 'session-' + id,
    rootInputId: 'input-' + id,
    displayOriginalPrompt: 'Repair login',
    effectivePrompt: 'Repair login',
    origin: 'workbench:create',
    policy: 'optimize',
    status: 'optimized',
    optimizerVersion: 'test',
    inputHash: 'input-hash-' + id,
    preparedTextHash: 'prepared-hash-' + id,
    optimizationCount: 1,
    finalizedAt: 1
  }
}

function lineage(root: PromptEnvelope): PromptDispatchLineage {
  return {
    origin: root.origin,
    policy: root.policy,
    rootInputId: root.rootInputId,
    rootEnvelopeId: root.envelopeId,
    rootPreparedTextHash: root.preparedTextHash
  }
}

function reservations(limit = 100): BudgetReservationCenter {
  return new BudgetReservationCenter(() => ({
    config: {
      version: 1,
      dailyLimitUsd: limit,
      monthlyLimitUsd: limit,
      perRequestMaxTokens: 100_000,
      perRequestMaxCostUsd: limit,
      notifyAtPercent: 80,
      blockWhenExceeded: true,
      suggestCheaperModel: true
    },
    dailySpentUsd: 0,
    monthlySpentUsd: 0
  }))
}

function validEnvelope(request: any, id: string): DispatchEnvelope {
  return {
    dispatchId: id,
    ...request.options.lineage,
    providerId: request.route.providerId,
    modelId: request.route.modelId,
    canonicalPayloadHash: 'hash-' + id,
    optimizationCount: 0
  }
}

function gatewayFor(options?: {
  candidate?: (request: any) => Promise<any> | any
  verdicts?: Array<'PASS' | 'REVISE'>
}): { gateway: LoopDispatchGateway; calls: any[] } {
  const calls: any[] = []
  const verdicts = [...(options?.verdicts || ['PASS'])]
  return {
    calls,
    gateway: {
      start(request) {
        calls.push(request)
        const id = 'dispatch-' + calls.length
        const content = request.role === 'judge'
          ? JSON.stringify({
              verdict: verdicts.shift() || 'PASS',
              score: 91,
              revisionId: request.revisionId,
              feedback: '',
              unresolved: []
            })
          : request.role + '-' + id
        const result = request.role === 'candidate' && options?.candidate
          ? options.candidate(request)
          : { status: 'completed' as const, content, dispatchEnvelope: validEnvelope(request, id) }
        return {
          taskId: id,
          result: Promise.resolve(result),
          cancel: vi.fn(async () => {})
        }
      }
    }
  }
}

function gatewayWith(
  handler: (request: any, id: string) => any | undefined
): { gateway: LoopDispatchGateway; calls: any[] } {
  const calls: any[] = []
  return {
    calls,
    gateway: {
      start(request) {
        const id = 'dispatch-' + (calls.length + 1)
        calls.push({ ...request, testDispatchId: id })
        const scripted = handler(request, id)
        const content = request.role === 'judge'
          ? JSON.stringify({
              verdict: 'PASS',
              score: 91,
              revisionId: request.revisionId,
              feedback: '',
              unresolved: []
            })
          : request.role + '-' + id
        return {
          taskId: id,
          result: Promise.resolve(scripted || {
            status: 'completed' as const,
            content,
            dispatchEnvelope: validEnvelope(request, id)
          }),
          cancel: vi.fn(async () => {})
        }
      }
    }
  }
}

function input(root: PromptEnvelope, overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-' + root.envelopeId,
    envelope: root,
    lineage: lineage(root),
    routes: [...routes],
    turnId: 'turn-1',
    threadId: 'thread-1',
    deadline: Date.now() + 30_000,
    branchTimeoutMs: 5_000,
    maxCandidates: 2 as const,
    maxRounds: 3,
    requiresExecution: false,
    ...overrides
  }
}

function runner(
  gateway: LoopDispatchGateway,
  center = reservations(),
  events: any[] = [],
  estimates?: { round?: (count: number, round: number) => any; single?: () => any }
) {
  return new MultiModelLoopRunner({
    gateway,
    reservations: center,
    emit: event => events.push(event),
    estimateRound: estimates?.round || (count => ({ tokens: count * 1_000, costUsd: count, requests: count + 2 })),
    estimateSingle: estimates?.single || (() => ({ tokens: 1_000, costUsd: 1, requests: 1 }))
  })
}

describe('MultiModelLoopRunner', () => {
  it('preserves prepared conversation and plugin context on every read-only branch', async () => {
    const scripted = gatewayFor()
    const root = envelope('context')
    const messages = [
      { role: 'user', content: 'Earlier request' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: '[Plugin PreDispatch Context]\nKeep the API backwards compatible.' }
    ]

    await runner(scripted.gateway).run(input(root, {
      messages,
      conversationText: 'Prepared conversation with plugin context'
    }))

    const readOnlyBranches = scripted.calls.filter(call => call.role !== 'executor')
    expect(readOnlyBranches.length).toBeGreaterThan(0)
    for (const branch of readOnlyBranches) {
      expect(branch.options.messages).toEqual(expect.arrayContaining(messages))
      expect(branch.options.messages.at(-1)).toMatchObject({
        role: 'user',
        content: branch.prompt
      })
      expect(branch.options.conversationText).toBe('Prepared conversation with plugin context')
    }
  })

  it('fans candidates out in parallel and emits exactly one gated final response', async () => {
    const scripted = gatewayFor()
    const events: any[] = []
    const root = envelope('parallel')

    const result = await runner(scripted.gateway, reservations(), events).run(input(root))

    expect(result).toMatchObject({ mode: 'fusion', rounds: 1, unverified: false })
    const candidates = scripted.calls.filter(call => call.role === 'candidate')
    expect(candidates).toHaveLength(2)
    expect(candidates.every(call =>
      call.options.visibility === 'run'
      && call.options.capabilityMode === 'read-only'
      && call.options.optimizationCount === 0
      && call.origin === 'internal:loop-candidate'
      && call.options.lineage.rootEnvelopeId === root.envelopeId
    )).toBe(true)
    expect(scripted.calls.find(call => call.role === 'synthesizer')?.origin).toBe('internal:loop-synthesizer')
    expect(scripted.calls.find(call => call.role === 'judge')?.origin).toBe('internal:loop-judge')
    expect(events.filter(event => event.visibility === 'chat')).toEqual([
      expect.objectContaining({ kind: 'multi-model:final', gatedRelease: true })
    ])
  })

  it('marks a bounded all-REVISE loop final as unverified', async () => {
    const scripted = gatewayFor({ verdicts: ['REVISE', 'REVISE', 'REVISE'] })
    const events: any[] = []
    const root = envelope('all-revise')

    const result = await runner(scripted.gateway, reservations(), events).run(input(root, { maxRounds: 3 }))

    expect(result).toMatchObject({ mode: 'fusion', rounds: 3, unverified: true })
    expect(scripted.calls.filter(call => call.role === 'judge')).toHaveLength(3)
    expect(events.filter(event => event.visibility === 'chat')).toEqual([
      expect.objectContaining({
        kind: 'multi-model:final',
        gatedRelease: true,
        metadata: expect.objectContaining({
          mode: 'fusion',
          rounds: 3,
          budgetLimited: false,
          unverified: true
        })
      })
    ])
  })

  it('rejects a root lineage that does not exactly describe the prepared envelope', async () => {
    const root = envelope('lineage')
    const mismatched = { ...lineage(root), origin: 'internal:agentic-round' as const }

    await expect(runner(gatewayFor().gateway).run(input(root, { lineage: mismatched })))
      .rejects.toThrow(/root lineage does not match/)
  })

  it('rejects a forged internal loop envelope even when its root lineage matches', async () => {
    const root = {
      ...envelope('forged-root'),
      origin: 'internal:loop-candidate' as const,
      policy: 'internal' as const,
      optimizationCount: 0 as const
    }

    await expect(runner(gatewayFor().gateway).run(input(root))).rejects.toThrow(/root-scoped/)
  })

  it('falls back to one candidate on a first-round budget denial and releases every reservation', async () => {
    const scripted = gatewayFor()
    const center = reservations(1.5)
    const root = envelope('budget')

    const result = await runner(scripted.gateway, center).run(input(root))

    expect(result).toMatchObject({ mode: 'degraded', budgetLimited: true, unverified: true })
    expect(scripted.calls.filter(call => call.role === 'candidate')).toHaveLength(1)
    expect(center.listActive()).toEqual([])
  })

  it('drops an invalid candidate envelope but degrades with a valid surviving candidate', async () => {
    let candidate = 0
    const scripted = gatewayFor({
      candidate: request => {
        candidate += 1
        const response = {
          status: 'completed' as const,
          content: 'candidate-' + candidate,
          dispatchEnvelope: validEnvelope(request, 'candidate-' + candidate)
        }
        if (candidate === 1) (response.dispatchEnvelope as any).providerId = 'forged'
        return response
      }
    })
    const root = envelope('invalid')

    const result = await runner(scripted.gateway).run(input(root))

    expect(result).toMatchObject({ mode: 'degraded', unverified: true })
    expect(result.failures.join('\n')).toMatch(/provider\/model mismatch/)
    expect(scripted.calls.filter(call => call.role === 'synthesizer')).toHaveLength(0)
  })

  it('rejects all candidates whose dispatch envelopes do not prove their requested internal lineage', async () => {
    const scripted = gatewayFor({
      candidate: request => ({
        status: 'completed' as const,
        content: 'forged candidate',
        dispatchEnvelope: {
          ...validEnvelope(request, 'forged'),
          origin: 'workbench:create'
        }
      })
    })
    const root = envelope('all-invalid')

    await expect(runner(scripted.gateway).run(input(root))).rejects.toThrow(/All multi-model candidates failed/)
  })

  it('cancels all live candidate handles and rejects without waiting for non-settling branches', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => {})
    const gateway: LoopDispatchGateway = {
      start: request => ({
        taskId: request.branchId,
        result: new Promise(() => {}),
        cancel
      })
    }
    const root = envelope('abort')
    const center = reservations()
    const running = runner(gateway, center).run(input(root, { signal: controller.signal }))

    await Promise.resolve()
    controller.abort('user cancelled')

    await expect(running).rejects.toThrow(/user cancelled/)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(center.listActive()).toEqual([])
  })

  it.each([
    { label: 'per-branch', deadlineOffsetMs: 1_000, branchTimeoutMs: 5 },
    { label: 'global', deadlineOffsetMs: 5, branchTimeoutMs: 1_000 }
  ])('cancels non-settling $label deadline branches and releases reservations', async ({ label, deadlineOffsetMs, branchTimeoutMs }) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const cancel = vi.fn(async () => {})
      const gateway: LoopDispatchGateway = {
        start: request => ({
          taskId: request.branchId,
          result: new Promise(() => {}),
          cancel
        })
      }
      const center = reservations()
      const running = runner(gateway, center).run(input(envelope('deadline-' + label), {
        deadline: Date.now() + deadlineOffsetMs,
        branchTimeoutMs
      }))
      let outcome: unknown = undefined
      void running.then(
        () => { outcome = 'resolved' },
        error => { outcome = error }
      )

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(Math.max(deadlineOffsetMs, branchTimeoutMs) + 1)

      expect(outcome).toBeInstanceOf(Error)
      expect(String((outcome as Error).message)).toMatch(/deadline exceeded/)
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(center.listActive()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispatches a single normal-capability executor only after a PASS', async () => {
    const scripted = gatewayFor()
    const root = envelope('executor')

    await runner(scripted.gateway).run(input(root, { requiresExecution: true }))

    const executors = scripted.calls.filter(call => call.role === 'executor')
    expect(executors).toHaveLength(1)
    expect(executors[0]).toMatchObject({
      origin: 'internal:loop-executor',
      options: { capabilityMode: 'normal', visibility: 'run', optimizationCount: 0 }
    })
  })

  it('records a failed synthesis and continues with the next bounded round', async () => {
    let syntheses = 0
    const scripted = gatewayWith((request, id) => {
      if (request.role !== 'synthesizer') return undefined
      syntheses += 1
      if (syntheses !== 1) return undefined
      return {
        status: 'failed' as const,
        content: '',
        error: 'synthesizer unavailable',
        dispatchEnvelope: validEnvelope(request, id)
      }
    })
    const root = envelope('synthesis-retry')

    const result = await runner(scripted.gateway).run(input(root, { maxRounds: 2 }))

    expect(result).toMatchObject({ mode: 'fusion', rounds: 2, unverified: false })
    expect(result.failures).toContain('synthesizer unavailable')
    expect(scripted.calls.filter(call => call.role === 'synthesizer')).toHaveLength(2)
  })

  it('uses the failed judge synthesis as round-two lineage and releases it unverified after the bound', async () => {
    const scripted = gatewayWith((request, id) => request.role === 'judge'
      ? {
          status: 'failed' as const,
          content: '',
          error: 'judge unavailable',
          dispatchEnvelope: validEnvelope(request, id)
        }
      : undefined)
    const root = envelope('judge-retry')

    const result = await runner(scripted.gateway).run(input(root, { maxRounds: 2 }))

    const syntheses = scripted.calls.filter(call => call.role === 'synthesizer')
    const secondRoundCandidates = scripted.calls.filter(call => call.branchId.startsWith('round-2-candidate'))
    expect(result).toMatchObject({ mode: 'fusion', rounds: 2, unverified: true })
    expect(result.failures).toContain('judge unavailable')
    expect(secondRoundCandidates.every(call =>
      call.options.lineage.parentDispatchId === syntheses[0].testDispatchId
    )).toBe(true)
  })

  it('releases the last synthesis as unverified when a later round budget is denied', async () => {
    const scripted = gatewayWith((request, id) => request.role === 'judge'
      ? {
          status: 'failed' as const,
          content: '',
          error: 'judge unavailable',
          dispatchEnvelope: validEnvelope(request, id)
        }
      : undefined)
    const events: any[] = []
    const root = envelope('budget-after-judge')

    const result = await runner(scripted.gateway, reservations(1.5), events, {
      round: (_count, round) => ({ tokens: 1_000, costUsd: round === 1 ? 1 : 2, requests: 4 })
    }).run(input(root, { maxRounds: 2 }))

    expect(result).toMatchObject({ mode: 'fusion', rounds: 1, budgetLimited: true, unverified: true })
    expect(events.filter(event => event.visibility === 'chat')).toHaveLength(1)
    expect(scripted.calls.some(call => call.branchId.startsWith('round-2'))).toBe(false)
  })

  it('rethrows the root abort while the final-round synthesizer is still pending', async () => {
    const controller = new AbortController()
    let synthesisStarted!: () => void
    const started = new Promise<void>(resolve => { synthesisStarted = resolve })
    const cancel = vi.fn(async () => {})
    const calls: any[] = []
    const gateway: LoopDispatchGateway = {
      start(request) {
        const id = 'abort-' + (calls.length + 1)
        calls.push(request)
        if (request.role === 'synthesizer') {
          synthesisStarted()
          return { taskId: id, result: new Promise(() => {}), cancel }
        }
        const content = request.role === 'judge'
          ? JSON.stringify({ verdict: 'PASS', score: 91, revisionId: request.revisionId, feedback: '', unresolved: [] })
          : request.role + '-' + id
        return {
          taskId: id,
          result: Promise.resolve({
            status: 'completed' as const,
            content,
            dispatchEnvelope: validEnvelope(request, id)
          }),
          cancel
        }
      }
    }
    const root = envelope('abort-synthesis')
    const running = runner(gateway).run(input(root, { signal: controller.signal, maxRounds: 1 }))

    await started
    controller.abort('user stopped')

    await expect(running).rejects.toThrow(/user stopped/)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels a handle returned after gateway.start synchronously aborts the root signal', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => {})
    const gateway: LoopDispatchGateway = {
      start: request => {
        controller.abort('cancelled during gateway start')
        return {
          taskId: request.branchId,
          result: new Promise(() => {}),
          cancel
        }
      }
    }
    const root = envelope('abort-during-start')

    await expect(runner(gateway).run(input(root, { signal: controller.signal })))
      .rejects.toThrow(/cancelled during gateway start/)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('cancelled during gateway start')
  })
})
