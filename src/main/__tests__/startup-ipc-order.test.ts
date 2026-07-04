import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('main startup IPC order', () => {
  it('registers workbench IPC handlers before loading the renderer window', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const readyBlockStart = source.indexOf('app.whenReady().then(async () => {')
    const registerIndex = source.indexOf('registerAllIpcHandlers({', readyBlockStart)
    const createWindowIndex = source.indexOf('createWindow()', readyBlockStart)

    expect(readyBlockStart).toBeGreaterThanOrEqual(0)
    expect(registerIndex).toBeGreaterThanOrEqual(0)
    expect(createWindowIndex).toBeGreaterThanOrEqual(0)
    expect(registerIndex).toBeLessThan(createWindowIndex)
  })
})
