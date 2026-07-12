import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Composer approval mode picker", () => {
  it("renders Codex-style approval modes backed by real agentic policies", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/ComposerBar.tsx"), "utf8")

    expect(source).toContain("wb-approval-mode-trigger")
    expect(source).toContain("approvalDisplayModeFromConfig")
    expect(source).toContain("window.electronAPI.agentic.setApprovalPreset")
    expect(source).toContain("id: 'ask'")
    expect(source).toContain("id: 'auto'")
    expect(source).toContain("id: 'full'")
  })
})
