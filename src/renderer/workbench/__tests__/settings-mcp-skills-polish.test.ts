import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("settings MCP and Skills polish", () => {
  it("shows durable decision details inline before allowing a tool action", () => {
    const decisionBar = readFileSync(join(process.cwd(), "src/renderer/workbench/decisions/DecisionBar.tsx"), "utf8")
    const executor = readFileSync(join(process.cwd(), "src/main/agentic/executor.ts"), "utf8")
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(decisionBar).toContain("wb-decision-bar")
    expect(decisionBar).toContain("wb-decision-options")
    expect(decisionBar).toContain("request.allowRemember")
    expect(executor).toContain("Action: write file")
    expect(executor).toContain("Preview:")
    expect(executor).toContain("Action: run command")
    expect(css).toContain(".wb-decision-bar")
  })

  it("renders Skills as a left catalog with a right SKILL.md detail pane", () => {
    const skills = readFileSync(join(process.cwd(), "src/renderer/screens/Skills.tsx"), "utf8")
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(skills).toContain("wb-skill-browser-grid")
    expect(skills).toContain("wb-skill-tree")
    expect(skills).toContain("wb-skill-detail")
    expect(skills).toContain("wb-skill-md")
    expect(skills).toContain("onToggleInstall(agentId, selectedSkill.id)")
    expect(css).toContain("grid-template-columns: minmax(220px, 300px) minmax(0, 1fr)")
  })

  it("labels MCP servers discovered from common local client configs", () => {
    readFileSync(join(process.cwd(), "src/renderer/screens/Settings.tsx"), "utf8")
    const mcp = readFileSync(join(process.cwd(), "src/main/runtime/mcp.ts"), "utf8")

    expect(mcp).toContain('join(home, ".claude.json")')
    expect(mcp).toContain('join(home, ".ccgui", "config.json")')
    expect(mcp).toContain('join(home, ".gemini", "settings.json")')
    expect(mcp).toContain("disabledMcpServers")
    const mcpTab = readFileSync(join(process.cwd(), "src/renderer/screens/McpSettingsTab.tsx"), "utf8")
    expect(mcpTab).toContain("claude: 'Claude'")
    expect(mcpTab).toContain("ccgui: tr('全局配置', 'Global config')")
  })
  it("keeps confirmation and prompt enhancer UI coordinated with the workbench theme", () => {
    const confirm = readFileSync(join(process.cwd(), "src/renderer/lib/confirm.ts"), "utf8")
    const enhancer = readFileSync(join(process.cwd(), "src/renderer/workbench/PromptEnhancer.tsx"), "utf8")
    const css = readFileSync(join(process.cwd(), "src/renderer/globals.css"), "utf8")

    expect(confirm).toContain("wb-confirm-overlay")
    expect(confirm).toContain("wb-confirm-container")
    expect(confirm).toContain("aria-modal")
    expect(confirm).toContain("取消")
    expect(confirm).toContain("确认")
    expect(enhancer).toContain("wb-prompt-enhancer")
    expect(enhancer).toContain("wb-prompt-enhancer-error")
    expect(css).toContain(".wb-confirm-overlay")
    expect(css).toContain(".wb-confirm-container")
    expect(css).toContain(".wb-prompt-enhancer-button")
    expect(css).toContain(".wb-prompt-enhancer-error")
  })
})
