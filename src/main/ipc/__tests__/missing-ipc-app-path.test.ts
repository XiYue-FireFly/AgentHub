import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getPath: vi.fn((name: string) => resolve(process.cwd(), name)),
  showOpenDialog: vi.fn(),
  openExternal: vi.fn()
}))

const workspaceMock = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; rootPath: string }>,
  activeId: null as string | null
}))

const openTargetMock = vi.hoisted(() => ({
  openWithEditor: vi.fn(async () => ({ ok: true }))
}))

const fsMock = vi.hoisted(() => ({
  statSync: vi.fn(() => ({ size: 10 })),
  readFileSync: vi.fn(() => 'file content')
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  shell: { openExternal: electronMock.openExternal },
  dialog: { showOpenDialog: electronMock.showOpenDialog },
  app: { getPath: electronMock.getPath }
}))

vi.mock('../../hub/workspace', () => ({
  getWorkspaceManager: () => ({
    list: () => workspaceMock.workspaces,
    getActive: () => workspaceMock.activeId,
    getById: (id: string) => workspaceMock.workspaces.find(workspace => workspace.id === id)
  })
}))

vi.mock('../../runtime/open-target', () => openTargetMock)

vi.mock('node:fs', () => fsMock)

vi.mock('../../providers/client', () => ({
  ProviderClient: vi.fn()
}))

describe('missing IPC app path workspace trust', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.getPath.mockImplementation((name: string) => resolve(process.cwd(), name))
    electronMock.showOpenDialog.mockReset()
    electronMock.openExternal.mockReset()
    workspaceMock.workspaces = []
    workspaceMock.activeId = null
    openTargetMock.openWithEditor.mockClear()
    fsMock.statSync.mockClear()
    fsMock.statSync.mockReturnValue({ size: 10 })
    fsMock.readFileSync.mockClear()
    fsMock.readFileSync.mockReturnValue('file content')
    vi.resetModules()
  })

  async function setup(getMainWindow: () => any = () => null) {
    const { registerMissingIpc } = await import('../missing-ipc')
    registerMissingIpc({
      dispatcher: null,
      runtimeStore: null,
      registry: null,
      providerMgr: { getProvider: vi.fn(), getEnabledProviders: vi.fn() },
      proxy: null,
      hub: null,
      getMainWindow,
      memory: () => null
    })
  }

  it('rejects explicit unregistered workspace roots for app path operations', async () => {
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    const otherRoot = resolve(process.cwd(), 'other-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]

    await setup()

    await expect(electronMock.handlers.get('app:resolvePath')?.({}, {
      path: 'README.md',
      workspaceRoot: otherRoot
    })).resolves.toMatchObject({ ok: false, error: 'Access denied: workspace root is not registered' })

    await expect(electronMock.handlers.get('app:readTextFile')?.({}, {
      path: 'README.md',
      workspaceRoot: otherRoot
    })).resolves.toMatchObject({
      ok: false,
      path: 'README.md',
      error: 'Access denied: workspace root is not registered'
    })

    await expect(electronMock.handlers.get('app:openPath')?.({}, {
      path: 'README.md',
      target: 'editor',
      workspaceRoot: otherRoot
    })).resolves.toMatchObject({ ok: false, error: 'Access denied: workspace root is not registered' })
    expect(openTargetMock.openWithEditor).not.toHaveBeenCalled()
  })

  it('rejects sensitive filenames before reading from disk', async () => {
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]

    await setup()

    await expect(electronMock.handlers.get('app:readTextFile')?.({}, {
      path: '.env',
      workspaceRoot: registeredRoot
    })).resolves.toMatchObject({
      ok: false,
      path: '.env',
      error: 'Access to sensitive file type denied'
    })
    await expect(electronMock.handlers.get('app:readTextFile')?.({}, {
      path: '.ssh/id_rsa.pub',
      workspaceRoot: registeredRoot
    })).resolves.toMatchObject({
      ok: false,
      path: '.ssh/id_rsa.pub',
      error: 'Access to sensitive file type denied'
    })

    expect(fsMock.statSync).not.toHaveBeenCalled()
    expect(fsMock.readFileSync).not.toHaveBeenCalled()
  })

  it('resolves legal paths under explicit registered workspace roots', async () => {
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]

    await setup()

    await expect(electronMock.handlers.get('app:resolvePath')?.({}, {
      path: 'project..demo/README.md',
      workspaceRoot: registeredRoot
    })).resolves.toEqual({
      ok: true,
      path: resolve(registeredRoot, 'project..demo/README.md')
    })
  })

  it('returns resolved path with readTextFile success content', async () => {
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]

    await setup()

    await expect(electronMock.handlers.get('app:readTextFile')?.({}, {
      path: 'notes/readme.md',
      workspaceRoot: registeredRoot
    })).resolves.toEqual({
      ok: true,
      path: resolve(registeredRoot, 'notes/readme.md'),
      content: 'file content'
    })
  })

  it('returns resolved path with file-too-large errors', async () => {
    const registeredRoot = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: registeredRoot }]
    fsMock.statSync.mockReturnValue({ size: 1_000_001 })

    await setup()

    await expect(electronMock.handlers.get('app:readTextFile')?.({}, {
      path: 'large.log',
      workspaceRoot: registeredRoot
    })).resolves.toEqual({
      ok: false,
      path: resolve(registeredRoot, 'large.log'),
      error: 'File too large'
    })
    expect(fsMock.readFileSync).not.toHaveBeenCalled()
  })

  it('keeps app openExternal protocol allowlist behavior', async () => {
    await setup()

    await expect(electronMock.handlers.get('app:openExternal')?.({}, 'https://agenthub.dev'))
      .resolves.toEqual({ ok: true })
    await expect(electronMock.handlers.get('app:openExternal')?.({}, 'file:///secret.txt'))
      .resolves.toEqual({ ok: false, error: 'Invalid URL scheme' })
    expect(electronMock.openExternal).toHaveBeenCalledTimes(1)
    expect(electronMock.openExternal).toHaveBeenCalledWith('https://agenthub.dev')
  })

  it('returns null for pickFolder and pickFiles when no window is available', async () => {
    await setup()

    await expect(electronMock.handlers.get('app:pickFolder')?.({}, { defaultPath: 'C:\\repo' }))
      .resolves.toBeNull()
    await expect(electronMock.handlers.get('app:pickFiles')?.({}, { defaultPath: 'C:\\repo' }))
      .resolves.toBeNull()
    expect(electronMock.showOpenDialog).not.toHaveBeenCalled()
  })

  it('returns null on picker cancel and paths on picker success', async () => {
    const win = { id: 1 }
    await setup(() => win)

    electronMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(electronMock.handlers.get('app:pickFolder')?.({}, { defaultPath: 'C:\\repo' }))
      .resolves.toBeNull()

    electronMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\repo'] })
    await expect(electronMock.handlers.get('app:pickFolder')?.({}, { defaultPath: 'C:\\repo' }))
      .resolves.toBe('C:\\repo')

    electronMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(electronMock.handlers.get('app:pickFiles')?.({}, { defaultPath: 'C:\\repo' }))
      .resolves.toBeNull()

    electronMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\repo\\a.md', 'C:\\repo\\b.txt'] })
    await expect(electronMock.handlers.get('app:pickFiles')?.({}, { defaultPath: 'C:\\repo' }))
      .resolves.toEqual(['C:\\repo\\a.md', 'C:\\repo\\b.txt'])
  })
})
