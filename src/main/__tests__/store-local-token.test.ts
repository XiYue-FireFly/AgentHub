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
  })
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
    vi.resetModules()
  })

  it('flushes a newly generated local token immediately', async () => {
    const { getLocalToken } = await import('../store')

    const token = getLocalToken()

    expect(token).toMatch(/^[a-f0-9]{48}$/)
    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1)
    expect(fsMock.renameSync).toHaveBeenCalledTimes(1)
    const targetPath = fsMock.renameSync.mock.calls[0]?.[1]
    const saved = JSON.parse(fsMock.files.get(targetPath) || '{}')
    expect(saved['local.token']).toBe(token)
  })

  it('does not rewrite an existing local token', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ 'local.token': 'existing-token' }))
    const { getLocalToken } = await import('../store')

    expect(getLocalToken()).toBe('existing-token')
    expect(fsMock.writeFileSync).not.toHaveBeenCalled()
    expect(fsMock.renameSync).not.toHaveBeenCalled()
  })
})
