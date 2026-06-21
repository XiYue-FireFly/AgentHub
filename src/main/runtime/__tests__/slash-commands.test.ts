import { describe, expect, it, vi, beforeEach } from "vitest"

const memory: Record<string, any> = {}
vi.mock("../../store", () => ({
  store: {
    get: (key: string) => memory[key],
    set: (key: string, value: any) => { memory[key] = value }
  }
}))

describe("slash-commands", () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key]
    vi.resetModules()
  })

  it("extracts params from body", async () => {
    const { extractParams } = await import("../slash-commands")
    expect(extractParams("Review {{code}} for {{language}}")).toEqual(["code", "language"])
    expect(extractParams("No params here")).toEqual([])
    expect(extractParams("{{a}} and {{a}} duplicates")).toEqual(["a"])
  })

  it("validates shortcut format", async () => {
    const { validateShortcut } = await import("../slash-commands")
    expect(validateShortcut("/review").valid).toBe(true)
    expect(validateShortcut("/my-command").valid).toBe(true)
    expect(validateShortcut("review").valid).toBe(false)
    expect(validateShortcut("/").valid).toBe(false)
    expect(validateShortcut("/has space").valid).toBe(false)
  })

  it("creates and lists slash commands", async () => {
    const { saveSlashCommand, listSlashCommands } = await import("../slash-commands")
    saveSlashCommand({ shortcut: "/test", name: "Test Command", body: "Run tests for {{file}}" })
    const cmds = listSlashCommands()
    expect(cmds.length).toBeGreaterThanOrEqual(1)
    const cmd = cmds.find(c => c.shortcut === "/test")
    expect(cmd).toBeDefined()
    expect(cmd!.params).toEqual(["file"])
    expect(cmd!.system).toBe(false)
  })

  it("detects conflicts", async () => {
    const { saveSlashCommand, checkConflict } = await import("../slash-commands")
    saveSlashCommand({ shortcut: "/dup", name: "First", body: "first" })
    const result = checkConflict("/dup")
    expect(result.conflict).toBe(true)
    expect(result.conflictingName).toBe("First")
    expect(checkConflict("/unique").conflict).toBe(false)
  })

  it("resolves params in body", async () => {
    const { saveSlashCommand, resolveSlashCommand } = await import("../slash-commands")
    saveSlashCommand({ shortcut: "/greet", name: "Greet", body: "Hello {{name}}, welcome to {{project}}" })
    const result = resolveSlashCommand("/greet", { name: "Alice", project: "AgentHub" })
    expect(result.ok).toBe(true)
    expect(result.body).toBe("Hello Alice, welcome to AgentHub")
  })

  it("resolves unknown command returns error", async () => {
    const { resolveSlashCommand } = await import("../slash-commands")
    const result = resolveSlashCommand("/nonexistent", {})
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Unknown")
  })

  it("deletes slash command", async () => {
    const { saveSlashCommand, deleteSlashCommand, getSlashCommand } = await import("../slash-commands")
    saveSlashCommand({ shortcut: "/del", name: "Delete Me", body: "temp" })
    expect(deleteSlashCommand("/del")).toBe(true)
    expect(getSlashCommand("/del")).toBeNull()
  })
})
