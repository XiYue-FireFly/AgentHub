/**
 * IPC Channel Uniqueness Test
 *
 * Scans all source files for IPC handler registrations and asserts
 * that no channel name is registered more than once. This prevents the
 * "Attempted to register a second handler" runtime error in Electron.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue
      collectTsFiles(full, acc)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && !entry.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

interface Registration {
  channel: string
  file: string
  line: number
}

function extractIpcRegistrations(filePath: string): Registration[] {
  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const results: Registration[] = []
  const regex = /(?:ipcMain\.handle|typedHandle)\(\s*["']([^"']+)["']/g

  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(lines[i])) !== null) {
      results.push({
        channel: match[1],
        file: filePath,
        line: i + 1,
      })
    }
  }
  return results
}

describe("IPC channel uniqueness", () => {
  it("should have no duplicate IPC channel registrations", () => {
    const srcDir = join(__dirname, "..")
    const files = collectTsFiles(srcDir)
    const allRegistrations: Registration[] = []

    for (const file of files) {
      allRegistrations.push(...extractIpcRegistrations(file))
    }

    // Group by channel name
    const byChannel = new Map<string, Registration[]>()
    for (const reg of allRegistrations) {
      const existing = byChannel.get(reg.channel) || []
      existing.push(reg)
      byChannel.set(reg.channel, existing)
    }

    // Find duplicates
    const duplicates: string[] = []
    for (const [channel, regs] of byChannel) {
      if (regs.length > 1) {
        const locations = regs.map(r => `${relative(srcDir, r.file)}:${r.line}`).join(", ")
        duplicates.push(`${channel} -> ${locations}`)
      }
    }

    expect(duplicates, `Duplicate IPC channels found:\n${duplicates.join("\n")}`).toEqual([])
  })

  it("should have at least 100 IPC handlers registered", () => {
    const srcDir = join(__dirname, "..")
    const files = collectTsFiles(srcDir)
    const allRegistrations: Registration[] = []

    for (const file of files) {
      allRegistrations.push(...extractIpcRegistrations(file))
    }

    // Sanity check: ensure we are actually scanning files
    expect(allRegistrations.length).toBeGreaterThanOrEqual(100)
  })
})
