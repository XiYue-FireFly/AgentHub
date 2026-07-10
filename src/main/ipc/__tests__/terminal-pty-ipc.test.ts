import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: any, ...args: any[]) => any

const handlers = new Map<string, IpcHandler>()
const spawnedPtys: FakePty[] = []

const workspaceMock = vi.hoisted(() => ({
  roots: [] as string[]
}))

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
  resizes: Array<{ cols: number; rows: number }> = []
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

  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows })
  }

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
  BrowserWindow: class {},
  app: {
    getPath: (name: string) => (name === 'userData' ? 'C:/tmp-user-data' : `C:/${name}`),
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  }
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const pty = new FakePty()
    spawnedPtys.push(pty)
    return pty
  })
}))

vi.mock('../../hub/workspace', () => ({
  getWorkspaceManager: () => ({
    list: () => workspaceMock.roots.map((rootPath, i) => ({ id: `ws-${i}`, rootPath }))
  })
}))

describe('Terminal PTY IPC', () => {
  beforeEach(() => {
    handlers.clear()
    spawnedPtys.length = 0
    workspaceMock.roots = []
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

  it('forwards write and resize to a live session and stops forwarding after dispose', async () => {
    await setup()
    const create = handlers.get('terminal:create')
    const write = handlers.get('terminal:write')
    const resize = handlers.get('terminal:resize')
    const dispose = handlers.get('terminal:dispose')
    const sender = new FakeSender()
    await create?.({ sender }, { sessionId: 'term-io', cwd: process.cwd() })

    await write?.({ sender }, { sessionId: 'term-io', data: 'echo ok\r' })
    await resize?.({ sender }, { sessionId: 'term-io', cols: 120, rows: 32 })

    expect(spawnedPtys[0].writes).toEqual(['echo ok\r'])
    expect(spawnedPtys[0].resizes).toEqual([{ cols: 120, rows: 32 }])

    await dispose?.({ sender }, 'term-io')
    await write?.({ sender }, { sessionId: 'term-io', data: 'after dispose\r' })

    expect(spawnedPtys[0].killed).toBe(true)
    expect(spawnedPtys[0].writes).toEqual(['echo ok\r'])
  })

  it('rejects write from a non-owner sender (F-N1)', async () => {
    await setup()
    const create = handlers.get('terminal:create')
    const write = handlers.get('terminal:write')
    const owner = new FakeSender()
    const other = new FakeSender()
    await create?.({ sender: owner }, { sessionId: 'term-own', cwd: process.cwd() })
    await write?.({ sender: other }, { sessionId: 'term-own', data: 'hack\r' })
    expect(spawnedPtys[0].writes).toEqual([])
    await write?.({ sender: owner }, { sessionId: 'term-own', data: 'ok\r' })
    expect(spawnedPtys[0].writes).toEqual(['ok\r'])
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

  it('rejects cwd outside registered workspaces when workspaces exist', async () => {
    workspaceMock.roots = [resolve(process.cwd(), 'fake-ws-root')]
    await setup()
    const create = handlers.get('terminal:create')
    const sender = new FakeSender()
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc'
    const result = await create?.({ sender }, { sessionId: 'term-bad-cwd', cwd: outside })
    expect(result).toEqual({ ok: false, message: 'cwd must be within a registered workspace' })
    expect(spawnedPtys).toHaveLength(0)
  })

  it('allows cwd under process.cwd when no workspaces are registered', async () => {
    workspaceMock.roots = []
    await setup()
    const create = handlers.get('terminal:create')
    const sender = new FakeSender()
    const result = await create?.({ sender }, { sessionId: 'term-dev-cwd', cwd: process.cwd() })
    expect(result).toEqual({ ok: true })
    expect(spawnedPtys).toHaveLength(1)
  })

  it('rejects cwd outside process.cwd when no workspaces are registered', async () => {
    workspaceMock.roots = []
    await setup()
    const create = handlers.get('terminal:create')
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc'
    const result = await create?.({ sender: new FakeSender() }, {
      sessionId: 'term-no-ws-outside',
      cwd: outside
    })
    expect(result).toEqual({ ok: false, message: 'cwd must be within a registered workspace' })
    expect(spawnedPtys).toHaveLength(0)
  })

  it('allows cwd inside a registered workspace root', async () => {
    workspaceMock.roots = [process.cwd()]
    await setup()
    const create = handlers.get('terminal:create')
    const sender = new FakeSender()
    const result = await create?.({ sender }, { sessionId: 'term-ws-cwd', cwd: process.cwd() })
    expect(result).toEqual({ ok: true })
    expect(spawnedPtys).toHaveLength(1)
  })
})
