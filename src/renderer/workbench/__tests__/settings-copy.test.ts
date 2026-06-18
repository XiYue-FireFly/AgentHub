import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("settings navigation copy", () => {
  it("uses readable Chinese labels instead of placeholder question marks", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/screens/Settings.tsx"), "utf8")

    for (const label of ["外观", "供应商", "本地 Agent", "路由", "权限", "工作目录", "技能", "MCP", "使用统计", "版本与更新"]) {
      expect(source).toContain(`label: '${label}'`)
    }

    expect(source).toContain("暂无模型用量数据")
    expect(source).toContain("wb-usage-day")
    expect(source).toContain("tab === 'updates'")
    expect(source).not.toContain("label: '??'")
    expect(source).not.toContain("description: '????????")
  })
})
