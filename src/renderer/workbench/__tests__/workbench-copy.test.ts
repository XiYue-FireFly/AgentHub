import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const files = [
  "src/renderer/workbench/WorkbenchLayout.tsx",
  "src/renderer/workbench/ComposerBar.tsx",
  "src/renderer/workbench/ThreadView.tsx",
  "src/renderer/workbench/WriteWorkspace.tsx",
  "src/renderer/workbench/SessionSidebar.tsx"
]

describe("workbench copy", () => {
  it("does not keep sample placeholder wording in primary workbench UI", () => {
    const combined = files.map(file => readFileSync(join(root, file), "utf8")).join("\n")

    expect(combined).not.toMatch(/例如[:：]|Example:|e\.g\./)
  })
})
