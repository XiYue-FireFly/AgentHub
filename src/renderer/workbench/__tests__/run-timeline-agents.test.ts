import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("RunTimeline local agent surface", () => {
  it("renders only dispatch-ready local agents in the run workspace", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/RunTimeline.tsx"), "utf8")

    expect(source).toContain("const usableAgentIds = localAgentOptions(localAgents)")
    expect(source).toContain(".map(id => localAgents.find(agent => agent.agentId === id))")
    expect(source).not.toContain("[...localAgents].sort")
    expect(source).toContain("No dispatch-ready local agents")
  })

  it("localizes schedule dependency copy and neutral schedule labels", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/RunTimeline.tsx"), "utf8")

    expect(source).toContain("dependencyLabel(step.dependsOn?.length || 0)")
    expect(source).toContain("Smart five-role")
    expect(source).not.toContain("依赖 ${step.dependsOn.length} 步")
    expect(source).not.toContain("FireFly five-role")
  })

  it("counts every non-terminal Turn as running", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/RunTimeline.tsx"), "utf8")

    expect(source).toContain("isTerminalTurnStatus")
    expect(source).toContain("turns.filter(turn => !isTerminalTurnStatus(turn.status)).length")
  })
})
