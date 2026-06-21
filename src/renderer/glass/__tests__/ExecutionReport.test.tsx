import { describe, expect, it } from 'vitest'
import { ExecutionReport, ExecutionStats } from '../ExecutionReport'

describe('ExecutionReport', () => {
  it('exports ExecutionReport component', () => {
    expect(typeof ExecutionReport).toBe('function')
  })

  it('ExecutionStats type has required fields', () => {
    const stats: ExecutionStats = {
      totalTools: 5,
      successfulTools: 5,
      failedTools: 0,
      totalDuration: 3500,
      filesModified: ['src/main.ts']
    }
    expect(stats.totalTools).toBe(5)
    expect(stats.successfulTools).toBe(5)
    expect(stats.failedTools).toBe(0)
    expect(stats.filesModified).toHaveLength(1)
  })

  it('supports optional testsRun field', () => {
    const stats: ExecutionStats = {
      totalTools: 3,
      successfulTools: 2,
      failedTools: 1,
      totalDuration: 1200,
      filesModified: [],
      testsRun: { passed: 10, failed: 2 }
    }
    expect(stats.testsRun?.passed).toBe(10)
    expect(stats.testsRun?.failed).toBe(2)
  })
})
