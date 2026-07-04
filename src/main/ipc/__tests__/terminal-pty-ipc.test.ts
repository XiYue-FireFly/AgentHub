import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: any, ...args: any[]) => any

const handlers = new Map<string, IpcHandler>()
const spawnedPtys: FakePty[] = []

class FakeSender extends EventEmitter {
  sent: Array<{ channel: string; payload: any }> = []
  destroyed = false

  send(channel: string, payload: any) {
    this.sent.push({ channel, payload })
  }

  isDestroyed() {
    return this.destroyed
  }

  listenerCountFor(event: string) {
    return this.listenerCount(event)
  }
}

class FakePty {
  killed = false
  writes: string[] = []
  dataHandler: ((data: string) => void) | null = null
  exitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null

  onData(handler: (data: string) => void) {
    this.dataHandler = handler
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void) {
    this.exitHandler = handler
  }

  write(data: string) {
    this.writes.push(data)
  }

  resize() {}

  kill() {
    this.killed = true
  }

  emitData(data: string) {
    this.dataHandler?.(data)
  }

  emitExit(exitCode = 0) {
    this.exitHandler?.({ exitCode })
  }
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => handlers.set(channel, handler)
  },
  BrowserWindow: class {}
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const pty = new FakePty()
    spawnedPtys.push(pty)
    return pty
  })
}))

describe('Terminal PTY IPC', () => {
  beforeEach(() => {
    handlers.clear()
    spawnedPtys.length = 0
    vi.resetModules()
  })

  async function setup() {
    const mod = await import('../terminal-pty-ipc')
    mod.registerTerminalPtyIpc(() => null)
    return mod
  }

  it('reattaches an existing live session without killing or respawning it', async () => {
    await setup()
    const create = handlers.get('terminal:create')
    expect(create).toBeTruthy()

    const firstSender = new FakeSender()
    await create?.({ sender: firstSender }, { sessionId: 'term-1', cwd: process.cwd() })
    expect(spawnedPtys).toHaveLength(1)

    spawnedPtys[0].emitData('hello\r\n')
    expect(firstSender.sent).toContainEqual({ channel: 'terminal:data', payload: { sessionId: 'term-1', data: 'hello\r\n' } })

    const secondSender = new FakeSender()
    const result = await create?.({ sender: secondSender }, { sessionId: 'term-1', cwd: process.cwd() })

    expect(result).toEqual({ ok: true, reattached: true })
    expect(spawnedPtys).toHaveLength(1)
    expect(spawnedPtys[0].killed).toBe(false)
    expect(firstSender.listenerCountFor('destroyed')).toBe(0)
    expect(secondSender.listenerCountFor('destroyed')).toBe(1)
    expect(secondSender.sent).toContainEqual({ channel: 'terminal:data', payload: { sessionId: 'term-1', data: 'hello\r\n' } })
  })

  it('removes the destroyed listener when a session exits normally', async () => {
    await setup()
    const create = handlers.get('terminal:create')
    const sender = new FakeSender()
    await create?.({ sender }, { sessionId: 'term-exit', cwd: process.cwd() })

    expect(sender.listenerCountFor('destroyed')).toBe(1)
    spawnedPtys[0].emitExit(0)

    expect(sender.listenerCountFor('destroyed')).toBe(0)
    expect(sender.sent).toContainEqual({ channel: 'terminal:exit', payload: { sessionId: 'term-exit', exitCode: 0 } })
  })

  it('registers terminal lifecycle handlers', async () => {
    await setup()
    expect([...handlers.keys()].sort()).toEqual([
      'terminal:create',
      'terminal:dispose',
      'terminal:resize',
      'terminal:write'
    ])
  })
})
