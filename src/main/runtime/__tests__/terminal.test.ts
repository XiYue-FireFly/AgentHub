import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFileSync: vi.fn()
}))

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true)
}))

const electronMock = vi.hoisted(() => ({
  getPath: vi.fn(() => '/agenthub-user-data')
}))

const workspaceMock = vi.hoisted(() => ({
  getById: vi.fn()
}))

const storeMock = vi.hoisted(() => ({
  get: vi.fn(() => ({ terminalShell: 'system' }))
}))

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  execFileSync: childProcessMock.execFileSync
}))

vi.mock('node:fs', () => ({
  existsSync: fsMock.existsSync
}))

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath }
}))

vi.mock('../../hub/workspace', () => ({
  getWorkspaceManager: () => workspaceMock
}))

vi.mock('../../store', () => ({
  store: storeMock
}))

function fakeChild(pid = 2468) {
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

describe('TerminalRuntime workspace and process tree boundaries', () => {
  beforeEach(() => {
    childProcessMock.spawn.mockReset()
    childProcessMock.execFileSync.mockReset()
    fsMock.existsSync.mockReturnValue(true)
    workspaceMock.getById.mockReset()
    storeMock.get.mockReturnValue({ terminalShell: 'system' })
    childProcessMock.spawn.mockReturnValue(fakeChild())
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws for an explicit unknown workspaceId instead of falling back to userData', async () => {
    workspaceMock.getById.mockReturnValue(undefined)
    const { TerminalRuntime } = await import('../terminal')
    const runtime = new TerminalRuntime()

    expect(() => runtime.run({ workspaceId: 'missing-workspace', command: 'echo hi' })).toThrow(/workspace/i)
    expect(childProcessMock.spawn).not.toHaveBeenCalled()
  })

  it('keeps the no-workspace default userData fallback', async () => {
    const { TerminalRuntime } = await import('../terminal')
    const runtime = new TerminalRuntime()

    const run = runtime.run({ command: 'echo hi' })

    expect(run.cwd).toBe('/agenthub-user-data')
    expect(childProcessMock.spawn).toHaveBeenCalled()
  })

  it('uses a detached POSIX process group for cancellable shells', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const { TerminalRuntime } = await import('../terminal')
    const runtime = new TerminalRuntime()

    runtime.run({ command: 'echo hi' })

    expect(childProcessMock.spawn).toHaveBeenCalledWith('/bin/sh', ['-lc', 'echo hi'], expect.objectContaining({
      detached: true
    }))
  })

  it('kills the detached POSIX process group when cancelling a run', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = fakeChild(9876)
    childProcessMock.spawn.mockReturnValue(child)
    const { TerminalRuntime } = await import('../terminal')
    const runtime = new TerminalRuntime()

    const run = runtime.run({ command: 'sleep 60' })
    expect(runtime.cancel(run.id)).toBe(true)

    expect(killSpy).toHaveBeenCalledWith(-9876, 'SIGKILL')
    expect(child.kill).not.toHaveBeenCalled()
  })
})
