import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Settings memory tab", () => {
  it("exposes import, approval, edit, disable, and delete controls from settings", () => {
    const source = readFileSync(join(process.cwd(), "src/renderer/screens/Settings.tsx"), "utf8")
    const workbench = readFileSync(join(process.cwd(), "src/renderer/workbench/WorkbenchLayout.tsx"), "utf8")
    const threadView = readFileSync(join(process.cwd(), "src/renderer/workbench/ThreadView.tsx"), "utf8")
    const runTimeline = readFileSync(join(process.cwd(), "src/renderer/workbench/RunTimeline.tsx"), "utf8")

    expect(source).toContain("memory.importConversation")
    expect(source).toContain("memory.catalog")
    expect(source).toContain("memory.approveCandidate")
    expect(source).toContain("memory.updateEntry")
    expect(source).toContain("memory.disableEntry")
    expect(source).toContain("memory.delete")
    expect(source).toContain("function memoryMeta")
    expect(source).toContain("MemorySettingsTab")
    expect(source).toContain("wb-memory-settings")
    expect(source).toContain("scopeFilter")
    expect(source).toContain("MEMORY_SCOPES")
    expect(source).toContain("wb-memory-category-badge")
    expect(source).toContain("entry.updatedAt || entry.createdAt")
    expect(source).toContain("togglePinned")
    expect(source).toContain("MEMORY_CATEGORIES")
    expect(source).toContain("confidence")
    expect(source).toContain("作用域")
    expect(source).toContain("tr('置顶', 'Pinned')")
    expect(source).toContain("tr('批准', 'Approve')")
    expect(source).toContain("tr('禁用', 'Disable')")
    expect(source).toContain("tr('偏好', 'Preference')")
    expect(workbench).not.toContain("function MemoryPanel")
    expect(threadView).toContain("function isChatVisibleRuntimeEvent")
    expect(threadView).toContain("event.kind === 'memory:candidate'")
    expect(runTimeline).toContain("event.kind !== 'memory:candidate'")
  })
})
