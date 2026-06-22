import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ToolCallStream, ToolCall } from '../ToolCallStream'

describe('ToolCallStream', () => {
  it('exports ToolCallStream component', () => {
    expect(typeof ToolCallStream).toBe('function')
  })

  it('ToolCall type has required fields', () => {
    const call: ToolCall = {
      id: '1',
      tool: 'fs_write',
      status: 'succeeded',
      startTime: 1000,
      endTime: 1500
    }
    expect(call.id).toBe('1')
    expect(call.tool).toBe('fs_write')
    expect(call.status).toBe('succeeded')
  })

  it('all status values are valid', () => {
    const statuses: ToolCall['status'][] = ['started', 'succeeded', 'failed', 'declined']
    statuses.forEach(s => {
      expect(['started', 'succeeded', 'failed', 'declined']).toContain(s)
    })
  })

  it('supports collapsing completed tool streams behind a summary row', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/glass/ToolCallStream.tsx'), 'utf8')

    expect(source).toContain('collapseWhenComplete')
    expect(source).toContain('tool-call-stream-summary')
    expect(source).toContain('summary.running === 0')
    expect(source).toContain('setStreamOpen(shouldCollapse ? false : defaultOpen)')
    expect(source).toContain('setExpandedIds(new Set())')
    expect(source).toContain('[collapseWhenComplete, defaultOpen, summary.running]')
    expect(source).toContain('streamOpen && calls.map')
  })

  it('clamps tool durations so failed timeout rows never show negative time', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/glass/ToolCallStream.tsx'), 'utf8')

    expect(source).toContain('const value = Math.max(0, Math.round(ms))')
    expect(source).toContain('const duration = call.endTime ? Math.max(0, call.endTime - call.startTime) : null')
    expect(source).toContain('call.endTime && call.endTime >= call.startTime ? call.endTime : 0')
  })
})
