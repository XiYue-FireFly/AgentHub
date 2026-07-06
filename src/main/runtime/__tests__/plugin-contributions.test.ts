import { describe, expect, it, vi } from "vitest"
import { runPreDispatchHooks } from "../../hooks/hook-engine"
import { applyPluginActivityParsers, resolvePluginPreDispatchHooks } from "../plugin-contributions"
import type { RuntimeEvent } from "../types"

vi.mock("../plugin-manager-enhanced", () => ({
  getEnabledContributions: () => ({
    activityParsers: [{
      id: "todo",
      pattern: "TODO: (?<title>.+)",
      fields: { title: "title" },
      kind: "todo"
    }],
    preDispatchHooks: [
      { id: "ctx", pattern: "bug", appendContext: "Run regression tests for {{prompt}}" },
      { id: "deny", pattern: "forbidden", denyMessage: "Blocked by plugin policy." }
    ]
  })
}))

vi.mock("../plugin-manager", () => ({
  scanPlugins: () => [],
  getPluginContributions: () => ({ activityParsers: [], preDispatchHooks: [] })
}))

describe("plugin runtime contributions", () => {
  it("adds structured plugin activity to matching runtime events", () => {
    const event: RuntimeEvent = {
      id: "event-1",
      threadId: "thread-1",
      turnId: "turn-1",
      seq: 1,
      kind: "agent:activity",
      payload: { text: "TODO: write tests" },
      createdAt: Date.now()
    }

    const parsed = applyPluginActivityParsers(event)

    expect(parsed.payload.pluginActivity[0]).toMatchObject({
      parserId: "todo",
      kind: "todo",
      fields: { title: "write tests" }
    })
  })

  it("turns plugin pre-dispatch hooks into hook-engine results", async () => {
    const outcome = await runPreDispatchHooks(resolvePluginPreDispatchHooks(), {
      threadId: "thread-1",
      prompt: "fix bug in composer"
    })

    expect(outcome.additionalContext[0]).toContain("Run regression tests for fix bug in composer")
  })

  it("can deny dispatch through declaration-only plugin hooks", async () => {
    const outcome = await runPreDispatchHooks(resolvePluginPreDispatchHooks(), {
      threadId: "thread-1",
      prompt: "forbidden operation"
    })

    expect(outcome.denied).toBe("Blocked by plugin policy.")
  })
})
