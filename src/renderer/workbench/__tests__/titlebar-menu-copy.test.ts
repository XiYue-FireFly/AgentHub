import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("workbench titlebar menus", () => {
  it("exposes implemented desktop menus without placeholder edit menu", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(source).toContain("label={tr('文件'")
    expect(source).toContain("label={tr('视图'")
    expect(source).toContain("label={tr('帮助'")
    expect(source).toContain("新建对话")
    expect(source).toContain("版本与更新")
    expect(source).not.toContain("tr('编辑'")
  })
})
