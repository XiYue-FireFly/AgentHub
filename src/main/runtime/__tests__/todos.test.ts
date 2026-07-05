import { beforeEach, describe, expect, it, vi } from "vitest"

const memory: Record<string, any> = {}

vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

describe("thread todos", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("keeps an existing status when an agent plan upserts the same todo again", async () => {
    const { upsertThreadTodo, listThreadTodos } = await import("../todos")

    const first = upsertThreadTodo({ threadId: "thread-1", id: "orchestrate-turn-1-a", content: "Inspect route" })
    upsertThreadTodo({ threadId: "thread-1", id: first.id, content: first.content, status: "completed" })
    upsertThreadTodo({ threadId: "thread-1", id: first.id, content: first.content })

    expect(listThreadTodos("thread-1")).toHaveLength(1)
    expect(listThreadTodos("thread-1")[0]).toMatchObject({
      id: first.id,
      content: "Inspect route",
      status: "completed"
    })
  })

  it("syncs only plan checklist items with valid requirement covers", async () => {
    const { syncTodosFromMarkdown, listThreadTodos } = await import("../todos")

    const todos = syncTodosFromMarkdown("thread-1", [
      "- [ ] T-1: Implement checkout (covers: R-1)",
      "- [x] T-2: Ship payment review (covers: R-1, R-2)",
      "- [-] Wire order status (covers: R-2)",
      "- [ ] acceptance criterion without covers",
      "- [ ] malformed requirement marker (covers: R-one)",
      "- [ ] unrelated parenthetical (notes: R-3)"
    ].join("\n"), {
      workspaceRoot: "E:\\workspace",
      draftId: "draft-1",
      relativePath: ".agenthub/requirements/draft-1/requirement.md"
    })

    expect(todos).toHaveLength(3)
    expect(listThreadTodos("thread-1").map(todo => todo.content)).toEqual(expect.arrayContaining([
      "T-1: Implement checkout (covers: R-1)",
      "T-2: Ship payment review (covers: R-1, R-2)",
      "Wire order status (covers: R-2)"
    ]))
    expect(todos.find(todo => todo.content.startsWith("T-1"))?.status).toBe("pending")
    expect(todos.find(todo => todo.content.startsWith("T-2"))?.status).toBe("completed")
    expect(todos.find(todo => todo.content.startsWith("Wire order"))?.status).toBe("in_progress")
    expect(todos.find(todo => todo.content.startsWith("T-1"))?.source).toMatchObject({
      kind: "plan",
      threadId: "thread-1",
      workspaceRoot: "E:\\workspace",
      draftId: "draft-1",
      relativePath: ".agenthub/requirements/draft-1/requirement.md",
      planItemId: "T-1"
    })
    expect(todos.find(todo => todo.content.startsWith("Wire order"))?.source).toMatchObject({
      planItemId: "P-3"
    })
    expect(todos.some(todo => todo.content.includes("without covers"))).toBe(false)
    expect(todos.some(todo => todo.content.includes("R-one"))).toBe(false)
    expect(todos.some(todo => todo.content.includes("notes: R-3"))).toBe(false)
  })

  it("merges new source metadata without dropping existing plan source fields", async () => {
    const { upsertThreadTodo, listThreadTodos } = await import("../todos")

    const first = upsertThreadTodo({
      threadId: "thread-1",
      id: "todo-1",
      content: "T-1: Implement checkout (covers: R-1)",
      source: { kind: "plan", draftId: "draft-1", workspaceRoot: "E:\\workspace", planItemId: "T-1" }
    })
    upsertThreadTodo({
      threadId: "thread-1",
      id: first.id,
      content: first.content,
      source: { kind: "plan", turnId: "turn-1" }
    })

    expect(listThreadTodos("thread-1")[0].source).toMatchObject({
      kind: "plan",
      draftId: "draft-1",
      workspaceRoot: "E:\\workspace",
      planItemId: "T-1",
      turnId: "turn-1"
    })
  })

  it("syncs SDD plan todos without deleting unrelated todos or existing turn ids", async () => {
    const { upsertThreadTodo, syncTodosFromMarkdown, listThreadTodos } = await import("../todos")

    upsertThreadTodo({
      threadId: "thread-1",
      id: "manual-1",
      content: "Manual follow-up",
      source: { kind: "manual" }
    })
    upsertThreadTodo({
      threadId: "thread-1",
      id: "todo-old",
      content: "T-1: Implement checkout (covers: R-1)",
      status: "in_progress",
      source: { kind: "plan", workspaceRoot: "E:\\workspace", draftId: "draft-1", planItemId: "T-1", turnId: "turn-1" }
    })
    upsertThreadTodo({
      threadId: "thread-1",
      id: "other-draft",
      content: "T-9: Other draft work (covers: R-9)",
      source: { kind: "plan", workspaceRoot: "E:\\workspace", draftId: "draft-2", planItemId: "T-9" }
    })

    syncTodosFromMarkdown("thread-1", [
      "- [ ] T-1: Implement checkout (covers: R-1)",
      "- [ ] T-2: Add checkout tests (covers: R-1)"
    ].join("\n"), {
      workspaceRoot: "E:\\workspace",
      draftId: "draft-1"
    })

    const todos = listThreadTodos("thread-1")
    expect(todos.find(todo => todo.id === "manual-1")?.content).toBe("Manual follow-up")
    expect(todos.find(todo => todo.id === "other-draft")?.content).toContain("Other draft")
    expect(todos.find(todo => todo.content.startsWith("T-1"))?.source).toMatchObject({
      draftId: "draft-1",
      planItemId: "T-1",
      turnId: "turn-1"
    })
    expect(todos.find(todo => todo.content.startsWith("T-1"))?.status).toBe("in_progress")
    expect(todos.find(todo => todo.content.startsWith("T-2"))?.source).toMatchObject({
      draftId: "draft-1",
      planItemId: "T-2"
    })
  })

  it("clears old SDD plan todos when the synced plan has no valid covered items", async () => {
    const { upsertThreadTodo, syncTodosFromMarkdown, listThreadTodos } = await import("../todos")

    upsertThreadTodo({
      threadId: "thread-1",
      id: "manual-1",
      content: "Manual follow-up",
      source: { kind: "manual" }
    })
    upsertThreadTodo({
      threadId: "thread-1",
      id: "old-plan",
      content: "T-1: Implement checkout (covers: R-1)",
      source: { kind: "plan", threadId: "thread-1", workspaceRoot: "E:\\workspace", draftId: "draft-1", planItemId: "T-1" }
    })
    upsertThreadTodo({
      threadId: "thread-1",
      id: "other-draft",
      content: "T-9: Other draft work (covers: R-9)",
      source: { kind: "plan", threadId: "thread-1", workspaceRoot: "E:\\workspace", draftId: "draft-2", planItemId: "T-9" }
    })

    syncTodosFromMarkdown("thread-1", "- [ ] acceptance criterion without covers", {
      workspaceRoot: "E:\\workspace",
      draftId: "draft-1"
    })

    const todos = listThreadTodos("thread-1")
    expect(todos.find(todo => todo.id === "old-plan")).toBeUndefined()
    expect(todos.find(todo => todo.id === "manual-1")?.content).toBe("Manual follow-up")
    expect(todos.find(todo => todo.id === "other-draft")?.content).toContain("Other draft")
  })
})
