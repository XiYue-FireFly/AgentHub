import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn()
}))

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  execFile: childProcessMock.execFile
}))

function fakeChild(pid = 4321) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child
}

describe('agentic exec abort', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    childProcessMock.spawn.mockReset()
    childProcessMock.execFile.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('kills the Windows process tree on abort and settles only after child close', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const child = fakeChild()
    childProcessMock.spawn.mockReturnValue(child)
    const taskkill = {
      callback: null as ((error?: Error | null) => void) | null
    }
    childProcessMock.execFile.mockImplementation((_file, _args, _options, callback) => {
      taskkill.callback = callback
      return {} as any
    })
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const { executeTool } = await import('../tools')

    const operation = executeTool('exec', { command: 'long-running' }, {
      root: process.cwd(),
      readOnly: false,
      signal: controller.signal
    })
    let settled = false
    void operation.then(() => { settled = true })

    try {
      controller.abort()
      await Promise.resolve()

      expect(childProcessMock.execFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '4321', '/t', '/f'],
        { windowsHide: true },
        expect.any(Function)
      )
      expect(settled).toBe(false)
      taskkill.callback?.(null)
      await Promise.resolve()
      expect(settled).toBe(false)

      child.emit('close', 1)
      const result = await operation
      expect(result).toMatchObject({ ok: false, output: expect.stringMatching(/abort/i) })
      const abortListener = addListener.mock.calls.find(call => call[0] === 'abort')?.[1]
      expect(abortListener).toBeDefined()
      expect(removeListener).toHaveBeenCalledWith('abort', abortListener)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      taskkill.callback?.(null)
      child.emit('close', 1)
      await operation
    }
  })

  it('spawns POSIX commands in a detached process group and kills the group on abort', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = fakeChild(9876)
    childProcessMock.spawn.mockReturnValue(child)
    const controller = new AbortController()
    const { executeTool } = await import('../tools')

    const operation = executeTool('exec', { command: 'sleep 30' }, {
      root: process.cwd(),
      readOnly: false,
      signal: controller.signal
    })

    controller.abort()
    await Promise.resolve()

    expect(childProcessMock.spawn).toHaveBeenCalledWith('sleep', ['30'], expect.objectContaining({
      shell: false,
      detached: true
    }))
    expect(killSpy).toHaveBeenCalledWith(-9876, 'SIGTERM')

    child.emit('close', 1)
    await expect(operation).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/abort/i) })
  })
})
