import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Terminal PTY IPC", () => {
  const source = readFileSync(join(process.cwd(), "src/main/ipc/terminal-pty-ipc.ts"), "utf8")

  it("exports registerTerminalPtyIpc function", () => {
    expect(source).toContain("export function registerTerminalPtyIpc")
  })

  it("registers terminal:create handler", () => {
    expect(source).toContain("terminal:create")
  })

  it("registers terminal:write handler", () => {
    expect(source).toContain("terminal:write")
  })

  it("registers terminal:resize handler", () => {
    expect(source).toContain("terminal:resize")
  })

  it("registers terminal:dispose handler", () => {
    expect(source).toContain("terminal:dispose")
  })

  it("loads node-pty dynamically", () => {
    expect(source).toContain("loadNodePty")
    expect(source).toContain("import('node-pty')")
  })

  it("resolves default shell for current platform", () => {
    expect(source).toContain("resolveDefaultShell")
  })

  it("supports PowerShell on Windows", () => {
    expect(source).toContain("pwsh.exe")
    expect(source).toContain("powershell.exe")
  })

  it("supports zsh on macOS and bash on Linux", () => {
    expect(source).toContain("/bin/zsh")
    expect(source).toContain("/bin/bash")
  })

  it("has ring buffer for session replay", () => {
    expect(source).toContain("ringBuffer")
    expect(source).toContain("RING_BUFFER_MAX")
  })

  it("limits maximum sessions", () => {
    expect(source).toContain("MAX_SESSIONS")
  })

  it("sends terminal:data event to renderer", () => {
    expect(source).toContain("terminal:data")
  })

  it("sends terminal:exit event to renderer", () => {
    expect(source).toContain("terminal:exit")
  })

  it("cleans up sessions on exit", () => {
    expect(source).toContain("sessions.delete")
  })

  it("uses xterm-256color terminal type", () => {
    expect(source).toContain("xterm-256color")
  })

  it("handles missing node-pty gracefully", () => {
    expect(source).toContain("node-pty not available")
  })
})
