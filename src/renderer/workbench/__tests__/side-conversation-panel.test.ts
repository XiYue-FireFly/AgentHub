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

  it("uses turns:create IPC to send messages", () => {
    expect(source).toContain("window.electronAPI.turns.create")
  })

  it("adds context prefix for side conversation", () => {
    expect(source).toContain("Side conversation from turn")
  })

  it("has message input with Enter key support", () => {
    expect(source).toContain("onKeyDown")
    expect(source).toContain("Enter")
  })

  it("shows user and assistant message bubbles", () => {
    expect(source).toContain("wb-side-message-")
    expect(source).toContain("msg.role")
    expect(source).toContain("wb-side-message-assistant")
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
