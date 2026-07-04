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
    expect(titlebarSource).toContain("label={tr('文件'")
    expect(titlebarSource).toContain("label={tr('视图'")
    expect(titlebarSource).toContain("label={tr('帮助'")
    expect(titlebarSource).toContain('新建对话')
    expect(titlebarSource).toContain('MCP 配置')
    expect(titlebarSource).toContain('view-requirements')
    expect(titlebarSource).not.toContain('版本与更新')
    expect(titlebarSource).not.toContain('长期记忆')
    expect(titlebarSource).not.toContain('使用统计')
    expect(titlebarSource).not.toContain("tr('编辑'")
  })
})
