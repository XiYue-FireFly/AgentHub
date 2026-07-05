import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentRegistry } from "../registry"
import { EventPipeline } from "../pipeline"
import type { AgentAdapter } from "../adapters/agent-adapter"
import type { StreamEvent } from "../dispatcher"

const h = vi.hoisted(() => {
  const state = {
    providerEnabled: true,
    providerApiKey: "deepseek-key",
    clientCalls: [] as any[],
    resolveBindingCalls: [] as string[],
    getBindingsCalls: 0,
    bindingProtocol: "stdio-plain" as "stdio-plain" | "http",
    localModels: {} as Record<string, any>
  }
  return { state }
})

vi.mock("../../providers/manager", () => ({
  isProviderRuntimeUsable: (provider: any) => !!provider && provider.enabled && !!provider.apiKey && !provider.apiKeyLocked,
  getProviderManager: () => ({
    getProvider: (id: string) => id === "deepseek"
      ? {
          id: "deepseek",
          name: "DeepSeek",
          kind: "openai-compatible",
          baseUrl: "https://api.deepseek.example/v1",
          apiKey: h.state.providerApiKey,
          enabled: h.state.providerEnabled,
          builtIn: true,
          models: [{
            id: "deepseek-v4-flash",
            label: "DeepSeek V4 Flash",
            contextWindow: 258000,
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
          defaultThinking: { mode: "off", level: "low" }
        }
      : undefined,
    getBindings: () => {
      h.state.getBindingsCalls += 1
      return [{ agentId: "codex", providerId: "deepseek", modelId: "deepseek-v4-flash", protocol: h.state.bindingProtocol }]
    },
    getBinding: (agentId: string) => ({ agentId, providerId: "deepseek", modelId: "deepseek-v4-flash", protocol: h.state.bindingProtocol }),
    resolveBinding: (id: string) => {
      h.state.resolveBindingCalls.push(id)
      if (h.state.bindingProtocol !== "http") return null
      const provider = {
        id: "deepseek",
        name: "DeepSeek",
        kind: "openai-compatible",
        baseUrl: "https://api.deepseek.example/v1",
        apiKey: h.state.providerApiKey,
        enabled: h.state.providerEnabled,
        builtIn: true,
        models: [{
          id: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          contextWindow: 258000,
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
        defaultThinking: { mode: "off", level: "low" }
      }
      return {
        provider,
        model: provider.models[0],
        binding: { agentId: id, providerId: "deepseek", modelId: "deepseek-v4-flash", protocol: "http" },
        thinking: { mode: "off", level: "low" }
      }
    }
  })
}))

vi.mock("../../providers/client", () => ({
  buildProviderClient: (resolved: any) => ({
    stream: (opts: any, cb: any) => {
      h.state.clientCalls.push({ resolved, opts })
      cb.onContent?.("provider answer")
      cb.onDone?.({
        content: "provider answer",
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      })
    }
  })
}))

vi.mock("../../runtime/local-models", () => ({
  readLocalModelConfig: (agentId: string) => h.state.localModels[agentId] ?? null
}))

import { Dispatcher, providerDirectAgentId } from "../dispatcher"

function mockAdapter(id: string): AgentAdapter & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn((_prompt: string) => {})
  return {
    id,
    name: id,
    binary: "mock",
    protocol: "stdio-plain",
    mode: "oneshot",
    status: "idle",
    onOutput: null,
    onError: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send
  } as AgentAdapter & { send: typeof send }
}

function makeDispatcher() {
  const registry = new AgentRegistry()
  const localCodex = mockAdapter("codex")
  registry.register(localCodex, ["code"], "openai", "gpt-4o")
  const dispatcher = new Dispatcher(registry, new EventPipeline())
  const events: StreamEvent[] = []
  dispatcher.on("stream", (event: StreamEvent) => events.push(event))
  return { dispatcher, events, localCodex }
}

describe("provider direct dispatch", () => {
  beforeEach(() => {
    h.state.providerEnabled = true
    h.state.providerApiKey = "deepseek-key"
    h.state.clientCalls = []
    h.state.resolveBindingCalls = []
    h.state.getBindingsCalls = 0
    h.state.bindingProtocol = "stdio-plain"
    h.state.localModels = {}
  })

  it("runs the selected API provider directly without touching local agent routing", async () => {
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatchProviderDirect(
      "who are you?",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" },
      { messages: [{ role: "user", content: "who are you?" }] }
    )

    expect(task.status).toBe("completed")
    expect(task.targetAgent).toBe(providerDirectAgentId("deepseek"))
    expect(task.results.get(providerDirectAgentId("deepseek"))).toBe("provider answer")
    expect(task.usage.get(providerDirectAgentId("deepseek"))).toMatchObject({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7
    })
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.getBindingsCalls).toBe(0)
    expect(h.state.resolveBindingCalls).toEqual([])
    expect(h.state.clientCalls).toHaveLength(1)
    expect(h.state.clientCalls[0].resolved.binding.agentId).toBe("provider:deepseek")
    expect(events.map(event => (event as any).agentId)).toEqual([
      "provider:deepseek",
      "provider:deepseek",
      "provider:deepseek"
    ])
    expect(events.some(event => event.kind.startsWith("orchestrate:"))).toBe(false)
  })

  it("fails API direct runs without falling back to a local CLI when the provider is unavailable", async () => {
    h.state.providerApiKey = ""
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatchProviderDirect(
      "hello",
      { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" }
    )

    expect(task.status).toBe("failed")
    expect(task.error).toContain("deepseek")
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.clientCalls).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "error",
      agentId: "provider:deepseek",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash"
    })
  })

  it("rejects stale provider selections that accidentally enter local agent routing", async () => {
    const { dispatcher, localCodex } = makeDispatcher()

    await expect(dispatcher.dispatch(
      "stale mixed state",
      "auto",
      "codex",
      { modelSelection: { providerId: "deepseek", modelId: "deepseek-v4-flash", source: "provider" } }
    )).rejects.toThrow(/provider direct/i)

    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.clientCalls).toHaveLength(0)
    expect(h.state.resolveBindingCalls).toEqual([])
  })

  it("labels local CLI runs with the configured local model instead of stale API binding defaults", async () => {
    h.state.localModels.codex = {
      agentId: "codex",
      source: "codex",
      status: "ok",
      modelId: "gpt-5.5",
      configPath: "C:/Users/test/.codex/config.toml",
      models: [{ id: "gpt-5.5" }]
    }
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatch("hello", "auto", "codex")

    expect(task.status).toBe("completed")
    expect(localCodex.send).toHaveBeenCalled()
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "start",
        agentId: "codex",
        providerId: "local-cli",
        modelId: "gpt-5.5"
      }),
      expect.objectContaining({
        kind: "done",
        agentId: "codex",
        providerId: "local-cli",
        modelId: "gpt-5.5"
      })
    ]))
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "openai", modelId: "gpt-4o" })
    ]))
  })

  it("does not treat a stale local adapter as usable for an HTTP binding", async () => {
    h.state.bindingProtocol = "http"
    const { dispatcher, events, localCodex } = makeDispatcher()

    const task = await dispatcher.dispatch("hello over http", "auto", "codex")

    expect(task.status).toBe("completed")
    expect(localCodex.send).not.toHaveBeenCalled()
    expect(h.state.clientCalls).toHaveLength(1)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "start",
        agentId: "codex",
        providerId: "deepseek",
        modelId: "deepseek-v4-flash"
      }),
      expect.objectContaining({
        kind: "done",
        agentId: "codex",
        providerId: "deepseek",
        modelId: "deepseek-v4-flash"
      })
    ]))
  })
})
