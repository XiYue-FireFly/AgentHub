import { describe, expect, it, vi } from "vitest"
import { listWorkbenchCommands, parseCommandText, runWorkbenchCommand } from "../commands"

vi.mock("../local-agents", () => ({
  detectLocalAgentStatuses: () => [],
  getCachedLocalAgentStatuses: () => [
    { agentId: "codex", label: "Codex", configured: true, installed: true, protocol: "stdio-plain", binary: "codex.cmd", loginState: "unknown", candidates: [], workspaceSession: "per-dispatch" },
    { agentId: "gemini", label: "Gemini", configured: false, installed: false, protocol: "stdio-plain", binary: "gemini.cmd", loginState: "not-installed", candidates: [], workspaceSession: "per-dispatch" },
    { agentId: "claude", label: "Claude", configured: true, installed: true, protocol: "stdio-plain", binary: "claude.cmd", loginState: "needs-login", candidates: [], workspaceSession: "per-dispatch" },
    { agentId: "zcode", label: "ZCode", configured: true, installed: true, protocol: "stdio-plain", binary: "", loginState: "unknown", candidates: [], workspaceSession: "per-dispatch" }
  ],
  isUsableLocalAgentStatus: (agent: any) => {
    if (!agent.agentId || !agent.configured) return false
    if (agent.loginState === "needs-login" || agent.loginState === "not-installed") return false
    if ((agent.protocol === "stdio-plain" || agent.protocol === "acp") && !agent.binary?.trim()) return false
    return true
  }
}))

vi.mock("../schedules", () => ({
  listSchedules: () => [{
    preset: "firefly-custom",
    label: "Smart five-role",
    labelZh: "智能五角色",
    labelEn: "Smart five-role",
    description: "Main agent chats, router sees only recent user intent, reviewer/gatekeeper guard risk and format, executor performs approved actions.",
    descriptionZh: "主 Agent 负责对话，Router 只看最近用户意图，Reviewer/Gatekeeper 审查风险和格式，Executor 执行获批动作。",
    descriptionEn: "Main agent chats, router sees only recent user intent, reviewer/gatekeeper guard risk and format, executor performs approved actions.",
    steps: []
  }]
}))

vi.mock("../../skills/manager", () => ({
  getSkillManager: () => ({ list: () => [] })
}))

vi.mock("../plugin-manager-enhanced", () => ({
  getEnabledContributions: () => ({
    slashCommands: [{
      id: "summarize",
      label: "/plugin-summary",
      description: "Summarize with plugin template",
      promptTemplate: "Summarize {{input}}"
    }]
  })
}))

describe("workbench command parsing", () => {
  it("parses slash commands and agent aliases", () => {
    expect(parseCommandText("/terminal npm test")).toEqual({ label: "/terminal", args: "npm test" })
    expect(parseCommandText("/model openai/gpt-4o")).toEqual({ label: "/model", args: "openai/gpt-4o" })
    expect(parseCommandText("/reasoning high")).toEqual({ label: "/reasoning", args: "high" })
    expect(parseCommandText("/agent:codex 修复测试")).toEqual({ label: "/agent:codex", args: "修复测试" })
    expect(parseCommandText("@claude 总结 diff")).toEqual({ label: "/agent:claude", args: "总结 diff" })
    expect(parseCommandText("@opencode 实现功能")).toEqual({ label: "/agent:opencode", args: "实现功能" })
    expect(parseCommandText("/agent:minimax-code 实现功能")).toEqual({ label: "/agent:opencode", args: "实现功能" })
  })

  it("does not parse commands embedded in normal prose", () => {
    expect(parseCommandText("请用 @claude 总结")).toBeNull()
    expect(parseCommandText("请执行 /terminal pwd")).toBeNull()
  })

  it("registers bundled workflow commands and prefers workflow aliases", () => {
    const commands = listWorkbenchCommands()
    expect(commands.some(command => command.source === "ecc" && command.label === "/plan")).toBe(true)
    expect(commands.some(command => command.source === "ecc" && command.label === "/tdd")).toBe(true)
    expect(runWorkbenchCommand({ text: "/review current changes" })?.source).toBe("ecc")
  })

  it("registers goal and loop commands as first-class actions", () => {
    const commands = listWorkbenchCommands()
    expect(commands.find(command => command.label === "/goal")).toMatchObject({ action: "set-goal", source: "builtin" })
    expect(commands.find(command => command.label === "/loop")).toMatchObject({
      action: "run-loop",
      source: "builtin",
      descriptionZh: "使用智能五角色调度启动有边界的目标循环。",
      descriptionEn: "Start a bounded goal run with smart five-role scheduling."
    })
    expect(runWorkbenchCommand({ text: "/goal ship the release" })?.action).toBe("set-goal")
    expect(runWorkbenchCommand({ text: "/loop --limit 3" })?.action).toBe("run-loop")
  })

  it("uses localized schedule descriptions for slash palette commands", () => {
    const schedule = listWorkbenchCommands().find(command => command.id === "schedule:firefly-custom")

    expect(schedule).toMatchObject({
      label: "/schedule:smart-five-role",
      description: "主 Agent 负责对话，Router 只看最近用户意图，Reviewer/Gatekeeper 审查风险和格式，Executor 执行获批动作。",
      descriptionEn: "Main agent chats, router sees only recent user intent, reviewer/gatekeeper guard risk and format, executor performs approved actions."
    })
    expect(JSON.stringify(listWorkbenchCommands())).not.toContain("FireFly")
  })

  it("only registers slash commands for usable local agents", () => {
    const agentCommands = listWorkbenchCommands().filter(command => command.source === "local-agent")

    expect(agentCommands.map(command => command.label)).toEqual(["/agent:codex"])
  })

  it("injects manifest-only plugin slash commands into the slash palette", () => {
    const command = listWorkbenchCommands().find(command => command.source === "plugin" && command.label === "/plugin-summary")

    expect(command).toMatchObject({
      action: "insert",
      category: "plugin",
      payload: { template: "plugin-prompt", promptTemplate: "Summarize {{input}}" }
    })
    expect(runWorkbenchCommand({ text: "/plugin-summary current file" })?.source).toBe("plugin")
  })
})
