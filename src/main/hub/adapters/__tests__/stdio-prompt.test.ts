import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, afterEach } from 'vitest'

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
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
    childProcessMock.execFile.mockReset()
    childProcessMock.execFileSync.mockReset()
    vi.restoreAllMocks()
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

  it('resets stale process result state at the start of a new send', () => {
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
    ;(adapter as any).exitCode = 1
    ;(adapter as any).lastStderr = 'previous failure'

    adapter.send('prompt')

    expect(adapter.getLifecycle()).toMatchObject({
      status: 'busy',
      running: true,
      exitCode: null,
      lastStderr: ''
    })
    expect(adapter.getLifecycle().runId).toBe(1)
  })

  it('exposes a terminal lifecycle snapshot after process exit', () => {
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
    adapter.send('prompt')
    stderr.emit('data', Buffer.from('boom'))
    proc.emit('exit', 2)

    expect(adapter.getLifecycle()).toMatchObject({
      status: 'error',
      running: false,
      exitCode: 2,
      lastStderr: 'boom',
      runId: 1
    })
  })

  it('waits for Windows taskkill when stopping a running process', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const taskkill = {
      callback: null as ((error?: Error | null) => void) | null
    }
    childProcessMock.execFile.mockImplementation((_file: string, _args: string[], _options: any, callback: (error?: Error | null) => void) => {
      taskkill.callback = callback
      return {} as any
    })
    const adapter = new StdioAgentAdapter('test', 'Test CLI', 'test.exe', [])
    ;(adapter as any).proc = { pid: 1234 }

    let stopped = false
    const stopPromise = adapter.stop().then(() => { stopped = true })

    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(childProcessMock.execFile).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '1234', '/t', '/f'],
      { windowsHide: true },
      expect.any(Function)
    )

    expect(taskkill.callback).toBeTypeOf('function')
    taskkill.callback?.(null)
    await stopPromise
    expect(stopped).toBe(true)
    expect((adapter as any).proc).toBeNull()
  })
})
