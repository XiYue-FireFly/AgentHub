import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('workbench sidebar feature entrypoints', () => {
  it('exposes first-class UI entries for implemented 2.0 features', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/workbench/SessionSidebar.tsx'), 'utf8')

    expect(source).toContain("setView('workflows')")
    expect(source).toContain("openSetup('plugins')")
    expect(source).toContain("openSetup('usage')")
    expect(source).toContain("openSetup('models')")
    expect(source).toContain("openSetup('updates')")
    expect(source).toContain("openSetup('diagnostics')")
    expect(source).toContain("openSetup('agentLoop')")
  })
})
