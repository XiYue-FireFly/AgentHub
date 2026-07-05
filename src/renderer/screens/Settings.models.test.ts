// @vitest-environment happy-dom
import React from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { ModelsTab } from "./Settings"
import { setLang } from "../glass/i18n"

const listModelsWithCustomReasoningLevels = (listModels: typeof window.electronAPI.models.list) => listModels([{
  id: "opencode",
  name: "OpenCode",
  kind: "future-provider-kind",
  enabled: true,
  apiKey: "key",
  capabilities: { protocol: "responses" },
  models: [{
    id: "mini-max-code",
    label: "MiniMax Code",
    defaultReasoningLevel: "adaptive",
    supportedReasoningLevels: ["adaptive"],
    supportsTools: true
  }]
}])

describe("Settings model route center UI", () => {
  const source = readFileSync(resolve(__dirname, "Settings.tsx"), "utf8")
  const css = readFileSync(resolve(__dirname, "../globals.css"), "utf8")
  const appearance = readFileSync(resolve(__dirname, "../appearance.ts"), "utf8")

  it("uses the global model route IPC instead of provider-only model flattening", () => {
    expect(source).toContain("window.electronAPI.models.list()")
    expect(source).toContain("window.electronAPI.models.updateRoute")
    expect(source).toContain("window.electronAPI.models.test")
    expect(source).toContain("window.electronAPI.models.exportCodexCatalog")
  })

  it("types explicit model-list providers with custom reasoning levels", () => {
    expect(typeof listModelsWithCustomReasoningLevels).toBe("function")
  })

  it("contains Mac and Windows preview UI classes", () => {
    expect(source).toContain("wb-ui-style-preview-grid")
    expect(source).toContain("Mac Preview")
    expect(source).toContain("Windows Preview")
    expect(css).toContain('[data-ui-style="mac"]')
    expect(css).toContain('[data-ui-style="win"]')
    expect(appearance).toContain("root.dataset.uiStyle = preferences.uiStyle")
    expect(appearance).toContain("root.setAttribute('data-uistyle', preferences.uiStyle)")
    expect(css).toContain(".wb-model-route-item")
    expect(source).not.toContain('className="wb-model-route-row')
  })

  it("renders provider model cards and calls model routing actions", async () => {
    setLang("en")
    const providers: React.ComponentProps<typeof ModelsTab>["providers"] = [{
      id: "deepseek",
      name: "DeepSeek",
      kind: "openai-compatible",
      enabled: true,
      apiKey: "sk-test",
      models: [{
        id: "deepseek-chat",
        label: "DeepSeek Chat",
        enabled: true,
        supportsTools: true,
        contextWindow: 128000
      }]
    } as React.ComponentProps<typeof ModelsTab>["providers"][number]]
    const modelInfo: ModelRouteInfo = {
      providerId: "deepseek",
      providerName: "DeepSeek",
      providerEnabled: true,
      providerHasKey: true,
      providerKeyLocked: false,
      providerProtocol: "openai-compatible",
      modelId: "deepseek-chat",
      label: "DeepSeek Chat",
      enabled: true,
      supportsTools: true,
      supportsVision: false,
      supportsThinking: false,
      contextWindow: 128000,
      upstreamModel: "deepseek-chat",
      isFavorite: false,
      isHidden: false
    }
    const api = {
      models: {
        list: vi.fn(async () => [modelInfo]),
        routeSettingsGet: vi.fn(async () => ({
          codexDefaultModel: "",
          fallbackModelId: "",
          codexInjectionMode: "third_party_api",
          codexInternalModelLock: true
        })),
        routeSettingsSet: vi.fn(async patch => ({
          codexDefaultModel: patch.codexDefaultModel || "",
          fallbackModelId: "",
          codexInjectionMode: "third_party_api",
          codexInternalModelLock: true
        })),
        updateRoute: vi.fn(async (_providerId: string, _modelId: string, patch: ModelRoutePatch) => ({
          ...modelInfo,
          ...patch
        })),
        test: vi.fn(async () => ({ ok: true, latencyMs: 42 })),
        exportCodexCatalog: vi.fn(async () => ({ ok: true, count: 1, path: "E:\\Agent\\codex-models.json" }))
      },
      providers: {
        fetchModels: vi.fn(async () => ({ ok: true }))
      }
    }
    ;(window as any).electronAPI = api

    render(React.createElement(ModelsTab, { providers }))

    await screen.findByText("DeepSeek")
    expect(screen.getByText("DeepSeek Chat")).toBeTruthy()

    const selects = screen.getAllByRole("combobox")
    fireEvent.change(selects[0], { target: { value: "deepseek/deepseek-chat" } })
    await waitFor(() => expect(api.models.routeSettingsSet).toHaveBeenCalledWith({
      codexDefaultModel: "deepseek/deepseek-chat"
    }))

    fireEvent.change(screen.getByDisplayValue("deepseek-chat"), { target: { value: "deepseek-chat-v2" } })
    await waitFor(() => expect(api.models.updateRoute).toHaveBeenCalledWith("deepseek", "deepseek-chat", {
      upstreamModel: "deepseek-chat-v2"
    }))

    fireEvent.click(screen.getByRole("button", { name: "Test Model" }))
    await waitFor(() => expect(api.models.test).toHaveBeenCalledWith({
      providerId: "deepseek",
      modelId: "deepseek-chat",
      upstreamModel: "deepseek-chat-v2"
    }))
    await screen.findByText("OK 42ms")

    fireEvent.click(screen.getByRole("button", { name: "Export Codex Catalog" }))
    await waitFor(() => expect(api.models.exportCodexCatalog).toHaveBeenCalledTimes(1))
    await screen.findByText("Exported 1 model(s) to E:\\Agent\\codex-models.json")
  })

  beforeEach(() => {
    setLang("en")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as any).electronAPI
  })
})
