import { describe, it, expect, vi } from "vitest"
import { createAdapter, HttpAgentAdapter } from "../adapters/base"
import { StdioAgentAdapter } from "../adapters/stdio-adapter"
import { CodexAdapter } from "../adapters/codex"
import { ClaudeAdapter } from "../adapters/claude"
import { HermesAdapter } from "../adapters/hermes"
import { OpenClawAdapter } from "../adapters/openclaw"
import { GeminiAdapter } from "../adapters/gemini"
import { CodeBuddyAdapter } from "../adapters/codebuddy"
import { AcpAgentAdapter } from "../adapters/acp-adapter"

describe("createAdapter", () => {
  it("returns HttpAgentAdapter by default (no protocol)", () => {
    const a = createAdapter("codex", "Codex CLI")
    expect(a).toBeInstanceOf(HttpAgentAdapter)
    expect(a.id).toBe("codex")
    expect(a.name).toBe("Codex CLI")
    expect((a as any).protocol).toBe("http")
  })
  it("returns HttpAgentAdapter when protocol=http", () => {
    const a = createAdapter("codex", "Codex CLI", "http")
    expect(a).toBeInstanceOf(HttpAgentAdapter)
    expect((a as any).protocol).toBe("http")
  })
  it("returns CodexAdapter (oneshot exec) for stdio-plain codex", () => {
    const a = createAdapter("codex", "Codex CLI", "stdio-plain")
    expect(a).toBeInstanceOf(CodexAdapter)
    expect(a.id).toBe("codex")
    expect(a.name).toBe("Codex CLI")
    expect((a as any).protocol).toBe("stdio-plain")
    expect(a.mode).toBe("oneshot")
    expect((a as any).execArgs).toContain("exec")
    expect((a as any).execArgs).toContain("--json")
    expect((a as any).execArgs).toContain("danger-full-access")
    expect((a as any).execArgs).toEqual(expect.arrayContaining(["-C", "."]))
    expect((a as any).activityParser).toBeTypeOf("function")
  })
  it("returns ClaudeAdapter (oneshot --print) for stdio-plain claude", () => {
    const a = createAdapter("claude", "Claude Code", "stdio-plain")
    expect(a).toBeInstanceOf(ClaudeAdapter)
    expect((a as any).protocol).toBe("stdio-plain")
    expect(a.mode).toBe("oneshot")
    expect((a as any).execArgs).toContain("--print")
  })
  it("returns HermesAdapter / OpenClawAdapter for stdio-plain", () => {
    const h = createAdapter("hermes", "Hermes", "stdio-plain")
    const o = createAdapter("openclaw", "OpenClaw", "stdio-plain")
    expect(h).toBeInstanceOf(HermesAdapter)
    expect(o).toBeInstanceOf(OpenClawAdapter)
    expect(h.mode).toBe("oneshot")
    expect(o.mode).toBe("oneshot")
    expect((h as any).execArgs).toEqual(["-z", "{prompt}"])                    // hermes: 官方 oneshot(-z)，裸 hermes 会进 TUI 崩溃
    expect((o as any).execArgs).toEqual(["crestodian", "--message", "{prompt}"]) // openclaw: 官方 oneshot 用法
  })
  it("applies custom binary path on stdio adapters", () => {
    const a = createAdapter("codex", "Codex CLI", "stdio-plain", "/custom/path/to/codex")
    expect((a as any).binary).toBe("/custom/path/to/codex")
  })
  it("applies custom args on stdio adapters", () => {
    const a = createAdapter("hermes", "Hermes", "stdio-plain", undefined, ["run", "--quiet", "{prompt}"])
    expect(a).toBeInstanceOf(StdioAgentAdapter)
    expect((a as any).execArgs).toEqual(["run", "--quiet", "{prompt}"])
  })
  it("returns GeminiAdapter for stdio-plain gemini", () => {
    const a = createAdapter("gemini", "Gemini CLI", "stdio-plain", "C:/bin/gemini.cmd")
    expect(a).toBeInstanceOf(GeminiAdapter)
    expect((a as any).binary).toBe("C:/bin/gemini.cmd")
    expect((a as any).execArgs).toEqual(expect.arrayContaining(["--skip-trust", "--output-format", "text", "--prompt", ""]))
    expect((a as any).envOverrides).toEqual(expect.objectContaining({ GEMINI_CLI_TRUST_WORKSPACE: "true" }))
  })
  it("returns CodeBuddyAdapter for stdio-plain codebuddy", () => {
    const a = createAdapter("codebuddy", "CodeBuddy", "stdio-plain", "C:/bin/codebuddy.exe")
    expect(a).toBeInstanceOf(CodeBuddyAdapter)
    expect((a as any).binary).toBe("C:/bin/codebuddy.exe")
    expect((a as any).execArgs).toEqual([])
  })
  it("uses Gemini ACP defaults without falling back to generic stdio", () => {
    const a = createAdapter("gemini", "Gemini CLI", "acp")
    expect(a).toBeInstanceOf(AcpAgentAdapter)
    expect((a as any).binary).toMatch(/gemini/i)
    expect((a as any).acpArgs).toEqual(["--acp"])
  })
  it("uses generic stdio for manually configured unknown agents", () => {
    const a = createAdapter("aider", "Aider", "stdio-plain", "C:/bin/aider.cmd", ["--prompt", "{prompt}"])
    expect(a).toBeInstanceOf(StdioAgentAdapter)
    expect((a as any).protocol).toBe("stdio-plain")
    expect((a as any).binary).toBe("C:/bin/aider.cmd")
    expect((a as any).execArgs).toEqual(["--prompt", "{prompt}"])
  })
  it("falls back to HttpAgentAdapter for stdio-plain unknown agents without a binary (warns)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const a = createAdapter("aider", "Aider", "stdio-plain")
    expect(a).toBeInstanceOf(HttpAgentAdapter)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it("hermes/openclaw default to HttpAgentAdapter without warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const a1 = createAdapter("hermes", "Hermes")
    const a2 = createAdapter("openclaw", "OpenClaw")
    expect(a1).toBeInstanceOf(HttpAgentAdapter)
    expect(a2).toBeInstanceOf(HttpAgentAdapter)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("HttpAgentAdapter baseline", () => {
  it("exposes http protocol and oneshot mode", () => {
    const a = new HttpAgentAdapter("codex", "Codex CLI")
    expect((a as any).protocol).toBe("http")
    expect(a.mode).toBe("oneshot")
    expect(a.status).toBe("idle")
  })
})
