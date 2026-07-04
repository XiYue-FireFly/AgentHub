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
    expect(styles).toContain("left: calc(var(--wb-sidebar-width, 312px) + 12px)")
    expect(styles).toContain(".wb-bottom-dock .wb-git-workflow")
  })

  it("keeps secondary panel dispatch and terminal polling outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const toolPanel = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchToolPanel.tsx"), "utf8")
    const terminalWatcher = readFileSync(join(process.cwd(), "src/renderer/workbench/utils/terminalRunWatcher.ts"), "utf8")

    expect(layout).toContain("import { WorkbenchToolPanel } from './WorkbenchToolPanel'")
    expect(layout).toContain("import { watchTerminalRun } from './utils/terminalRunWatcher'")
    expect(layout).not.toContain("function WorkbenchToolPanel")
    expect(layout).not.toContain("async function watchTerminalRun")
    expect(toolPanel).toContain("export function WorkbenchToolPanel")
    expect(toolPanel).toContain("<BrowserPanel")
    expect(terminalWatcher).toContain("while (!signal?.aborted)")
    expect(terminalWatcher).toContain("Math.min(5000")
    expect(terminalWatcher).not.toContain("i < 24")
  })

  it("keeps workspace creation dialog logic outside WorkbenchLayout", () => {
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const dialog = readFileSync(join(process.cwd(), "src/renderer/workbench/CreateWorkspaceDialog.tsx"), "utf8")

    expect(layout).toContain("import { CreateWorkspaceDialog } from './CreateWorkspaceDialog'")
    expect(layout).not.toContain("const pickProjectFolder")
    expect(layout).not.toContain("const submitProject")
    expect(dialog).toContain("export function CreateWorkspaceDialog")
    expect(dialog).toContain("window.electronAPI.app.pickFolder")
    expect(dialog).toContain("window.electronAPI.workspaces.create")
    expect(dialog).toContain("defaultDialogPath('folder'")
  })

  it("keeps new floating workbench surfaces on theme tokens", () => {
    const styles = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(styles).toContain(':root[data-theme="dark"] .wb-workspace-popover')
    expect(styles).toContain(':root[data-theme="dark"] .wb-git-branch-popover')
    expect(styles).not.toContain('.wb-context-capacity-trigger')
    expect(styles).not.toMatch(/var\(--line\)/)
    expect(styles).not.toMatch(/var\(--bg-2\)/)
  })
})
