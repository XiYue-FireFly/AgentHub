import { describe, expect, it, vi } from "vitest"

vi.mock("../../store", () => ({
  store: {
    get: () => undefined,
    set: () => {}
  }
}))

vi.mock("../../hub/workspace", () => ({
  getWorkspaceManager: () => ({
    getActive: () => null,
    getById: () => undefined
  })
}))

vi.mock("../../skills/manager", () => ({
  getSkillManager: () => ({
    findMatchingSkills: () => [{
      id: "skill-test-writer",
      name: "Test Writer",
      description: "为改动补单元测试，覆盖正常、边界和失败路径",
      instructions: "Use the existing test framework.",
      tags: ["testing"],
      source: "builtin",
      category: { id: "testing", label: "Testing" },
      createdAt: 1,
      updatedAt: 1
    }],
    list: () => []
  })
}))

vi.mock("../plugin-manager", () => ({
  scanPlugins: () => [{
    id: "global::test-plugin",
    enabled: true,
    path: "/plugins/test-plugin",
    source: "global",
    manifest: {
      name: "Test Plugin",
      version: "1.0.0",
      contributes: {
        skills: [{ id: "playwright-browser-qa", path: "skills/playwright/SKILL.md" }],
        prompts: [{ id: "release-note", name: "Release note", body: "Write release notes with verification." }]
      }
    }
  }],
  getPluginContributions: () => ({
    commands: [],
    skills: [{ pluginId: "global::test-plugin", id: "playwright-browser-qa", path: "skills/playwright/SKILL.md", content: "Use Playwright for browser QA and screenshots." }],
    prompts: [{ pluginId: "global::test-plugin", id: "release-note", name: "Release note", body: "Write release notes with verification." }]
  })
}))

describe("prompt optimizer", () => {
  it("derives routing artifacts without rewriting an immutable prepared prompt", async () => {
    const { analyzePromptForDispatch } = await import("../prompt-optimizer")
    const preparedPrompt = "Repair the login retry flow and run focused tests."

    const analysis = analyzePromptForDispatch({ prompt: preparedPrompt, attachments: [] })

    expect(analysis.originalPrompt).toBe(preparedPrompt)
    expect(analysis).not.toHaveProperty("optimizedPrompt")
    expect(analysis.contextBlock.content).toContain(preparedPrompt)
  })

  it("wraps user input with intent and matching skill context", async () => {
    const { optimizePromptForDispatch } = await import("../prompt-optimizer")
    const result = optimizePromptForDispatch({
      prompt: "修复需求 AI 助手滚动问题，并用 playwright 验证",
      attachments: []
    })

    expect(result.intent).toBe("bugfix")
    expect(result.optimizedPrompt).toContain("[AgentHub Prompt Optimizer]")
    expect(result.optimizedPrompt).toContain("[User Request]")
    expect(result.optimizedPrompt).toContain("修复需求 AI 助手滚动问题")
    expect(result.matchedSkills.some(skill => skill.name.includes("Test Writer") || skill.name.includes("AgentHub Workflow"))).toBe(true)
    expect(result.matchedPlugins.some(plugin => plugin.id === "playwright-browser-qa")).toBe(true)
    expect(result.contextBlock.kind).toBe("skill")
  })
})
