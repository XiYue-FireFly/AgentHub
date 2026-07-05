import { app, ipcMain } from 'electron'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LOG_FILE = 'agenthub-events.jsonl'
const RECENT_LOG_TAIL_BYTES = 512 * 1024
const LOG_READER_CHANNELS = new Set(['logs:path', 'logs:recent'])
let ipcInstalled = false

export interface AppEventLogEntry {
  ts?: string
  kind?: string
  raw?: string
  parseError?: string
  [key: string]: unknown
}

export interface RecentAppEventLogs {
  path: string
  entries: AppEventLogEntry[]
  scannedLines: number
  truncated: boolean
  parseWarnings: string[]
  error?: string
}

function logDir(): string {
  try {
    return join(app.getPath('userData'), 'logs')
  } catch {
    return join(process.cwd(), 'logs')
  }
}

function redactString(value: string): string {
  if (/(?:sk|sk-ant|sk-or|gsk|hf|ghp)_[A-Za-z0-9_-]{12,}/i.test(value)) return '[redacted]'
  if (/\b(?:sk|sk-ant|sk-or)-[A-Za-z0-9_-]{12,}\b/i.test(value)) return '[redacted]'
  if (/\bAIza[0-9A-Za-z_-]{20,}\b/.test(value)) return '[redacted]'
  if (/\bgithub_pat_[0-9A-Za-z_]{20,}\b/i.test(value)) return '[redacted]'
  if (/^Bearer\s+\S{12,}$/i.test(value)) return '[redacted]'
  if (value.length > 240) return value.slice(0, 240) + '...'
  return value
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]'
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 12).map(item => redact(item, depth + 1))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/api[-_]?key|token|secret|password|authorization/i.test(key)) {
      result[key] = item ? '[redacted]' : item
    } else {
      result[key] = redact(item, depth + 1)
    }
  }
  return result
}

function redactIpcStart(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted = redact(payload) as Record<string, unknown>
  const channel = typeof redacted.channel === 'string' ? redacted.channel : ''
  if (channel === 'providers:setKey' && Array.isArray(redacted.args)) {
    redacted.args = redacted.args.map((item, index) => index === 1 && item ? '[redacted]' : item)
  }
  return redacted
}

function redactAppEvent(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'ipc:start') return redactIpcStart(payload)
  return redact(payload) as Record<string, unknown>
}

function redactStoredEntry(entry: AppEventLogEntry): AppEventLogEntry {
  const kind = typeof entry.kind === 'string' ? entry.kind : ''
  return redactAppEvent(kind, entry) as AppEventLogEntry
}

export function appendAppEventLog(kind: string, payload: Record<string, unknown> = {}): void {
  try {
    const dir = logDir()
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, LOG_FILE), JSON.stringify({
      ts: new Date().toISOString(),
      kind,
      ...redactAppEvent(kind, payload)
    }) + '\n', 'utf8')
  } catch {
    // Logging must never affect app behavior.
  }
}

export function appEventLogPath(): string {
  return join(logDir(), LOG_FILE)
}

export function readRecentAppEventLogs(limit = 80): RecentAppEventLogs {
  const path = appEventLogPath()
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 80
  try {
    if (!existsSync(path)) {
      return { path, entries: [], scannedLines: 0, truncated: false, parseWarnings: [] }
    }

    const stat = statSync(path)
    const start = Math.max(0, stat.size - RECENT_LOG_TAIL_BYTES)
    const byteLength = Math.max(0, stat.size - start)
    const buffer = Buffer.alloc(byteLength)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, byteLength, start)
    } finally {
      closeSync(fd)
    }

    let text = buffer.toString('utf8')
    if (start > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
    }
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
    const parseWarnings: string[] = []
    const entries = lines.slice(-safeLimit).map((line, index) => {
      try {
        const parsed = JSON.parse(line)
        return parsed && typeof parsed === 'object'
          ? redactStoredEntry(parsed as AppEventLogEntry)
          : { raw: line, parseError: 'Log line is not a JSON object.' }
      } catch (error: any) {
        parseWarnings.push(`Line ${Math.max(1, lines.length - safeLimit + index + 1)}: ${error?.message || String(error)}`)
        return { raw: redactString(line.slice(0, 500)), parseError: error?.message || String(error) }
      }
    })
    return {
      path,
      entries,
      scannedLines: lines.length,
      truncated: start > 0 || lines.length > entries.length,
      parseWarnings
    }
  } catch (error: any) {
    return {
      path,
      entries: [],
      scannedLines: 0,
      truncated: false,
      parseWarnings: [],
      error: error?.message || String(error)
    }
  }
}

export function installGlobalAppEventLogging(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  appendAppEventLog('app:logger-installed', { path: appEventLogPath() })
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: any) => {
    if (LOG_READER_CHANNELS.has(channel)) {
      return originalHandle(channel, listener)
    }
    return originalHandle(channel, async (event: any, ...args: any[]) => {
      const startedAt = Date.now()
      appendAppEventLog('ipc:start', { channel, args })
      try {
        const result = await listener(event, ...args)
        appendAppEventLog('ipc:done', { channel, durationMs: Date.now() - startedAt })
        return result
      } catch (error: any) {
        appendAppEventLog('ipc:error', { channel, durationMs: Date.now() - startedAt, error: error?.message || String(error), stack: error?.stack })
        throw error
      }
    })
  }) as typeof ipcMain.handle

  process.on('uncaughtException', error => {
    appendAppEventLog('process:uncaughtException', { error: error?.message || String(error), stack: error?.stack })
  })
  process.on('unhandledRejection', reason => {
    appendAppEventLog('process:unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined })
  })
}
