import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  userData: 'C:/agenthub-test-user-data'
}))

const fsMock = vi.hoisted(() => ({
  files: new Map<string, string>(),
  existsSync: vi.fn((path: string) => fsMock.files.has(path)),
  readFileSync: vi.fn((path: string) => fsMock.files.get(path) || '{}'),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsMock.files.set(path, content)
  }),
  renameSync: vi.fn((from: string, to: string) => {
    const content = fsMock.files.get(from)
    if (content !== undefined) {
      fsMock.files.set(to, content)
      fsMock.files.delete(from)
    }
  }),
  promises: {
    writeFile: vi.fn(async (path: string, content: string) => {
      fsMock.files.set(path, content)
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const content = fsMock.files.get(from)
      if (content !== undefined) {
        fsMock.files.set(to, content)
        fsMock.files.delete(from)
      }
    })
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMock.userData)
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

vi.mock('fs', () => fsMock)

describe('main store local token', () => {
  beforeEach(() => {
    fsMock.files.clear()
    fsMock.existsSync.mockClear()
    fsMock.readFileSync.mockClear()
    fsMock.writeFileSync.mockClear()
    fsMock.renameSync.mockClear()
    fsMock.promises.writeFile.mockClear()
    fsMock.promises.rename.mockClear()
    vi.resetModules()
  })

  it('flushes a newly generated local token immediately', async () => {
    const { getLocalToken } = await import('../store')

    const token = getLocalToken()

    expect(token).toMatch(/^[a-f0-9]{48}$/)
    // Wait for async flush to complete
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(fsMock.promises.writeFile).toHaveBeenCalledTimes(1)
    expect(fsMock.promises.rename).toHaveBeenCalledTimes(1)
    const targetPath = fsMock.promises.rename.mock.calls[0]?.[1]
    const saved = JSON.parse(fsMock.files.get(targetPath) || '{}')
    expect(saved['local.token']).toBe(token)
  })

  it('does not rewrite an existing local token', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ 'local.token': 'existing-token' }))
    const { getLocalToken } = await import('../store')

    expect(getLocalToken()).toBe('existing-token')
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
  })

  it('serializes concurrent set/flush so last write wins without interleave', async () => {
    let releaseWrite: (() => void) | undefined
    const gate = new Promise<void>(resolve => { releaseWrite = resolve })
    let inFlight = 0
    let maxInFlight = 0

    fsMock.promises.writeFile.mockImplementation(async (path: string, content: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      // First write blocks until released so a second enqueue can pile up
      if (inFlight === 1) await gate
      fsMock.files.set(path, content)
      inFlight--
    })

    const { store } = await import('../store')
    store.set('agenthub.test.a', 1)
    const flush1 = store.flush()
    // Let first persist start
    await Promise.resolve()
    store.set('agenthub.test.b', 2)
    const flush2 = store.flush()
    releaseWrite!()
    await Promise.all([flush1, flush2])

    expect(maxInFlight).toBe(1)
    const configPath = join(electronMock.userData, 'config.json')
    const saved = JSON.parse(fsMock.files.get(configPath) || '{}')
    expect(saved['agenthub.test.a']).toBe(1)
    expect(saved['agenthub.test.b']).toBe(2)
  })
})
