import { beforeEach, describe, expect, it, vi } from "vitest"

const memory: Record<string, any> = {}

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  },
  encryptSecret: (value: string) => value,
  decryptSecret: (value: string) => value
}))

describe("ProviderManager.fetchModels", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("keeps existing models and records the error when a refresh fails", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.upsertProvider({
      id: "custom-test",
      name: "Custom Test",
      kind: "openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey: "key",
      enabled: true,
      builtIn: false,
      models: [{
        id: "kept-model",
        label: "Kept Model",
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
        supportsThinking: false
      }],
      capabilities: {
        protocol: "chat_completions",
        stream: true,
        nativeThinking: false,
        budgetTokens: false,
        toolCalls: true,
        systemPrompt: true
      },
      defaultThinking: { mode: "auto", level: "medium", collapseInUI: true }
    })
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 500 })))

    const result = await manager.fetchModels("custom-test")
    const provider = manager.getProvider("custom-test")!

    expect(result).toMatchObject({ ok: false, error: "HTTP 500", count: 1 })
    expect(provider.models.map(model => model.id)).toEqual(["kept-model"])
    expect(provider.modelFetch).toMatchObject({ status: "error", error: "HTTP 500", lastSuccessCount: 1 })
  })

  it("merges successful model refreshes with route-bound models", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.setProviderApiKey("openai", "key")
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      json: async () => ({ data: [{ id: "fresh-model" }] })
    })))

    const result = await manager.fetchModels("openai")
    const provider = manager.getProvider("openai")!

    expect(result.ok).toBe(true)
    expect(provider.models.some(model => model.id === "fresh-model")).toBe(true)
    expect(provider.models.some(model => model.id === "gpt-4o")).toBe(true)
    expect(provider.modelFetch).toMatchObject({ status: "ok", lastSuccessCount: provider.models.length })
  })
})
