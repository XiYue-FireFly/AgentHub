import { describe, expect, it, vi, beforeEach } from "vitest"

const memory: Record<string, any> = {}
vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

describe("prompt-library", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("creates and retrieves a prompt", async () => {
    const { upsertPrompt, getPrompt } = await import("../prompt-library")
    const p = upsertPrompt({ name: "Test Prompt", body: "Hello {{name}}", category: "general", tags: ["test"] })
    expect(p.name).toBe("Test Prompt")
    expect(p.body).toBe("Hello {{name}}")
    const found = getPrompt(p.id)
    expect(found).not.toBeNull()
    expect(found!.category).toBe("general")
  })

  it("lists prompts by category", async () => {
    const { upsertPrompt, listPrompts } = await import("../prompt-library")
    upsertPrompt({ name: "A", body: "a", category: "coding" })
    upsertPrompt({ name: "B", body: "b", category: "review" })
    upsertPrompt({ name: "C", body: "c", category: "coding" })
    expect(listPrompts("coding")).toHaveLength(2)
    expect(listPrompts("review")).toHaveLength(1)
    expect(listPrompts()).toHaveLength(3)
  })

  it("searches by name, body, and tags", async () => {
    const { upsertPrompt, searchPrompts } = await import("../prompt-library")
    upsertPrompt({ name: "Code Review", body: "Review this code", tags: ["review", "quality"] })
    upsertPrompt({ name: "Research", body: "Investigate the topic", tags: ["research"] })
    expect(searchPrompts("review")).toHaveLength(1)
    expect(searchPrompts("topic")).toHaveLength(1)
    expect(searchPrompts("quality")).toHaveLength(1)
  })

  it("tracks use count", async () => {
    const { upsertPrompt, incrementUseCount, getPrompt } = await import("../prompt-library")
    const p = upsertPrompt({ name: "Counter", body: "test" })
    expect(getPrompt(p.id)!.useCount).toBe(0)
    incrementUseCount(p.id)
    incrementUseCount(p.id)
    expect(getPrompt(p.id)!.useCount).toBe(2)
  })

  it("returns slash commands", async () => {
    const { upsertPrompt, getSlashCommands } = await import("../prompt-library")
    upsertPrompt({ name: "Review", body: "review", isSlashCommand: true, shortcut: "/review" })
    upsertPrompt({ name: "Normal", body: "normal", isSlashCommand: false })
    expect(getSlashCommands()).toHaveLength(1)
    expect(getSlashCommands()[0].shortcut).toBe("/review")
  })

  it("deletes a prompt", async () => {
    const { upsertPrompt, deletePrompt, getPrompt } = await import("../prompt-library")
    const p = upsertPrompt({ name: "Delete Me", body: "temp" })
    expect(deletePrompt(p.id)).toBe(true)
    expect(getPrompt(p.id)).toBeNull()
    expect(deletePrompt("nonexistent")).toBe(false)
  })

  it("seeds defaults on first run", async () => {
    const { seedDefaultPrompts, listPrompts } = await import("../prompt-library")
    seedDefaultPrompts()
    const all = listPrompts()
    expect(all.length).toBeGreaterThanOrEqual(4)
    expect(all.some(p => p.shortcut === "/review")).toBe(true)
    // Second seed is no-op
    seedDefaultPrompts()
    expect(listPrompts()).toHaveLength(all.length)
  })
})
