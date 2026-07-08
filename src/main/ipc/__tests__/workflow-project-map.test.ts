import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const projectMapMock = vi.hoisted(() => ({
  buildProjectMap: vi.fn(() => ({
    nodes: [{ name: 'src', path: 'src', type: 'directory' }],
    stats: { totalFiles: 10, totalDirectories: 2, totalSize: 1000, languages: { typescript: 5 } }
  })),
  searchProjectFiles: vi.fn(() => [{ name: 'index.ts', path: 'src/index.ts' }])
}))

const workspaceRootGuardMock = vi.hoisted(() => ({
  resolveRegisteredWorkspaceRoot: vi.fn((root: string) => {
    if (root === 'C:/registered-workspace') return root
    return null
  })
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  app: {
    getPath: vi.fn((name: string) => name === 'home' ? 'C:/Users/test' : 'C:/' + name),
    isPackaged: false,
    getAppPath: vi.fn(() => 'C:/app')
  }
}))

vi.mock('../../runtime/project-map', () => projectMapMock)
vi.mock('../../ipc/workspace-root-guard', () => workspaceRootGuardMock)

describe('projectMap IPC path validation', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    projectMapMock.buildProjectMap.mockClear()
    projectMapMock.searchProjectFiles.mockClear()
    workspaceRootGuardMock.resolveRegisteredWorkspaceRoot.mockClear()
    vi.resetModules()
  })

  async function setup() {
    const { registerWorkflowIpc } = await import('../workflow-ipc')
    registerWorkflowIpc({
      resolveAppVersionFromMain: () => '1.0.0',
      getWorkspaceManager: () => ({ getActive: () => 'ws-1' }),
      store: { get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => ({})) },
      memory: () => ({ listEntries: () => [] }),
      providerMgr: { getConfig: () => ({ providers: [] }) },
      registry: { getAll: () => [] }
    })
  }

  it('rejects building project map for unregistered workspace paths', async () => {
    await setup()

    const handler = electronMock.handlers.get('projectMap:build')
    expect(handler).toBeTruthy()

    const result = handler?.({}, 'C:/unregistered-path', 3)
    expect(result).toEqual({ nodes: [], stats: { totalFiles: 0, totalDirectories: 0, totalSize: 0, languages: {} } })
    expect(projectMapMock.buildProjectMap).not.toHaveBeenCalled()
  })

  it('allows building project map for registered workspace paths', async () => {
    await setup()

    const handler = electronMock.handlers.get('projectMap:build')
    expect(handler).toBeTruthy()

    const result = handler?.({}, 'C:/registered-workspace', 3)
    expect(result).toEqual({
      nodes: [{ name: 'src', path: 'src', type: 'directory' }],
      stats: { totalFiles: 10, totalDirectories: 2, totalSize: 1000, languages: { typescript: 5 } }
    })
    expect(projectMapMock.buildProjectMap).toHaveBeenCalledWith('C:/registered-workspace', 3)
  })
})
