import { describe, it, expect, beforeEach } from 'vitest'
import {
  executeSystemTool,
  guardedCategoryForTool,
  systemToolsOpenAi,
  SYSTEM_TOOL_SCHEMAS
} from '../system-tools'
import type { SystemToolContext } from '../system-tools'

describe('MCP System Tools', () => {
  let ctx: SystemToolContext

  beforeEach(() => {
    ctx = {
      cwd: process.cwd(),
      readOnly: false
    }
  })

  describe('SYSTEM_TOOL_SCHEMAS', () => {
    it('should define all 8 tools', () => {
      expect(SYSTEM_TOOL_SCHEMAS.length).toBe(8)
      const names = SYSTEM_TOOL_SCHEMAS.map(s => s.name)
      expect(names).toContain('fs_read')
      expect(names).toContain('fs_write')
      expect(names).toContain('fs_list')
      expect(names).toContain('fs_delete')
      expect(names).toContain('fs_move')
      expect(names).toContain('fs_copy')
      expect(names).toContain('shell_exec')
      expect(names).toContain('system_info')
    })
  })

  describe('systemToolsOpenAi', () => {
    it('should return OpenAI format tools', () => {
      const tools = systemToolsOpenAi()
      expect(tools.length).toBe(8)
      expect(tools[0].type).toBe('function')
      expect(tools[0].function.name).toBe('fs_read')
    })
  })

  describe('guardedCategoryForTool', () => {
    it('should map read tools to read category', () => {
      expect(guardedCategoryForTool('fs_read')).toBe('read')
      expect(guardedCategoryForTool('fs_list')).toBe('read')
      expect(guardedCategoryForTool('system_info')).toBe('read')
    })

    it('should map write tools to write category', () => {
      expect(guardedCategoryForTool('fs_write')).toBe('write')
      expect(guardedCategoryForTool('fs_delete')).toBe('write')
      expect(guardedCategoryForTool('fs_move')).toBe('write')
      expect(guardedCategoryForTool('fs_copy')).toBe('write')
    })

    it('should map shell_exec to exec category', () => {
      expect(guardedCategoryForTool('shell_exec')).toBe('exec')
    })
  })

  describe('executeSystemTool', () => {
    it('should read system info', async () => {
      const result = await executeSystemTool('system_info', { detailed: false }, ctx)
      expect(result.ok).toBe(true)
      const info = JSON.parse(result.output)
      expect(info.platform).toBeDefined()
      expect(info.arch).toBeDefined()
    })

    it('should return hostname as string, not Promise', async () => {
      const result = await executeSystemTool('system_info', { detailed: false }, ctx)
      expect(result.ok).toBe(true)
      const info = JSON.parse(result.output)
      expect(typeof info.hostname).toBe('string')
      expect(info.hostname).not.toBe('{}')
      expect(info.hostname.length).toBeGreaterThan(0)
    })

    it('should list directory', async () => {
      const result = await executeSystemTool('fs_list', { path: '.' }, ctx)
      expect(result.ok).toBe(true)
      expect(result.output.length).toBeGreaterThan(0)
    })

    it('should read a file', async () => {
      const result = await executeSystemTool('fs_read', { path: 'package.json' }, ctx)
      expect(result.ok).toBe(true)
      expect(result.output).toContain('AgentHub')
    })

    it('should block write in read-only mode', async () => {
      const readOnlyCtx = { ...ctx, readOnly: true }
      const result = await executeSystemTool('fs_write', { path: 'test.txt', content: 'test' }, readOnlyCtx)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('read-only mode')
    })

    it('should block shell_exec in read-only mode', async () => {
      const readOnlyCtx = { ...ctx, readOnly: true }
      const result = await executeSystemTool('shell_exec', { command: 'echo hello' }, readOnlyCtx)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('read-only mode')
    })

    it('should execute shell command', async () => {
      const result = await executeSystemTool('shell_exec', { command: 'echo hello' }, ctx)
      expect(result.ok).toBe(true)
      expect(result.output.trim()).toBe('hello')
    })
  })
})
