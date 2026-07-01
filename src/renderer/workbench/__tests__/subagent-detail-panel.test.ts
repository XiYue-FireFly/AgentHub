import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("SubagentDetailPanel", () => {
  const source = readFileSync(join(process.cwd(), "src/renderer/workbench/SubagentDetailPanel.tsx"), "utf8")

  it("exports SubagentDetailPanel component", () => {
    expect(source).toContain("export function SubagentDetailPanel")
  })

  it("accepts agentId and turnId props", () => {
    expect(source).toContain("agentId: string")
    expect(source).toContain("turnId: string")
  })

  it("accepts events array prop", () => {
    expect(source).toContain("events: RuntimeEvent[]")
  })

  it("has onClose callback prop", () => {
    expect(source).toContain("onClose: () => void")
  })

  it("summarizes agent run from events", () => {
    expect(source).toContain("summarizeAgentRun")
  })

  it("shows agent status (running/completed/failed/cancelled)", () => {
    expect(source).toContain("running")
    expect(source).toContain("completed")
    expect(source).toContain("failed")
    expect(source).toContain("cancelled")
  })

  it("displays duration information", () => {
    expect(source).toContain("formatDuration")
    expect(source).toContain("durationMs")
  })

  it("shows tool calls list", () => {
    expect(source).toContain("toolCalls")
    expect(source).toContain("tool-name")
  })

  it("shows thinking content", () => {
    expect(source).toContain("thinkingContent")
  })

  it("shows output content", () => {
    expect(source).toContain("outputContent")
  })

  it("shows error messages", () => {
    expect(source).toContain("errors")
  })

  it("uses AgentMark for agent avatar", () => {
    expect(source).toContain("AgentMark")
  })

  it("shows stream event count", () => {
    expect(source).toContain("streamDeltas")
  })
})
