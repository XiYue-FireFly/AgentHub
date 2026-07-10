import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const memory: Record<string, any> = {}
let setCount = 0
const runtimes: Array<{ dispose?: () => void }> = []

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

  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.dispose?.()
    vi.useRealTimers()
  })

  it("creates threads, turns, and replayable events", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = runtime.createTurn({ prompt: "Read the project", mode: "parallel-review", workspaceId: "ws-1" })

    expect(thread.title).toBe("Read the project")
    expect(turn.status).toBe("running")
    expect(runtime.eventsSince(thread.id, 0).map(e => e.kind)).toContain("turn:created")

    runtime.setTurnStatus(turn.id, "completed")
    expect(runtime.snapshot("ws-1").threads[0].lastTurnStatus).toBe("completed")
    expect(runtime.eventsSince(thread.id, 1).some(e => e.kind === "turn:status")).toBe(true)
  })

  it("auto-titles New chat / 新对话 placeholders on first turn (IT-1)", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const en = runtime.createThread({ title: "New chat" })
    const zh = runtime.createThread({ title: "新对话" })
    const named = runtime.createThread({ title: "My notes" })

    expect(runtime.createTurn({ threadId: en.id, prompt: "Explain React hooks", mode: "auto" }).thread.title)
      .toBe("Explain React hooks")
    expect(runtime.createTurn({ threadId: zh.id, prompt: "修复登录 bug", mode: "auto" }).thread.title)
      .toBe("修复登录 bug")
    expect(runtime.createTurn({ threadId: named.id, prompt: "other prompt", mode: "auto" }).thread.title)
      .toBe("My notes")
  })

  it("allows personal threads and turns without a workspace", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
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

  it("does not substitute a workspace thread when the active thread belongs elsewhere", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)

    const workspaceThread = runtime.createThread({ workspaceId: "ws-1", title: "Workspace thread" })
    const personalThread = runtime.createThread({ workspaceId: null, title: "Personal thread" })

    expect(runtime.snapshot(undefined).activeThreadId).toBe(personalThread.id)
    expect(runtime.snapshot("ws-1").threads.map(thread => thread.id)).toContain(workspaceThread.id)
    expect(runtime.snapshot("ws-1").activeThreadId).toBeNull()
  })

  it("maps extended scheduling presets to existing dispatcher modes", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)

    expect(runtime.dispatcherMode("lead-workers")).toBe("orchestrate")
    expect(runtime.dispatcherMode("parallel-review")).toBe("broadcast")
    expect(runtime.dispatcherMode("chain")).toBe("chain")
  })

  it("persists direct target agents so retries keep the selected agent", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
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
    runtimes.push(runtime)
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
    runtimes.push(runtime)
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

  it("persists custom schedule stream roles on run nodes", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = runtime.createTurn({ prompt: "guarded run", mode: "firefly-custom", workspaceId: null })

    runtime.appendStreamEvent(turn.id, {
      kind: "start",
      agentId: "reviewer-agent",
      providerId: "local-cli",
      modelId: "reviewer-agent",
      mode: "content",
      scheduleRole: "reviewer",
      visibility: "run"
    })

    expect(runtime.snapshot(undefined).runs[0]).toMatchObject({
      agentId: "reviewer-agent",
      role: "reviewer"
    })
    expect(runtime.eventsSince(turn.threadId, 0).find(event => event.kind === "agent:start")?.payload).toMatchObject({
      scheduleRole: "reviewer",
      visibility: "run"
    })
  })

  it("updates repeated same-agent schedule runs by role instead of overwriting the latest run", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { turn } = runtime.createTurn({ prompt: "five role", mode: "firefly-custom", workspaceId: null })

    runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "router-task", agentId: "claude", providerId: "local-cli", modelId: "claude", mode: "content", scheduleRole: "router", scheduleStepId: "router" })
    runtime.appendStreamEvent(turn.id, { kind: "done", taskId: "router-task", agentId: "claude", providerId: "local-cli", modelId: "claude", content: "{}", durationMs: 1, scheduleRole: "router", scheduleStepId: "router" })
    runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "lead-task", agentId: "claude", providerId: "local-cli", modelId: "claude", mode: "content", scheduleRole: "lead", scheduleStepId: "main" })
    runtime.appendStreamEvent(turn.id, { kind: "done", taskId: "lead-task", agentId: "claude", providerId: "local-cli", modelId: "claude", content: "answer", durationMs: 2, scheduleRole: "lead", scheduleStepId: "main" })
    runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "review-task", agentId: "claude", providerId: "local-cli", modelId: "claude", mode: "content", scheduleRole: "reviewer", scheduleStepId: "reviewer" })
    runtime.appendStreamEvent(turn.id, { kind: "error", taskId: "review-task", agentId: "claude", providerId: "local-cli", modelId: "claude", error: "exit 1", durationMs: 3, scheduleRole: "reviewer", scheduleStepId: "reviewer" })

    const runs = runtime.snapshot(undefined).runs.filter(run => run.turnId === turn.id)
    expect(runs.map(run => [run.role, run.status])).toEqual([
      ["router", "completed"],
      ["lead", "completed"],
      ["reviewer", "failed"]
    ])
    const reviewStatus = runtime.eventsSince(turn.threadId, 0).filter(event => event.kind === "run:status").at(-1)
    expect(reviewStatus?.payload).toMatchObject({ status: "failed", scheduleRole: "reviewer", scheduleStepId: "reviewer" })
  })

  it("hides a runtime task card by turn id without deleting conversation data", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = runtime.createTurn({ prompt: "delete me", mode: "auto", workspaceId: "ws-1" })
    runtime.appendStreamEvent(turn.id, { kind: "start", taskId: "task-1", agentId: "codex" })
    runtime.attachTask(turn.id, "task-1")
    runtime.setTurnStatus(turn.id, "completed", { taskId: "task-1" })

    expect(runtime.deleteTask(turn.id)).toBe(true)
    expect(runtime.snapshot("ws-1").turns).toHaveLength(1)
    expect(runtime.snapshot("ws-1").runs).toHaveLength(1)
    expect(runtime.eventsSince(thread.id, 0).length).toBeGreaterThan(0)
    expect(runtime.snapshot("ws-1").hiddenTaskTurnIds).toEqual([turn.id])
  })

  it("hides completed runtime task cards for one workspace only", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const done = runtime.createTurn({ prompt: "done", mode: "custom", workspaceId: "ws-1" }).turn
    const failed = runtime.createTurn({ prompt: "failed", mode: "custom", workspaceId: "ws-1" }).turn
    const running = runtime.createTurn({ prompt: "running", mode: "custom", workspaceId: "ws-1" }).turn
    const other = runtime.createTurn({ prompt: "other", mode: "custom", workspaceId: "ws-2" }).turn

    runtime.setTurnStatus(done.id, "completed")
    runtime.setTurnStatus(failed.id, "failed")
    runtime.setTurnStatus(other.id, "completed")

    expect(runtime.clearCompletedTasks("ws-1").sort()).toEqual([done.id, failed.id].sort())
    expect(runtime.snapshot("ws-1").turns.map(turn => turn.id)).toEqual([done.id, failed.id, running.id])
    expect(runtime.snapshot("ws-1").hiddenTaskTurnIds?.sort()).toEqual([done.id, failed.id].sort())
    expect(runtime.snapshot("ws-2").hiddenTaskTurnIds).toEqual([])
  })

  it("prunes old stream deltas before completion events", async () => {
    const { WorkbenchRuntimeStore } = await import("../store")
    const runtime = new WorkbenchRuntimeStore()
    runtimes.push(runtime)
    const { thread, turn } = runtime.createTurn({ prompt: "long stream", mode: "auto", workspaceId: null })
    runtime.appendSystemEvent(thread.id, turn.id, "agent:done", "codex", {
      providerId: "openai",
      modelId: "gpt-4o",
      content: "old usage",
      usage: { input_tokens: 1, output_tokens: 1 }
    })

    for (let i = 0; i < 5100; i += 1) {
      runtime.appendStreamEvent(turn.id, { kind: "delta", agentId: "codex", text: "x", channel: "content" })
    }

    const events = runtime.eventsSince(thread.id, 0)
    expect(events.length).toBeLessThanOrEqual(5000)
    expect(events.some(event => event.kind === "agent:done" && event.payload?.usage)).toBe(true)
  })
})
