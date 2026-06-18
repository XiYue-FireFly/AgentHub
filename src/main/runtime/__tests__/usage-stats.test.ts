import { beforeEach, describe, expect, it, vi } from "vitest"

const memory: Record<string, any> = {}

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

describe("usageStats", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("aggregates actual usage when providers report it", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const { usageStats } = await import("../usage-stats")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({ prompt: "hello", mode: "auto", workspaceId: null })
    runtime.appendSystemEvent(thread.id, turn.id, "agent:done", "codex", {
      providerId: "openai",
      modelId: "gpt-4o",
      content: "done",
      usage: { input_tokens: 12, output_tokens: 8 }
    })

    const stats = usageStats("all", "models")

    expect(stats.totalTokens).toBe(20)
    expect(stats.actualTokens).toBe(20)
    expect(stats.estimatedTokens).toBe(0)
    expect(stats.hasEstimated).toBe(false)
    expect(stats.models[0]).toMatchObject({ modelId: "gpt-4o", tokens: 20, actualTokens: 20, estimatedTokens: 0 })
  })

  it("estimates local CLI and ACP usage when agent done events do not include usage", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const { usageStats } = await import("../usage-stats")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({
      prompt: "Summarize this text",
      mode: "auto",
      workspaceId: null,
      attachments: [{ id: "a1", kind: "text", name: "notes.txt", text: "local attachment text" }]
    })
    runtime.appendSystemEvent(thread.id, turn.id, "agent:done", "claude", {
      providerId: "local-cli",
      modelId: "claude-sonnet-4-5",
      content: "A concise answer with enough characters to estimate."
    })

    const stats = usageStats("all", "models")

    expect(stats.totalTokens).toBeGreaterThan(0)
    expect(stats.actualTokens).toBe(0)
    expect(stats.estimatedTokens).toBe(stats.totalTokens)
    expect(stats.hasEstimated).toBe(true)
    expect(stats.models[0]).toMatchObject({
      agentId: "claude",
      modelId: "claude-sonnet-4-5",
      actualTokens: 0,
      hasEstimated: true
    })
    expect(stats.heatmap.some(day => day.hasEstimated && day.estimatedTokens > 0)).toBe(true)
  })

  it("does not count git or terminal system events as model usage", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const { usageStats } = await import("../usage-stats")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({ prompt: "/git status", mode: "auto", workspaceId: "repo" })
    runtime.appendSystemEvent(thread.id, turn.id, "agent:done", "system", {
      providerId: "local-git",
      modelId: "git",
      content: "M file.ts",
      usage: { total_tokens: 999 }
    })
    runtime.appendSystemEvent(thread.id, turn.id, "agent:done", "system", {
      providerId: "terminal",
      modelId: "terminal",
      content: "ok"
    })

    const stats = usageStats("all", "overview")

    expect(stats.totalTokens).toBe(0)
    expect(stats.actualTokens).toBe(0)
    expect(stats.estimatedTokens).toBe(0)
    expect(stats.models).toEqual([])
  })
})
