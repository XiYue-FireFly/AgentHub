import { describe, expect, it } from "vitest"
import {
  defaultBindings,
  migrateLegacySwappedOfficialBindings
} from "../manager"
import type { AgentRouteBinding } from "../types"

function bindingByAgent(bindings: AgentRouteBinding[], agentId: string): AgentRouteBinding {
  const binding = bindings.find(b => b.agentId === agentId)
  if (!binding) throw new Error(`missing binding for ${agentId}`)
  return binding
}

describe("provider manager default route bindings", () => {
  it("binds Codex to OpenAI and Claude Code to Anthropic by default", () => {
    const bindings = defaultBindings()

    expect(bindingByAgent(bindings, "codex")).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4o"
    })
    expect(bindingByAgent(bindings, "claude")).toMatchObject({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5"
    })
  })

  it("migrates the old swapped official defaults without touching other agents", () => {
    const legacy = defaultBindings().map(binding => ({ ...binding }))
    legacy.find(binding => binding.agentId === "codex")!.providerId = "anthropic"
    legacy.find(binding => binding.agentId === "codex")!.modelId = "claude-sonnet-4-5"
    legacy.find(binding => binding.agentId === "claude")!.providerId = "openai"
    legacy.find(binding => binding.agentId === "claude")!.modelId = "gpt-4o"

    const migrated = migrateLegacySwappedOfficialBindings(legacy)

    expect(bindingByAgent(migrated, "codex")).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4o"
    })
    expect(bindingByAgent(migrated, "claude")).toMatchObject({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5"
    })
    expect(bindingByAgent(migrated, "hermes")).toEqual(bindingByAgent(legacy, "hermes"))
  })

  it("preserves custom user changes when only one side looks like the legacy default", () => {
    const custom = defaultBindings().map(binding => ({ ...binding }))
    custom.find(binding => binding.agentId === "codex")!.providerId = "anthropic"
    custom.find(binding => binding.agentId === "codex")!.modelId = "claude-sonnet-4-5"
    custom.find(binding => binding.agentId === "claude")!.providerId = "deepseek"
    custom.find(binding => binding.agentId === "claude")!.modelId = "deepseek-chat"

    expect(migrateLegacySwappedOfficialBindings(custom)).toEqual(custom)
  })
})
