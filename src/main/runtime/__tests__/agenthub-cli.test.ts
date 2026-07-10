import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const cli = resolve(process.cwd(), 'scripts/agenthub-cli.mjs')
const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agenthub-cli-'))
  roots.push(dir)
  return dir
}

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 15_000
    })
    return { code: 0, stdout: String(stdout), stderr: '' }
  } catch (err: any) {
    return {
      code: typeof err?.status === 'number' ? err.status : 1,
      stdout: String(err?.stdout || ''),
      stderr: String(err?.stderr || err?.message || '')
    }
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('agenthub-cli (Wave4 P4)', () => {
  it('prints version JSON', () => {
    const result = runCli(['version'])
    expect(result.code).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.name).toBe('agenthub')
    expect(json.version).toBeTruthy()
  })

  it('rejects run without workspace', () => {
    const result = runCli(['run', '--prompt', 'hello'])
    expect(result.code).toBe(2)
  })

  it('validates workspace and dry-runs', () => {
    const ws = tempDir()
    writeFileSync(join(ws, 'README.md'), '# test', 'utf-8')
    const result = runCli(['run', '--workspace', ws, '--prompt', 'hello world', '--mode', 'orchestrate', '--dry-run'])
    expect(result.code).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.ok).toBe(true)
    expect(json.dryRun).toBe(true)
    expect(json.mode).toBe('orchestrate')
    expect(json.promptChars).toBe('hello world'.length)
  })

  it('fails when workspace path is missing', () => {
    const result = runCli(['run', '--workspace', join(tmpdir(), 'no-such-ws-' + Date.now()), '--prompt', 'x'])
    expect(result.code).toBe(2)
  })

  it('executes mock agent (real headless run)', () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = runCli([
      'run',
      '--workspace', ws,
      '--prompt', 'cli-mock-run',
      '--mock',
      '--runs-dir', runsDir
    ])
    expect(result.code).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.ok).toBe(true)
    expect(json.mock).toBe(true)
    expect(json.dryRun).toBe(false)
    expect(json.runId).toBeTruthy()

    const status = runCli(['status', '--run-id', json.runId, '--runs-dir', runsDir])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout).status).toBe('completed')
  })
})
