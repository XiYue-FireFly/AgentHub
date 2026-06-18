import { describe, expect, it, vi, beforeEach } from "vitest"

const memory: Record<string, any> = {}
let setCount = 0

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { setCount++; memory[key] = value }
  }
}))

describe("WorkbenchRuntimeStore", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    setCount = 0
    vi.resetModules()
  })

  it("creates threads, turns, and replayable events", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({ prompt: "Read the project", mode: "parallel-review", workspaceId: "ws-1" })

    expect(thread.title).toBe("Read the project")
    expect(turn.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0).map(e => e.kind)).toContain("turn:created")

    runtime.setTurnStatus(turn.id, "completed")
    expect(runtime.snapshot("ws-1").threads[0].lastTurnStatus).toBe("completed")
    expect(runtime.eventsSince(thread.id, 1).some(e => e.kind === "turn:status")).toBe(true)
  })

  it("allows personal threads and turns without a workspace", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    const thread = runtime.createThread({ workspaceId: null, title: "个人会话" })
    const { turn } = runtime.createTurn({
      threadId: thread.id,
      workspaceId: null,
      prompt: "不绑定目录也能聊天",
      mode: "auto"
    })

    expect(thread.workspaceId).toBeNull()
    expect(turn.threadId).toBe(thread.id)
    expect(runtime.snapshot(null).threads).toHaveLength(1)
    expect(runtime.snapshot(null).turns[0].prompt).toBe("不绑定目录也能聊天")
    expect(runtime.snapshot(undefined).threads[0].workspaceId).toBeNull()
  })

  it("maps extended scheduling presets to existing dispatcher modes", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()

    expect(runtime.dispatcherMode("lead-workers")).toBe("orchestrate")
    expect(runtime.dispatcherMode("parallel-review")).toBe("broadcast")
    expect(runtime.dispatcherMode("chain")).toBe("chain")
  })

  it("persists direct target agents so retries keep the selected agent", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({
      prompt: "只让 Claude 回答",
      mode: "lead-workers",
      targetAgent: "claude",
      workspaceId: "ws-1"
    })

    expect(turn.targetAgent).toBe("claude")
    expect(runtime.snapshot("ws-1").turns[0].targetAgent).toBe("claude")
    expect(runtime.eventsSince(thread.id, 0)[0].payload).toEqual(expect.objectContaining({
      prompt: "只让 Claude 回答",
      mode: "lead-workers"
    }))
  })

  it("persists attachments and custom schedule graphs on turns", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({
      prompt: "分析图片和文件",
      mode: "custom",
      workspaceId: "ws-1",
      attachments: [{ id: "att-1", kind: "image", name: "screen.png", path: "C:/tmp/screen.png", mime: "image/png", size: 12 }],
      customSchedule: {
        preset: "custom",
        label: "自定义调度",
        description: "test",
        steps: [
          { id: "a", label: "A", agentId: "codex", role: "worker", mode: "auto" },
          { id: "b", label: "B", agentId: "claude", role: "reviewer", mode: "auto", dependsOn: ["a"] }
        ]
      }
    })

    const saved = runtime.snapshot("ws-1").turns[0]
    expect(saved.attachments?.[0].name).toBe("screen.png")
    expect(saved.customSchedule?.steps[1].dependsOn).toEqual(["a"])
    expect(runtime.eventsSince(thread.id, 0).find(e => e.kind === "turn:created")?.payload.attachments[0].path).toBe("C:/tmp/screen.png")
    expect(turn.mode).toBe("custom")
  })

  it("debounces delta event persistence but saves terminal events immediately", async () => {
    vi.useFakeTimers()
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    const { thread, turn } = runtime.createTurn({ prompt: "stream", mode: "auto", workspaceId: null })
    const beforeSetCount = setCount

    runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "gemini", text: "hello", channel: "content" })
    expect(setCount).toBe(beforeSetCount)

    vi.advanceTimersByTime(451)
    expect(setCount).toBeGreaterThan(beforeSetCount)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.kind === "agent:delta")).toBe(true)

    const afterDeltaSetCount = setCount
    runtime.appendStreamEvent(turn.id, { kind: "done", agentId: "gemini", content: "hello", durationMs: 1 })
    expect(setCount).toBeGreaterThan(afterDeltaSetCount)
    expect(memory["runtime.workbench.v1"].events.some((event: any) => event.kind === "agent:done")).toBe(true)
    expect(runtime.eventsSince(thread.id, 0).some(event => event.kind === "agent:done")).toBe(true)
    vi.useRealTimers()
  })
})
