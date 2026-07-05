import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  userDataDir: '',
  handle: vi.fn(),
  ipcMain: { handle: vi.fn() }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userDataDir)
  },
  ipcMain: electronMock.ipcMain
}))

describe('app-event-log recent reader', () => {
  beforeEach(() => {
    electronMock.userDataDir = mkdtempSync(join(tmpdir(), 'agenthub-log-test-'))
    electronMock.handle = vi.fn()
    electronMock.ipcMain.handle = electronMock.handle
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(electronMock.userDataDir, { recursive: true, force: true })
  })

  it('returns an empty recent log result when the file does not exist', async () => {
    const { readRecentAppEventLogs } = await import('../app-event-log')

    const result = readRecentAppEventLogs(20)

    expect(result.entries).toEqual([])
    expect(result.scannedLines).toBe(0)
    expect(result.error).toBeUndefined()
    expect(result.path).toContain('agenthub-events.jsonl')
  })

  it('reads the latest entries and reports malformed lines without throwing', async () => {
    const { appEventLogPath, readRecentAppEventLogs } = await import('../app-event-log')
    const path = appEventLogPath()
    mkdirSync(join(electronMock.userDataDir, 'logs'), { recursive: true })
    writeFileSync(path, [
      JSON.stringify({ ts: '2026-07-04T00:00:00.000Z', kind: 'ipc:start', channel: 'a' }),
      'not json',
      JSON.stringify({ ts: '2026-07-04T00:00:02.000Z', kind: 'ipc:error', error: 'boom' })
    ].join('\n'), 'utf8')

    const result = readRecentAppEventLogs(2)

    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({ raw: 'not json' })
    expect(result.entries[0].parseError).toBeTruthy()
    expect(result.entries[1]).toMatchObject({ kind: 'ipc:error', error: 'boom' })
    expect(result.scannedLines).toBe(3)
    expect(result.truncated).toBe(true)
    expect(result.parseWarnings).toHaveLength(1)
  })

  it('redacts positional provider keys when writing and reading logs', async () => {
    const { appendAppEventLog, appEventLogPath, readRecentAppEventLogs } = await import('../app-event-log')
    appendAppEventLog('ipc:start', { channel: 'providers:setKey', args: ['deepseek', 'sk-super-secret-token-value'] })
    appendAppEventLog('ipc:start', { channel: 'other:channel', args: ['Bearer hidden-token-value'] })

    const raw = readFileSync(appEventLogPath(), 'utf8')
    const result = readRecentAppEventLogs(10)

    expect(raw).not.toContain('sk-super-secret-token-value')
    expect(raw).not.toContain('hidden-token-value')
    expect(result.entries[0]).toMatchObject({ channel: 'providers:setKey', args: ['deepseek', '[redacted]'] })
    expect(JSON.stringify(result.entries)).not.toContain('sk-super-secret-token-value')
    expect(JSON.stringify(result.entries)).not.toContain('hidden-token-value')
  })

  it('redacts provider keys from historical log entries before returning them', async () => {
    const { appEventLogPath, readRecentAppEventLogs } = await import('../app-event-log')
    mkdirSync(join(electronMock.userDataDir, 'logs'), { recursive: true })
    writeFileSync(appEventLogPath(), JSON.stringify({
      ts: '2026-07-04T00:00:00.000Z',
      kind: 'ipc:start',
      channel: 'providers:setKey',
      args: ['anthropic', 'sk-ant-historical-secret-value']
    }), 'utf8')

    const result = readRecentAppEventLogs(10)

    expect(result.entries[0]).toMatchObject({ channel: 'providers:setKey', args: ['anthropic', '[redacted]'] })
    expect(JSON.stringify(result.entries)).not.toContain('sk-ant-historical-secret-value')
  })

  it('does not wrap log-reader IPC channels with app-event logging', async () => {
    const { installGlobalAppEventLogging } = await import('../app-event-log')

    installGlobalAppEventLogging()
    const logsRecentListener = vi.fn(() => ({ ok: true }))
    const providersListener = vi.fn(() => ({ ok: true }))

    const { ipcMain } = await import('electron')
    ipcMain.handle('logs:recent', logsRecentListener)
    ipcMain.handle('providers:get', providersListener)

    const registeredLogsRecent = electronMock.handle.mock.calls.find(call => call[0] === 'logs:recent')?.[1]
    const registeredProviders = electronMock.handle.mock.calls.find(call => call[0] === 'providers:get')?.[1]

    expect(registeredLogsRecent).toBe(logsRecentListener)
    expect(registeredProviders).not.toBe(providersListener)
  })

  it('clamps excessive limits to a bounded result size', async () => {
    const { appEventLogPath, readRecentAppEventLogs } = await import('../app-event-log')
    mkdirSync(join(electronMock.userDataDir, 'logs'), { recursive: true })
    const lines = Array.from({ length: 620 }, (_, index) => JSON.stringify({ kind: 'ipc:done', seq: index + 1 }))
    writeFileSync(appEventLogPath(), lines.join('\n'), 'utf8')

    const result = readRecentAppEventLogs(10_000)

    expect(result.entries).toHaveLength(500)
    expect(result.entries[0]).toMatchObject({ seq: 121 })
    expect(result.entries.at(-1)).toMatchObject({ seq: 620 })
  })
})
