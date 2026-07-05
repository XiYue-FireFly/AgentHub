export type WorkbenchRoutingSelectionPatch = {
  targetAgent?: string | null
  modelSelection?: ModelSelection | null
  mode?: DispatchPreset
}

export type WorkbenchRoutingSelectionAction =
  | { type: 'select-agent'; agentId: string | null }
  | { type: 'select-schedule-command'; preset: DispatchPreset }
  | { type: 'select-provider-model-command'; selection: ModelSelection }
  | { type: 'run-loop-command' }

export function resolveWorkbenchRoutingSelectionPatch(action: WorkbenchRoutingSelectionAction): WorkbenchRoutingSelectionPatch {
  if (action.type === 'select-agent') {
    if (action.agentId) {
      return {
        targetAgent: action.agentId,
        modelSelection: null,
        mode: 'auto'
      }
    }
    return { targetAgent: null }
  }

  if (action.type === 'select-schedule-command') {
    return {
      mode: action.preset,
      modelSelection: null
    }
  }

  if (action.type === 'select-provider-model-command') {
    return {
      targetAgent: null,
      modelSelection: action.selection
    }
  }

  return {
    mode: 'firefly-custom',
    targetAgent: null
  }
}
