/**
 * execution-tracker: 追踪 Agent 执行过程并生成报告
 * 参照 Codex 输出形式：实时追踪 → 自动生成报告
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

export interface ExecutionStats {
  totalTools: number
  successfulTools: number
  failedTools: number
  totalDuration: number
  filesModified: string[]
  testsRun?: { passed: number; failed: number }
}

export interface ToolCallRecord {
  id: string
  tool: string
  startTime: number
  endTime?: number
  status: 'started' | 'succeeded' | 'failed' | 'declined'
  input?: string
  output?: string
  error?: string
}

export interface ExecutionTracker {
  toolCalls: Map<string, ToolCallRecord>
  filesModified: Set<string>
  testsResult?: { passed: number; failed: number }
  sessionId: string
  startTime: number

  startTool(id: string, tool: string, input?: string): void
  endTool(id: string, status: 'succeeded' | 'failed' | 'declined', output?: string, error?: string): void
  recordFileModification(path: string): void
  recordTestResult(passed: number, failed: number): void
  getToolCalls(): ToolCallRecord[]
  generateReport(): ExecutionStats
  persistReport(): void
}

const MAX_LEDGER_ENTRIES = 500

function ledgerFile(): string {
  return join(app.getPath('userData'), 'execution-reports.json')
}

export function createExecutionTracker(sessionId: string): ExecutionTracker {
  const tracker: ExecutionTracker = {
    toolCalls: new Map(),
    filesModified: new Set(),
    sessionId,
    startTime: Date.now(),

    startTool(id: string, tool: string, input?: string) {
      tracker.toolCalls.set(id, {
        id,
        tool,
        startTime: Date.now(),
        status: 'started',
        input
      })
    },

    endTool(id: string, status: 'succeeded' | 'failed' | 'declined', output?: string, error?: string) {
      const call = tracker.toolCalls.get(id)
      if (call) {
        call.endTime = Date.now()
        call.status = status
        if (output) call.output = output
        if (error) call.error = error
      }
    },

    recordFileModification(path: string) {
      tracker.filesModified.add(path)
    },

    recordTestResult(passed: number, failed: number) {
      tracker.testsResult = { passed, failed }
    },

    getToolCalls(): ToolCallRecord[] {
      return Array.from(tracker.toolCalls.values())
    },

    generateReport(): ExecutionStats {
      const calls = Array.from(tracker.toolCalls.values())
      const _completedCalls = calls.filter(c => c.endTime)
      const totalDuration = Date.now() - tracker.startTime

      return {
        totalTools: calls.length,
        successfulTools: calls.filter(c => c.status === 'succeeded').length,
        failedTools: calls.filter(c => c.status === 'failed').length,
        totalDuration,
        filesModified: Array.from(tracker.filesModified),
        testsRun: tracker.testsResult
      }
    },

    persistReport() {
      const report = {
        sessionId: tracker.sessionId,
        timestamp: new Date().toISOString(),
        stats: tracker.generateReport(),
        toolCalls: tracker.getToolCalls()
      }

      let existing: any[] = []
      const filePath = ledgerFile()
      if (existsSync(filePath)) {
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'))
        } catch {
          existing = []
        }
      }

      existing.push(report)
      if (existing.length > MAX_LEDGER_ENTRIES) {
        existing = existing.slice(-MAX_LEDGER_ENTRIES)
      }
      try {
        writeFileSync(filePath, JSON.stringify(existing, null, 2))
      } catch (err) {
        console.error('[execution-tracker] Failed to write ledger:', err)
      }
    }
  }

  return tracker
}

export function loadExecutionHistory(limit: number = 50): any[] {
  const filePath = ledgerFile()
  if (!existsSync(filePath)) return []
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data.slice(-limit)
  } catch {
    return []
  }
}
