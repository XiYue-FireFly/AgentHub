#!/usr/bin/env node
/**
 * AgentHub headless CLI
 *
 *   agenthub-cli version
 *   agenthub-cli run --workspace <path> --prompt "..." [options]
 *   agenthub-cli status --run-id <id>
 *   agenthub-cli logs --run-id <id>
 *   agenthub-cli help
 *
 * Run options:
 *   --dry-run              validate only
 *   --mock                 deterministic offline mock agent
 *   --agent <id>           agent id label
 *   --agent-binary <path>  real CLI binary (required for real runs unless --mock)
 *   --agent-arg <arg>      repeatable args (use {prompt} placeholder if needed)
 *   --mode auto|orchestrate|chain|broadcast
 *   --timeout <ms>
 *   --runs-dir <path>
 *
 * Exit: 0 ok | 2 bad args | 3 run failed | 4 auth | 5 timeout | 6 decision required
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function printHelp() {
  console.log(`AgentHub CLI ${readPackageVersion()}

Usage:
  agenthub-cli version
  agenthub-cli run --workspace <path> --prompt <text> [--dry-run|--mock|--agent-binary <bin>] [options]
  agenthub-cli status --run-id <id> [--runs-dir <path>]
  agenthub-cli logs --run-id <id> [--runs-dir <path>]
  agenthub-cli help

Run options:
  --mode auto|orchestrate|chain|broadcast
  --agent <id>
  --agent-binary <path>
  --agent-arg <arg>          (repeatable; {prompt} placeholder supported)
  --timeout <ms>
  --runs-dir <path>
  --dry-run
  --mock

Exit codes: 0 ok | 2 bad args | 3 run failed | 4 auth | 5 timeout | 6 decision required
`)
}

function parseArgs(argv) {
  const args = { _: [], agentArgs: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--workspace' || a === '-w') args.workspace = argv[++i]
    else if (a === '--prompt' || a === '-p') args.prompt = argv[++i]
    else if (a === '--mode' || a === '-m') args.mode = argv[++i]
    else if (a === '--agent' || a === '-a') args.agent = argv[++i]
    else if (a === '--agent-binary') args.agentBinary = argv[++i]
    else if (a === '--agent-arg') args.agentArgs.push(argv[++i])
    else if (a === '--timeout') args.timeout = argv[++i]
    else if (a === '--run-id') args.runId = argv[++i]
    else if (a === '--runs-dir') args.runsDir = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--mock') args.mock = true
    else if (a === '--help' || a === '-h') args.help = true
    else if (a.startsWith('-')) {
      throw Object.assign(new Error(`Unknown flag: ${a}`), { code: 2 })
    } else {
      args._.push(a)
    }
  }
  return args
}

async function loadHeadless() {
  const compiled = join(ROOT, 'out', 'main', 'runtime', 'headless-run.js')
  if (existsSync(compiled)) {
    return import(pathToFileURL(compiled).href)
  }
  const tsSource = join(ROOT, 'src', 'main', 'runtime', 'headless-run.ts')
  if (existsSync(tsSource)) {
    // Node 22+ strip-types (project engines: node >= 24)
    return import(pathToFileURL(tsSource).href)
  }
  const lib = join(ROOT, 'scripts', 'lib', 'headless-run.mjs')
  if (existsSync(lib)) return import(pathToFileURL(lib).href)
  throw new Error('headless-run module not found')
}

function cmdVersion() {
  console.log(JSON.stringify({ name: 'agenthub', version: readPackageVersion(), cli: 'agenthub-cli' }))
  return 0
}

async function cmdRun(args) {
  if (!args.workspace || typeof args.workspace !== 'string') {
    console.error('error: --workspace is required')
    return 2
  }
  if (!args.prompt || typeof args.prompt !== 'string' || !args.prompt.trim()) {
    console.error('error: --prompt is required')
    return 2
  }

  const workspace = resolve(args.workspace)
  if (!existsSync(workspace)) {
    console.error(`error: workspace does not exist: ${workspace}`)
    return 2
  }
  try {
    if (!statSync(workspace).isDirectory()) {
      console.error(`error: workspace is not a directory: ${workspace}`)
      return 2
    }
  } catch (e) {
    console.error(`error: cannot access workspace: ${e?.message || e}`)
    return 2
  }

  const mode = args.mode || 'auto'
  if (!['auto', 'orchestrate', 'chain', 'broadcast'].includes(mode)) {
    console.error(`error: invalid --mode: ${mode}`)
    return 2
  }

  const dryRun = Boolean(args.dryRun)
  const mock = Boolean(args.mock)
  const agentBinary = args.agentBinary || process.env.AGENTHUB_AGENT_BINARY || null
  const agentId = args.agent || process.env.AGENTHUB_AGENT_ID || null

  if (!dryRun && !mock && !agentBinary && !agentId) {
    console.error('error: real run requires --mock, --agent-binary, or --dry-run')
    return 2
  }

  let timeoutMs = DEFAULT_TIMEOUT
  if (args.timeout != null) {
    timeoutMs = Number(args.timeout)
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
      console.error('error: --timeout must be a number >= 1000')
      return 2
    }
  }

  const { runHeadlessAgent } = await loadHeadless()
  const result = await runHeadlessAgent({
    workspace,
    prompt: args.prompt,
    mode,
    agentId,
    agentBinary: agentBinary || agentId,
    agentArgs: args.agentArgs || [],
    timeoutMs,
    mock,
    dryRun,
    nonInteractive: process.stdin.isTTY !== true,
    runsDir: args.runsDir ? resolve(args.runsDir) : undefined
  })

  // Never print secrets; truncate logs in JSON summary
  const out = {
    ok: result.ok,
    runId: result.runId,
    status: result.status,
    dryRun: result.dryRun,
    mock: result.mock,
    workspace: result.workspace,
    mode: result.mode,
    agent: result.agent,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    promptChars: result.promptChars,
    error: result.error,
    stdoutPreview: (result.stdout || '').slice(0, 500),
    stderrPreview: (result.stderr || '').slice(0, 500)
  }
  console.log(JSON.stringify(out, null, 2))

  if (result.exitCode === 5 || result.error?.includes('timeout')) return 5
  if (result.exitCode === 6 || result.status === 'decision_required') return 6
  if (!result.ok) return result.exitCode === 2 ? 2 : 3
  return 0
}

const DEFAULT_TIMEOUT = 120_000

async function cmdStatus(args) {
  if (!args.runId) {
    console.error('error: --run-id is required')
    return 2
  }
  const { getHeadlessRun, defaultRunsDir } = await loadHeadless()
  const runsDir = args.runsDir ? resolve(args.runsDir) : defaultRunsDir()
  const record = getHeadlessRun(args.runId, runsDir)
  if (!record) {
    console.error(`error: run not found: ${args.runId}`)
    return 3
  }
  console.log(JSON.stringify(record, null, 2))
  return record.ok || record.status === 'dry-run' ? 0 : 3
}

async function cmdLogs(args) {
  if (!args.runId) {
    console.error('error: --run-id is required')
    return 2
  }
  const { readHeadlessLogs, defaultRunsDir } = await loadHeadless()
  const runsDir = args.runsDir ? resolve(args.runsDir) : defaultRunsDir()
  const logs = readHeadlessLogs(args.runId, runsDir)
  if (!logs.ok) {
    console.error(`error: ${logs.error}`)
    return 3
  }
  if (logs.stdout) process.stdout.write(logs.stdout)
  if (logs.stderr) process.stderr.write(logs.stderr)
  return 0
}

async function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e.message || String(e))
    return 2
  }

  const cmd = args._[0] || (args.help ? 'help' : '')
  if (!cmd || cmd === 'help' || args.help) {
    printHelp()
    return cmd ? 0 : 2
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-V') return cmdVersion()
  if (cmd === 'run') return cmdRun(args)
  if (cmd === 'status') return cmdStatus(args)
  if (cmd === 'logs') return cmdLogs(args)

  console.error(`error: unknown command: ${cmd}`)
  printHelp()
  return 2
}

const code = await main(process.argv.slice(2))
process.exit(code)
