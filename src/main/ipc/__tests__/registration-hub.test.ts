import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("IPC registration hub", () => {
  const source = readFileSync(join(__dirname, "../index.ts"), "utf8")

  it("registers missing IPC handlers exactly once", () => {
    const calls = source.match(/\bregisterMissingIpc\(/g) || []
    expect(calls).toHaveLength(1)
  })

  it("does not gate full IPC registration on Hub or Dispatcher startup", () => {
    const mainSource = readFileSync(join(__dirname, "../../index.ts"), "utf8")
    const callIndex = mainSource.indexOf("registerAllIpcHandlers({")
    expect(callIndex).toBeGreaterThan(-1)
    const precedingStartupBlock = mainSource.slice(Math.max(0, callIndex - 500), callIndex)

    expect(precedingStartupBlock).not.toContain("hubInitOk")
    expect(precedingStartupBlock).not.toContain("Skipping IPC registration")
    expect(precedingStartupBlock).not.toMatch(/if\s*\([^)]*dispatcher[^)]*\)\s*{\s*$/)
  })
})
