/**
 * Wave4+ headless agent runner (no BrowserWindow / Electron required).
 *
 * Spawns a local agent CLI (oneshot stdio) or a deterministic mock agent.
 * Persists run metadata + logs under ~/.agenthub/cli-runs/ (or runsDir override).
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface HeadlessRunInput {
  workspace: string
  prompt: string
  mode?: string
  agentId?: string | null
  /** Absolute or PATH binary for the agent CLI */
  agentBinary?: string | null
  agentArgs?: string[]
  timeoutMs?: number
  /** Deterministic mock agent (for CI / offline) */
  mock?: boolean
  /** When true, only validate inputs and write a dry-run record */
  dryRun?: boolean
  /** High-risk shell capabilities (reserved; denied by default) */
  allowShell?: boolean
  runsDir?: string
}

export interface HeadlessRunRecord {
  runId: string
  ok: boolean
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'dry-run'
  workspace: string
  promptChars: number
  mode: string
  agent: string | null
  mock: boolean
  dryRun: boolean
  startedAt: string
  finishedAt?: string
  durationMs?: number
  exitCode: number | null
  error?: string
  stdoutChars?: number
  stderrChars?: number
}

export interface HeadlessRunResult extends HeadlessRunRecord {
  stdout: string
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_LOG_CHARS = 512 * 1024
const MAX_PROMPT_CHARS = 200_000

export function defaultRunsDir(): string {
  return join(homedir(), '.agenthub', 'cli-runs')
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function newRunId(): string {
  return `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clip(text: string, max = MAX_LOG_CHARS): string {
  if (text.length <= max) return text
  return text.slice(text.length - max)
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, path)
}

function validateInput(input: HeadlessRunInput): string | null {
  if (!input.workspace || typeof input.workspace !== 'string') return 'workspace is required'
  if (!existsSync(input.workspace)) return `workspace does not exist: ${input.workspace}`
  try {
    if (!statSync(input.workspace).isDirectory()) return `workspace is not a directory: ${input.workspace}`
  } catch (e: any) {
    return `cannot access workspace: ${e?.message || e}`
  }
  if (!input.prompt || typeof input.prompt !== 'string' || !input.prompt.trim()) return 'prompt is required'
  if (input.prompt.length > MAX_PROMPT_CHARS) return `prompt exceeds ${MAX_PROMPT_CHARS} characters`
  if (input.allowShell) return 'allowShell is not enabled in headless MVP (high-risk)'
  const mode = input.mode || 'auto'
  if (!['auto', 'orchestrate', 'chain', 'broadcast'].includes(mode)) return `invalid mode: ${mode}`
  if (!input.dryRun && !input.mock && !input.agentBinary && !input.agentId) {
    return 'agentBinary or agentId is required for real runs (or pass --mock / --dry-run)'
  }
  return null
}

/**
 * Run a headless agent task. Never logs secrets.
 */
export async function runHeadlessAgent(input: HeadlessRunInput): Promise<HeadlessRunResult> {
  const validationError = validateInput(input)
  const runsDir = input.runsDir || defaultRunsDir()
  ensureDir(runsDir)
  const runId = newRunId()
  const startedAt = new Date().toISOString()
  const mode = input.mode || 'auto'
  const agentLabel = input.mock
    ? 'mock'
    : (input.agentBinary || input.agentId || null)

  if (validationError) {
    const record: HeadlessRunResult = {
      runId,
      ok: false,
      status: 'failed',
      workspace: input.workspace || '',
      promptChars: input.prompt?.length || 0,
      mode,
      agent: agentLabel,
      mock: Boolean(input.mock),
      dryRun: Boolean(input.dryRun),
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: 2,
      error: validationError,
      stdout: '',
      stderr: validationError
    }
    persistRun(runsDir, record)
    return record
  }

  if (input.dryRun) {
    const record: HeadlessRunResult = {
      runId,
      ok: true,
      status: 'dry-run',
      workspace: input.workspace,
      promptChars: input.prompt.trim().length,
      mode,
      agent: agentLabel,
      mock: Boolean(input.mock),
      dryRun: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      exitCode: 0,
      stdout: '',
      stderr: '',
      stdoutChars: 0,
      stderrChars: 0
    }
    persistRun(runsDir, record)
    return record
  }

  const t0 = Date.now()
  const partial: HeadlessRunRecord = {
    runId,
    ok: false,
    status: 'running',
    workspace: input.workspace,
    promptChars: input.prompt.trim().length,
    mode,
    agent: agentLabel,
    mock: Boolean(input.mock),
    dryRun: false,
    startedAt,
    exitCode: null
  }
  writeJsonAtomic(join(runsDir, `${runId}.json`), partial)

  try {
    const spawned = input.mock
      ? await spawnMockAgent(input.prompt, input.workspace, input.timeoutMs)
      : await spawnLocalAgent({
          binary: String(input.agentBinary || input.agentId),
          args: input.agentArgs || [],
          prompt: input.prompt,
          cwd: input.workspace,
          timeoutMs: input.timeoutMs || DEFAULT_TIMEOUT_MS
        })

    const result: HeadlessRunResult = {
      ...partial,
      ok: spawned.exitCode === 0,
      status: spawned.exitCode === 0 ? 'completed' : 'failed',
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      exitCode: spawned.exitCode,
      error: spawned.exitCode === 0 ? undefined : (spawned.stderr.slice(0, 500) || `exit ${spawned.exitCode}`),
      stdout: clip(spawned.stdout),
      stderr: clip(spawned.stderr),
      stdoutChars: spawned.stdout.length,
      stderrChars: spawned.stderr.length
    }
    if (spawned.timedOut) {
      result.ok = false
      result.status = 'failed'
      result.error = `timeout after ${input.timeoutMs || DEFAULT_TIMEOUT_MS}ms`
      result.exitCode = 5
    }
    persistRun(runsDir, result)
    return result
  } catch (e: any) {
    const result: HeadlessRunResult = {
      ...partial,
      ok: false,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      exitCode: 3,
      error: e?.message || String(e),
      stdout: '',
      stderr: e?.message || String(e)
    }
    persistRun(runsDir, result)
    return result
  }
}

function persistRun(runsDir: string, result: HeadlessRunResult | HeadlessRunRecord): void {
  ensureDir(runsDir)
  const metaPath = join(runsDir, `${result.runId}.json`)
  const { stdout, stderr, ...meta } = result as HeadlessRunResult
  writeJsonAtomic(metaPath, {
    ...meta,
    stdoutChars: (result as HeadlessRunResult).stdoutChars ?? stdout?.length ?? 0,
    stderrChars: (result as HeadlessRunResult).stderrChars ?? stderr?.length ?? 0
  })
  if (typeof stdout === 'string') {
    writeFileSync(join(runsDir, `${result.runId}.stdout.log`), stdout, 'utf-8')
  }
  if (typeof stderr === 'string') {
    writeFileSync(join(runsDir, `${result.runId}.stderr.log`), stderr, 'utf-8')
  }
}

export function getHeadlessRun(runId: string, runsDir = defaultRunsDir()): HeadlessRunRecord | null {
  if (!runId || runId.includes('..') || runId.includes('/') || runId.includes('\\')) return null
  const path = join(runsDir, `${runId}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as HeadlessRunRecord
  } catch {
    return null
  }
}

export function listHeadlessRuns(runsDir = defaultRunsDir(), limit = 20): HeadlessRunRecord[] {
  if (!existsSync(runsDir)) return []
  return readdirSync(runsDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(runsDir, f), 'utf-8')) as HeadlessRunRecord
      } catch {
        return null
      }
    })
    .filter((r): r is HeadlessRunRecord => Boolean(r?.runId))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, Math.max(1, Math.min(limit, 100)))
}

export function readHeadlessLogs(
  runId: string,
  runsDir = defaultRunsDir()
): { ok: boolean; stdout?: string; stderr?: string; error?: string } {
  if (!runId || runId.includes('..') || runId.includes('/') || runId.includes('\\')) {
    return { ok: false, error: 'invalid run id' }
  }
  const base = join(runsDir, runId)
  if (!existsSync(`${base}.json`)) return { ok: false, error: `run not found: ${runId}` }
  const stdout = existsSync(`${base}.stdout.log`) ? readFileSync(`${base}.stdout.log`, 'utf-8') : ''
  const stderr = existsSync(`${base}.stderr.log`) ? readFileSync(`${base}.stderr.log`, 'utf-8') : ''
  return { ok: true, stdout, stderr }
}

interface SpawnResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
}

function spawnMockAgent(prompt: string, cwd: string, timeoutMs?: number): Promise<SpawnResult> {
  // Deterministic offline agent: echoes a structured completion (no network).
  const script = [
    "let d='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',c=>d+=c);",
    "process.stdin.on('end',()=>{",
    "  const text=d.trim();",
    "  process.stdout.write(JSON.stringify({ok:true,agent:'mock',echo:text.slice(0,2000),chars:text.length})+'\\n');",
    "});"
  ].join('')
  return spawnProcess(process.execPath, ['-e', script], prompt, cwd, timeoutMs || 15_000)
}

function spawnLocalAgent(opts: {
  binary: string
  args: string[]
  prompt: string
  cwd: string
  timeoutMs: number
}): Promise<SpawnResult> {
  // Prefer stdin prompt (safe); if args contain {prompt}, substitute.
  const hasPlaceholder = opts.args.some(a => a.includes('{prompt}'))
  const args = hasPlaceholder
    ? opts.args.map(a => a.split('{prompt}').join(opts.prompt))
    : opts.args
  const stdin = hasPlaceholder ? '' : opts.prompt
  return spawnProcess(opts.binary, args, stdin, opts.cwd, opts.timeoutMs)
}

function spawnProcess(
  binary: string,
  args: string[],
  stdinText: string,
  cwd: string,
  timeoutMs: number
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, AGENTHUB_HEADLESS: '1' },
      windowsHide: true,
      shell: false
    })

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }, 2000)
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = clip(stdout + String(chunk))
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = clip(stderr + String(chunk))
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: 3, stdout, stderr: stderr || err.message, timedOut })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: timedOut ? 5 : (code ?? 3),
        stdout,
        stderr,
        timedOut
      })
    })

    if (stdinText) {
      child.stdin?.write(stdinText)
    }
    child.stdin?.end()
  })
}
