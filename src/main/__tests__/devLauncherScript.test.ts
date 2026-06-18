import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('dev launcher script', () => {
  it('does not use pid-like variable names that collide with PowerShell built-ins', () => {
    // 该启动脚本位于仓库外（开发机父目录），CI 检出时不存在 → 跳过断言
    const path = resolve(__dirname, '../../../..', 'start_agenthub_dev.ps1')
    if (!existsSync(path)) return

    const script = readFileSync(path, 'utf8')
    expect(script).not.toMatch(/\$pid(?:_|\b)/i)
  })
})
