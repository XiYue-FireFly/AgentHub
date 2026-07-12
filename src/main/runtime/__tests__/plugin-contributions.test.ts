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
      { id: "deny", pattern: "forbidden", denyMessage: "Blocked by plugin policy." },
      { id: "review", pattern: "review", requireApproval: true, message: "Plugin review required." }
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

  it("returns a structured approval request instead of denying plugin-gated dispatch", async () => {
    const outcome = await runPreDispatchHooks(resolvePluginPreDispatchHooks(), {
      threadId: "thread-1",
      prompt: "review this change"
    })

    expect(outcome.denied).toBeUndefined()
    expect(outcome.approvalRequests).toEqual([{
      pluginId: "installed",
      hookId: "review",
      message: "Plugin review required."
    }])
    const results = await Promise.all(resolvePluginPreDispatchHooks().map(hook => hook.run({
      phase: 'PreDispatch', threadId: 'thread-1', prompt: 'review this change'
    })))
    expect(results.find(result => result?.requestApproval)).toMatchObject({ decision: 'request-approval' })
  })

  it("matches approval gates against the canonical optimized prompt when raw input does not match", async () => {
    const rawOutcome = await runPreDispatchHooks(resolvePluginPreDispatchHooks(), {
      threadId: "thread-1",
      prompt: "Please improve the implementation"
    })
    const canonicalOutcome = await runPreDispatchHooks(resolvePluginPreDispatchHooks(), {
      threadId: "thread-1",
      prompt: "[AgentHub Prompt Optimizer]\nIntent: review\n[User Request]\nPlease improve the implementation"
    })

    expect(rawOutcome.approvalRequests).toEqual([])
    expect(canonicalOutcome.approvalRequests).toEqual([{
      pluginId: "installed",
      hookId: "review",
      message: "Plugin review required."
    }])
  })
})
