import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getHeadlessRun,
  listHeadlessRuns,
  readHeadlessLogs,
  runHeadlessAgent,
  prepareHeadlessPrompt,
  type HeadlessRunDependencies
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
  it('returns decision_required without spawning for an ambiguous non-interactive prompt', async () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const dependencies: HeadlessRunDependencies = {
      preparePrompt: vi.fn(async () => ({
        kind: 'decision-required' as const,
        session: { sessionId: 'session-1' } as any,
        candidates: ['Repair the focused defect.', 'Audit and repair the whole module.']
      })),
      spawnAgent: vi.fn()
    }

    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'Fix it',
      mock: true,
      nonInteractive: true,
      runsDir
    }, dependencies)

    expect(result).toMatchObject({ ok: false, status: 'decision_required', exitCode: 6 })
    expect(JSON.parse(result.error || '{}')).toMatchObject({
      code: 'PROMPT_DECISION_REQUIRED',
      sessionId: 'session-1',
      candidates: ['Repair the focused defect.', 'Audit and repair the whole module.']
    })
    expect(dependencies.spawnAgent).not.toHaveBeenCalled()
  })

  it('dispatches the finalized effective prompt once after a terminal selection', async () => {
    const ws = tempDir()
    const runsDir = tempDir()
    const dependencies: HeadlessRunDependencies = {
      preparePrompt: vi.fn(async () => ({
        kind: 'ready' as const,
        session: { sessionId: 'session-ready' } as any,
        envelope: { effectivePrompt: 'Repair the login form and run focused tests.' } as any
      })),
      spawnAgent: vi.fn(async (prompt, input) => ({
        runId: 'prepared-run',
        ok: true,
        status: 'completed' as const,
        workspace: input.workspace,
        promptChars: prompt.length,
        mode: input.mode || 'auto',
        agent: 'mock',
        mock: true,
        dryRun: false,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:00.000Z',
        durationMs: 0,
        exitCode: 0,
        stdout: prompt,
        stderr: ''
      }))
    }

    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'Fix it',
      mock: true,
      runsDir
    }, dependencies)

    expect(result).toMatchObject({ status: 'completed', stdout: 'Repair the login form and run focused tests.' })
    expect(dependencies.spawnAgent).toHaveBeenCalledWith(
      'Repair the login form and run focused tests.',
      expect.objectContaining({ prompt: 'Fix it' })
    )
  })

  it('uses shared clarity analysis to stop an ambiguous non-interactive CLI root before spawning', async () => {
    const ws = tempDir()
    const runsDir = tempDir()

    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'Review',
      mock: true,
      nonInteractive: true,
      runsDir
    })

    expect(result).toMatchObject({ ok: false, status: 'decision_required', exitCode: 6 })
    expect(JSON.parse(result.error || '{}')).toMatchObject({
      code: 'PROMPT_DECISION_REQUIRED',
      sessionId: expect.stringMatching(/^cli-headless-/u)
    })
  })

  it('finalizes a clear CLI root with a shared-core envelope before dispatch', async () => {
    const prepared = await prepareHeadlessPrompt({
      prompt: 'Run the focused test suite',
      workspace: tempDir(),
      nonInteractive: false
    })

    expect(prepared).toMatchObject({
      kind: 'ready',
      envelope: {
        origin: 'cli:headless',
        policy: 'optimize',
        status: 'optimized',
        displayOriginalPrompt: 'Run the focused test suite',
        optimizationCount: 1,
        inputHash: expect.any(String),
        preparedTextHash: expect.any(String)
      }
    })
    if (prepared.kind !== 'ready') return
    expect(prepared.envelope.effectivePrompt).toContain('[AgentHub Prompt Optimizer]')
  })

  it('does not silently truncate long ambiguous CLI prompt candidates', async () => {
    const longPrompt = 'fix this ' + 'x'.repeat(20_000)
    const prepared = await prepareHeadlessPrompt({
      prompt: longPrompt,
      workspace: tempDir(),
      nonInteractive: true
    })

    expect(prepared.kind).toBe('decision-required')
    if (prepared.kind !== 'decision-required') return
    // Each candidate must preserve the full optimized prompt, not a 16K-truncated copy.
    for (const candidate of prepared.candidates) {
      expect(candidate.length).toBeGreaterThan(16_000)
      expect(candidate).toContain('x'.repeat(20_000))
    }
  })

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

  it.each([true, false])('dry-run skips preparation and spawning for an ambiguous %s TTY mode', async nonInteractive => {
    const ws = tempDir()
    const runsDir = tempDir()
    const preparePrompt = vi.fn()
    const spawnAgent = vi.fn()

    const result = await runHeadlessAgent({
      workspace: ws,
      prompt: 'Fix it',
      dryRun: true,
      nonInteractive,
      runsDir
    }, { preparePrompt, spawnAgent } as any)

    expect(result).toMatchObject({ ok: true, status: 'dry-run', exitCode: 0 })
    expect(preparePrompt).not.toHaveBeenCalled()
    expect(spawnAgent).not.toHaveBeenCalled()
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
      prompt: 'Run the binary prompt',
      agentBinary: process.execPath,
      agentArgs: ['-e', "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write('BIN:'+d.trim());});"],
      runsDir,
      timeoutMs: 15_000
    })
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('BIN:[AgentHub Prompt Optimizer]')
    expect(result.stdout).toContain('Run the binary prompt')
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
