import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("git runtime copy", () => {
  it("keeps visible Git labels readable", () => {
    const source = readFileSync(join(process.cwd(), "src/main/runtime/git.ts"), "utf8")

    expect(source).toContain("已暂存")
    expect(source).toContain("未暂存")
    expect(source).toContain("未跟踪")
    expect(source).toContain("使用 Git 前请先选择工作目录。")
    expect(source).not.toMatch(/[\u951f\ufffd]|\u5bb8\u53c9\u6b8f|\u93c8\ue045\u6b8f|\u93c8\ue047\u7aa1/)
  })
})
