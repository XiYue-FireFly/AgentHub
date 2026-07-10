import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("local agent settings sync", () => {
  it("syncs local-agent detection/configuration results back to the workbench picker", () => {
    const settings = readFileSync(join(process.cwd(), "src/renderer/screens/Settings.tsx"), "utf8")
    const mainContent = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchMainContent.tsx"), "utf8")
    const layout = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")

    expect(settings).toContain("onLocalAgentsChanged?: (agents: LocalAgentStatus[]) => void")
    expect(settings).toContain("<LocalAgentsTab onLocalAgentsChanged={props.onLocalAgentsChanged} />")
    expect(settings).toContain("onLocalAgentsChanged?.(next)")
    expect(mainContent).toContain("onLocalAgentsChanged: (agents: LocalAgentStatus[]) => void")
    expect(mainContent).toContain("onLocalAgentsChanged={onLocalAgentsChanged}")
    expect(layout).toContain("onLocalAgentsChanged={setLocalAgents}")
  })
})
