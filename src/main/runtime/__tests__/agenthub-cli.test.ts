import { spawnSync } from 'node:child_process'
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
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 15_000
  })
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || result.error?.message || '')
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
    expect(result.stderr).not.toContain('MODULE_TYPELESS_PACKAGE_JSON')
  })

  it('rejects run without workspace', () => {
    const result = runCli(['run', '--prompt', 'hello'])
    expect(result.code).toBe(2)
  })

  it('validates workspace and dry-runs', () => {
    const ws = tempDir()
    const runsDir = tempDir()
    writeFileSync(join(ws, 'README.md'), '# test', 'utf-8')
    const result = runCli([
      'run',
      '--workspace', ws,
      '--prompt', 'Run the focused tests',
      '--mode', 'orchestrate',
      '--dry-run',
      '--runs-dir', runsDir
    ])
    expect(result.code).toBe(0)
    const json = JSON.parse(result.stdout)
    expect(json.ok).toBe(true)
    expect(json.dryRun).toBe(true)
    expect(json.mode).toBe('orchestrate')
    expect(json.promptChars).toBe('Run the focused tests'.length)
    expect(result.stderr).not.toContain('MODULE_TYPELESS_PACKAGE_JSON')
  })

  it('dry-runs an ambiguous non-interactive prompt without requesting a decision', () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = runCli([
      'run',
      '--workspace', ws,
      '--prompt', 'Fix it',
      '--dry-run',
      '--runs-dir', runsDir
    ])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      status: 'dry-run',
      exitCode: 0
    })
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
    expect(result.stderr).not.toContain('MODULE_TYPELESS_PACKAGE_JSON')

    const status = runCli(['status', '--run-id', json.runId, '--runs-dir', runsDir])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout).status).toBe('completed')
    expect(status.stderr).not.toContain('MODULE_TYPELESS_PACKAGE_JSON')
  })

  it('reports a structured decision_required result for an ambiguous non-TTY prompt', () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const result = runCli([
      'run',
      '--workspace', ws,
      '--prompt', 'Fix it',
      '--mock',
      '--runs-dir', runsDir
    ])

    expect(result.code).toBe(6)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      status: 'decision_required',
      exitCode: 6
    })
  })
})
