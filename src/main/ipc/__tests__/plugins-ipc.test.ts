import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcPayloadValidationError } from '../../../shared/ipc-contract'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>()
}))

const pluginManagerMock = vi.hoisted(() => ({
  scanPlugins: vi.fn(() => []),
  validateManifest: vi.fn(() => ({ valid: true, errors: [] })),
  getPluginContributions: vi.fn(() => ({ commands: [], skills: [], prompts: [] })),
  listPluginRepositories: vi.fn(() => []),
  importPluginRepository: vi.fn(async () => ({ ok: true, path: 'plugins/example' }))
}))

const pluginLifecycleMock = vi.hoisted(() => ({
  installPlugin: vi.fn((manifest: any) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    dependencies: manifest.dependencies || [],
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    enabled: true,
    contributes: manifest.contributes || {}
  })),
  uninstallPlugin: vi.fn(() => true),
  togglePlugin: vi.fn(() => false),
  listInstalledPlugins: vi.fn(() => []),
  getEnabledContributions: vi.fn(() => ({}))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../runtime/plugin-manager', () => pluginManagerMock)
vi.mock('../../runtime/plugin-manager-enhanced', () => pluginLifecycleMock)

describe('plugins IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    for (const value of Object.values(pluginManagerMock)) value.mockClear()
    for (const value of Object.values(pluginLifecycleMock)) value.mockClear()
    vi.resetModules()
  })

  async function setup() {
    const { registerPluginsIpc } = await import('../plugins-ipc')
    registerPluginsIpc()
  }

  it('delegates valid plugin inventory and lifecycle requests', async () => {
    await setup()
    const manifest = {
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      contributes: {
        commands: [{ id: 'example.run', label: 'Run example' }],
        skills: [{ id: 'example.skill', path: 'skills/example/SKILL.md' }],
        prompts: [{ id: 'example.prompt', name: 'Prompt', body: 'Hello' }]
      }
    }
    const pluginEntry = {
      id: 'global::example',
      manifest,
      path: 'C:/plugins/example',
      enabled: true,
      source: 'global'
    }

    expect(electronMock.handlers.get('plugins:scan')?.({}, 'C:/workspace')).toEqual([])
    expect(electronMock.handlers.get('plugins:validate')?.({}, manifest)).toEqual({ valid: true, errors: [] })
    expect(electronMock.handlers.get('plugins:contributions')?.({}, [pluginEntry])).toEqual({ commands: [], skills: [], prompts: [] })
    await expect(electronMock.handlers.get('plugins:importRepository')?.({}, { url: 'https://github.com/acme/example.git' })).resolves.toEqual({
      ok: true,
      path: 'plugins/example'
    })
    expect(electronMock.handlers.get('plugins:install')?.({}, manifest)).toMatchObject({ id: 'example', enabled: true })
    expect(electronMock.handlers.get('plugins:uninstall')?.({}, 'example')).toBe(true)
    expect(electronMock.handlers.get('plugins:toggle')?.({}, 'example')).toBe(false)

    expect(pluginManagerMock.scanPlugins).toHaveBeenCalledWith('C:/workspace')
    expect(pluginManagerMock.validateManifest).toHaveBeenCalledWith(manifest)
    expect(pluginManagerMock.getPluginContributions).toHaveBeenCalledWith([pluginEntry])
    expect(pluginManagerMock.importPluginRepository).toHaveBeenCalledWith({ url: 'https://github.com/acme/example.git' })
    expect(pluginLifecycleMock.installPlugin).toHaveBeenCalledWith(manifest)
  })

  it('rejects invalid plugin scan and repository import payloads before runtime work', async () => {
    await setup()

    expect(() => electronMock.handlers.get('plugins:scan')?.({}, { root: 'C:/workspace' })).toThrow(
      new IpcPayloadValidationError('plugins:scan', 'workspaceRoot must be a string')
    )
    expect(() => electronMock.handlers.get('plugins:importRepository')?.({}, {
      url: 'file:///tmp/plugin.git'
    })).toThrow(new IpcPayloadValidationError('plugins:importRepository', 'input.url must use https'))
    expect(() => electronMock.handlers.get('plugins:importRepository')?.({}, {
      url: 'http://github.com/acme/example.git'
    })).toThrow(new IpcPayloadValidationError('plugins:importRepository', 'input.url must use https'))
    expect(() => electronMock.handlers.get('plugins:importRepository')?.({}, {
      url: 'https://example.com/acme/example.git'
    })).toThrow(new IpcPayloadValidationError('plugins:importRepository', 'input.url host must be github.com or gitcode.com'))
    expect(() => electronMock.handlers.get('plugins:importRepository')?.({}, {
      url: 'https://github.com/acme'
    })).toThrow(new IpcPayloadValidationError('plugins:importRepository', 'input.url must include owner and repository name'))
    expect(() => electronMock.handlers.get('plugins:importRepository')?.({}, {
      url: 'https://github.com/acme/example.git',
      branch: null
    })).toThrow(new IpcPayloadValidationError('plugins:importRepository', 'input.branch must be a string'))

    expect(pluginManagerMock.scanPlugins).not.toHaveBeenCalled()
    expect(pluginManagerMock.importPluginRepository).not.toHaveBeenCalled()
  })

  it('rejects invalid plugin manifests and contribution paths before install/contribution processing', async () => {
    await setup()

    expect(() => electronMock.handlers.get('plugins:install')?.({}, {
      id: 'bad',
      name: 'Bad',
      version: '1.0.0',
      contributes: {
        skills: [{ id: 'escape', path: '../outside/SKILL.md' }]
      }
    })).toThrow(new IpcPayloadValidationError('plugins:install', 'manifest.contributes.skills[0].path must be a relative path without traversal'))

    expect(() => electronMock.handlers.get('plugins:install')?.({}, {
      name: 'Missing id',
      version: '1.0.0'
    })).toThrow(new IpcPayloadValidationError('plugins:install', 'manifest.id must be a string'))

    expect(() => electronMock.handlers.get('plugins:install')?.({}, {
      id: 'bad-null-skills',
      name: 'Bad',
      version: '1.0.0',
      contributes: { skills: null }
    })).toThrow(new IpcPayloadValidationError('plugins:install', 'manifest.contributes.skills must be an array'))

    expect(() => electronMock.handlers.get('plugins:install')?.({}, {
      id: 'bad-null-commands',
      name: 'Bad',
      version: '1.0.0',
      contributes: { commands: null }
    })).toThrow(new IpcPayloadValidationError('plugins:install', 'manifest.contributes.commands must be an array'))

    expect(() => electronMock.handlers.get('plugins:install')?.({}, {
      id: 'bad-null-prompts',
      name: 'Bad',
      version: '1.0.0',
      contributes: { prompts: null }
    })).toThrow(new IpcPayloadValidationError('plugins:install', 'manifest.contributes.prompts must be an array'))

    expect(() => electronMock.handlers.get('plugins:contributions')?.({}, [{
      id: 'global::bad',
      manifest: { name: 'Bad', version: '1.0.0', contributes: { prompts: [{ id: 'p', name: 'P', body: 42 }] } },
      path: 'C:/plugins/bad',
      enabled: true,
      source: 'global'
    }])).toThrow(new IpcPayloadValidationError('plugins:contributions', 'plugins[0].manifest.contributes.prompts[0].body must be a string'))

    expect(pluginLifecycleMock.installPlugin).not.toHaveBeenCalled()
    expect(pluginManagerMock.getPluginContributions).not.toHaveBeenCalled()
  })

  it('rejects invalid plugin id mutations before registry writes', async () => {
    await setup()

    expect(() => electronMock.handlers.get('plugins:uninstall')?.({}, '')).toThrow(
      new IpcPayloadValidationError('plugins:uninstall', 'id must not be empty')
    )
    expect(() => electronMock.handlers.get('plugins:toggle')?.({}, null)).toThrow(
      new IpcPayloadValidationError('plugins:toggle', 'id must be a string')
    )

    expect(pluginLifecycleMock.uninstallPlugin).not.toHaveBeenCalled()
    expect(pluginLifecycleMock.togglePlugin).not.toHaveBeenCalled()
  })
})
