import { scanPlugins, validateManifest, getPluginContributions, listPluginRepositories, importPluginRepository } from '../runtime/plugin-manager'
import { installPlugin, uninstallPlugin, togglePlugin, listInstalledPlugins, getEnabledContributions } from '../runtime/plugin-manager-enhanced'
import { typedHandle } from './typed-ipc'

export function registerPluginsIpc(): void {
  typedHandle("plugins:scan", (_e, workspaceRoot) => scanPlugins(workspaceRoot))
  typedHandle("plugins:validate", (_e, manifest) => validateManifest(manifest))
  typedHandle("plugins:contributions", (_e, plugins) => getPluginContributions(plugins))
  typedHandle("plugins:repositories", () => listPluginRepositories())
  typedHandle("plugins:importRepository", (_e, input) => importPluginRepository(input))

  typedHandle("plugins:install", (_e, manifest) => installPlugin(manifest))
  typedHandle("plugins:uninstall", (_e, id) => uninstallPlugin(id))
  typedHandle("plugins:toggle", (_e, id) => togglePlugin(id))
  typedHandle("plugins:listInstalled", () => listInstalledPlugins())
  typedHandle("plugins:enabledContributions", () => getEnabledContributions())
}
