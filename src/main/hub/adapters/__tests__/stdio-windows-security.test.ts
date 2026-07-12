import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { StdioAgentAdapter } from '../stdio-adapter'

const describeWindows = process.platform === 'win32' ? describe : describe.skip
const fixture = fileURLToPath(new URL('./fixtures/stdio-argv-fixture.cmd', import.meta.url))
const fixtureDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url))
const temporaryDirectories: string[] = []

async function runFixture(prompt: string, binary = fixture): Promise<string[]> {
  const cwd = await mkdtemp(join(tmpdir(), 'agenthub-stdio-security-'))
  temporaryDirectories.push(cwd)
  const adapter = new StdioAgentAdapter('fixture', 'Windows argv fixture', binary, ['--capture', '{prompt}'])
  let stdout = ''
  adapter.onOutput = chunk => { stdout += chunk }
  await adapter.start()

  await new Promise<void>((resolve, reject) => {
    adapter.onError = reject
    adapter.send(prompt, { cwd })
    const child = (adapter as any).proc
    child.once('exit', (code: number | null) => {
      setImmediate(() => code === 0 ? resolve() : reject(new Error(`fixture exited with ${code}`)))
    })
  })

  return JSON.parse(stdout)
}

describeWindows('StdioAgentAdapter Windows command safety', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it('passes quotes and cmd metacharacters as one literal prompt argument', async () => {
    const prompts = [
      'hello" & echo AGENTHUB_INJECTION_PROOF & echo "x',
      'literal & pipe | redirects < > caret ^ percent % parens ( ) bang ! quote "',
      'do not expand %PATH% or !COMSPEC!',
      'slashes before quote: \\ " \\" and trailing \\',
      ''
    ]

    for (const prompt of prompts) {
      expect(await runFixture(prompt)).toEqual(['--capture', prompt])
    }
  }, 15_000)

  it('selects a supported Windows launcher when PATH also contains an extensionless shim', async () => {
    const originalPath = process.env.PATH
    process.env.PATH = `${fixtureDirectory};${originalPath || ''}`
    try {
      expect(await runFixture('literal prompt', 'stdio-path-fixture')).toEqual(['--capture', 'literal prompt'])
    } finally {
      process.env.PATH = originalPath
    }
  })
})
