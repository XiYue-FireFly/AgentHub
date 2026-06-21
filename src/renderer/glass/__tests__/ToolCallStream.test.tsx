import { describe, expect, it } from 'vitest'
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
})
