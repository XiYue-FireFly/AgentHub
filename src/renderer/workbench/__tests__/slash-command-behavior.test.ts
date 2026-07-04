import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { addPaletteQuery, replaceAddToken, shouldRunComposerCommand } from "../ComposerBar"
import { parseLoopLimit, parseSlashInput, stripLoopFlags } from "../utils/slashCommandUtils"
import { reasoningFromCommand, resolveModelCommand } from "../utils/modelUtils"

describe("workbench slash command behavior", () => {
  it("keeps model and reasoning commands wired into the runtime", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const commands = readFileSync(join(process.cwd(), "src/main/runtime/commands.ts"), "utf8")

    expect(commands).toContain('{ template: "context" }')
    expect(commands).toContain('{ template: "review" }')
    expect(commands).toContain('{ template: "model" }')
    expect(commands).toContain('{ template: "reasoning" }')
    expect(layout).toContain("from './utils/slashCommandUtils'")
    expect(layout).toContain("from './utils/modelUtils'")
    expect(layout).toContain("resolveModelCommand(args, selectableModels)")
    expect(layout).toContain("reasoningFromCommand(args, thinking)")
    expect(layout).toContain("请以代码审查方式回答")
    expect(layout).toContain("请在指令后面写下要处理的内容")
    expect(layout).toContain("await sendPrompt(args)")
  })

  it("parses slash commands and loop flags in extracted utilities", () => {
    expect(parseSlashInput("/model deepseek/deepseek-chat")).toEqual({ label: "/model", args: "deepseek/deepseek-chat" })
    expect(parseSlashInput("@minimax-code fix this")).toEqual({ label: "/agent:opencode", args: "fix this" })
    expect(parseLoopLimit("--limit=25", 5)).toBe(20)
    expect(parseLoopLimit("循环 3", 5)).toBe(3)
    expect(stripLoopFlags("fix this --times=4")).toBe("fix this")
  })

  it("resolves provider model and reasoning commands in extracted utilities", () => {
    const options = [
      { providerId: "deepseek", modelId: "deepseek-chat", label: "DeepSeek / Chat", searchable: "deepseek/deepseek-chat deepseek chat" }
    ]

    expect(resolveModelCommand("deepseek/deepseek-chat", options)).toEqual({
      selection: { providerId: "deepseek", modelId: "deepseek-chat", source: "provider" },
      label: "DeepSeek / Chat"
    })
    expect(reasoningFromCommand("高", { mode: "auto", level: "medium", collapseInUI: true })).toEqual({
      mode: "enabled",
      level: "high",
      collapseInUI: true
    })
  })

  it("keeps unknown slash input from silently becoming a normal prompt", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("commandTextForSelection")
    expect(composer).toContain("normalizeCommandToken")
    expect(composer).toContain("currentText.length > rawFirstToken.length")
    expect(composer).toContain("未识别的指令")
  })

  it("does not route @path file references through the command handler", () => {
    const commands = [{ label: "/agent:codex" }] as any[]

    expect(shouldRunComposerCommand("/plan fix this", commands)).toBe(true)
    expect(shouldRunComposerCommand("@codex fix this", commands)).toBe(true)
    expect(shouldRunComposerCommand("@C:\\Users\\me\\file.ts explain this", commands)).toBe(false)
    expect(shouldRunComposerCommand("@/workspace/file.ts explain this", commands)).toBe(false)
    expect(shouldRunComposerCommand("@plugin-writing-plans fix this", commands)).toBe(false)
    expect(shouldRunComposerCommand("@writing-plans fix this", commands)).toBe(false)
    expect(shouldRunComposerCommand('@"C:\\Users\\me\\file with spaces.ts" explain this', commands)).toBe(false)
    expect(shouldRunComposerCommand("file:///C:/Users/me/file.ts explain this", commands)).toBe(false)
  })

  it("opens plugin add palette from @ mentions at the current cursor", () => {
    const commands = [{ label: "/agent:codex" }] as any[]

    expect(addPaletteQuery("@", commands, 1)).toEqual({ query: "", start: 0, end: 1 })
    expect(addPaletteQuery("read @wri", commands, 9)).toEqual({ query: "wri", start: 5, end: 9 })
    expect(addPaletteQuery("read @wri please", commands, 9)).toEqual({ query: "wri", start: 5, end: 9 })
    expect(addPaletteQuery("@codex fix this", commands, 6)).toBeNull()
    expect(addPaletteQuery("@plugin-writing-plans fix", commands, 21)).toBeNull()
  })

  it("replaces the active @ mention instead of only the leading token", () => {
    const match = addPaletteQuery("read @wri please", [], 9)

    expect(replaceAddToken("read @wri please", match, "@plugin-writing-plans ")).toBe("read @plugin-writing-plans please")
    expect(replaceAddToken("@wri please", addPaletteQuery("@wri please", [], 4), "/goal ")).toBe("/goal please")
    expect(replaceAddToken("read @wri please", match, "")).toBe("read please")
  })

  it("does not submit while IME composition is confirming text", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("composingRef")
    expect(composer).toContain("compositionEndedAtRef")
    expect(composer).toContain("native.isComposing")
    expect(composer).toContain("native.keyCode === 229")
    expect(composer).toContain("Date.now() - compositionEndedAtRef.current < 40")
    expect(composer).toContain("onCompositionStart")
    expect(composer).toContain("onCompositionEnd")
    expect(composer).toContain("e.key === 'Enter' && !e.shiftKey && isImeConfirming(e)")
  })

  it("loads plugin contributions for the composer @ palette", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("setPluginAddItems")
    expect(composer).toContain("window.electronAPI.plugins.scan(workspace?.rootPath)")
    expect(composer).toContain("window.electronAPI.plugins.contributions(plugins)")
    expect(composer).toContain("buildPluginAddItems(plugins, contributions)")
    expect(composer).toContain("const [addPaletteOpen, setAddPaletteOpen] = useState(false)")
    expect(composer).toContain("addPaletteOpen && (")
    expect(composer).toContain('className="wb-add-palette"')
    expect(composer).toContain("groupComposerAddItems(addItems)")
    expect(composer).toContain("chooseAddItem(item)")
  })

  it("prioritizes workflow commands in the slash palette", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(composer).toContain("rankCommandsForPalette")
    expect(composer).toContain("command.source === 'ecc' ? 0")
    expect(composer).toContain("slice(0, 12)")
    expect(composer).toContain("['/plan', 0]")
    expect(composer).toContain("['/goal', 1]")
    expect(composer).toContain("['/loop', 2]")
    expect(composer).toContain("['/tdd', 3]")
    expect(composer).toContain("['/code-review', 4]")
  })

  it("renders localized slash command descriptions", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")
    const commands = readFileSync(join(process.cwd(), "src/main/runtime/commands.ts"), "utf8")

    expect(composer).toContain("commandDescription(command)")
    expect(composer).toContain("command.descriptionZh")
    expect(composer).toContain("command.descriptionEn")
    expect(commands).toContain("descriptionZh")
    expect(commands).toContain("descriptionEn")
    expect(commands).toContain("使用智能五角色调度启动有边界的目标循环。")
    expect(commands).not.toContain("FireFly")
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

  it("clicking a provider row reveals models without auto-selecting the first model", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")
    const selectProviderChoice = composer.slice(
      composer.indexOf("const selectProviderChoice"),
      composer.indexOf("const selectProviderModel")
    )

    expect(selectProviderChoice).toContain("setActiveProviderId(providerId)")
    expect(selectProviderChoice).toContain("setModelSelection(null)")
    expect(selectProviderChoice).not.toContain("firstModel")
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
    const dispatchRequest = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/dispatchRequest.ts"), "utf8")
    const modelUtils = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/modelUtils.ts"), "utf8")
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")
    const main = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    const dispatcher = readFileSync(join(process.cwd(), "src/main/hub/dispatcher.ts"), "utf8")

    expect(layout).toContain("resolveDispatchRequest")
    expect(dispatchRequest).toContain("selectedProviderDirect")
    expect(dispatchRequest).toContain("requestedModelSelection?.source === 'provider'")
    expect(layout).toContain("setTargetAgent(null)")
    expect(modelUtils).toContain("source: 'provider'")
    expect(composer).toContain("source: 'provider'")
    expect(main).toContain("isProviderDirectSelection")
    expect(main).toContain("dispatcher.dispatchProviderDirect")
    expect(main).toContain("retryProviderDirect")
    expect(main).toContain("const directTarget = payload.targetAgent?.trim()")
    expect(main).toContain("await dispatcher.dispatchProviderDirect(message.payload.text, modelSelection")
    expect(main).toContain("activeDispatcher.dispatchProviderDirect(")
    expect(main).toContain("const providerDirect = !directTarget && isProviderDirectSelection(payload.modelSelection)")
    expect(main).toContain("const turnModelSelection = providerDirect ? payload.modelSelection : directTarget ? undefined : payload.modelSelection")
    expect(main).not.toContain("isProviderDirectSelection(payload.modelSelection, directTarget)")
    expect(dispatcher).toContain("dispatchProviderDirect")
    expect(dispatcher).toContain("providerDirectAgentId")
    expect(dispatcher).toContain("Provider model selections must run through provider direct dispatch")
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

  it("keeps the 258k context fallback without rendering a composer context chip", () => {
    const composer = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")
    const capacity = readFileSync(join(process.cwd(), "src/renderer/workbench/contextCapacity.ts"), "utf8")

    expect(composer).toContain("from './contextCapacity'")
    expect(composer).toContain("contextWindow: model.contextWindow || 258_000")
    expect(composer).not.toContain("buildContextCapacity")
    expect(composer).not.toContain("wb-context-capacity-host")
    expect(composer).not.toContain("wb-context-capacity-trigger")
    expect(capacity).toContain("return 258_000")
    expect(composer).not.toContain("return 128_000")
  })

  it("keeps model picker controls covered by dark theme overrides", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(css).toContain(".wb-agent-model-list button")
    expect(css).toContain(".wb-agent-model-back")
    expect(css).toContain(".wb-provider-mark")
  })
})
