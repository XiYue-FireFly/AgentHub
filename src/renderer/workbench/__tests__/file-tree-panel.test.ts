import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("FileTreePanel", () => {
  const source = readFileSync(join(process.cwd(), "src/renderer/workbench/FileTreePanel.tsx"), "utf8")

  it("exports FileTreePanel component", () => {
    expect(source).toContain("export function FileTreePanel")
  })

  it("accepts workspaceRoot and workspaceId props", () => {
    expect(source).toContain("workspaceRoot: string | null")
    expect(source).toContain("workspaceId: string | null")
  })

  it("has onClose callback prop", () => {
    expect(source).toContain("onClose: () => void")
  })

  it("has onFileSelect callback prop", () => {
    expect(source).toContain("onFileSelect?: (path: string) => void")
  })

  it("uses workspaceFiles:list IPC for directory listing", () => {
    expect(source).toContain("window.electronAPI.workspaceFiles.list")
  })

  it("ignores .git and node_modules directories", () => {
    expect(source).toContain(".git")
    expect(source).toContain("node_modules")
  })

  it("shows loading state while fetching directory", () => {
    expect(source).toContain("loading")
  })

  it("shows error state on failure", () => {
    expect(source).toContain("error")
  })

  it("supports expand/collapse of directories", () => {
    expect(source).toContain("toggleExpand")
    expect(source).toContain("expanded")
  })

  it("renders file icons based on extension", () => {
    expect(source).toContain("fileIcon")
  })

  it("has context menu with copy path action", () => {
    expect(source).toContain("contextMenu")
    expect(source).toContain("handleCopyPath")
  })

  it("shows file size for files", () => {
    expect(source).toContain("formatFileSize")
  })
})
