import { describe, expect, it, vi } from "vitest"
import { listWorkbenchCommands, parseCommandText, runWorkbenchCommand } from "../commands"

vi.mock("../local-agents", () => ({
  detectLocalAgentStatuses: () => [],
  getCachedLocalAgentStatuses: () => []
}))

vi.mock("../schedules", () => ({
  listSchedules: () => []
}))

vi.mock("../../skills/manager", () => ({
  getSkillManager: () => ({ list: () => [] })
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

  it("registers bundled ECC commands and prefers ECC aliases", () => {
    const commands = listWorkbenchCommands()
    expect(commands.some(command => command.source === "ecc" && command.label === "/plan")).toBe(true)
    expect(commands.some(command => command.source === "ecc" && command.label === "/tdd")).toBe(true)
    expect(runWorkbenchCommand({ text: "/review current changes" })?.source).toBe("ecc")
  })
})
