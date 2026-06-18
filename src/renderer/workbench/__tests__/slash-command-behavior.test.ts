import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("workbench slash command behavior", () => {
  it("keeps model and reasoning commands wired into the runtime", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const commands = readFileSync(join(process.cwd(), "src/main/runtime/commands.ts"), "utf8")

    expect(commands).toContain('payload: { template: "context" }')
    expect(commands).toContain('payload: { template: "review" }')
    expect(commands).toContain('payload: { template: "model" }')
    expect(commands).toContain('payload: { template: "reasoning" }')
    expect(layout).toContain("resolveModelCommand(args, selectableModels)")
    expect(layout).toContain("reasoningFromCommand(args, thinking)")
    expect(layout).toContain("请以代码审查方式回答")
    expect(layout).toContain("请在指令后面写下要处理的内容")
    expect(layout).toContain("await sendPrompt(args)")
  })

  it("keeps unknown slash input from silently becoming a normal prompt", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("commandTextForSelection")
    expect(composer).toContain("normalizeCommandToken")
    expect(composer).toContain("currentText.length > rawFirstToken.length")
    expect(composer).toContain("未识别的指令")
  })

  it("prioritizes ECC commands in the slash palette", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("rankCommandsForPalette")
    expect(composer).toContain("command.source === 'ecc' ? 0")
    expect(composer).toContain("slice(0, 12)")
    expect(composer).toContain("['/plan', 0]")
    expect(composer).toContain("['/tdd', 1]")
    expect(composer).toContain("['/code-review', 2]")
  })

  it("keeps configured API provider models in the composer picker", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("providerModelRows(providers, activeProviderId)")
    expect(composer).toContain("providerModelRows(providers, modelSelection.providerId)")
    expect(composer).toContain("source: 'provider-model'")
    expect(composer).toContain("selectProviderModel")
    expect(composer).toContain("setTargetAgent(null)")
    expect(composer).toContain("apiModelRows")
    expect(composer).toContain("providerAgentRows(providers)")
    expect(composer).toContain("source: 'provider-agent'")
    expect(composer).toContain("selectProviderChoice(row.providerId)")
    expect(composer).toContain("pickerAvailable")
    expect(composer).toContain("selectedPickerLabel")
    expect(composer).toContain("filterPickerModelRows")
    expect(composer).not.toContain("source: 'provider-group'")
    expect(composer).not.toContain("setActiveProviderId(model.providerId)")
    expect(composer).not.toContain("!activeProviderId && modelSelection?.providerId")
  })

  it("keeps local CLI model choices disabled in the composer picker", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(layout).not.toContain("selection.source === 'local-cli'")
    expect(composer).not.toContain("localModels.readConfig")
    expect(composer).not.toContain("source: 'local-cli'")
    expect(composer).not.toContain("localCliModelSelection")
    expect(composer).not.toContain("selectLocalModel")
  })

  it("routes provider model selections through provider direct runs", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const dispatcher = readFileSync(join(process.cwd(), "src/main/hub/dispatcher.ts"), "utf8")

    expect(layout).toContain("selectedProviderDirect")
    expect(layout).toContain("setTargetAgent(null)")
    expect(layout).toContain("source: 'provider'")
    expect(main).toContain("isProviderDirectSelection")
    expect(main).toContain("dispatcher.dispatchProviderDirect")
    expect(main).toContain("retryProviderDirect")
    expect(dispatcher).toContain("dispatchProviderDirect")
    expect(dispatcher).toContain("providerDirectAgentId")
    const directBody = dispatcher.slice(
      dispatcher.indexOf("async dispatchProviderDirect"),
      dispatcher.indexOf("private resolveTargets")
    )
    expect(directBody).not.toContain("runOrchestrate")
    expect(directBody).not.toContain("resolveTargets")
    expect(directBody).not.toContain("sendToAgentStdio")
    expect(directBody).not.toContain("sendToAgentAcp")
    expect(directBody).not.toContain("runAgenticHttpBranch")
  })

  it("uses 258k as the composer context capacity fallback", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("return 258_000")
    expect(composer).not.toContain("return 128_000")
  })

  it("keeps model picker controls covered by dark theme overrides", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(css).toContain(".wb-agent-model-list button")
    expect(css).toContain(".wb-agent-model-back")
    expect(css).toContain(".wb-provider-mark")
  })
})
