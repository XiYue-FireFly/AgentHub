import { scanPlugins, validateManifest, getPluginContributions, listPluginRepositories, importPluginRepository } from '../runtime/plugin-manager'
import { installPlugin, uninstallPlugin, togglePlugin, listInstalledPlugins, getEnabledContributions } from '../runtime/plugin-manager-enhanced'
import {
  listMarketplace,
  installMarketplacePlugin,
  getMarketplacePlugin,
  listBuiltinMarketplace
} from '../runtime/plugin-marketplace'
import {
  loadTrustStore,
  addTrustedPublisher,
  removeTrustedPublisher
} from '../runtime/plugin-signature'
import { resolveRegisteredWorkspaceRoot } from './workspace-root-guard'
import { typedHandle } from './typed-ipc'

export function registerPluginsIpc(): void {
  typedHandle("plugins:scan", (_e, workspaceRoot) => {
    if (!workspaceRoot) return []
    const root = resolveRegisteredWorkspaceRoot(workspaceRoot)
    if (!root) return []
    return scanPlugins(root)
  })
  typedHandle("plugins:validate", (_e, manifest) => validateManifest(manifest))
  typedHandle("plugins:contributions", (_e, plugins) => getPluginContributions(plugins))
  typedHandle("plugins:repositories", () => listPluginRepositories())
  typedHandle("plugins:importRepository", (_e, input) => importPluginRepository(input))

  typedHandle("plugins:install", (_e, manifest) => installPlugin(manifest))
  typedHandle("plugins:uninstall", (_e, id) => uninstallPlugin(id))
  typedHandle("plugins:toggle", (_e, id) => togglePlugin(id))
  typedHandle("plugins:listInstalled", () => listInstalledPlugins())
  typedHandle("plugins:enabledContributions", () => getEnabledContributions())

  // Wave4+: marketplace + publisher trust
  typedHandle("plugins:marketplaceList", (_e, registryUrl) => listMarketplace(registryUrl))
  typedHandle("plugins:marketplaceInstall", async (_e, pluginId, options) => {
    const listed = await listMarketplace(options?.registryUrl)
    const plugin = getMarketplacePlugin(pluginId, listed.plugins.length ? listed.plugins : listBuiltinMarketplace())
    if (!plugin) return { ok: false, error: `Marketplace plugin not found: ${pluginId}` }
    return installMarketplacePlugin(plugin, { requireSignature: options?.requireSignature })
  })
  typedHandle("plugins:trustList", () => loadTrustStore().publishers)
  typedHandle("plugins:trustAdd", (_e, publisher) => addTrustedPublisher(publisher).publishers)
  typedHandle("plugins:trustRemove", (_e, id) => removeTrustedPublisher(id).publishers)
}
