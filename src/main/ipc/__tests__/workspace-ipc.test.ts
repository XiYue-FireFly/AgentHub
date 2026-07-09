import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getPath: vi.fn((name: string) => resolve(process.cwd(), name))
}))

const workspaceMock = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; rootPath: string }>,
  activeId: null as string | null,
  create: vi.fn((input: { name: string; rootPath: string }) => ({
    id: 'ws-created',
    name: input.name,
    rootPath: input.rootPath,
    bootstrapFiles: [],
    createdAt: 1,
    updatedAt: 1
  })),
  update: vi.fn((id: string, patch: any) => ({
    id,
    name: patch.name || 'Workspace',
    rootPath: patch.rootPath || resolve(process.cwd(), 'registered-workspace'),
    bootstrapFiles: patch.bootstrapFiles || [],
    createdAt: 1,
    updatedAt: 2
  })),
  remove: vi.fn(() => true),
  setActive: vi.fn((id: string | null) => {
    workspaceMock.activeId = id
  })
}))

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(async () => 'file content'),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readdir: vi.fn(async () => [])
}))

const workspaceFilesMock = vi.hoisted(() => ({
  listWorkspaceFiles: vi.fn(() => [{ relativePath: 'README.md' }]),
  searchWorkspaceFiles: vi.fn(() => [{ relativePath: 'README.md' }]),
  readFilePreview: vi.fn(async () => ({ ok: true, content: 'preview' }))
}))

const worktreesMock = vi.hoisted(() => ({
  createWorktree: vi.fn((input: any) => ({
    id: 'wt-1',
    parentWorkspaceId: input.parentWorkspaceId,
    path: input.path || resolve(process.cwd(), 'registered-workspace-feature'),
    branch: input.branch || 'feature',
    status: 'clean',
    createdAt: 1
  })),
  listWorktrees: vi.fn(() => []),
  openWorktree: vi.fn(() => ({
    id: 'ws-opened',
    name: 'feature',
    rootPath: resolve(process.cwd(), 'registered-workspace-feature'),
    createdAt: 1,
    updatedAt: 1
  })),
  removeWorktree: vi.fn(() => true),
  syncWorktree: vi.fn((id: string) => ({
    id,
    parentWorkspaceId: 'ws-1',
    path: resolve(process.cwd(), 'registered-workspace-feature'),
    branch: 'feature',
    status: 'clean',
    createdAt: 1
  }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  app: { getPath: electronMock.getPath }
}))

vi.mock('node:fs/promises', () => fsMock)

vi.mock('../../runtime/worktrees', () => worktreesMock)

vi.mock('../../runtime/workspace-files', () => workspaceFilesMock)

vi.mock('../../hub/workspace', () => ({
  WorkspaceNotFoundError: class WorkspaceNotFoundError extends Error {
    code = 'WORKSPACE_NOT_FOUND'
  },
  WorkspacePathInvalidError: class WorkspacePathInvalidError extends Error {
    code = 'WORKSPACE_PATH_INVALID'
  },
  getWorkspaceManager: () => ({
    list: () => workspaceMock.workspaces,
    getActive: () => workspaceMock.activeId,
    getById: (id: string) => workspaceMock.workspaces.find(workspace => workspace.id === id),
    create: workspaceMock.create,
    update: workspaceMock.update,
    remove: workspaceMock.remove,
    setActive: workspaceMock.setActive
  })
}))

describe('workspace IPC file path trust', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.workspaces = []
    workspaceMock.activeId = null
    workspaceMock.create.mockClear()
    workspaceMock.update.mockClear()
    workspaceMock.remove.mockClear()
    workspaceMock.setActive.mockClear()
    fsMock.readFile.mockClear()
    fsMock.mkdir.mockClear()
    fsMock.writeFile.mockClear()
    fsMock.readdir.mockClear()
    workspaceFilesMock.listWorkspaceFiles.mockClear()
    workspaceFilesMock.searchWorkspaceFiles.mockClear()
    for (const value of Object.values(worktreesMock)) value.mockClear()
    vi.resetModules()
  })

  async function setup() {
    const { registerWorkspaceIpc } = await import('../workspace-ipc')
    registerWorkspaceIpc()
  }

  it('allows legal relative file names containing two dots under registered roots', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    const read = electronMock.handlers.get('workspaceFiles:read')
    const result = await read?.({}, root, 'release..notes.md')

    expect(result).toEqual({ ok: true, content: 'file content', path: resolve(root, 'release..notes.md') })
    expect(fsMock.readFile).toHaveBeenCalledWith(resolve(root, 'release..notes.md'), 'utf-8')
  })

  it('rejects read/write/image/directory operations for unregistered roots', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    const otherRoot = resolve(process.cwd(), 'other-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    await expect(electronMock.handlers.get('workspaceFiles:read')?.({}, otherRoot, 'README.md'))
      .resolves.toMatchObject({ ok: false, error: 'Invalid path' })
    await expect(electronMock.handlers.get('workspaceFiles:write')?.({}, otherRoot, 'README.md', 'content'))
      .resolves.toEqual({ ok: false, error: 'Invalid path' })
    await expect(electronMock.handlers.get('workspaceFiles:readImage')?.({}, otherRoot, 'logo.png'))
      .resolves.toMatchObject({ ok: false, error: 'Invalid path' })
    await expect(electronMock.handlers.get('workspaceFiles:listDirectory')?.({}, otherRoot, '.'))
      .resolves.toMatchObject({ ok: false, error: 'Invalid path' })

    expect(fsMock.readFile).not.toHaveBeenCalled()
    expect(fsMock.writeFile).not.toHaveBeenCalled()
    expect(fsMock.readdir).not.toHaveBeenCalled()
  })

  it('rejects traversal paths even when the root is registered', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    await expect(electronMock.handlers.get('workspaceFiles:read')?.({}, root, '../secret.txt'))
      .resolves.toMatchObject({ ok: false, error: 'Invalid path' })

    expect(fsMock.readFile).not.toHaveBeenCalled()
  })

  it('uses only registered roots for list and search', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    const otherRoot = resolve(process.cwd(), 'other-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    expect(electronMock.handlers.get('workspaceFiles:list')?.({}, otherRoot, 10)).toEqual([])
    expect(electronMock.handlers.get('workspaceFiles:search')?.({}, otherRoot, 'readme', 10)).toEqual([])
    expect(workspaceFilesMock.listWorkspaceFiles).not.toHaveBeenCalled()
    expect(workspaceFilesMock.searchWorkspaceFiles).not.toHaveBeenCalled()

    expect(electronMock.handlers.get('workspaceFiles:list')?.({}, root, 10)).toEqual([{ relativePath: 'README.md' }])
    expect(electronMock.handlers.get('workspaceFiles:search')?.({}, root, 'readme', 10)).toEqual([{ relativePath: 'README.md' }])
    expect(workspaceFilesMock.listWorkspaceFiles).toHaveBeenCalledWith(root, 10)
    expect(workspaceFilesMock.searchWorkspaceFiles).toHaveBeenCalledWith(root, 'readme', 10)
  })

  it('allows list and search inside registered workspace subdirectories', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    const srcDir = resolve(root, 'src')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    expect(electronMock.handlers.get('workspaceFiles:list')?.({}, srcDir, 10)).toEqual([{ relativePath: 'README.md' }])
    expect(electronMock.handlers.get('workspaceFiles:search')?.({}, srcDir, 'readme', 10)).toEqual([{ relativePath: 'README.md' }])
    expect(workspaceFilesMock.listWorkspaceFiles).toHaveBeenCalledWith(srcDir, 10)
    expect(workspaceFilesMock.searchWorkspaceFiles).toHaveBeenCalledWith(srcDir, 'readme', 10)
  })

  it('delegates workspace CRUD and active workspace requests', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    workspaceMock.activeId = 'ws-1'
    await setup()

    expect(electronMock.handlers.get('workspaces:list')?.({})).toEqual([{ id: 'ws-1', rootPath: root }])
    expect(electronMock.handlers.get('workspaces:create')?.({}, { name: 'New', rootPath: root })).toMatchObject({
      id: 'ws-created',
      name: 'New',
      rootPath: root
    })
    expect(electronMock.handlers.get('workspaces:update')?.({}, 'ws-1', { name: 'Renamed' })).toMatchObject({
      id: 'ws-1',
      name: 'Renamed'
    })
    expect(electronMock.handlers.get('workspaces:remove')?.({}, 'ws-1')).toBe(true)
    expect(electronMock.handlers.get('workspaces:getActive')?.({})).toBe('ws-1')
    expect(electronMock.handlers.get('workspaces:setActive')?.({}, null)).toBeNull()

    expect(workspaceMock.create).toHaveBeenCalledWith({ name: 'New', rootPath: root })
    expect(workspaceMock.update).toHaveBeenCalledWith('ws-1', { name: 'Renamed' })
    expect(workspaceMock.remove).toHaveBeenCalledWith('ws-1')
    expect(workspaceMock.setActive).toHaveBeenCalledWith(null)
  })

  it('preserves workspace error codes when workspace manager operations fail', async () => {
    workspaceMock.create.mockImplementationOnce(() => {
      const err = new Error('Invalid workspace path "missing": not found') as Error & { code: string }
      err.code = 'WORKSPACE_PATH_INVALID'
      err.name = 'WorkspacePathInvalidError'
      throw err
    })
    await setup()

    let thrown: (Error & { code?: string }) | null = null
    try {
      electronMock.handlers.get('workspaces:create')?.({}, { name: 'Broken', rootPath: 'missing' })
    } catch (error) {
      thrown = error as Error & { code?: string }
    }

    expect(thrown).toMatchObject({
      message: 'Invalid workspace path "missing": not found',
      code: 'WORKSPACE_PATH_INVALID'
    })
  })

  it('rejects reading sensitive files like .env in workspace', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    const read = electronMock.handlers.get('workspaceFiles:read')
    const result = await read?.({}, root, '.env')

    expect(result).toEqual({ ok: false, content: '', path: '', error: 'Access denied: sensitive file' })
    expect(fsMock.readFile).not.toHaveBeenCalled()
  })

  it('rejects reading sensitive files like id_rsa in workspace', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    const read = electronMock.handlers.get('workspaceFiles:read')
    const result = await read?.({}, root, '.ssh/id_rsa')

    expect(result).toEqual({ ok: false, content: '', path: '', error: 'Access denied: sensitive file' })
    expect(fsMock.readFile).not.toHaveBeenCalled()
  })

  it('rejects previewing sensitive files like .env', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    workspaceMock.activeId = 'ws-1'
    await setup()

    const preview = electronMock.handlers.get('workspaceFiles:preview')
    const result = await preview?.({}, resolve(root, '.env'), 50)

    expect(result).toEqual({ ok: false, error: 'Access denied: sensitive file' })
    expect(workspaceFilesMock.readFilePreview).not.toHaveBeenCalled()
  })

  it('allows reading non-sensitive files in workspace', async () => {
    const root = resolve(process.cwd(), 'registered-workspace')
    workspaceMock.workspaces = [{ id: 'ws-1', rootPath: root }]
    await setup()

    const read = electronMock.handlers.get('workspaceFiles:read')
    const result = await read?.({}, root, 'README.md')

    expect(result).toEqual({ ok: true, content: 'file content', path: resolve(root, 'README.md') })
    expect(fsMock.readFile).toHaveBeenCalled()
  })

  it('delegates worktree operations with arguments intact', async () => {
    await setup()
    const input = { parentWorkspaceId: 'ws-1', branch: 'feature', path: resolve(process.cwd(), 'registered-workspace-feature') }

    expect(electronMock.handlers.get('worktrees:list')?.({}, 'ws-1')).toEqual([])
    expect(await electronMock.handlers.get('worktrees:create')?.({}, input)).toMatchObject({
      id: 'wt-1',
      parentWorkspaceId: 'ws-1',
      branch: 'feature'
    })
    expect(await electronMock.handlers.get('worktrees:remove')?.({}, 'wt-1', true)).toBe(true)
    expect(await electronMock.handlers.get('worktrees:sync')?.({}, 'wt-1')).toMatchObject({
      id: 'wt-1',
      status: 'clean'
    })
    expect(await electronMock.handlers.get('worktrees:open')?.({}, 'wt-1')).toMatchObject({
      id: 'ws-opened',
      name: 'feature'
    })

    expect(worktreesMock.listWorktrees).toHaveBeenCalledWith('ws-1')
    expect(worktreesMock.createWorktree).toHaveBeenCalledWith(input)
    expect(worktreesMock.removeWorktree).toHaveBeenCalledWith('wt-1', true)
    expect(worktreesMock.syncWorktree).toHaveBeenCalledWith('wt-1')
    expect(worktreesMock.openWorktree).toHaveBeenCalledWith('wt-1')
  })
})
