import { describe, expect, it, vi } from "vitest"

vi.mock("../../store", () => ({
  store: {
    get: () => undefined,
    set: () => {}
  }
}))

vi.mock("../../hub/workspace", () => ({
  getWorkspaceManager: () => ({
    getById: () => undefined
  })
}))

describe("context ledger", () => {
  it("projects personal chat context without a workspace", async () => {
    const { buildContextProjection, contextProjectionPrompt } = await import("../context-ledger")
    const projection = buildContextProjection({
      thread: undefined,
      prompt: "直接开始问答",
      workspaceId: null,
      attachments: [],
      snapshot: { threads: [], turns: [], runs: [], activeThreadId: null },
      events: []
    })

    expect(projection.workspaceId).toBeNull()
    expect(projection.blocks.some(block => block.id === "ctx-workspace-unbound")).toBe(true)
    expect(contextProjectionPrompt(projection)).toContain("未绑定工作目录")
  })

  it("includes attachments and recent turns as model-bound blocks", async () => {
    const { buildContextProjection } = await import("../context-ledger")
    const thread = {
      id: "thread-1",
      workspaceId: null,
      title: "个人会话",
      createdAt: 1,
      updatedAt: 1
    }
    const projection = buildContextProjection({
      thread,
      prompt: "分析图片",
      workspaceId: null,
      attachments: [{ id: "att-1", kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,abcd", createdAt: 2 }],
      snapshot: {
        threads: [thread],
        turns: [{
          id: "turn-1",
          threadId: "thread-1",
          prompt: "上一轮内容",
          mode: "auto",
          status: "completed",
          taskIds: [],
          createdAt: 3
        }],
        runs: [],
        activeThreadId: "thread-1"
      },
      events: []
    })

    expect(projection.blocks.map(block => block.kind)).toEqual(expect.arrayContaining(["recent_turns", "attachment", "workspace_state"]))
    expect(projection.blocks.find(block => block.kind === "attachment")?.title).toBe("screen.png")
  })
})
