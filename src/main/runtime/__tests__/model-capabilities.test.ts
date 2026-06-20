import { describe, expect, it } from "vitest"
import { resolveContextWindow, allModelCapabilities, findModelCapability, estimateTokenBudget } from "../model-capabilities"
import type { ProviderDefinition } from "../../providers/types"

const mockProviders: ProviderDefinition[] = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    enabled: true,
    builtIn: true,
    models: [
      { id: "gpt-4o", label: "GPT-4o", contextWindow: 128_000, supportsTools: true, supportsVision: true, supportsThinking: false },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", contextWindow: 128_000, supportsTools: true, supportsVision: true, supportsThinking: false }
    ],
    capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: true, systemPrompt: true },
    defaultThinking: { mode: "off", level: "low" }
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-test",
    enabled: true,
    builtIn: true,
    models: [
      { id: "claude-sonnet-4", label: "Claude Sonnet 4", contextWindow: 200_000, supportsTools: true, supportsVision: true, supportsThinking: true, maxThinkingLevel: "high" }
    ],
    capabilities: { protocol: "messages", stream: true, nativeThinking: true, budgetTokens: true, toolCalls: true, systemPrompt: true },
    defaultThinking: { mode: "enabled", level: "medium", budgetTokens: 10_000 }
  },
  {
    id: "disabled-provider",
    name: "Disabled",
    kind: "openai-compatible",
    baseUrl: "http://localhost",
    apiKey: "",
    enabled: false,
    builtIn: false,
    models: [{ id: "test-model", label: "Test", contextWindow: 4_096, supportsTools: false, supportsVision: false, supportsThinking: false }],
    capabilities: { protocol: "chat_completions", stream: false, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: false },
    defaultThinking: { mode: "off", level: "low" }
  }
]

describe("model-capabilities", () => {
  describe("resolveContextWindow", () => {
    it("uses reported value when available", () => {
      expect(resolveContextWindow("gpt-4o", 256_000)).toBe(256_000)
    })

    it("falls back to known defaults for well-known models", () => {
      expect(resolveContextWindow("gpt-4o")).toBe(128_000)
      expect(resolveContextWindow("claude-sonnet-4")).toBe(200_000)
      expect(resolveContextWindow("deepseek-chat")).toBe(128_000)
      expect(resolveContextWindow("gemini-2.5-pro")).toBe(1_048_576)
    })

    it("uses default for unknown models", () => {
      expect(resolveContextWindow("my-custom-model")).toBe(128_000)
    })

    it("matches prefix for model variants", () => {
      expect(resolveContextWindow("gpt-4o-2024-08-06")).toBe(128_000)
    })

    it("rejects zero or negative reported values", () => {
      expect(resolveContextWindow("gpt-4o", 0)).toBe(128_000)
      expect(resolveContextWindow("gpt-4o", -1)).toBe(128_000)
    })
  })

  describe("allModelCapabilities", () => {
    it("lists models from enabled providers only", () => {
      const caps = allModelCapabilities(mockProviders)
      expect(caps.length).toBe(3) // 2 openai + 1 anthropic, not the disabled provider
      expect(caps.map(c => c.modelId)).toEqual(["gpt-4o", "gpt-4o-mini", "claude-sonnet-4"])
    })

    it("includes provider name in each capability", () => {
      const caps = allModelCapabilities(mockProviders)
      expect(caps[0].providerName).toBe("OpenAI")
      expect(caps[2].providerName).toBe("Anthropic")
    })

    it("resolves context windows correctly", () => {
      const caps = allModelCapabilities(mockProviders)
      const sonnet = caps.find(c => c.modelId === "claude-sonnet-4")
      expect(sonnet?.contextWindow).toBe(200_000)
      expect(sonnet?.supportsThinking).toBe(true)
      expect(sonnet?.maxThinkingLevel).toBe("high")
    })

    it("deduplicates by providerId + modelId", () => {
      const dupeProviders = [mockProviders[0], mockProviders[0]] // same provider twice
      const caps = allModelCapabilities(dupeProviders)
      expect(caps.length).toBe(2) // not 4
    })
  })

  describe("findModelCapability", () => {
    it("finds a specific model", () => {
      const cap = findModelCapability(mockProviders, "anthropic", "claude-sonnet-4")
      expect(cap).not.toBeNull()
      expect(cap!.label).toBe("Claude Sonnet 4")
      expect(cap!.supportsVision).toBe(true)
    })

    it("returns null for unknown provider", () => {
      expect(findModelCapability(mockProviders, "unknown", "gpt-4o")).toBeNull()
    })

    it("returns null for unknown model", () => {
      expect(findModelCapability(mockProviders, "openai", "gpt-5")).toBeNull()
    })
  })

  describe("estimateTokenBudget", () => {
    it("subtracts response reserve from context window", () => {
      expect(estimateTokenBudget(128_000)).toBe(123_904) // 128000 - 4096
    })

    it("uses custom reserve", () => {
      expect(estimateTokenBudget(128_000, 8_192)).toBe(119_808)
    })

    it("returns 0 for very small context windows", () => {
      expect(estimateTokenBudget(1_000, 4_096)).toBe(0)
    })
  })
})
