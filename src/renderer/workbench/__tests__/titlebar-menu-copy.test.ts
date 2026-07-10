import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('workbench titlebar menus', () => {
  it('exposes implemented desktop menus without placeholder edit menu', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/workbench/NativeTitlebar.tsx'), 'utf8')
    const titlebarStart = source.indexOf('export function NativeTitlebar')
    const titlebarEnd = source.indexOf('function TitlebarMenu')
    const titlebarSource = source.slice(titlebarStart, titlebarEnd)

    expect(titlebarStart).toBeGreaterThan(-1)
    expect(titlebarEnd).toBeGreaterThan(titlebarStart)
    expect(titlebarSource).toContain('id="file"')
    expect(titlebarSource).toContain('id="view"')
    expect(titlebarSource).toContain('id="help"')
    expect(titlebarSource).toContain('New chat')
    expect(titlebarSource).toContain('window.electronAPI.windows.openWorkbench')
    expect(titlebarSource).toContain('MCP settings')
    expect(titlebarSource).toContain('view-requirements')
    expect(titlebarSource).toContain("openSetup('updates')")
    expect(titlebarSource).toContain("openSetup('usage')")
    expect(titlebarSource).toContain("openSetup('plugins')")
    expect(titlebarSource).toContain("openSetup('models')")
    expect(titlebarSource).toContain("openSetup('diagnostics')")
    expect(titlebarSource).toContain("openSetup('agentLoop')")
    expect(titlebarSource).toContain("setView('workflows')")
    expect(titlebarSource).not.toContain('id="edit"')
  })
})
