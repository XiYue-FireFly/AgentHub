import { describe, expect, it, vi, beforeEach } from "vitest"

const bindings: any[] = []
const existingBinaries = new Set(["C:/bin/codex.cmd", "C:/bin/opencode.exe", "C:/bin/hermes.exe", "C:/bin/gemini.cmd", "C:/bin/codebuddy.exe", "C:/bin/antigravity.exe"])
const failingBinaries = new Set<string>()

vi.mock("node:fs", () => ({
  existsSync: (path: string) => existingBinaries.has(path)
}))

vi.mock("node:child_process", () => ({
  execFile: (binary: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    if (failingBinaries.has(binary)) {
      callback(new Error("not available"), "")
      return
    }
    callback(null, `${binary} 1.0.0\n`)
  }
}))

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
    vi.resetModules()
    bindings.length = 0
    existingBinaries.clear()
    existingBinaries.add("C:/bin/codex.cmd")
    existingBinaries.add("C:/bin/opencode.exe")
    existingBinaries.add("C:/bin/hermes.exe")
    existingBinaries.add("C:/bin/gemini.cmd")
    existingBinaries.add("C:/bin/codebuddy.exe")
    existingBinaries.add("C:/bin/antigravity.exe")
    failingBinaries.clear()
  })

  it("reports installed and configured local agents", async () => {
    bindings.push({ agentId: "codex", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "C:/bin/codex.cmd" })
    const { detectLocalAgentStatuses } = await import("../local-agents")

    const statuses = await detectLocalAgentStatuses()

    expect(statuses.find(s => s.agentId === "codex")?.installed).toBe(true)
    expect(statuses.find(s => s.agentId === "codex")?.configured).toBe(true)
    expect(statuses.find(s => s.agentId === "claude")?.loginState).toBe("not-installed")
  })

  it("shows conservative candidates without marking them installed or ready until configured", async () => {
    const { detectLocalAgentStatuses } = await import("../local-agents")

    const statuses = await detectLocalAgentStatuses()
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

    await configureLocalAgent("minimax-code", { binary: "C:/bin/opencode.exe", args: "run {prompt}" })

    expect(bindings[0].agentId).toBe("minimax-code")
    expect(bindings[0].protocol).toBe("stdio-plain")
    await configureLocalAgent("hermes", { binary: "C:/bin/hermes.exe" })
    expect(bindings.find(b => b.agentId === "hermes")?.binary).toBe("C:/bin/hermes.exe")
    await configureLocalAgent("gemini", { binary: "C:/bin/gemini.cmd" })
    const gemini = (await detectLocalAgentStatuses()).find(s => s.agentId === "gemini")
    expect(gemini?.manualOnly).toBe(true)
    expect(gemini?.configured).toBe(true)
    expect(bindings.find(b => b.agentId === "gemini")?.args).toBe("")
    await configureLocalAgent("codebuddy", { binary: "C:/bin/codebuddy.exe" })
    const codebuddy = (await detectLocalAgentStatuses()).find(s => s.agentId === "codebuddy")
    expect(codebuddy?.manualOnly).toBe(true)
    expect(codebuddy?.configured).toBe(true)
    expect(codebuddy?.requiresPromptArg).toBe(false)
    await expect(configureLocalAgent("antigravity", { binary: "C:/bin/antigravity.exe", args: "--ask" })).rejects.toThrow(/\{prompt\}/)
    await expect(configureLocalAgent("unknown-agent", {})).rejects.toThrow(/Unsupported/)
  })

  it("forces local CLI attribution when a configured agent replaces a stale API binding", async () => {
    bindings.push({
      agentId: "gemini",
      providerId: "openai",
      modelId: "gpt-4o",
      protocol: "http",
      binary: "",
      args: "",
      thinking: { mode: "auto", level: "medium", collapseInUI: true }
    })
    const { configureLocalAgent } = await import("../local-agents")

    await configureLocalAgent("gemini", { binary: "C:/bin/gemini.cmd", protocol: "stdio-plain" })

    expect(bindings.find(b => b.agentId === "gemini")).toMatchObject({
      providerId: "local-cli",
      modelId: "local",
      protocol: "stdio-plain",
      binary: "C:/bin/gemini.cmd"
    })
  })

  it("forces local ACP attribution when a configured agent replaces a stale API binding", async () => {
    bindings.push({
      agentId: "codex",
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      protocol: "http",
      binary: "",
      args: "",
      thinking: { mode: "auto", level: "medium", collapseInUI: true }
    })
    const { configureLocalAgent } = await import("../local-agents")

    await configureLocalAgent("codex", { binary: "C:/bin/codex.cmd", protocol: "acp" })

    expect(bindings.find(b => b.agentId === "codex")).toMatchObject({
      providerId: "local-cli",
      modelId: "local",
      protocol: "acp",
      binary: "C:/bin/codex.cmd"
    })
  })

  it("serves cached statuses until explicitly refreshed", async () => {
    const mod = await import("../local-agents")
    const first = await mod.refreshLocalAgentStatusCache()
    bindings.push({ agentId: "gemini", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "C:/bin/gemini.cmd" })
    const cached = mod.getCachedLocalAgentStatuses()
    expect(cached.find(s => s.agentId === "gemini")?.configured).toBe(first.find(s => s.agentId === "gemini")?.configured)
    const refreshed = await mod.refreshLocalAgentStatusCache()
    expect(refreshed.find(s => s.agentId === "gemini")?.configured).toBe(true)
  })

  it("marks stale configured local binaries unavailable", async () => {
    existingBinaries.delete("C:/bin/gemini.cmd")
    bindings.push({ agentId: "gemini", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "C:/bin/gemini.cmd" })
    const { detectLocalAgentStatuses, isUsableLocalAgentStatus } = await import("../local-agents")

    const gemini = (await detectLocalAgentStatuses()).find(s => s.agentId === "gemini")

    expect(gemini?.installed).toBe(false)
    expect(gemini?.configured).toBe(false)
    expect(gemini?.loginState).toBe("not-installed")
    expect(gemini?.diagnostic?.code).toBe("configured-binary-missing")
    expect(isUsableLocalAgentStatus(gemini!)).toBe(false)
  })

  it("marks configured commands unavailable when version probing fails", async () => {
    failingBinaries.add("gemini")
    bindings.push({ agentId: "gemini", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "gemini" })
    const { detectLocalAgentStatuses } = await import("../local-agents")

    const gemini = (await detectLocalAgentStatuses()).find(s => s.agentId === "gemini")

    expect(gemini?.installed).toBe(false)
    expect(gemini?.configured).toBe(false)
    expect(gemini?.diagnostic?.code).toBe("configured-binary-unavailable")
  })

  it("revalidates cached configured agents in the background after uninstall", async () => {
    bindings.push({ agentId: "gemini", providerId: "local-cli", modelId: "local", protocol: "stdio-plain", binary: "C:/bin/gemini.cmd" })
    const mod = await import("../local-agents")

    const refreshed = await mod.refreshLocalAgentStatusCache()
    expect(refreshed.find(s => s.agentId === "gemini")?.configured).toBe(true)

    existingBinaries.delete("C:/bin/gemini.cmd")
    const stale = mod.getCachedLocalAgentStatuses()
    expect(stale.find(s => s.agentId === "gemini")?.configured).toBe(true)

    await new Promise(resolve => setTimeout(resolve, 0))

    const revalidated = mod.getCachedLocalAgentStatuses()
    const gemini = revalidated.find(s => s.agentId === "gemini")
    expect(gemini?.configured).toBe(false)
    expect(gemini?.installed).toBe(false)
    expect(gemini?.diagnostic?.code).toBe("configured-binary-missing")
  })
})
