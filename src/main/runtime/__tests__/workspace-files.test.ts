import { describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { listWorkspaceFiles, searchWorkspaceFiles, readFilePreview } from "../workspace-files"

function makeTestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agenthub-wf-test-"))
  writeFileSync(join(dir, "index.ts"), "export const x = 1\nexport const y = 2\n")
  writeFileSync(join(dir, "README.md"), "# Test Project\n\nA test project.\n")
  writeFileSync(join(dir, "package.json"), '{"name":"test"}\n')
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src", "main.ts"), "console.log('hello')\n")
  mkdirSync(join(dir, "node_modules"), { recursive: true })
  writeFileSync(join(dir, "node_modules", "dep.js"), "// ignored")
  return dir
}

describe("workspace-files", () => {
  it("lists files excluding node_modules and hidden dirs", () => {
    const dir = makeTestDir()
    const files = listWorkspaceFiles(dir)
    expect(files.length).toBeGreaterThanOrEqual(4)
    expect(files.some(f => f.name === "node_modules")).toBe(false)
    expect(files.some(f => f.name === "index.ts")).toBe(true)
    expect(files.some(f => f.name === "src")).toBe(true)
  })

  it("searches files by name", () => {
    const dir = makeTestDir()
    const results = searchWorkspaceFiles(dir, "index")
    expect(results.length).toBe(1)
    expect(results[0].name).toBe("index.ts")
  })

  it("reads text file preview", async () => {
    const dir = makeTestDir()
    const result = await readFilePreview(join(dir, "index.ts"))
    expect(result.ok).toBe(true)
    expect(result.content).toContain("export const x")
  })

  it("rejects binary files", async () => {
    const dir = makeTestDir()
    writeFileSync(join(dir, "image.png"), Buffer.from([0x89, 0x50]))
    const result = await readFilePreview(join(dir, "image.png"))
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Binary")
  })

  it("returns empty for non-existent directory", () => {
    expect(listWorkspaceFiles("/nonexistent/path")).toEqual([])
  })
})
