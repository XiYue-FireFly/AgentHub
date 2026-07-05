import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("open editor actions", () => {
  it("uses a real editor target for the workbench open-editor button", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchChatTopBar.tsx"), "utf8")

    expect(source).toContain("window.electronAPI.app.openPath({ path: workspaceRoot, target: 'editor' })")
    expect(source).not.toContain("openPath({ path: workspaceRoot, target: readAppearanceLocal().defaultOpenTarget })")
  })

  it("offers editor and file-manager actions for markdown file references", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/MarkdownBlock.tsx"), "utf8")

    expect(source).toContain("openFileReference(fileMenu.path, fileMenu.line, 'editor')")
    expect(source).toContain("Open in editor")
    expect(source).toContain("Reveal in file manager")
    expect(source).toContain("Open failed:")
    expect(source).not.toContain("\u9366\u3129\u7caf\u7481\u3087\u6d30\u93cd\u56e6\u8151\u93b5\u64b3\u7d11")
  })
})
