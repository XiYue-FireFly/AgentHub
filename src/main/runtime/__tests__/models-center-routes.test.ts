import { beforeEach, describe, expect, it, vi } from "vitest"

const memory: Record<string, any> = {}

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  },
  encryptSecret: (value: string) => value,
  decryptSecret: (value: string) => value,
  decryptSecretDetailed: (value: string) => ({ ok: true, value, encrypted: value.startsWith("enc:v1:") })
}))

describe("models center route catalog", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("lists route fields for global provider models", async () => {
    const { getProviderManager } = await import("../../providers/manager")
    const { listGlobalModels } = await import("../models-center")
    const manager = getProviderManager()
    manager.setProviderApiKey("openai", "key")
    manager.updateModelRoute("openai", "gpt-4o", {
      enabled: false,
      upstreamModel: "gpt-upstream",
      timeoutMs: 20000,
      retryCount: 1,
      codexAlias: "agenthub-main"
    })

    expect(listGlobalModels().find(model => model.providerId === "openai" && model.modelId === "gpt-4o")).toMatchObject({
      enabled: false,
      upstreamModel: "gpt-upstream",
      timeoutMs: 20000,
      retryCount: 1,
      codexAlias: "agenthub-main",
      contextWindow: 128000
    })
  })

  it("omits locked providers from runtime model lists", async () => {
    const { buildModelList, buildCodexCatalog } = await import("../models-center")

    const lockedProvider = {
      id: "locked-provider",
      name: "Locked Provider",
      enabled: true,
      apiKey: "********",
      apiKeyLocked: true,
      kind: "openai-compatible",
      models: [{
        id: "locked-model",
        label: "Locked Model",
        enabled: true,
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
        supportsThinking: false
      }]
    }

    expect(buildModelList([lockedProvider as any])).toEqual([])
    memory["providers.config.v1"] = {
      providers: [lockedProvider],
      routing: { bindings: [], fallbackChain: [], strategy: "single" },
      activeBindingId: null
    }
    expect(buildCodexCatalog().models).toEqual([])
  })

  it("exports Codex catalog with unique slug and upstream target model", async () => {
    const { getProviderManager } = await import("../../providers/manager")
    const { buildCodexCatalog } = await import("../models-center")
    const manager = getProviderManager()
    manager.setProviderApiKey("openai", "openai-key")
    manager.setProviderApiKey("anthropic", "anthropic-key")
    manager.updateModelRoute("openai", "gpt-4o", {
      upstreamModel: "real-gpt-4o",
      codexAlias: "main",
      contextWindow: 258000
    })
    manager.updateModelRoute("anthropic", "claude-sonnet-4-5", {
      codexAlias: "main",
      contextWindow: 200000
    })

    const catalog = buildCodexCatalog()
    const slugs = catalog.models.map(model => model.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(catalog.models.find(model => model.target_model_id === "real-gpt-4o")).toMatchObject({
      slug: expect.stringMatching(/^main(-\d+)?$/),
      target_model_id: "real-gpt-4o",
      context_window: 258000
    })
    expect(slugs).toContain("main-2")
  })
})
