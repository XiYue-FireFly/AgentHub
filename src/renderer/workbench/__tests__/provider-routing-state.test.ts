import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Workbench provider/local routing state", () => {
  it("clears provider model selection when a local agent is selected", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const mainContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchMainContent.tsx"), "utf8")
    const dispatchRequest = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/dispatchRequest.ts"), "utf8")
    const routingState = readFileSync(join(process.cwd(), "src/renderer/workbench/state/routingSelectionState.ts"), "utf8")

    expect(source).toContain("const selectTargetAgent = useCallback")
    expect(source).toContain("resolveWorkbenchRoutingSelectionPatch({ type: 'select-agent', agentId })")
    expect(routingState).toContain("if (action.agentId) {")
    expect(routingState).toContain("modelSelection: null")
    expect(routingState).toContain("mode: 'auto'")
    expect(source).toContain("resolveDispatchRequest")
    expect(dispatchRequest).toContain("const rawTargetAgent = overrides.targetAgent")
    expect(dispatchRequest).toContain("input.usableLocalAgents.includes(rawTargetAgent)")
    expect(dispatchRequest).toContain("const requestedModelSelection = requestedTargetAgent")
    expect(dispatchRequest).toContain("const selectedLocalDirect = !!requestedTargetAgent")
    expect(dispatchRequest).toContain("const nextMode = selectedProviderDirect || selectedLocalDirect ? 'auto'")
    expect(dispatchRequest).toContain("const rawCustomSchedule = selectedProviderDirect || selectedLocalDirect")
    expect(dispatchRequest).toContain("customSchedule: selectedProviderDirect || selectedLocalDirect ? undefined : safeCustomSchedule")
    expect(source).toContain("selectTargetAgent={selectTargetAgent}")
    expect(mainContent).toContain("setTargetAgent={selectTargetAgent}")
    expect(source).toContain("selectTargetAgent(agentId)")
    expect(mainContent).toContain("goChat={agentId => { selectTargetAgent(agentId); setView('chat') }}")
    expect(source).not.toContain("selectionForAgentBinding(targetAgent")
  })

  it("does not auto-select the first provider model as default routing state", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(source).toContain("if (modelSelection && isSelectableModel(modelSelection, props.providers)) return")
    expect(source).not.toContain("setModelSelection(selectableModels[0]")
    expect(source).not.toContain("source: 'provider' } : null)")
  })

  it("describes provider rows as valid picker targets when no local agent is ready", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(source).toContain("Switch agent or API provider")
    expect(source).toContain("Configure a local agent or API provider")
    expect(source).toContain("const pickerTitle = pickerAvailable")
  })

  it("blocks editable local-agent scheduling before dispatch when no local agent is usable", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const dispatchRequest = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/dispatchRequest.ts"), "utf8")

    expect(source).toContain("const usableLocalAgents = localAgentOptions(localAgents)")
    expect(source).toContain("scheduleForMode: dispatchScheduleForMode")
    expect(dispatchRequest).toContain("input.scheduleForMode(nextMode)")
    expect(dispatchRequest).toContain("safeCustomSchedule")
    expect(dispatchRequest).toContain("input.usableLocalAgents.length === 0")
    expect(source).toContain("智能/自定义调度需要至少一个可用本地 Agent")
  })

  it("persists and dispatches editable schedules for non-custom presets", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const timeline = readFileSync(join(process.cwd(), "src/renderer/workbench/RunTimeline.tsx"), "utf8")

    expect(layout).toContain("SCHEDULE_OVERRIDES_STORE_KEY")
    expect(layout).toContain("normalizeStoredScheduleOverrides")
    expect(layout).toContain("setScheduleForMode")
    expect(layout).toContain("scheduleOverrides[preset]")
    expect(layout).toContain("scheduleForMode: dispatchScheduleForMode")
    expect(timeline).toContain("currentSchedule")
    expect(timeline).toContain("setScheduleForMode(mode, next)")
    expect(timeline).not.toContain("editableSchedule = mode === 'custom'")
  })

  it("clears direct routing selections when switching to a schedule", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(composer).toContain("const selectScheduleMode")
    expect(composer).toContain("setTargetAgent(null)")
    expect(composer).toContain("setModelSelection(null)")
    expect(composer).toContain("onChange={event => selectScheduleMode(event.target.value as DispatchPreset)}")
    expect(layout).toContain("if (command.action === 'use-schedule' && command.payload?.preset)")
    expect(layout).toContain("setModelSelection(null)")
  })

  it("switches visible composer mode back to auto when choosing a direct target", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    const selectAgentChoice = composer.slice(
      composer.indexOf("const selectAgentChoice"),
      composer.indexOf("const selectProviderChoice")
    )
    const selectProviderModel = composer.slice(
      composer.indexOf("const selectProviderModel"),
      composer.indexOf("const selectScheduleMode")
    )

    expect(selectAgentChoice).toContain("setMode('auto')")
    expect(selectProviderModel).toContain("setMode('auto')")
  })

  it("persists and passes the multi-model fusion composer control", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const main = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchMainContent.tsx"), "utf8")
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(layout).toContain("const MULTI_MODEL_FUSION_STORE_KEY = 'agenthub.multiModelFusion.v1'")
    expect(layout).toContain('writeMultiModelFusionPreference(localStorage, MULTI_MODEL_FUSION_STORE_KEY, enabled)')
    expect(layout).toContain('multiModelFusion={multiModelFusion}')
    expect(main).toContain('multiModelFusion,')
    expect(main).toContain('setMultiModelFusion,')
    expect(composer).toContain('aria-pressed={multiModelFusion}')
  })
})
