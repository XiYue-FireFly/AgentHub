import { afterEach, describe, expect, it, vi } from "vitest"
import { buildProviderClient } from "../client"
import type { AgentRouteBinding, ModelDefinition, ProviderDefinition } from "../types"
import { canonicalProviderPayload, createDispatchEnvelope } from "../../runtime/dispatch-envelope"

describe("ProviderClient usage normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("preserves Anthropic cache usage from message_start when final delta only reports output", async () => {
    const provider: ProviderDefinition = {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.example/v1",
      apiKey: "test-key",
      enabled: true,
      builtIn: true,
      models: [],
      capabilities: {
        protocol: "messages",
        stream: true,
        nativeThinking: true,
        budgetTokens: true,
        toolCalls: true,
        systemPrompt: true
      },
      defaultThinking: { mode: "off", level: "low" }
    }
    const model: ModelDefinition = {
      id: "claude-sonnet",
      label: "Claude Sonnet",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: false,
      supportsThinking: true
    }
    const binding: AgentRouteBinding = {
      agentId: "claude",
      providerId: provider.id,
      modelId: model.id,
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "off", level: "low" },
      maxOutputTokens: 4096
    }
    const sse = [
      `data: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } }
      })}`,
      `data: ${JSON.stringify({
        type: "message_delta",
        usage: { output_tokens: 5 },
        delta: { stop_reason: "end_turn" }
      })}`,
      ""
    ].join("\n\n")
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamFromText(sse), { status: 200 })))

    const client = buildProviderClient({ provider, model, binding, thinking: binding.thinking })
    const messages = [{ role: "user" as const, content: "hello" }]
    const dispatchEnvelope = createDispatchEnvelope({
      dispatchId: "usage-dispatch",
      lineage: { origin: "internal:model-diagnostic", policy: "internal" },
      payload: canonicalProviderPayload({
        providerId: provider.id,
        modelId: model.id,
        protocol: provider.capabilities.protocol,
        messages,
        systemPrompt: "",
        tools: [],
        toolChoice: null,
        thinking: binding.thinking
      })
    })
    let finalUsage: any = null
    await client.stream(
      { messages, dispatchEnvelope },
      { onDone: final => { finalUsage = final.usage } }
    )

    expect(finalUsage).toMatchObject({
      input_tokens: 20,
      output_tokens: 5,
      cache_read_tokens: 80,
      cache_creation_tokens: 10,
      total_tokens: 115,
      providerId: "anthropic",
      modelId: "claude-sonnet"
    })
  })
})

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    }
  })
}
