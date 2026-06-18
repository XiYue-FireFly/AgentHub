import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("workbench git dock layout", () => {
  it("keeps Git in the wide bottom dock instead of the narrow inspector", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const styles = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(layout).toContain("rightPanel && rightPanel !== 'git'")
    expect(layout).toContain("rightPanel === 'git'")
    expect(layout).toContain("WorkbenchBottomDock")
    expect(styles).toContain(".wb-bottom-dock")
    expect(styles).toContain(".wb-bottom-dock .wb-git-workflow")
  })
})
