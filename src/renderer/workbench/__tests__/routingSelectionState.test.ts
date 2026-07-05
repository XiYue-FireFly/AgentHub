import { describe, expect, it } from 'vitest'
import { resolveWorkbenchRoutingSelectionPatch } from '../state/routingSelectionState'

const providerModel: ModelSelection = {
  source: 'provider',
  providerId: 'deepseek',
  modelId: 'deepseek-chat'
}

describe('workbench routing selection state', () => {
  it('selects a direct local agent and clears provider routing state', () => {
    expect(resolveWorkbenchRoutingSelectionPatch({ type: 'select-agent', agentId: 'codex' })).toEqual({
      targetAgent: 'codex',
      modelSelection: null,
      mode: 'auto'
    })
  })

  it('clears a direct local agent without changing mode or model state', () => {
    expect(resolveWorkbenchRoutingSelectionPatch({ type: 'select-agent', agentId: null })).toEqual({
      targetAgent: null
    })
  })

  it('switches slash schedule commands without clearing the selected agent', () => {
    const patch = resolveWorkbenchRoutingSelectionPatch({ type: 'select-schedule-command', preset: 'custom' })

    expect(patch).toEqual({
      mode: 'custom',
      modelSelection: null
    })
    expect(patch).not.toHaveProperty('targetAgent')
  })

  it('switches slash model commands to provider direct state without changing mode', () => {
    const patch = resolveWorkbenchRoutingSelectionPatch({ type: 'select-provider-model-command', selection: providerModel })

    expect(patch).toEqual({
      targetAgent: null,
      modelSelection: providerModel
    })
    expect(patch).not.toHaveProperty('mode')
  })

  it('switches loop commands to the smart schedule without changing model state', () => {
    const patch = resolveWorkbenchRoutingSelectionPatch({ type: 'run-loop-command' })

    expect(patch).toEqual({
      mode: 'firefly-custom',
      targetAgent: null
    })
    expect(patch).not.toHaveProperty('modelSelection')
  })
})
