import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('settings bundle entry', () => {
  it('lazy-loads SettingsScreen instead of statically importing it into WorkbenchMainContent', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/workbench/WorkbenchMainContent.tsx'), 'utf8')

    expect(source).not.toContain("import { SettingsScreen } from '../screens/Settings'")
    expect(source).toContain("const SettingsScreen = React.lazy(() => import('../screens/Settings').then(m => ({ default: m.SettingsScreen })))")
    expect(source).toContain('<React.Suspense fallback=')
  })
})
