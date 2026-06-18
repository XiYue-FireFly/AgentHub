import { describe, expect, it, vi, beforeEach } from "vitest"

const bindings: any[] = []

vi.mock("../../hub/agent-locator", () => ({
  locateAgentCandidates: () => ({
    codex: [{ source: "terminal", label: "PATH", path: "C:/bin/codex.cmd" }],
    claude: [],
    "minimax-code": [{ source: "desktop", label: "MiniMax", path: "C:/bin/opencode.exe" }],
    gemini: [{ source: "terminal", label: "PATH", path: "C:/bin/gemini.cmd" }],
    codebuddy: [{ source: "terminal", label: "PATH", path: "C:/bin/codebuddy.exe" }],
    antigravity: [{ source: "desktop", label: "Antigravity", path: "C:/bin/antigravity.exe", verification: "manual" }]
  })
}))

vi.mock("../../providers/manager", () => ({
  getProviderManager: () => ({
    getBindings: () => bindings,
    getBinding: (agentId: string) => bindings.find(b => b.agentId === agentId),
    upsertBinding: (binding: any) => {
      const idx = bindings.findIndex(b => b.agentId === binding.agentId)
      if (idx >= 0) bindings[idx] = binding
      else bindings.push(binding)
    }
  })
}))

describe("local agent statuses", () => {
  beforeEach(() => {
    bindings.length = 0
  })

  it("reports installed and configured local agents", async () => {
    bindings.push({ agentId: "codex", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "C:/bin/codex.cmd" })
    const { detectLocalAgentStatuses } = await import("../local-agents")

    const statuses = detectLocalAgentStatuses()

    expect(statuses.find(s => s.agentId === "codex")?.installed).toBe(true)
    expect(statuses.find(s => s.agentId === "codex")?.configured).toBe(true)
    expect(statuses.find(s => s.agentId === "claude")?.loginState).toBe("not-installed")
  })

  it("shows conservative candidates without marking them installed or ready until configured", async () => {
    const { detectLocalAgentStatuses } = await import("../local-agents")

    const statuses = detectLocalAgentStatuses()
    const gemini = statuses.find(s => s.agentId === "gemini")
    const antigravity = statuses.find(s => s.agentId === "antigravity")

    expect(gemini?.candidates).toHaveLength(1)
    expect(gemini?.installed).toBe(false)
    expect(gemini?.configured).toBe(false)
    expect(gemini?.manualOnly).toBe(true)
    expect(gemini?.requiresPromptArg).toBe(false)
    expect(gemini?.loginState).toBe("not-installed")
    expect(antigravity?.installed).toBe(false)
    expect(antigravity?.configured).toBe(false)
    expect(antigravity?.requiresPromptArg).toBe(true)
  })

  it("configures first-class and explicit manual local agents", async () => {
    const { configureLocalAgent, detectLocalAgentStatuses } = await import("../local-agents")

    configureLocalAgent("minimax-code", { binary: "C:/bin/opencode.exe", args: "run {prompt}" })

    expect(bindings[0].agentId).toBe("minimax-code")
    expect(bindings[0].protocol).toBe("stdio-plain")
    configureLocalAgent("hermes", { binary: "C:/bin/hermes.exe" })
    expect(bindings.find(b => b.agentId === "hermes")?.binary).toBe("C:/bin/hermes.exe")
    configureLocalAgent("gemini", { binary: "C:/bin/gemini.cmd" })
    const gemini = detectLocalAgentStatuses().find(s => s.agentId === "gemini")
    expect(gemini?.manualOnly).toBe(true)
    expect(gemini?.configured).toBe(true)
    expect(bindings.find(b => b.agentId === "gemini")?.args).toBe("")
    configureLocalAgent("codebuddy", { binary: "C:/bin/codebuddy.exe" })
    const codebuddy = detectLocalAgentStatuses().find(s => s.agentId === "codebuddy")
    expect(codebuddy?.manualOnly).toBe(true)
    expect(codebuddy?.configured).toBe(true)
    expect(codebuddy?.requiresPromptArg).toBe(false)
    expect(() => configureLocalAgent("antigravity", { binary: "C:/bin/antigravity.exe", args: "--ask" })).toThrow(/\{prompt\}/)
    expect(() => configureLocalAgent("unknown-agent", {})).toThrow(/Unsupported/)
  })

  it("serves cached statuses until explicitly refreshed", async () => {
    const mod = await import("../local-agents")
    const first = mod.refreshLocalAgentStatusCache()
    bindings.push({ agentId: "gemini", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "C:/bin/gemini.cmd" })
    const cached = mod.getCachedLocalAgentStatuses()
    expect(cached.find(s => s.agentId === "gemini")?.configured).toBe(first.find(s => s.agentId === "gemini")?.configured)
    const refreshed = mod.refreshLocalAgentStatusCache()
    expect(refreshed.find(s => s.agentId === "gemini")?.configured).toBe(true)
  })
})
