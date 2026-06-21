import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("settings navigation copy", () => {
  it("uses readable localized labels and shows usage tab", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/screens/Settings.tsx"), "utf8")

    for (const label of ["外观", "供应商", "本地 Agent", "路由", "权限", "工作目录", "技能", "MCP", "长期记忆", "版本与更新", "用量统计"]) {
      expect(source).toContain(`label: '${label}'`)
    }

    expect(source).toContain("VISIBLE_NAV_ITEMS")
    expect(source).toContain("visibleTab === 'updates'")
    expect(source).toContain("visibleTab === 'usage'")
    expect(source).toContain("labelEn: 'Appearance'")
    expect(source).toContain("settingsNavLabel")
    expect(source).toContain("defaultFileLocation")
    expect(source).toContain("defaultFolderLocation")
    expect(source).toContain("DialogLocationControl")
    expect(source).toContain("Default open target")
    expect(source).toContain("Default attachment location")
    expect(source).toContain("Interface language")
    expect(source).toContain("Last used location")
    expect(source).toContain("tr('健康检查', 'Health check')")
    expect(source).toContain("tr('本地引擎', 'Local engines')")
    expect(source).toContain("tr('Agent 路由', 'Agent routing')")
    expect(source).toContain("tr('自定义默认策略', 'Custom default policy')")
    expect(source).toContain("tr('MCP 服务', 'MCP services')")
    expect(source).toContain("tr('版本与更新', 'Version & Updates')")
    expect(source).toContain("tr('动效强度', 'Motion level')")
    expect(source).toContain("UsageStatsDashboard")
    expect(source).toContain("React.lazy")
    expect(source).toContain("value: 'usage'")
    expect(source).not.toContain("label: '??'")
    expect(source).not.toContain("description: '????????")
    expect(source).not.toContain("FireFly")
  })
})
