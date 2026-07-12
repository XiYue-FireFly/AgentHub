import { afterEach, describe, expect, it, vi } from "vitest"
import { ProviderClient } from "../client"
import {
  canonicalProviderPayload,
  createDispatchEnvelope
} from "../../runtime/dispatch-envelope"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ProviderClient DispatchEnvelope boundary", () => {
  it("rejects a payload changed after envelope creation before fetch", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const provider = {
      id: "p1", name: "P1", kind: "openai-compatible", baseUrl: "https://example.test",
      apiKey: "secret", enabled: true, builtIn: false,
      capabilities: { protocol: "chat_completions", stream: true, nativeThinking: false, budgetTokens: false, toolCalls: false, systemPrompt: true },
      defaultThinking: { mode: "off", level: "medium" },
      models: []
    } as any
    const model = {
      id: "m1", label: "M1", contextWindow: 8_000,
      supportsTools: false, supportsVision: false, supportsThinking: false
    } as any
    const binding = {
      agentId: "test", providerId: "p1", modelId: "m1",
      temperature: 0, maxOutputTokens: 100
    } as any
    const client = new ProviderClient(provider, model, binding, { mode: "off", level: "medium" })
    const payload = canonicalProviderPayload({
      providerId: "p1",
      modelId: "m1",
      protocol: "chat_completions",
      messages: [{ role: "user" as const, content: "original" }],
      systemPrompt: "system",
      tools: [],
      toolChoice: null,
      attachments: [{ id: "attachment-1" }],
      contextLayers: ["workspace"],
      thinking: { mode: "off", level: "medium" }
    })
    const envelope = createDispatchEnvelope({
      dispatchId: "dispatch-1",
      lineage: {
        origin: "workbench:create",
        policy: "optimize",
        rootInputId: "input-1",
        rootEnvelopeId: "envelope-1",
        rootPreparedTextHash: "root-hash"
      },
      payload
    })

    await client.stream({
      messages: [{ role: "user", content: "tampered" }],
      systemPrompt: "system",
      attachments: [{ id: "attachment-1" }],
      contextLayers: ["workspace"],
      dispatchEnvelope: envelope
    }, {})

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("hashes the exact final system, messages, tools, choice, attachments, context, and thinking", () => {
    const payload = canonicalProviderPayload({
      providerId: "p1",
      modelId: "m1",
      protocol: "chat_completions",
      messages: [{ role: "user", content: "prepared root plus workspace context" }],
      systemPrompt: "system",
      tools: [{ type: "function", function: { name: "read_file" } }],
      toolChoice: "auto",
      attachments: [{ id: "attachment-1" }],
      contextLayers: ["workspace", "skills"],
      thinking: { mode: "on", level: "high" }
    })
    const envelope = createDispatchEnvelope({
      dispatchId: "dispatch-2",
      lineage: {
        origin: "workbench:create",
        policy: "optimize",
        rootPreparedTextHash: "root-prepared-hash"
      },
      payload
    })

    expect(envelope.canonicalPayloadHash).not.toBe(envelope.rootPreparedTextHash)
    expect(payload).toMatchObject({
      systemPrompt: "system",
      messages: [{ role: "user", content: "prepared root plus workspace context" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      toolChoice: "auto",
      attachments: [{ id: "attachment-1" }],
      contextLayers: ["workspace", "skills"],
      thinking: { mode: "on", level: "high" }
    })
  })
})
