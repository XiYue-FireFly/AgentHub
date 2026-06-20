import { describe, expect, it } from "vitest"
import { EDITOR_CANDIDATES, buildEditorArgs, detectEditor } from "../open-target"

describe("open-target editor detection", () => {
  it("has required editors in candidate list", () => {
    const ids = EDITOR_CANDIDATES.map(e => e.id)
    expect(ids).toContain("vscode")
    expect(ids).toContain("cursor")
    expect(ids).toContain("windsurf")
    expect(ids).toContain("zed")
    expect(ids).toContain("system")
    expect(ids).toContain("file-manager")
  })

  it("every editor has a name and nameZh", () => {
    for (const editor of EDITOR_CANDIDATES) {
      expect(editor.name).toBeTruthy()
      expect(editor.nameZh).toBeTruthy()
    }
  })

  it("VS Code uses -g file:line:col line style", () => {
    const vscode = EDITOR_CANDIDATES.find(e => e.id === "vscode")!
    expect(buildEditorArgs(vscode, "/home/user/file.ts", 42, 10)).toEqual(["-g", "/home/user/file.ts:42:10"])
  })

  it("VS Code returns just file path when no line", () => {
    const vscode = EDITOR_CANDIDATES.find(e => e.id === "vscode")!
    expect(buildEditorArgs(vscode, "/home/user/file.ts")).toEqual(["/home/user/file.ts"])
  })

  it("Zed uses file:line:col style", () => {
    const zed = EDITOR_CANDIDATES.find(e => e.id === "zed")!
    expect(buildEditorArgs(zed, "/test.ts", 5, 3)).toEqual(["/test.ts:5:3"])
  })

  it("system default uses no line args", () => {
    const system = EDITOR_CANDIDATES.find(e => e.id === "system")!
    expect(buildEditorArgs(system, "/test.ts", 10)).toEqual(["/test.ts"])
  })

  it("detectEditor returns found for system and file-manager", () => {
    expect(detectEditor("system").found).toBe(true)
    expect(detectEditor("file-manager").found).toBe(true)
  })

  it("detectEditor returns not found for unknown editor", () => {
    expect(detectEditor("nonexistent-editor").found).toBe(false)
  })

  it("all editors have lineStyle set", () => {
    for (const editor of EDITOR_CANDIDATES) {
      expect(editor.lineStyle).toBeDefined()
    }
  })
})
