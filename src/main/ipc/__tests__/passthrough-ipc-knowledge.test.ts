import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const projectKnowledgeMock = vi.hoisted(() => ({
  detectTechStack: vi.fn(() => ({ language: 'typescript', framework: 'react' })),
  generateWorkspaceSummary: vi.fn(() => 'Project summary')
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
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => null)
  }
}))

vi.mock('../../runtime/project-knowledge-enhanced', () => projectKnowledgeMock)
vi.mock('../../ipc/workspace-root-guard', () => workspaceRootGuardMock)

describe('knowledge IPC path validation', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    projectKnowledgeMock.detectTechStack.mockClear()
    projectKnowledgeMock.generateWorkspaceSummary.mockClear()
    workspaceRootGuardMock.resolveRegisteredWorkspaceRoot.mockClear()
    vi.resetModules()
  })

  async function setup() {
    const { registerPassthroughIpc } = await import('../passthrough-ipc')
    registerPassthroughIpc({
      memory: () => ({ listEntries: () => [] }),
      store: {},
      runtimeStore: { snapshot: () => ({ turns: [] }), eventsSince: () => [] },
      dispatcher: {},
      registry: { getAll: () => [] },
      providerMgr: { getConfig: () => ({ providers: [] }) },
      resolveAppVersionFromMain: () => '1.0.0',
      registerAgentsFromBindings: () => {},
      getWorkspaceManager: () => ({ getActive: () => 'ws-1' }),
      getMainWindow: () => null
    })
  }

  it('rejects detecting tech stack for unregistered workspace paths', async () => {
    await setup()

    const handler = electronMock.handlers.get('knowledge:detectTechStack')
    expect(handler).toBeTruthy()

    const result = handler?.({}, 'C:/unregistered-path')
    expect(result).toEqual({})
    expect(projectKnowledgeMock.detectTechStack).not.toHaveBeenCalled()
  })

  it('allows detecting tech stack for registered workspace paths', async () => {
    await setup()

    const handler = electronMock.handlers.get('knowledge:detectTechStack')
    expect(handler).toBeTruthy()

    const result = handler?.({}, 'C:/registered-workspace')
    expect(result).toEqual({ language: 'typescript', framework: 'react' })
    expect(projectKnowledgeMock.detectTechStack).toHaveBeenCalledWith('C:/registered-workspace')
  })

  it('rejects generating summary for unregistered workspace paths', async () => {
    await setup()

    const handler = electronMock.handlers.get('knowledge:generateSummary')
    expect(handler).toBeTruthy()

    const result = handler?.({}, 'C:/unregistered-path', [])
    expect(result).toEqual('')
    expect(projectKnowledgeMock.generateWorkspaceSummary).not.toHaveBeenCalled()
  })

  it('allows generating summary for registered workspace paths', async () => {
    await setup()

    const handler = electronMock.handlers.get('knowledge:generateSummary')
    expect(handler).toBeTruthy()

    const result = handler?.({}, 'C:/registered-workspace', [{ title: 'Entry', content: 'Content', category: 'general' }])
    expect(result).toEqual('Project summary')
    expect(projectKnowledgeMock.generateWorkspaceSummary).toHaveBeenCalledWith('C:/registered-workspace', [{ title: 'Entry', content: 'Content', category: 'general' }])
  })
})
