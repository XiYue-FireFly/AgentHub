import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("SideConversationPanel", () => {
  const source = readFileSync(join(process.cwd(), "src/renderer/workbench/SideConversationPanel.tsx"), "utf8")

  it("exports SideConversationPanel component", () => {
    expect(source).toContain("export function SideConversationPanel")
  })

  it("accepts parentThreadId prop", () => {
    expect(source).toContain("parentThreadId: string | null")
  })

  it("accepts workspaceId prop", () => {
    expect(source).toContain("workspaceId: string | null")
  })

  it("has onClose callback prop", () => {
    expect(source).toContain("onClose: () => void")
  })

  it("has optional onSendMessage callback", () => {
    expect(source).toContain("onSendMessage?: (message: string) => void")
  })

  it("creates a dedicated side thread instead of parent (F-W1)", () => {
    expect(source).toContain("threads.create")
    expect(source).toContain("ensureSideThread")
    expect(source).not.toContain("threadId: parentThreadId")
  })

  it("uses turns.create with side thread id", () => {
    expect(source).toContain("window.electronAPI.turns.create")
    expect(source).toContain("threadId,")
  })

  it("has message input with Enter key support", () => {
    expect(source).toContain("onKeyDown")
    expect(source).toContain("Enter")
  })

  it("shows user and assistant message bubbles", () => {
    expect(source).toContain("wb-side-message-")
    expect(source).toContain("msg.role")
  })

  it("shows typing indicator while sending", () => {
    expect(source).toContain("sending")
    expect(source).toContain("Thinking")
  })

  it("shows empty state when no messages", () => {
    expect(source).toContain("messages.length === 0")
  })

  it("clears input after sending", () => {
    expect(source).toContain("setInput('')")
  })
})
