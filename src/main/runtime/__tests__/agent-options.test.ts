import { describe, expect, it } from "vitest"
import { buildAgentOptions } from "../agent-options"
import type { LocalAgentStatus } from "../local-agents"

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

describe("buildAgentOptions", () => {
  it("exposes configured or locally installed agents", () => {
    const options = buildAgentOptions([
      agent({ agentId: "codex", configured: true, installed: true, protocol: "stdio-plain", binary: "codex.cmd" }),
      agent({ agentId: "gemini", configured: false, installed: true, protocol: "stdio-plain", binary: "gemini.cmd" }),
      agent({ agentId: "claude", configured: true, installed: true, protocol: "stdio-plain", binary: "claude.cmd", loginState: "needs-login" }),
      agent({ agentId: "zcode", configured: true, installed: true, protocol: "stdio-plain", binary: "" })
    ])

    expect(options).toEqual([
      expect.objectContaining({ agentId: "codex", status: "idle", configured: true, installed: true }),
      expect.objectContaining({ agentId: "gemini", status: "idle", configured: false, installed: true })
    ])
  })
})
