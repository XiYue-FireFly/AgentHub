import { describe, expect, it, vi } from 'vitest'
import { resolveDispatchRequest } from '../utils/dispatchRequest'

const baseSchedule: SchedulePreview = {
  preset: 'custom',
  label: 'Custom schedule',
  description: 'test',
  steps: [
    { id: 'step-1', label: 'Step 1', agentId: 'codex', role: 'worker', mode: 'auto' },
    { id: 'step-2', label: 'Step 2', agentId: 'claude', role: 'reviewer', mode: 'auto' }
  ]
}

const providerModel: ModelSelection = {
  source: 'provider',
  providerId: 'deepseek',
  modelId: 'deepseek-chat'
}

function resolve(overrides: Partial<Parameters<typeof resolveDispatchRequest>[0]> = {}) {
  return resolveDispatchRequest({
    targetAgent: null,
    modelSelection: null,
    mode: 'lead-workers',
    usableLocalAgents: ['codex'],
    scheduleForMode: () => undefined,
    ...overrides
  })
}

describe('dispatch request resolver', () => {
  it('routes provider model selections through provider-direct mode', () => {
    expect(resolve({ modelSelection: providerModel })).toMatchObject({
      mode: 'auto',
      targetAgent: null,
      modelSelection: providerModel,
      customSchedule: undefined,
      selectedProviderDirect: true,
      selectedLocalDirect: false,
      scheduleUnavailable: false
    })
  })

  it('routes explicit local agents directly and drops provider model selections', () => {
    expect(resolve({
      targetAgent: 'codex',
      modelSelection: providerModel,
      overrides: { mode: 'custom', customSchedule: baseSchedule }
    })).toMatchObject({
      mode: 'auto',
      targetAgent: 'codex',
      modelSelection: undefined,
      customSchedule: undefined,
      selectedProviderDirect: false,
      selectedLocalDirect: true,
      scheduleUnavailable: false
    })
  })

  it('drops explicit local agents that are no longer usable', () => {
    expect(resolve({
      targetAgent: 'gemini',
      usableLocalAgents: ['codex']
    })).toMatchObject({
      mode: 'lead-workers',
      targetAgent: null,
      modelSelection: undefined,
      selectedProviderDirect: false,
      selectedLocalDirect: false,
      scheduleUnavailable: false
    })
  })

  it('marks an explicitly snapshotted local target unavailable instead of silently rerouting it', () => {
    expect(resolve({
      targetAgent: 'codex',
      usableLocalAgents: ['codex'],
      overrides: { targetAgent: 'gemini', mode: 'auto', modelSelection: null }
    })).toMatchObject({
      targetAgent: null,
      targetUnavailable: true
    })
  })

  it('preserves explicit null routing snapshots instead of falling back to dequeue-time state', () => {
    expect(resolve({
      targetAgent: 'codex',
      modelSelection: providerModel,
      overrides: { targetAgent: null, modelSelection: null, mode: 'broadcast', customSchedule: baseSchedule }
    })).toMatchObject({
      mode: 'broadcast',
      targetAgent: null,
      modelSelection: undefined,
      customSchedule: expect.objectContaining({ preset: 'custom' })
    })
  })

  it('reports create success even when the post-create refresh fails', async () => {
    type Helper = <T>(create: () => Promise<T>, refresh: (value: T) => Promise<void>) => Promise<{
      ok: boolean
      value?: T
      error?: unknown
      refreshError?: unknown
    }>
    const module = await import('../utils/dispatchRequest')
    const createTurnAndRefresh = (module as unknown as { createTurnAndRefresh?: Helper }).createTurnAndRefresh
    expect(createTurnAndRefresh).toBeTypeOf('function')
    if (!createTurnAndRefresh) return
    const turn = { thread: { id: 'thread-1' }, turn: { id: 'turn-1' } }

    await expect(createTurnAndRefresh(
      vi.fn().mockResolvedValue(turn),
      vi.fn().mockRejectedValue(new Error('refresh failed'))
    )).resolves.toMatchObject({ ok: true, value: turn, refreshError: expect.any(Error) })
  })

  it('distinguishes cancellation from other turn creation failures', async () => {
    type Classifier = (error: unknown) => 'cancelled' | 'create-failed'
    const module = await import('../utils/dispatchRequest')
    const classifyCreateFailure = (module as unknown as { classifyCreateFailure?: Classifier }).classifyCreateFailure
    expect(classifyCreateFailure).toBeTypeOf('function')
    if (!classifyCreateFailure) return

    expect(classifyCreateFailure({ code: 'AGENT_CANCELLED', message: 'stopped' })).toBe('cancelled')
    expect(classifyCreateFailure(new DOMException('Aborted', 'AbortError'))).toBe('cancelled')
    expect(classifyCreateFailure(new Error('provider failed'))).toBe('create-failed')
  })

  it('sanitizes schedule agents before dispatching editable schedules', () => {
    const result = resolve({
      mode: 'custom',
      usableLocalAgents: ['gemini'],
      scheduleForMode: () => baseSchedule
    })

    expect(result.mode).toBe('custom')
    expect(result.customSchedule?.steps.map(step => step.agentId)).toEqual(['gemini', 'gemini'])
    expect(result.scheduleUnavailable).toBe(false)
  })

  it('blocks custom and smart schedules when no local agent is usable', () => {
    expect(resolve({
      mode: 'custom',
      usableLocalAgents: [],
      scheduleForMode: () => baseSchedule
    })).toMatchObject({
      mode: 'custom',
      scheduleUnavailable: true
    })
    expect(resolve({
      mode: 'firefly-custom',
      usableLocalAgents: [],
      scheduleForMode: () => undefined
    })).toMatchObject({
      mode: 'firefly-custom',
      scheduleUnavailable: true
    })
  })

  it('does not rewrite concrete agents in an immutable override schedule', () => {
    const overrideSchedule: SchedulePreview = {
      ...baseSchedule,
      steps: [{ id: 'override', label: 'Override', agentId: 'claude', role: 'worker', mode: 'auto' }]
    }
    const result = resolve({
      usableLocalAgents: ['codex'],
      overrides: { mode: 'broadcast', customSchedule: overrideSchedule },
      scheduleForMode: () => baseSchedule
    })

    expect(result.mode).toBe('broadcast')
    expect(result.customSchedule?.steps.map(step => step.id)).toEqual(['override'])
    expect(result.customSchedule?.steps.map(step => step.agentId)).toEqual(['claude'])
    expect(result.scheduleTargetUnavailable).toBe(true)
  })

  it('fails a codex schedule snapshot when only gemini remains usable', () => {
    const codexSnapshot: SchedulePreview = {
      ...baseSchedule,
      steps: [{ id: 'codex-only', label: 'Codex', agentId: 'codex', role: 'worker', mode: 'auto' }]
    }
    const result = resolve({
      usableLocalAgents: ['gemini'],
      overrides: { mode: 'custom', targetAgent: null, modelSelection: null, customSchedule: codexSnapshot },
      scheduleForMode: () => undefined
    })

    expect(result.customSchedule?.steps[0].agentId).toBe('codex')
    expect(result.scheduleTargetUnavailable).toBe(true)
  })

  it('resolves placeholders in immutable schedules without rewriting concrete agents', () => {
    const snapshot: SchedulePreview = {
      ...baseSchedule,
      steps: [
        { id: 'auto-step', label: 'Auto', agentId: 'auto', role: 'worker', mode: 'auto' },
        { id: 'all-step', label: 'All', agentId: 'all', role: 'worker', mode: 'broadcast' },
        { id: 'fixed-step', label: 'Fixed', agentId: 'claude', role: 'reviewer', mode: 'auto', dependsOn: ['auto-step', 'all-step'] }
      ]
    }
    const result = resolve({
      usableLocalAgents: ['codex'],
      overrides: { mode: 'custom', targetAgent: null, modelSelection: null, customSchedule: snapshot }
    })

    expect(result.customSchedule?.steps.map(step => step.agentId)).toEqual(['codex', 'codex', 'claude'])
    expect(result.customSchedule?.graph?.nodes.map(node => node.agentId)).toEqual(['codex', 'codex', 'claude'])
    expect(result.scheduleTargetUnavailable).toBe(true)
  })

  it('canonicalizes conflicting graph and steps before checking snapshot availability', () => {
    const conflicting: SchedulePreview = {
      ...baseSchedule,
      steps: [{ id: 'only', label: 'Step copy', agentId: 'codex', role: 'worker', mode: 'auto' }],
      graph: {
        version: 1,
        nodes: [{ id: 'only', label: 'Graph copy', agentId: 'claude', role: 'worker', mode: 'auto' }],
        edges: [],
        layout: { only: { x: 0, y: 0 } }
      }
    }
    const result = resolve({
      usableLocalAgents: ['codex'],
      overrides: { mode: 'custom', targetAgent: null, modelSelection: null, customSchedule: conflicting }
    })

    expect(result.customSchedule?.steps).toEqual([
      expect.objectContaining({ id: 'only', label: 'Graph copy', agentId: 'claude' })
    ])
    expect(result.customSchedule?.graph?.nodes).toEqual([
      expect.objectContaining({ id: 'only', label: 'Graph copy', agentId: 'claude' })
    ])
    expect(result.scheduleTargetUnavailable).toBe(true)
  })
})
