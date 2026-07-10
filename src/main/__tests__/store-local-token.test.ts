import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  userData: 'C:/agenthub-test-user-data',
  getPath: vi.fn(() => 'C:/agenthub-test-user-data')
}))

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
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
    if (content === undefined) throw new Error(`Missing rename source: ${from}`)
    fsMock.files.set(to, content)
    fsMock.files.delete(from)
  }),
  promises: {
    writeFile: vi.fn(async (path: string, content: string) => {
      fsMock.files.set(path, content)
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const content = fsMock.files.get(from)
      if (content === undefined) throw new Error(`Missing rename source: ${from}`)
      fsMock.files.set(to, content)
      fsMock.files.delete(from)
    })
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: electronMock.getPath
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

vi.mock('fs', () => fsMock)

vi.mock('../logger', () => ({
  createLogger: () => loggerMock
}))

describe('main store local token', () => {
  beforeEach(() => {
    fsMock.files.clear()
    loggerMock.error.mockReset()
    loggerMock.warn.mockReset()
    loggerMock.info.mockReset()
    loggerMock.debug.mockReset()
    electronMock.getPath.mockReset().mockImplementation(() => electronMock.userData)
    fsMock.existsSync.mockReset().mockImplementation((path: string) => fsMock.files.has(path))
    fsMock.readFileSync.mockReset().mockImplementation((path: string) => fsMock.files.get(path) || '{}')
    fsMock.writeFileSync.mockReset().mockImplementation((path: string, content: string) => {
      fsMock.files.set(path, content)
    })
    fsMock.renameSync.mockReset().mockImplementation((from: string, to: string) => {
      const content = fsMock.files.get(from)
      if (content === undefined) throw new Error(`Missing rename source: ${from}`)
      fsMock.files.set(to, content)
      fsMock.files.delete(from)
    })
    fsMock.promises.writeFile.mockReset().mockImplementation(async (path: string, content: string) => {
      fsMock.files.set(path, content)
    })
    fsMock.promises.rename.mockReset().mockImplementation(async (from: string, to: string) => {
      const content = fsMock.files.get(from)
      if (content === undefined) throw new Error(`Missing rename source: ${from}`)
      fsMock.files.set(to, content)
      fsMock.files.delete(from)
    })
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes a newly generated local token immediately', async () => {
    vi.useFakeTimers()
    const { getLocalToken } = await import('../store')

    const token = getLocalToken()

    expect(token).toMatch(/^[a-f0-9]{48}$/)
    for (let i = 0; i < 10; i++) await Promise.resolve()
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

  it('rejects a failed atomic commit without publishing it and recovers on later persistence', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ 'atomic.value': 'old' }))
    const renameError = new Error('rename failed')
    fsMock.promises.rename.mockRejectedValueOnce(renameError)
    const { store } = await import('../store')

    await expect(store.commit('atomic.value', 'rejected')).rejects.toBe(renameError)

    expect(store.get('atomic.value')).toBe('old')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.value']).toBe('old')

    await store.commit('atomic.value', 'committed')
    store.set('legacy.flush', 'recovered')
    await store.flush()

    expect(store.get('atomic.value')).toBe('committed')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')).toMatchObject({
      'atomic.value': 'committed',
      'legacy.flush': 'recovered'
    })
  })

  it('automatically persists pending legacy data after a commit rename fails', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ persisted: 'old' }))
    const renameError = new Error('rename failed')
    fsMock.promises.rename.mockRejectedValueOnce(renameError)
    const { store } = await import('../store')

    store.set('pending.legacy', 'A')
    await expect(store.commit('atomic.value', 'B')).rejects.toBe(renameError)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(fsMock.promises.rename).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')).toEqual({
      persisted: 'old',
      'pending.legacy': 'A'
    })
    expect(store.get('atomic.value')).toBeUndefined()
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Commit failed'),
      'rename failed'
    )

    await store.commit('atomic.next', 'available')
    expect(store.get('atomic.next')).toBe('available')
  })

  it('logs a failed pending recovery and keeps the shared chain reusable', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    const originalConfig = JSON.stringify({ persisted: 'old' })
    fsMock.files.set(configPath, originalConfig)
    const commitError = new Error('commit rename failed')
    const recoveryError = new Error('recovery rename failed')
    fsMock.promises.rename
      .mockRejectedValueOnce(commitError)
      .mockRejectedValueOnce(recoveryError)
    const { store } = await import('../store')

    store.set('pending.legacy', 'A')
    await expect(store.commit('atomic.value', 'B')).rejects.toBe(commitError)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(fsMock.files.get(configPath)).toBe(originalConfig)
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Commit failed'),
      'commit rename failed'
    )
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Persist failed'),
      'recovery rename failed'
    )

    await store.flush()
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')).toEqual({
      persisted: 'old',
      'pending.legacy': 'A'
    })
  })

  it('runs concurrent commits one at a time in FIFO order', async () => {
    let releaseFirstRename!: () => void
    let markFirstRenameStarted!: () => void
    const firstRenameGate = new Promise<void>(resolve => { releaseFirstRename = resolve })
    const firstRenameStarted = new Promise<void>(resolve => { markFirstRenameStarted = resolve })
    const operations: string[] = []
    let renameCount = 0

    fsMock.promises.writeFile.mockImplementation(async (path: string, content: string) => {
      const value = JSON.parse(content)['atomic.queue']
      operations.push(`write:${value}`)
      fsMock.files.set(path, content)
    })
    fsMock.promises.rename.mockImplementation(async (from: string, to: string) => {
      const content = fsMock.files.get(from)
      if (content === undefined) throw new Error(`Missing rename source: ${from}`)
      operations.push(`rename:${JSON.parse(content)['atomic.queue']}`)
      renameCount++
      if (renameCount === 1) {
        markFirstRenameStarted()
        await firstRenameGate
      }
      fsMock.files.set(to, content)
      fsMock.files.delete(from)
    })

    const { store } = await import('../store')
    const first = store.commit('atomic.queue', 'first')
    const second = store.commit('atomic.queue', 'second')

    await firstRenameStarted
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(operations).toEqual(['write:first', 'rename:first'])
    expect(operations).not.toContain('write:second')
    releaseFirstRename()
    await Promise.all([first, second])

    const configPath = join(electronMock.userData, 'config.json')
    expect(operations).toEqual([
      'write:first',
      'rename:first',
      'write:second',
      'rename:second'
    ])
    expect(store.get('atomic.queue')).toBe('second')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.queue']).toBe('second')
  })

  it('preserves a different-key set while a commit is in flight', async () => {
    let releaseCommitWrite!: () => void
    let markCommitWriteStarted!: () => void
    const commitWriteGate = new Promise<void>(resolve => { releaseCommitWrite = resolve })
    const commitWriteStarted = new Promise<void>(resolve => { markCommitWriteStarted = resolve })
    let writeCount = 0

    fsMock.promises.writeFile.mockImplementation(async (path: string, content: string) => {
      writeCount++
      if (writeCount === 1) {
        markCommitWriteStarted()
        await commitWriteGate
      }
      fsMock.files.set(path, content)
    })

    const { store } = await import('../store')
    const committing = store.commit('atomic.key', 'committed')
    await commitWriteStarted

    store.set('later.key', 'set-during-commit')
    const flushing = store.flush()
    releaseCommitWrite()
    await Promise.all([committing, flushing])

    const configPath = join(electronMock.userData, 'config.json')
    expect(store.get('atomic.key')).toBe('committed')
    expect(store.get('later.key')).toBe('set-during-commit')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')).toMatchObject({
      'atomic.key': 'committed',
      'later.key': 'set-during-commit'
    })
  })

  it('keeps a later same-key set when an earlier commit finishes', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ 'atomic.race': 'old' }))
    let releaseCommitWrite!: () => void
    let markCommitWriteStarted!: () => void
    const commitWriteGate = new Promise<void>(resolve => { releaseCommitWrite = resolve })
    const commitWriteStarted = new Promise<void>(resolve => { markCommitWriteStarted = resolve })
    let writeCount = 0

    fsMock.promises.writeFile.mockImplementation(async (path: string, content: string) => {
      writeCount++
      if (writeCount === 1) {
        markCommitWriteStarted()
        await commitWriteGate
      }
      fsMock.files.set(path, content)
    })

    const { store } = await import('../store')
    const committing = store.commit('atomic.race', 'commit-value')
    await commitWriteStarted

    store.set('atomic.race', 'set-wins')
    const flushing = store.flush()
    releaseCommitWrite()
    await Promise.all([committing, flushing])

    expect(store.get('atomic.race')).toBe('set-wins')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.race']).toBe('set-wins')
  })

  it('recovers a same-key set when a later failed commit cancels its only timer', async () => {
    vi.useFakeTimers()
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ 'atomic.race': 'old' }))
    const { store } = await import('../store')

    const firstCommit = store.commit('atomic.race', 'C1')
    store.set('atomic.race', 'S')
    await firstCommit

    expect(store.get('atomic.race')).toBe('S')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.race']).toBe('C1')

    const secondCommitError = new Error('second commit rename failed')
    fsMock.promises.rename.mockRejectedValueOnce(secondCommitError)
    await expect(store.commit('atomic.race', 'C2')).rejects.toBe(secondCommitError)
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(fsMock.promises.rename).toHaveBeenCalledTimes(3)
    expect(store.get('atomic.race')).toBe('S')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.race']).toBe('S')
  })

  it('rolls back the legacy watermark when a queued flush is overwritten by a commit', async () => {
    vi.useFakeTimers()
    const configPath = join(electronMock.userData, 'config.json')
    fsMock.files.set(configPath, JSON.stringify({ 'atomic.race': 'old' }))
    let releaseFirstRename!: () => void
    let markFirstRenameStarted!: () => void
    const firstRenameGate = new Promise<void>(resolve => { releaseFirstRename = resolve })
    const firstRenameStarted = new Promise<void>(resolve => { markFirstRenameStarted = resolve })
    const secondCommitError = new Error('second commit rename failed')
    const operations: string[] = []
    let renameCount = 0

    fsMock.promises.writeFile.mockImplementation(async (path: string, content: string) => {
      operations.push(`write:${JSON.parse(content)['atomic.race']}`)
      fsMock.files.set(path, content)
    })
    fsMock.promises.rename.mockImplementation(async (from: string, to: string) => {
      const content = fsMock.files.get(from)
      if (content === undefined) throw new Error(`Missing rename source: ${from}`)
      operations.push(`rename:${JSON.parse(content)['atomic.race']}`)
      renameCount++
      if (renameCount === 1) {
        markFirstRenameStarted()
        await firstRenameGate
      }
      if (renameCount === 3) throw secondCommitError
      fsMock.files.set(to, content)
      fsMock.files.delete(from)
    })

    const { store } = await import('../store')
    const precedingFlush = store.flush()
    const firstCommit = store.commit('atomic.race', 'C1')
    store.set('atomic.race', 'S')

    await firstRenameStarted
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(operations).toEqual(['write:S', 'rename:S'])
    releaseFirstRename()
    await Promise.all([precedingFlush, firstCommit])

    expect(store.get('atomic.race')).toBe('S')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.race']).toBe('C1')
    expect(operations).toEqual(['write:S', 'rename:S', 'write:C1', 'rename:C1'])

    await expect(store.commit('atomic.race', 'C2')).rejects.toBe(secondCommitError)
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(fsMock.promises.rename).toHaveBeenCalledTimes(4)
    expect(operations).toEqual([
      'write:S',
      'rename:S',
      'write:C1',
      'rename:C1',
      'write:C2',
      'rename:C2',
      'write:S',
      'rename:S'
    ])
    expect(store.get('atomic.race')).toBe('S')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.race']).toBe('S')
  })

  it('publishes the persisted clone when the caller mutates a nested commit value during I/O', async () => {
    let releaseWrite!: () => void
    let markWriteStarted!: () => void
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
    const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve })
    fsMock.promises.writeFile.mockImplementationOnce(async (path: string, content: string) => {
      markWriteStarted()
      await writeGate
      fsMock.files.set(path, content)
    })

    const { store } = await import('../store')
    const value = { nested: { version: 'V1' } }
    const committing = store.commit('atomic.object', value)
    await writeStarted

    value.nested.version = 'V2'
    releaseWrite()
    await committing

    const configPath = join(electronMock.userData, 'config.json')
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')['atomic.object']).toEqual({
      nested: { version: 'V1' }
    })
    expect(store.get('atomic.object')).toEqual({ nested: { version: 'V1' } })
    expect(store.get('atomic.object')).not.toBe(value)
  })

  it.each([
    ['circular', () => {
      const value: Record<string, any> = {}
      value.self = value
      return value
    }],
    ['BigInt', () => ({ count: 1n })]
  ])('rejects a non-JSON %s commit value without publishing it', async (_label, makeValue) => {
    const configPath = join(electronMock.userData, 'config.json')
    const originalConfig = JSON.stringify({ 'atomic.invalid': 'old' })
    fsMock.files.set(configPath, originalConfig)
    const { store } = await import('../store')

    await expect(store.commit('atomic.invalid', makeValue())).rejects.toBeInstanceOf(TypeError)

    expect(store.get('atomic.invalid')).toBe('old')
    expect(fsMock.files.get(configPath)).toBe(originalConfig)
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Commit failed'),
      expect.any(String)
    )

    await store.commit('atomic.valid', 'chain-recovered')
    expect(store.get('atomic.valid')).toBe('chain-recovered')
  })

  it('cancels a pending debounce and includes earlier sets in the commit snapshot', async () => {
    vi.useFakeTimers()
    const { store } = await import('../store')
    store.set('pending.legacy', 'included')

    await store.commit('atomic.key', 'committed')
    await vi.advanceTimersByTimeAsync(250)

    const configPath = join(electronMock.userData, 'config.json')
    expect(fsMock.promises.rename).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fsMock.files.get(configPath) || '{}')).toMatchObject({
      'pending.legacy': 'included',
      'atomic.key': 'committed'
    })
  })

  it('rejects atomic commit when reading an existing config fails', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    const originalConfig = JSON.stringify({ existing: 'keep' })
    fsMock.files.set(configPath, originalConfig)
    fsMock.readFileSync.mockImplementationOnce(() => {
      throw new Error('read failed')
    })
    const { store } = await import('../store')

    await expect(store.commit('atomic.key', 'value')).rejects.toThrow('Store is not initialized')

    expect(fsMock.files.get(configPath)).toBe(originalConfig)
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Load failed'),
      'read failed'
    )
  })

  it('rejects atomic commit when the existing config contains malformed JSON', async () => {
    const configPath = join(electronMock.userData, 'config.json')
    const malformedConfig = '{"existing":'
    fsMock.files.set(configPath, malformedConfig)
    const { store } = await import('../store')

    await expect(store.commit('atomic.key', 'value')).rejects.toThrow('Store is not initialized')

    expect(fsMock.files.get(configPath)).toBe(malformedConfig)
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Load failed'),
      expect.any(String)
    )
  })

  it('rejects commit after initialization fails without writing an empty path', async () => {
    vi.useFakeTimers()
    electronMock.getPath.mockImplementationOnce(() => {
      throw new Error('userData unavailable')
    })
    const { store } = await import('../store')
    store.set('pending.legacy', 'value')

    await expect(store.commit('atomic.key', 'value')).rejects.toThrow('Store is not initialized')
    await vi.advanceTimersByTimeAsync(250)
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
  })

  it('does not schedule persistence for a standalone set after initialization fails', async () => {
    vi.useFakeTimers()
    electronMock.getPath.mockImplementationOnce(() => {
      throw new Error('userData unavailable')
    })
    const { store } = await import('../store')

    store.set('pending.legacy', 'value')
    await vi.advanceTimersByTimeAsync(250)

    expect(store.get('pending.legacy')).toBeUndefined()
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalled()
  })

  it('safely skips a direct flush when initialization fails', async () => {
    electronMock.getPath.mockImplementationOnce(() => {
      throw new Error('userData unavailable')
    })
    const { store } = await import('../store')

    await store.flush()

    expect(electronMock.getPath).toHaveBeenCalledTimes(1)
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled()
    expect(fsMock.promises.rename).not.toHaveBeenCalled()
    expect(loggerMock.error).toHaveBeenCalled()
  })
})
