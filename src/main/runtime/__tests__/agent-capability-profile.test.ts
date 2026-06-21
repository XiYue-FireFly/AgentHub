import { describe, expect, it } from "vitest"
import { buildAgentProfile, usableProfiles } from "../agent-capability-profile"
import type { AgentBinaryCandidate } from "../../hub/agent-locator"

describe("agent-capability-profile", () => {
  it("builds profile from binding (available agent)", () => {
    const profile = buildAgentProfile("codex", [], { providerId: "openai", modelId: "gpt-4o" })
    expect(profile.status).toBe("available")
    expect(profile.protocol).toBe("http")
    expect(profile.capabilities).toContain("coding")
    expect(profile.supportsTools).toBe(true)
    expect(profile.supportsExec).toBe(true)
    expect(profile.providerBinding).toEqual({ providerId: "openai", modelId: "gpt-4o" })
  })

  it("builds profile from PATH candidate (detected agent)", () => {
    const candidates: AgentBinaryCandidate[] = [
      { source: "terminal", label: "PATH", path: "/usr/bin/codex", kind: "path-detected" }
    ]
    const profile = buildAgentProfile("codex", candidates)
    expect(profile.status).toBe("detected")
    expect(profile.protocol).toBe("stdio")
    expect(profile.binaryPath).toBe("/usr/bin/codex")
    expect(profile.source).toBe("path")
  })

  it("marks desktop-candidate as desktop-only", () => {
    const candidates: AgentBinaryCandidate[] = [
      { source: "desktop", label: "GUI", path: "/app/opencode.exe", verification: "manual", kind: "desktop-candidate" }
    ]
    const profile = buildAgentProfile("minimax-code", candidates)
    expect(profile.status).toBe("desktop-only")
    expect(profile.source).toBe("desktop")
  })

  it("returns unavailable when no candidates and no binding", () => {
    const profile = buildAgentProfile("unknown-agent", [])
    expect(profile.status).toBe("unavailable")
  })

  it("assigns correct risk levels", () => {
    const codex = buildAgentProfile("codex", [], { providerId: "openai", modelId: "gpt-4o" })
    expect(codex.defaultApprovalRisk).toBe("medium") // supports exec
    const hermes = buildAgentProfile("hermes", [])
    expect(hermes.defaultApprovalRisk).toBe("low") // no exec
  })

  it("usableProfiles filters out desktop-only and unavailable", () => {
    const profiles = [
      buildAgentProfile("codex", [], { providerId: "openai", modelId: "gpt-4o" }),
      buildAgentProfile("minimax-code", [{ source: "desktop", label: "GUI", path: "/x", verification: "manual", kind: "desktop-candidate" }]),
      buildAgentProfile("unknown", [])
    ]
    const usable = usableProfiles(profiles)
    expect(usable).toHaveLength(1)
    expect(usable[0].id).toBe("codex")
  })
})
