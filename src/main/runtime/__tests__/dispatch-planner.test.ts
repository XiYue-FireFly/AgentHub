import { describe, expect, it } from "vitest"
import { planDispatch } from "../dispatch-planner"
import type { PromptOptimizerResult } from "../prompt-optimizer"

function optimizer(patch: Partial<PromptOptimizerResult>): PromptOptimizerResult {
  const prompt = patch.originalPrompt || "hello"
  return {
    originalPrompt: prompt,
    optimizedPrompt: patch.optimizedPrompt || prompt,
    intent: patch.intent || "general",
    matchedSkills: patch.matchedSkills || [],
    matchedPlugins: patch.matchedPlugins || [],
    contextBlock: patch.contextBlock || {
      id: "ctx",
      kind: "skill",
      title: "optimizer",
      participation: "selected",
      createdAt: 1
    }
  }
}

describe("dispatch planner", () => {
  it("keeps explicit target agents single-agent", () => {
    const plan = planDispatch({
      requestedMode: "auto",
      directRun: true,
      directTarget: "codex",
      availableAgentIds: ["codex", "claude"],
      optimization: optimizer({ intent: "review", originalPrompt: "review this with multiple agents" })
    })

    expect(plan.strategy).toBe("direct-agent")
    expect(plan.dispatchMode).toBe("auto")
    expect(plan.schedule).toBeUndefined()
  })

  it("turns review or consensus requests into a parallel aggregation schedule", () => {
    const plan = planDispatch({
      requestedMode: "auto",
      availableAgentIds: ["codex", "claude", "minimax-code"],
      optimization: optimizer({ intent: "review", originalPrompt: "并行审查这个改动并比较输出" })
    })

    expect(plan.strategy).toBe("auto-parallel-review")
    expect(plan.effectiveMode).toBe("parallel-review")
    expect(plan.schedule?.steps.map(step => step.role)).toEqual(["reviewer", "reviewer", "gatekeeper"])
  })

  it("turns complex implementation requests into lead-worker aggregation", () => {
    const plan = planDispatch({
      requestedMode: "auto",
      availableAgentIds: ["codex", "claude", "minimax-code"],
      attachments: [{ id: "a", kind: "file", name: "spec.md", text: "details" }],
      optimization: optimizer({
        intent: "implementation",
        originalPrompt: "实现一个跨多个模块的新功能，需要遵循现有架构并验证",
        matchedSkills: [
          { id: "frontend", name: "Frontend", description: "UI work", source: "builtin", score: 2 },
          { id: "testing", name: "Testing", description: "Tests", source: "builtin", score: 2 }
        ]
      })
    })

    expect(plan.strategy).toBe("auto-lead-workers")
    expect(plan.effectiveMode).toBe("lead-workers")
    expect(plan.schedule?.steps.some(step => step.role === "synthesizer")).toBe(true)
  })
})
