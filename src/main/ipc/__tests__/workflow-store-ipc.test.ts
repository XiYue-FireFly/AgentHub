import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  userDataDir: 'user-data'
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  },
  app: {
    getPath: vi.fn(() => electronMock.userDataDir)
  }
}))

describe('workflow store IPC allowlist', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.resetModules()
  })

  async function setup() {
    const backing = new Map<string, unknown>()
    const store = {
      get: vi.fn((key: string, defaultValue?: unknown) => backing.has(key) ? backing.get(key) : defaultValue),
      set: vi.fn((key: string, value: unknown) => { backing.set(key, value) })
    }

    const { registerWorkflowIpc } = await import('../workflow-ipc')
    registerWorkflowIpc({
      resolveAppVersionFromMain: () => '1.2.3',
      getWorkspaceManager: () => ({ getActive: () => null }),
      store,
      memory: () => ({ listEntries: () => [] }),
      providerMgr: { getConfig: () => ({ providers: [] }) },
      registry: { getAll: () => [] }
    })

    return store
  }

  it('allows agenthub and appearance keys', async () => {
    const store = await setup()

    expect(electronMock.handlers.get('store:set')?.({}, 'agenthub.workbench.sidebarWidth.v1', 320)).toBe(true)
    expect(electronMock.handlers.get('store:get')?.({}, 'agenthub.workbench.sidebarWidth.v1')).toBe(320)

    expect(store.set).toHaveBeenCalledWith('agenthub.workbench.sidebarWidth.v1', 320)
  })

  it('validates store payload shape before allowlist/runtime side effects', async () => {
    const store = await setup()

    expect(() => electronMock.handlers.get('store:get')?.({}, '')).toThrow(
      new IpcPayloadValidationError('store:get', 'key must not be empty')
    )
    expect(() => electronMock.handlers.get('store:get')?.({}, 'agenthub.valid', () => 'bad')).toThrow(
      new IpcPayloadValidationError('store:get', 'defaultValue must be an object')
    )
    expect(() => electronMock.handlers.get('store:set')?.({}, 'agenthub.valid', undefined)).toThrow(
      new IpcPayloadValidationError('store:set', 'value must be JSON-serializable')
    )
    expect(() => electronMock.handlers.get('store:set')?.({}, 'agenthub.valid', Number.POSITIVE_INFINITY)).toThrow(
      new IpcPayloadValidationError('store:set', 'value must be a finite number')
    )

    expect(store.get).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
  })

  it('allows JSON-like store values and undefined default reads', async () => {
    const store = await setup()
    const value = { layout: { width: 320, tabs: ['chat', 'requirements'], visible: true, empty: null } }

    expect(electronMock.handlers.get('store:get')?.({}, 'agenthub.workbench.sidebarWidth.v1', undefined)).toBeUndefined()
    expect(electronMock.handlers.get('store:set')?.({}, 'agenthub.workbench.layout.v1', value)).toBe(true)

    expect(store.get).toHaveBeenCalledWith('agenthub.workbench.sidebarWidth.v1', undefined)
    expect(store.set).toHaveBeenCalledWith('agenthub.workbench.layout.v1', value)
  })

  it('returns the default for blocked reads without touching the store', async () => {
    const store = await setup()

    const result = electronMock.handlers.get('store:get')?.({}, 'providers.config.v1', 'fallback')

    expect(result).toBe('fallback')
    expect(store.get).not.toHaveBeenCalled()
  })

  it('rejects blocked writes', async () => {
    const store = await setup()

    expect(() => electronMock.handlers.get('store:set')?.({}, 'providers.config.v1', { apiKey: 'secret' }))
      .toThrow('Store key not allowed: providers.config.v1')
    expect(store.set).not.toHaveBeenCalled()
  })
})
