import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, afterEach } from 'vitest'

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFileSync: vi.fn()
}))

vi.mock('child_process', () => childProcessMock)

import { appendBoundedStdoutBuffer, resolvePromptArg, StdioAgentAdapter } from '../stdio-adapter'

/**
 * Multi-line prompt preservation:
 * - direct spawn keeps newlines in the argv value;
 * - cmd.exe /c flattens newlines to avoid breaking command-line parsing.
 */
describe('resolvePromptArg', () => {
  const multi = 'line one\nline two\r\nline three'

  it('keeps newlines for direct spawn', () => {
    expect(resolvePromptArg(multi, false)).toBe(multi)
  })

  it('flattens newlines for the cmd.exe path', () => {
    expect(resolvePromptArg(multi, true)).toBe('line one line two line three')
  })

  it('leaves single-line prompts unchanged', () => {
    expect(resolvePromptArg('hello', false)).toBe('hello')
    expect(resolvePromptArg('hello', true)).toBe('hello')
  })
})

describe('appendBoundedStdoutBuffer', () => {
  it('keeps only the tail when stdout exceeds the cap', () => {
    expect(appendBoundedStdoutBuffer('abcdef', 'ghijkl', 5)).toBe('hijkl')
  })
})

describe('StdioAgentAdapter stdout buffering', () => {
  afterEach(() => {
    childProcessMock.spawn.mockReset()
    childProcessMock.exec.mockReset()
    childProcessMock.execFileSync.mockReset()
  })

  it('does not maintain the diagnostic stdout buffer when activityParser consumes the stream', async () => {
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const stdin = { write: vi.fn(), end: vi.fn() }
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: typeof stdin
    }
    proc.stdout = stdout
    proc.stderr = stderr
    proc.stdin = stdin

    childProcessMock.spawn.mockReturnValue(proc as any)

    const adapter = new StdioAgentAdapter('test', 'Test CLI', 'test.exe', [])
    const parsedLines: string[] = []
    const outputs: string[] = []
    adapter.activityParser = (line) => {
      parsedLines.push(line)
      return { content: `parsed:${line}\n` }
    }
    adapter.onOutput = chunk => outputs.push(chunk)

    adapter.send('prompt')
    stdout.emit('data', Buffer.from('{"event":"one"}\n{"event":"two"}\n'))
    proc.emit('exit', 0)

    expect(parsedLines).toEqual(['{"event":"one"}', '{"event":"two"}'])
    expect(outputs).toEqual(['parsed:{"event":"one"}\n', 'parsed:{"event":"two"}\n'])
    expect((adapter as any).buffer).toBe('')
  })
})
