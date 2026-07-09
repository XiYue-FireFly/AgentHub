import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getHeadlessRun,
  listHeadlessRuns,
  readHeadlessLogs,
  runHeadlessAgent
} from '../headless-run'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-headless-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('headless-run (real execution)', () => {
  it('dry-run validates and records without spawning', async () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'hello headless',
      dryRun: true,
      runsDir
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('dry-run')
    expect(result.exitCode).toBe(0)
    const saved = getHeadlessRun(result.runId, runsDir)
    expect(saved?.status).toBe('dry-run')
  })

  it('runs mock agent and persists logs', async () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'ping-mock-agent',
      mock: true,
      runsDir,
      timeoutMs: 15_000
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('completed')
    expect(result.stdout).toContain('mock')
    expect(result.stdout).toContain('ping-mock-agent')
    const logs = readHeadlessLogs(result.runId, runsDir)
    expect(logs.ok).toBe(true)
    expect(logs.stdout).toContain('ok')
    const listed = listHeadlessRuns(runsDir)
    expect(listed.some(r => r.runId === result.runId)).toBe(true)
  })

  it('runs a real local binary via agentBinary', async () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'from-binary',
      agentBinary: process.execPath,
      agentArgs: ['-e', "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write('BIN:'+d.trim());});"],
      runsDir,
      timeoutMs: 15_000
    })
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('BIN:from-binary')
  })

  it('rejects missing workspace', async () => {
    const runsDir = tempDir()
    const result = await runHeadlessAgent({
      workspace: join(tmpdir(), 'no-ws-' + Date.now()),
      prompt: 'x',
      mock: true,
      runsDir
    })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(2)
  })

  it('requires agent for non-dry non-mock runs', async () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'need agent',
      runsDir
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/agentBinary|agentId|mock|dry-run/i)
  })
})
