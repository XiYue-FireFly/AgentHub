import { describe, expect, it } from "vitest"
import { isUsableLocalAgent, localAgentOptions } from "../localAgentOptions"

function agent(patch: Partial<LocalAgentStatus> & { agentId: string }): LocalAgentStatus {
  return {
    agentId: patch.agentId,
    label: patch.label || patch.agentId,
    installed: patch.installed ?? false,
    configured: patch.configured ?? false,
    protocol: patch.protocol,
    binary: patch.binary,
    args: patch.args,
    version: patch.version,
    manualOnly: patch.manualOnly,
    candidateKind: patch.candidateKind,
    requiresPromptArg: patch.requiresPromptArg,
    note: patch.note,
    loginState: patch.loginState || "unknown",
    candidates: patch.candidates || [],
    workspaceSession: patch.workspaceSession || "per-dispatch",
    error: patch.error
  }
}

describe("localAgentOptions", () => {
  it("exposes configured or locally installed dispatch-safe agents", () => {
    const ready = agent({
      agentId: "codex",
      configured: true,
      installed: true,
      protocol: "stdio-plain",
      binary: "codex.cmd"
    })
    const candidate = agent({
      agentId: "gemini",
      configured: false,
      installed: true,
      candidateKind: "cli",
      binary: "gemini.cmd",
      candidates: [{ source: "terminal", label: "Gemini", path: "gemini.cmd" }]
    })
    const needsLogin = agent({
      agentId: "claude",
      configured: true,
      installed: true,
      protocol: "stdio-plain",
      binary: "claude.cmd",
      loginState: "needs-login"
    })
    const missingBinary = agent({
      agentId: "zcode",
      configured: true,
      installed: true,
      protocol: "stdio-plain",
      binary: ""
    })
    const unsafeManual = agent({
      agentId: "antigravity",
      configured: true,
      installed: true,
      protocol: "stdio-plain",
      binary: "antigravity.exe",
      manualOnly: true,
      candidateKind: "desktop",
      requiresPromptArg: true,
      args: "--open"
    })

    expect(isUsableLocalAgent(ready)).toBe(true)
    expect(isUsableLocalAgent(candidate)).toBe(true)
    expect(isUsableLocalAgent(needsLogin)).toBe(false)
    expect(isUsableLocalAgent(missingBinary)).toBe(false)
    expect(isUsableLocalAgent(unsafeManual)).toBe(false)
    expect(localAgentOptions([ready, candidate, needsLogin, missingBinary, unsafeManual, ready])).toEqual(["codex", "gemini"])
  })

  it("allows manual agents when ACP or prompt args make them non-interactive", () => {
    expect(isUsableLocalAgent(agent({
      agentId: "reasonix",
      configured: true,
      installed: true,
      protocol: "acp",
      binary: "reasonix.exe",
      manualOnly: true,
      requiresPromptArg: true
    }))).toBe(true)

    expect(isUsableLocalAgent(agent({
      agentId: "reasonix",
      configured: true,
      installed: true,
      protocol: "stdio-plain",
      binary: "reasonix.exe",
      manualOnly: true,
      requiresPromptArg: true,
      args: "--prompt {prompt}"
    }))).toBe(true)
  })
})
