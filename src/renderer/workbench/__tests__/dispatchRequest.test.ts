import { describe, expect, it } from 'vitest'
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

  it('uses override schedules before preset schedules', () => {
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
    expect(result.customSchedule?.steps.map(step => step.agentId)).toEqual(['codex'])
  })
})
