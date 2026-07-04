import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('settings bundle entry', () => {
  it('keeps Settings statically imported to avoid stale local chunk hashes after rebuilds', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/workbench/WorkbenchMainContent.tsx'), 'utf8')

    expect(source).toContain("import { SettingsScreen } from '../screens/Settings'")
    expect(source).not.toContain("React.lazy(() => import('../screens/Settings')")
  })
})
