import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildClaudeProviderReorderIds, deriveModelListCandidates, parseFetchedModels } from "../manager"

const storeMock = vi.hoisted(() => ({
  memory: {} as Record<string, any>,
  encryptSecret: vi.fn((value: string) => value),
  decryptSecret: vi.fn((value: string) => value)
}))

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => storeMock.memory[key],
    set: (key: string, value: any) => { storeMock.memory[key] = value }
  },
  encryptSecret: storeMock.encryptSecret,
  decryptSecret: storeMock.decryptSecret
}))

describe("ProviderManager.fetchModels", () => {
  beforeEach(() => {
    for (const key of Object.keys(storeMock.memory)) delete storeMock.memory[key]
    storeMock.encryptSecret.mockImplementation((value: string) => value)
    storeMock.decryptSecret.mockImplementation((value: string) => value)
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

  it("uses the provider returned model list without inventing missing route-bound models", async () => {
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
    expect(provider.models.some(model => model.id === "gpt-4o")).toBe(false)
    expect(provider.modelFetch).toMatchObject({ status: "ok", lastSuccessCount: provider.models.length })
  })

  it("fetches models with current form overrides before saved API key is present", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      calls.push({ url, headers: init.headers })
      return {
        status: 200,
        json: async () => ({ data: [{ id: "claude-live", display_name: "Claude Live" }] })
      }
    }))

    const result = await manager.fetchModels("anthropic", {
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "live-key",
      kind: "anthropic"
    })
    const provider = manager.getProvider("anthropic")!

    expect(result.ok).toBe(true)
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models")
    expect(calls[0].headers.authorization).toBe("Bearer live-key")
    expect(calls[0].headers["x-api-key"]).toBe("live-key")
    expect(provider.apiKey).toBe("live-key")
    expect(provider.models.some(model => model.id === "claude-live")).toBe(true)
  })

  it("derives Claude-compatible model endpoints from base URLs", () => {
    expect(deriveModelListCandidates("https://api.example.com", "anthropic")).toEqual([
      "https://api.example.com/v1/models",
      "https://api.example.com/models?limit=200"
    ])
    expect(deriveModelListCandidates("https://api.example.com/v1", "anthropic")).toEqual([
      "https://api.example.com/v1/models",
      "https://api.example.com/v1/v1/models",
      "https://api.example.com/v1/models?limit=200"
    ])
    expect(deriveModelListCandidates(" https://localhost:8787/api/anthropic/// ", "anthropic")).toEqual([
      "https://localhost:8787/api/anthropic/v1/models",
      "https://localhost:8787/api/anthropic/models?limit=200",
      "https://localhost:8787/api/v1/models",
      "https://localhost:8787/v1/models",
    ])
  })

  it("parses model list response shapes", () => {
    expect(parseFetchedModels({ data: [{ id: "claude-sonnet", display_name: "Claude Sonnet" }] }, "anthropic")).toEqual([
      { id: "claude-sonnet", label: "Claude Sonnet", contextWindow: undefined }
    ])
    expect(parseFetchedModels(["model-a", { id: "model-b", context_window: 1000 }], "openai-compatible")).toEqual([
      { id: "model-a", label: "model-a", contextWindow: undefined },
      { id: "model-b", label: "model-b", contextWindow: 1000 }
    ])
    expect(parseFetchedModels({ models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputTokenLimit: 1048576 }] }, "gemini")).toEqual([
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextWindow: 1048576 }
    ])
  })

  it("continues to next candidate when first returns 200 with empty model list", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.setProviderApiKey("openai", "key")
    let callCount = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return { status: 200, json: async () => ({ data: [] }) }
      }
      return { status: 200, json: async () => ({ data: [{ id: "fallback-model" }] }) }
    }))

    const result = await manager.fetchModels("openai")

    expect(result.ok).toBe(true)
    expect(callCount).toBeGreaterThan(1)
    expect(manager.getProvider("openai")!.models.some(m => m.id === "fallback-model")).toBe(true)
  })

  it("keeps current Claude provider in its home index when reordering other providers", () => {
    expect(buildClaudeProviderReorderIds([
      { id: "a" },
      { id: "b", isActive: true },
      { id: "c" }
    ], 1, 0)).toEqual(["c", "b", "a"])
  })

  it("preserves model route fields when fetched models are merged", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.setProviderApiKey("openai", "key")
    manager.updateModelRoute("openai", "gpt-4o", {
      enabled: false,
      upstreamModel: "real-upstream",
      timeoutMs: 12345,
      retryCount: 2,
      codexAlias: "main-alias",
      reasoningEnabled: true,
      defaultReasoningLevel: "high",
      supportedReasoningLevels: ["low", "high"]
    })
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      json: async () => ({ data: [{ id: "gpt-4o", context_window: 999000 }] })
    })))

    await manager.fetchModels("openai")
    expect(manager.getProvider("openai")!.models.find(model => model.id === "gpt-4o")).toMatchObject({
      enabled: false,
      providerId: "openai",
      upstreamModel: "real-upstream",
      timeoutMs: 12345,
      retryCount: 2,
      codexAlias: "main-alias",
      contextWindow: 999000
    })
  })

  it("resolves direct, upstream, disabled fallback, and Codex default model routes", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.setProviderApiKey("openai", "key")
    manager.updateModelRoute("openai", "gpt-4o", { upstreamModel: "upstream-gpt", enabled: true })
    manager.updateModelRoute("openai", "gpt-4o-mini", { enabled: true })
    manager.setModelRouteSettings({
      fallbackModelId: "openai/gpt-4o-mini",
      codexDefaultModel: "gpt-4o",
      codexInternalModelLock: true
    })

    expect(manager.resolveModelRoute("openai", "gpt-4o")).toMatchObject({
      requestedModelId: "gpt-4o",
      upstreamModelId: "upstream-gpt",
      routeReason: "upstream"
    })
    expect(manager.resolveModelRoute("openai", "missing")).toMatchObject({
      requestedModelId: "missing",
      upstreamModelId: "gpt-4o-mini",
      routeReason: "fallback_unknown"
    })
    expect(manager.resolveModelRoute("openai", "ignored", { codexSlot: "internal" })).toMatchObject({
      requestedModelId: "gpt-4o",
      upstreamModelId: "upstream-gpt",
      routeReason: "codex_internal_locked"
    })
  })

  it("persists Claude provider order without changing binding, enabled state, or api key", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.setProviderApiKey("openai", "openai-key")
    manager.setProviderApiKey("anthropic", "anthropic-key")
    manager.upsertBinding({
      ...manager.getBinding("claude")!,
      providerId: "anthropic"
    })

    manager.reorderProvidersForClaude(["openai", "anthropic", "deepseek"])

    expect(manager.getBinding("claude")?.providerId).toBe("anthropic")
    expect(manager.getProvider("anthropic")).toMatchObject({ apiKey: "anthropic-key", enabled: true })
    expect(manager.getProvider("openai")?.sortOrder).toBe(0)
    expect(manager.getProvider("deepseek")?.sortOrder).toBe(2)
  })

  it("continues saving provider config when secret encryption is unavailable", async () => {
    storeMock.encryptSecret.mockImplementation((value: string) => {
      if (value) throw new Error("safeStorage unavailable")
      return value
    })
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    const warnings: Array<{ providerId: string; message: string }> = []
    manager.onSecretEncryptionWarning(warning => warnings.push(warning))

    expect(() => manager.setProviderApiKey("openai", "plain-key")).not.toThrow()
    expect(manager.getProvider("openai")).toMatchObject({ apiKey: "plain-key", enabled: true })
    expect(storeMock.memory["providers.config.v1"].providers.find((provider: any) => provider.id === "openai")).toMatchObject({
      apiKey: "plain-key",
      enabled: true
    })
    expect(warnings).toEqual([{ providerId: "openai", message: "safeStorage unavailable" }])

    manager.setProviderApiKey("openai", "new-plain-key")

    expect(warnings).toHaveLength(1)
    expect(storeMock.memory["providers.config.v1"].providers.find((provider: any) => provider.id === "openai")).toMatchObject({
      apiKey: "new-plain-key",
      enabled: true
    })
  })

  it("falls back to a models health URL for unknown provider kinds", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.upsertProvider({
      id: "unknown-kind",
      name: "Unknown Kind",
      kind: "future-kind" as any,
      baseUrl: "https://future.example/v1/",
      apiKey: "key",
      enabled: true,
      builtIn: false,
      models: [],
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
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url)
      return { status: 200 }
    }))

    const health = await manager.checkProviderHealth("unknown-kind")

    expect(health.status).toBe("ok")
    expect(calls[0]).toBe("https://future.example/v1/models")
  })

  it("does not select disabled models when resolving a fallback provider binding", async () => {
    const { ProviderManager } = await import("../manager")
    const manager = new ProviderManager()
    manager.setProviderEnabled("openai", false)
    manager.setFallbackChain(["deepseek"])
    manager.setProviderApiKey("deepseek", "fallback-key")
    manager.upsertProvider({
      ...manager.getProvider("deepseek")!,
      models: [
        {
          id: "route-bound-model",
          label: "Route Bound Disabled",
          enabled: false,
          contextWindow: 128000,
          supportsTools: true,
          supportsVision: false,
          supportsThinking: false
        },
        {
          id: "enabled-chat",
          label: "Enabled Chat",
          enabled: true,
          contextWindow: 128000,
          supportsTools: false,
          supportsVision: false,
          supportsThinking: false
        }
      ]
    })
    manager.upsertBinding({
      ...manager.getBinding("codex")!,
      providerId: "openai",
      modelId: "route-bound-model"
    })

    const resolved = manager.resolveBinding("codex")

    expect(resolved?.provider.id).toBe("deepseek")
    expect(resolved?.model.id).toBe("enabled-chat")
  })
})
